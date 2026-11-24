import { deflateSync, Inflate } from 'fflate';
import type { Recipe, Step } from './types';
import { validateRecipeJson } from './validate';

export const SHARE_DECODE_MAX_BYTES = 2 * 1024 * 1024;

export interface ShareLiteralFinding {
  stepId: string;
  op: Step['op'];
  reason: string;
}

function encodeUtf8(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let cp = str.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp < 0x800) {
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

function decodeUtf8(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length;) {
    const b0 = bytes[i]!;
    if (b0 < 0x80) {
      parts.push(String.fromCharCode(b0));
      i += 1;
    } else if ((b0 & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      const cp = ((b0 & 0x1f) << 6) | (bytes[i + 1]! & 0x3f);
      parts.push(String.fromCharCode(cp));
      i += 2;
    } else if ((b0 & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      const cp = ((b0 & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f);
      parts.push(String.fromCharCode(cp));
      i += 3;
    } else if ((b0 & 0xf8) === 0xf0 && i + 3 < bytes.length) {
      const cp =
        ((b0 & 0x07) << 18) |
        ((bytes[i + 1]! & 0x3f) << 12) |
        ((bytes[i + 2]! & 0x3f) << 6) |
        (bytes[i + 3]! & 0x3f);
      const offset = cp - 0x10000;
      parts.push(String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff)));
      i += 4;
    } else {
      parts.push('\uFFFD');
      i += 1;
    }
  }
  return parts.join('');
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    out += B64_ALPHABET[(triplet >> 18) & 0x3f];
    out += B64_ALPHABET[(triplet >> 12) & 0x3f];
    out += i + 1 < bytes.length ? B64_ALPHABET[(triplet >> 6) & 0x3f] : '';
    out += i + 2 < bytes.length ? B64_ALPHABET[triplet & 0x3f] : '';
  }
  return out;
}

function fromBase64Url(input: string): Uint8Array {
  const clean = input.replace(/=+$/, '');
  if (!/^[A-Za-z0-9\-_]*$/.test(clean) || clean.length % 4 === 1) {
    throw new Error('Invalid base64url share payload.');
  }
  const outLen = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(outLen);
  let pos = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_ALPHABET.indexOf(clean[i]!);
    const c1 = B64_ALPHABET.indexOf(clean[i + 1]!);
    const c2 = i + 2 < clean.length ? B64_ALPHABET.indexOf(clean[i + 2]!) : 0;
    const c3 = i + 3 < clean.length ? B64_ALPHABET.indexOf(clean[i + 3]!) : 0;
    const triplet = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (pos < outLen) out[pos++] = (triplet >> 16) & 0xff;
    if (pos < outLen) out[pos++] = (triplet >> 8) & 0xff;
    if (pos < outLen) out[pos++] = triplet & 0xff;
  }
  return out;
}

/**
 * Encode a Recipe as a compressed #r= URL fragment token.
 * Local cell/row edit overlays are explicitly excluded from #r= share links.
 */
export function encodeShareRecipe(recipe: Recipe): string {
  const shareSafeRecipe: Recipe = { ...recipe };
  delete shareSafeRecipe.overlay;
  const jsonBytes = encodeUtf8(JSON.stringify(shareSafeRecipe));
  const compressed = deflateSync(jsonBytes, { level: 6 });
  return `#r=${toBase64Url(compressed)}`;
}

/**
 * Decode a #r= URL fragment or token with a strict 2 MB decompressed byte cap
 * (protects against zip-bomb share links) and full v1 schema validation.
 */
export function decodeShareRecipe(
  hashOrToken: string,
  maxBytes = SHARE_DECODE_MAX_BYTES,
): { ok: true; recipe: Recipe } | { ok: false; error: string } {
  try {
    const token = hashOrToken.startsWith('#r=')
      ? hashOrToken.slice(3)
      : hashOrToken.startsWith('r=')
        ? hashOrToken.slice(2)
        : hashOrToken;
    if (!token) {
      return { ok: false, error: 'Empty share recipe token.' };
    }
    const compressed = fromBase64Url(token);
    if (compressed.byteLength > maxBytes) {
      return {
        ok: false,
        error: `Compressed share link exceeds ${maxBytes.toLocaleString('en-US')} byte limit.`,
      };
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let aborted = false;

    const inflator = new Inflate((chunk) => {
      if (aborted) return;
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        aborted = true;
        return;
      }
      chunks.push(chunk);
    });

    const sliceSize = 16 * 1024;
    for (let off = 0; off < compressed.length; off += sliceSize) {
      const end = Math.min(off + sliceSize, compressed.length);
      inflator.push(compressed.subarray(off, end), end === compressed.length);
      if (aborted) {
        return {
          ok: false,
          error: `Decompressed share recipe exceeded ${maxBytes.toLocaleString('en-US')} byte security cap.`,
        };
      }
    }

    const merged = new Uint8Array(totalBytes);
    let pos = 0;
    for (const c of chunks) {
      merged.set(c, pos);
      pos += c.byteLength;
    }

    const parsed = JSON.parse(decodeUtf8(merged)) as unknown;
    const validated = validateRecipeJson(parsed);
    if (!validated.ok) {
      return { ok: false, error: validated.errors.join(' ') };
    }
    return { ok: true, recipe: validated.recipe };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to decode #r= share recipe.',
    };
  }
}

