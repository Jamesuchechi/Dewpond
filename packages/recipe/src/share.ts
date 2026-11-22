import type { Recipe, Step } from './types';

export interface ShareLiteralFinding {
  stepId: string;
  op: Step['op'];
  reason: string;
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
      case 'cast':
      case 'dedupe':
      case 'join':
      case 'rename':
      case 'drop':
      case 'trim':
        break;
    }
  }

  return findings;
}
