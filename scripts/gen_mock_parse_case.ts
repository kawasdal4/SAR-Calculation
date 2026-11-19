/** Generate mock respons /api/ai/parse-case dari fixture PK-TAL (untuk e2e). */
import { writeFileSync } from 'node:fs';
import pkTalJson from '../tests/golden/pk-tal.case.json';
import { sarCaseSchema } from '../src/lib/sar/caseSchema';
import { buildCaseExtractionResult } from '../src/lib/ai/parseCase';

const sarCase = sarCaseSchema.parse(pkTalJson);
const result = buildCaseExtractionResult(sarCase, {}, { model: 'mock-e2e', attempts: 1 });
if (!result.ok) { console.error('extraction fail', result.detail); process.exit(1); }
writeFileSync('/tmp/mock_parse_case.json', JSON.stringify(result));
console.log('mock ok — steps:', result.applyPlan.steps.length, 'bytes:', JSON.stringify(result).length);
