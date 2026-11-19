/**
 * DEBUG Fase-bug: apa isi buildApplyPlan untuk fixture PK-TAL dengan
 * planner inputs default (persis kondisi pertama kali dialog muncul)?
 * Jalankan: bun scripts/debug_apply_plan.ts
 */
import pkTalJson from '../tests/golden/pk-tal.case.json';
import { sarCaseSchema } from '../src/lib/sar/caseSchema';
import { buildCaseWorksheetSeeds } from '../src/lib/sar/caseAdapter';
import { buildApplyPlan } from '../src/lib/ai/parseCase';

const parsed = sarCaseSchema.safeParse(pkTalJson);
if (!parsed.success) {
  console.error('SCHEMA FAIL:', parsed.error.issues.slice(0, 10));
  process.exit(1);
}
const sarCase = parsed.data;
const plannerInputs = { leewayObjectId: sarCase.target?.leewayObjectId };
const { seeds } = buildCaseWorksheetSeeds(sarCase, plannerInputs);
console.log('== seeds ==');
for (const [key, value] of Object.entries(seeds)) {
  const summary = Array.isArray(value)
    ? `array(${value.length})`
    : value && typeof value === 'object' ? `obj(${Object.keys(value as object).join(',')})` : String(value);
  console.log(`  ${key}: ${summary}`);
}
const plan = buildApplyPlan(sarCase, plannerInputs);
console.log('== steps ==');
for (const step of plan.steps) {
  console.log(`  [${step.worksheet}] ${step.id} — ${step.label}`);
  const payloadKeys = Object.keys(step.payload ?? {});
  console.log(`      payload: ${payloadKeys.join(', ')}`);
}
console.log('== skipped ==');
for (const skip of plan.skipped) console.log(`  [${skip.worksheet}] ${skip.reason}`);
