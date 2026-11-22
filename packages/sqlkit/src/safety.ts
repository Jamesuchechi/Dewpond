const FORBIDDEN_KEYWORDS = new Set([
  'COPY',
  'ATTACH',
  'DETACH',
  'INSTALL',
  'LOAD',
  'PRAGMA',
  'SET',
  'RESET',
  'EXPORT',
  'IMPORT',
  'CALL',
  'CREATE',
  'DROP',
  'ALTER',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
]);

const FORBIDDEN_FUNCTIONS = new Set([
  'duckdb_secrets',
  'glob',
  'read_csv',
  'read_csv_auto',
  'read_parquet',
  'read_json',
  'read_json_auto',
  'read_ndjson',
  'read_text',
  'read_blob',
  'sniff_csv',
  'parquet_scan',
  'sqlite_scan',
  'excel_scan',
]);

const FORBIDDEN_URI_SCHEMES = [
  'http://',
  'https://',
  's3://',
  'gcs://',
  'az://',
  'r2://',
  'hf://',
  'opfs://',
  'file://',
] as const;

export type SqlSafetyResult = { ok: true } | { ok: false; reasons: string[] };

interface ScannedSql {
  codeWithoutLiteralsOrComments: string;
  stringLiterals: string[];
  quotedIdentifiers: string[];
}

function scanSql(sql: string): { result?: ScannedSql; error?: string } {
  const codeChars: string[] = [];
  const stringLiterals: string[] = [];
  const quotedIdentifiers: string[] = [];
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    // Single-line comment --
    if (ch === '-' && next === '-') {
      i += 2;
      while (i < sql.length && sql[i] !== '\n') {
        i++;
      }
      codeChars.push(' ');
      continue;
    }

    // Block comment /* ... */
    if (ch === '/' && next === '*') {
      i += 2;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === '*' && sql[i + 1] === '/') {
          i += 2;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        return { error: 'Unterminated block comment in SQL statement.' };
      }
      codeChars.push(' ');
      continue;
    }

    // Single-quoted string literal '...'
    if (ch === "'") {
      i++;
      let literal = '';
      let closed = false;
      while (i < sql.length) {
        const cur = sql[i]!;
        if (cur === "'") {
          if (sql[i + 1] === "'") {
            literal += "'";
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        literal += cur;
        i++;
      }
      if (!closed) {
        return { error: 'Unterminated string literal in SQL statement.' };
      }
      stringLiterals.push(literal);
      codeChars.push(' ');
      continue;
    }

    // Double-quoted identifier "..."
    if (ch === '"') {
      i++;
      let identifier = '';
      let closed = false;
      while (i < sql.length) {
        const cur = sql[i]!;
        if (cur === '"') {
          if (sql[i + 1] === '"') {
            identifier += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        identifier += cur;
        i++;
      }
      if (!closed) {
        return { error: 'Unterminated quoted identifier in SQL statement.' };
      }
      quotedIdentifiers.push(identifier);
      codeChars.push(' "ident" ');
      continue;
    }

    codeChars.push(ch);
    i++;
  }

  return {
    result: {
      codeWithoutLiteralsOrComments: codeChars.join(''),
      stringLiterals,
      quotedIdentifiers,
    },
  };
}

function findForbiddenScheme(value: string): string | undefined {
  const lower = value.toLowerCase();
  return FORBIDDEN_URI_SCHEMES.find((scheme) => lower.includes(scheme));
}

/** Validate untrusted read-only user/Recipe SQL against Dewpond's strict allowlist. */
export function validateReadOnlySql(sql: string): SqlSafetyResult {
  const reasons: string[] = [];

  if (sql.includes('\0')) {
    reasons.push('NUL bytes are not allowed in SQL.');
  }

  const scanned = scanSql(sql);
  if (scanned.error || !scanned.result) {
    reasons.push(scanned.error ?? 'Failed to parse SQL safely.');
    return { ok: false, reasons };
  }

  const { codeWithoutLiteralsOrComments, stringLiterals, quotedIdentifiers } = scanned.result;

  for (const literal of stringLiterals) {
    const scheme = findForbiddenScheme(literal);
    if (scheme) {
      reasons.push(`Forbidden URI scheme ${scheme} in string literal.`);
    }
  }

  for (const identifier of quotedIdentifiers) {
    const scheme = findForbiddenScheme(identifier);
    if (scheme) {
      reasons.push(`Forbidden URI scheme ${scheme} in quoted identifier.`);
    }
  }

  const unquotedScheme = findForbiddenScheme(codeWithoutLiteralsOrComments);
  if (unquotedScheme) {
    reasons.push(`Forbidden URI scheme ${unquotedScheme} in SQL.`);
  }

  // Strip a single optional trailing semicolon; any other semicolon is multi-statement.
  const withoutTrailingSemi = codeWithoutLiteralsOrComments.replace(/;\s*$/, '');
  if (withoutTrailingSemi.includes(';')) {
    reasons.push('Multiple SQL statements are not allowed.');
  }

  const trimmed = withoutTrailingSemi.trim();
  if (trimmed.length === 0) {
    reasons.push('SQL statement is empty.');
    return { ok: false, reasons };
  }

  const leadMatch = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(trimmed);
  const firstWord = leadMatch?.[1]?.toUpperCase();
  if (firstWord !== 'SELECT' && firstWord !== 'WITH') {
    reasons.push(
      `Only single SELECT or WITH queries are allowed; found ${firstWord ?? 'non-keyword'}.`,
    );
  }

  const words = trimmed.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
  for (const word of words) {
    const upper = word.toUpperCase();
    if (FORBIDDEN_KEYWORDS.has(upper)) {
      reasons.push(`Forbidden SQL keyword: ${upper}.`);
    }
  }

  const callMatches = trimmed.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g);
  for (const match of callMatches) {
    const fnName = match[1]?.toLowerCase();
    if (fnName && FORBIDDEN_FUNCTIONS.has(fnName)) {
      reasons.push(`Forbidden table/filesystem function: ${fnName}().`);
    }
  }

  if (reasons.length > 0) {
    return { ok: false, reasons: [...new Set(reasons)] };
  }

  return { ok: true };
}