/**
 * Scan a Recipe for steps that carry user-supplied literal values or raw SQL
 * so sharing UI can require explicit review before generating #r= links or .dew.json files.
 */
export function findShareUnsafeLiterals(recipe: Recipe): ShareLiteralFinding[] {
  const findings: ShareLiteralFinding[] = [];
  const activeLimit = Math.min(recipe.head, recipe.steps.length);

  for (let i = 0; i < activeLimit; i++) {
    const step = recipe.steps[i];
    if (!step) continue;

    switch (step.op) {
      case 'filter':
        if (
          step.predicate.value !== undefined &&
          step.predicate.value !== null &&
          step.predicate.op !== 'is_null' &&
          step.predicate.op !== 'not_null'
        ) {
          findings.push({
            stepId: step.id,
            op: step.op,
            reason: `Filter literal on column "${step.predicate.column}" may reveal dataset values.`,
          });
        }
        break;
      case 'replace':
        if (step.search.length > 0 || step.replacement.length > 0) {
          findings.push({
            stepId: step.id,
            op: step.op,
            reason: `Replace literals on column "${step.column}" may reveal dataset values.`,
          });
        }
        break;
      case 'derive':
        if (step.expr.kind === 'literal' && step.expr.value !== null) {
          findings.push({
            stepId: step.id,
            op: step.op,
            reason: `Derived constant for "${step.column}" contains a literal value.`,
          });
        } else if (step.expr.kind === 'sql') {
          findings.push({
            stepId: step.id,
            op: step.op,
            reason: `Derived SQL expression for "${step.column}" should be reviewed before sharing.`,
          });
        }
        break;
      case 'createTable':
        if (step.from === 'paste' || (step.sql && step.sql.length > 0)) {
          findings.push({
            stepId: step.id,
            op: step.op,
            reason:
              step.from === 'paste'
                ? `Pasted table "${step.as}" cannot be safely embedded in share links.`
                : `Query-derived table "${step.as}" contains raw SQL that must be reviewed.`,
          });
        }
        break;
      case 'rawSql':
        findings.push({
          stepId: step.id,
          op: step.op,
          reason: `Raw SQL step targeting "${step.as}" requires review before sharing.`,
        });
        break;
      case 'redact':
        if (step.action.mode === 'hash_sha256' && step.action.salt) {
          findings.push({
            stepId: step.id,
            op: step.op,
            reason: `Redaction hash on "${step.column}" embeds a salt literal.`,
          });
        }
        break;
      case 'fillNulls':
        if (step.strategy === 'value' && step.value !== undefined) {
          findings.push({
            stepId: step.id,
            op: step.op,
            reason: `Fill-nulls literal on "${step.column}" embeds a constant value.`,
          });
        }
        break;
      case 'regexExtract':
        findings.push({
          stepId: step.id,
          op: step.op,
          reason: `Regex pattern on "${step.column}" should be reviewed before sharing.`,
        });
        break;
      case 'cast':
      case 'dedupe':
      case 'join':
      case 'rename':
      case 'drop':
      case 'trim':
      case 'reorder':
      case 'case':
      case 'split':
      case 'merge':
      case 'parseDate':
      case 'parseNumber':
        break;
    }
  }

  if (
    recipe.overlay &&
    (recipe.overlay.cellEdits.length > 0 ||
      recipe.overlay.deletedRids.length > 0 ||
      recipe.overlay.insertedRows.length > 0)
  ) {
    findings.push({
      stepId: 'overlay',
      op: 'createTable',
      reason: 'Local cell/row edit overlay is excluded from #r= share links.',
    });
  }

  return findings;
}
