import type { LogicalType, PredicateOp, Recipe, Step } from './types';

export const RECIPE_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'DewpondRecipeV1',
  type: 'object',
  required: ['version', 'id', 'name', 'sources', 'steps', 'head', 'createdAt', 'updatedAt'],
  properties: {
    version: { const: 1 },
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    sources: { type: 'array' },
    steps: { type: 'array' },
    head: { type: 'integer', minimum: 0 },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
  },
} as const;

const VALID_LOGICAL_TYPES = new Set<LogicalType>([
  'VARCHAR',
  'BIGINT',
  'DOUBLE',
  'BOOLEAN',
  'DATE',
  'TIMESTAMP',
]);

const VALID_PREDICATE_OPS = new Set<PredicateOp>([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'is_null',
  'not_null',
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isStringArray(v: unknown, minLen = 1): v is string[] {
  return Array.isArray(v) && v.length >= minLen && v.every((x) => typeof x === 'string');
}

function validateStep(raw: unknown, idx: number, errors: string[]): raw is Step {
  if (!isRecord(raw)) {
    errors.push(`steps[${idx}] must be an object.`);
    return false;
  }
  if (!isNonEmptyString(raw.id)) {
    errors.push(`steps[${idx}].id must be a non-empty string.`);
  }
  if (!isNonEmptyString(raw.op)) {
    errors.push(`steps[${idx}].op must be a non-empty string.`);
    return false;
  }

  switch (raw.op) {
    case 'filter':
      if (!isNonEmptyString(raw.table) || !isRecord(raw.predicate)) {
        errors.push(`steps[${idx}] (filter) requires table and predicate.`);
      } else if (
        !isNonEmptyString(raw.predicate.column) ||
        !VALID_PREDICATE_OPS.has(raw.predicate.op as PredicateOp)
      ) {
        errors.push(`steps[${idx}].predicate has invalid column or op.`);
      }
      break;
    case 'derive':
      if (!isNonEmptyString(raw.table) || !isNonEmptyString(raw.column) || !isRecord(raw.expr)) {
        errors.push(`steps[${idx}] (derive) requires table, column, and expr.`);
      }
      break;
    case 'cast':
      if (
        !isNonEmptyString(raw.table) ||
        !isNonEmptyString(raw.column) ||
        !VALID_LOGICAL_TYPES.has(raw.to as LogicalType) ||
        (raw.onFail !== 'null' && raw.onFail !== 'reject')
      ) {
        errors.push(`steps[${idx}] (cast) has invalid fields.`);
      }
      break;
    case 'dedupe':
      if (
        !isNonEmptyString(raw.table) ||
        !isStringArray(raw.keys, 1) ||
        (raw.keep !== 'first' && raw.keep !== 'last' && raw.keep !== 'most_complete')
      ) {
        errors.push(`steps[${idx}] (dedupe) has invalid keys or keep policy.`);
      }
      break;
    case 'join':
      if (
        !isNonEmptyString(raw.left) ||
        !isNonEmptyString(raw.right) ||
        !Array.isArray(raw.on) ||
        !isNonEmptyString(raw.as)
      ) {
        errors.push(`steps[${idx}] (join) has invalid fields.`);
      }
      break;
    case 'redact':
      if (!isNonEmptyString(raw.table) || !isNonEmptyString(raw.column) || !isRecord(raw.action)) {
        errors.push(`steps[${idx}] (redact) has invalid fields.`);
      }
      break;
    case 'createTable':
      if (!isNonEmptyString(raw.as) || (raw.from !== 'query' && raw.from !== 'paste')) {
        errors.push(`steps[${idx}] (createTable) has invalid fields.`);
      }
      break;
    case 'rawSql':
      if (
        !isNonEmptyString(raw.sql) ||
        !isNonEmptyString(raw.as) ||
        typeof raw.trusted !== 'boolean'
      ) {
        errors.push(`steps[${idx}] (rawSql) requires sql, as, and trusted boolean.`);
      }
      break;
    case 'rename':
      if (
        !isNonEmptyString(raw.table) ||
        !isNonEmptyString(raw.from) ||
        !isNonEmptyString(raw.to)
      ) {
        errors.push(`steps[${idx}] (rename) requires table, from, and to.`);
      }
      break;
    case 'drop':
    case 'trim':
    case 'reorder':
      if (!isNonEmptyString(raw.table) || !isStringArray(raw.columns, 1)) {
        errors.push(`steps[${idx}] (${raw.op}) requires table and non-empty columns array.`);
      }
      break;
    case 'case':
      if (
        !isNonEmptyString(raw.table) ||
        !isStringArray(raw.columns, 1) ||
        (raw.mode !== 'lower' && raw.mode !== 'upper' && raw.mode !== 'title')
      ) {
        errors.push(`steps[${idx}] (case) requires table, columns, and valid mode.`);
      }
      break;
    case 'replace':
      if (
        !isNonEmptyString(raw.table) ||
        !isNonEmptyString(raw.column) ||
        typeof raw.search !== 'string' ||
        typeof raw.replacement !== 'string'
      ) {
        errors.push(`steps[${idx}] (replace) requires table, column, search, replacement.`);
      }
      break;
    case 'regexExtract':
      if (
        !isNonEmptyString(raw.table) ||
        !isNonEmptyString(raw.column) ||
        !isNonEmptyString(raw.pattern) ||
        !isNonEmptyString(raw.into)
      ) {
        errors.push(`steps[${idx}] (regexExtract) requires table, column, pattern, into.`);
      }
      break;
    case 'split':
      if (
        !isNonEmptyString(raw.table) ||
        !isNonEmptyString(raw.column) ||
        typeof raw.delimiter !== 'string' ||
        !isStringArray(raw.into, 1)
      ) {
        errors.push(`steps[${idx}] (split) requires table, column, delimiter, into.`);
      }
      break;
    case 'merge':
      if (
        !isNonEmptyString(raw.table) ||
        !isStringArray(raw.columns, 1) ||
        typeof raw.separator !== 'string' ||
        !isNonEmptyString(raw.into)
      ) {
        errors.push(`steps[${idx}] (merge) requires table, columns, separator, into.`);
      }
      break;
    case 'fillNulls':
      if (
        !isNonEmptyString(raw.table) ||
        !isNonEmptyString(raw.column) ||
        (raw.strategy !== 'value' &&
          raw.strategy !== 'mean' &&
          raw.strategy !== 'median' &&
          raw.strategy !== 'ffill')
      ) {
        errors.push(`steps[${idx}] (fillNulls) has invalid strategy.`);
      }
      break;
    case 'parseDate':
      if (
        !isNonEmptyString(raw.table) ||
        !isNonEmptyString(raw.column) ||
        (raw.format !== 'DMY' && raw.format !== 'MDY' && raw.format !== 'ISO')
      ) {
        errors.push(`steps[${idx}] (parseDate) requires DMY, MDY, or ISO format.`);
      }
      break;
    case 'parseNumber':
      if (
        !isNonEmptyString(raw.table) ||
        !isNonEmptyString(raw.column) ||
        (raw.locale !== 'us_currency' && raw.locale !== 'eu_decimal')
      ) {
        errors.push(`steps[${idx}] (parseNumber) requires us_currency or eu_decimal locale.`);
      }
      break;
    default:
      errors.push(`steps[${idx}] has unknown op "${String(raw.op)}".`);
      return false;
  }

  return true;
}

export type RecipeValidationResult = { ok: true; recipe: Recipe } | { ok: false; errors: string[] };

/** Validate untrusted JSON against Dewpond's v1 Recipe schema. */
export function validateRecipeJson(input: unknown): RecipeValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ['Recipe root must be a JSON object.'] };
  }

  if (input.version !== 1) {
    errors.push(`Unsupported recipe version: ${String(input.version)} (expected 1).`);
  }
  if (!isNonEmptyString(input.id)) {
    errors.push('Recipe.id must be a non-empty string.');
  }
  if (!isNonEmptyString(input.name)) {
    errors.push('Recipe.name must be a non-empty string.');
  }
  if (!Array.isArray(input.sources)) {
    errors.push('Recipe.sources must be an array.');
  }
  if (!Array.isArray(input.steps)) {
    errors.push('Recipe.steps must be an array.');
  } else {
    input.steps.forEach((step, idx) => {
      validateStep(step, idx, errors);
    });
  }

  const stepLen = Array.isArray(input.steps) ? input.steps.length : 0;
  if (
    typeof input.head !== 'number' ||
    !Number.isInteger(input.head) ||
    input.head < 0 ||
    input.head > stepLen
  ) {
    errors.push(`Recipe.head must be an integer between 0 and ${stepLen}.`);
  }
  if (typeof input.createdAt !== 'number' || typeof input.updatedAt !== 'number') {
    errors.push('Recipe.createdAt and updatedAt must be numeric timestamps.');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, recipe: input as unknown as Recipe };
}

