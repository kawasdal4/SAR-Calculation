/**
 * UJI PENERAPAN → KALKULASI (deliverable 13): kasus PK-TAL golden →
 * buildCaseWorksheetSeeds → applyPlan → runCasePipeline (engine resmi) →
 * cetak hasil worksheet (Datum, E, R, Ao, WS2/WS8, POD, alokasi).
 * LLM TIDAK terlibat — semua angka dari fungsi deterministik aplikasi.
 */
import { buildCaseExtractionResult, buildApplyPlan } from '../src/lib/ai/parseCase';
import { buildCaseWorksheetSeeds } from '../src/lib/sar/caseAdapter';
import { runCasePipeline } from '../src/lib/sar/casePipeline';
import { PKTAL_GOLDEN } from './golden-pktal';
import { parseSetFieldsArgs } from '../src/lib/ai/tools/setFields';
import { buildReferenceChoice } from '../src/lib/ai/tools/referenceChoice';

const planner = { leewayObjectId: 'raft-6-person-canopy-drogue', fs: 1.1 };
// Koreksi id: pakai id yang BENAR-BENAR ada di registry (dari daftar pilihan).
const choice = buildReferenceChoice('datum.leewayObjectId', 'rakit 6 orang dengan kanopi dan drogue');
const recommendedId = choice?.recommendation?.referenceId;
const plannerFinal = { leewayObjectId: recommendedId ?? planner.leewayObjectId, fs: 1.1 };

console.log('== Fase E: kartu pilihan leeway ==');
console.log(`rekomendasi AI: ${recommendedId} (${choice?.recommendation?.label})`);
console.log(`alternatif tersedia: ${choice?.alternatives.length} (semua dari Tabel I-1/I-2)`);

// Simulasi konfirmasi pengguna → set_fields (validasi registry yang SAMA di klien).
const applied = parseSetFieldsArgs({
  worksheet: choice!.worksheet,
  fields: [{ name: 'leewayObjectId', value_string: recommendedId! }],
});
console.log(`set_fields valid: ${applied.ok ? 'ya' : 'tidak — ' + JSON.stringify(applied.errors)}`);

console.log('\n== Apply plan (langkah penerapan) ==');
const plan = buildApplyPlan(PKTAL_GOLDEN, plannerFinal);
for (const step of plan.steps) console.log(`  • [${step.worksheet}] ${step.label}`);
for (const skip of plan.skipped) console.log(`  ⊘ skip: ${skip.reason}`);

console.log('\n== Pipeline resmi (engine deterministik) ==');
const extraction = buildCaseExtractionResult(PKTAL_GOLDEN, plannerFinal);
if (!extraction.ok) {
  console.error('ekstraksi gagal:', extraction.error, extraction.detail?.slice(0, 3));
  process.exit(1);
}
const output = runCasePipeline(extraction.case, plannerFinal);
for (const step of output.steps) {
  const flag = step.status === 'ok' ? 'OK' : step.status.toUpperCase();
  console.log(`  [${flag}] ${step.step}${step.detail ? ` — ${step.detail.slice(0, 150)}` : ''}`);
}
const n2 = (value: number | undefined, digits = 3): string =>
  value === undefined || !Number.isFinite(value) ? '-' : String(Math.round(value * 10 ** digits) / 10 ** digits);
console.log('\n== Hasil kalkulasi (angka engine resmi) ==');
console.log(`ASW: totalHours=${n2(output.asw?.totalHours)} arah=${n2(output.asw?.dirFrom)} kec=${n2(output.asw?.speed)} kts`);
console.log(`AWA: arah=${n2(output.awa?.dirFrom)} kecepatan=${n2(output.awa?.speed)} kts`);
console.log(`ADW: landingPos=${output.aero?.landingPos ? `${n2(output.aero.landingPos.lat, 4)}, ${n2(output.aero.landingPos.lng, 4)}` : '-'}`);
const d = output.datum;
console.log(`Datum WS1: datumB=${d?.datumB ? `${n2(d.datumB.lat, 4)}, ${n2(d.datumB.lng, 4)}` : '-'} De=${n2(d?.De)} E=${n2(d?.E)}`);
console.log(`Search Area: fs=${n2(output.searchArea?.fs)} R=${n2(output.searchArea?.RUp)} Ao=${n2(output.searchArea?.aoSquareNm2)} NM²`);
for (const row of output.ws2Rows ?? []) {
  console.log(`WS2 ${row.sruName ?? '?'}: Wu=${n2(row.result.Wu)} S=${n2(row.result.S)} C=${n2(row.result.C)} POD=${n2(row.result.pod ? row.result.pod * 100 : undefined, 1)}% T=${n2(row.result.T)}`);
}
for (const row of output.ws8Rows ?? []) {
  console.log(`WS8 ${row.sruName ?? '?'}: Wu=${n2(row.result.Wu)} S=${n2(row.result.S)} C=${n2(row.result.C)} POD=${n2(row.result.pod ? row.result.pod * 100 : undefined, 1)}% T=${n2(row.result.T)}`);
}
console.log(`Pola: ${output.pattern ? `${output.pattern.patternType ?? 'PS'} orientasi=${n2(output.pattern.orientationDeg)} sisi=${n2(output.pattern.sideNm ?? output.pattern.side)}` : '-'}`);
const alloc = output.allocation;
console.log(`Alokasi: totalA=${n2(alloc?.totalA)} Ao=${n2(alloc?.targetAo)} coverage=${n2(alloc?.coverage)} (${alloc?.assets?.length ?? 0} aset)`);
console.log(`\nSumber angka: fungsi kalkulasi SAR Calculator (LLM tidak menghitung apa pun).`);