/** Collect column names referenced by active steps that are missing from the target table schema. */
export function detectSchemaDrift(recipe: Recipe, availableColumns: readonly string[]): string[] {
  const available = new Set(availableColumns);
  const created = new Set<string>();
  const missing = new Set<string>();

  const checkCol = (col: string | undefined) => {
    if (!col || col === '__rid') return;
    if (!available.has(col) && !created.has(col)) {
      missing.add(col);
    }
  };

  for (const step of recipe.steps.slice(0, recipe.head)) {
    switch (step.op) {
      case 'filter':
        checkCol(step.predicate.column);
        break;
      case 'derive':
        if (step.expr.kind === 'column') checkCol(step.expr.name);
        created.add(step.column);
        break;
      case 'cast':
      case 'replace':
      case 'fillNulls':
      case 'parseDate':
      case 'parseNumber':
      case 'redact':
        checkCol(step.column);
        break;
      case 'rename':
        checkCol(step.from);
        created.add(step.to);
        break;
      case 'drop':
      case 'trim':
      case 'reorder':
      case 'case':
        step.columns.forEach(checkCol);
        break;
      case 'dedupe':
        step.keys.forEach(checkCol);
        checkCol(step.orderBy);
        break;
      case 'regexExtract':
        checkCol(step.column);
        created.add(step.into);
        break;
      case 'split':
        checkCol(step.column);
        step.into.forEach((c) => created.add(c));
        break;
      case 'merge':
        step.columns.forEach(checkCol);
        created.add(step.into);
        break;
      default:
        break;
    }
  }

  return [...missing];
}

/** Remap column names across all Recipe steps after resolving schema drift. */
export function remapRecipeColumns(
  recipe: Recipe,
  columnMap: Readonly<Record<string, string>>,
): Recipe {
  const mapCol = (name: string): string => columnMap[name] ?? name;

  const steps: Step[] = recipe.steps.map((step) => {
    switch (step.op) {
      case 'filter':
        return {
          ...step,
          predicate: { ...step.predicate, column: mapCol(step.predicate.column) },
        };
      case 'derive':
        return {
          ...step,
          expr:
            step.expr.kind === 'column'
              ? { ...step.expr, name: mapCol(step.expr.name) }
              : step.expr,
        };
      case 'cast':
      case 'replace':
      case 'fillNulls':
      case 'parseDate':
      case 'parseNumber':
      case 'redact':
      case 'regexExtract':
      case 'split':
        return { ...step, column: mapCol(step.column) };
      case 'rename':
        return { ...step, from: mapCol(step.from) };
      case 'drop':
      case 'trim':
      case 'reorder':
      case 'case':
      case 'merge':
        return { ...step, columns: step.columns.map(mapCol) };
      case 'dedupe':
        return {
          ...step,
          keys: step.keys.map(mapCol),
          orderBy: step.orderBy ? mapCol(step.orderBy) : undefined,
        };
      default:
        return step;
    }
  });

  return { ...recipe, steps, updatedAt: Date.now() };
}
