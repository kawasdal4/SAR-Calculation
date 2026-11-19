/**
 * Verifikasi rumus POD polinomial Excel POD.xls terhadap implementasi lib.
 * Jalankan: bun run scripts/verify_pod_ts.ts
 * Nilai eksak dari evaluasi Excel (sheet POD, R30 = 1.068):
 *   T33=81.9592570565795  T34=96.9635037348582  T35=99.5712595964259  T36=100  T37=100
 */
import { readFigureI12 } from '../src/lib/sar/wscPodTables';

const C_EXCEL = 1.068;
const EXCEL_EXPECTED = [81.9592570565795, 96.9635037348582, 99.5712595964259, 100, 100];

let fail = 0;
const check = (label: string, actual: number, expected: number, tol = 1e-9) => {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) fail += 1;
  console.log(`${ok ? 'OK ' : 'GAGAL'}  ${label}: lib=${actual} excel=${expected}`);
};

console.log('== Nilai eksak Excel pada C = 1.068 ==');
EXCEL_EXPECTED.forEach((expected, i) => {
  check(`Search ${i + 1}`, readFigureI12(C_EXCEL, (i + 1) as 1), expected);
});

console.log('\n== Tepi domain ==');
check('C=0 → 0 (Search 1)', readFigureI12(0, 1), 0);
check('C=-0.5 → 0 (Search 3)', readFigureI12(-0.5, 3), 0);
check('C=NaN → 0', readFigureI12(NaN, 2), 0);
[98.9088, 99.6368, 100, 100, 100].forEach((expected, i) => {
  check(`C=2 (ujung kurva) Search ${i + 1}`, readFigureI12(2, (i + 1) as 1), expected, 1e-6);
});
check('C=2.5 di-clamp ke ujung C=2 (Search 1)', readFigureI12(2.5, 1), readFigureI12(2, 1));

console.log('\n== Kesesuaian dengan tabel kurva Excel (X1 vs Y1..Y5, selisih maks) ==');
// Tabel kurva pada sheet POD (baris 4-24) — hasil dumping openpyxl
const table: Array<[number, number[]]> = [
  [0.1, [10, 18, 25, 31, 40]], [0.2, [20, 35, 48, 57, 65]], [0.3, [29, 50, 65, 75, 83]],
  [0.4, [37, 61, 77, 85, 91]], [0.5, [47, 72, 85, 92, 96]], [0.6, [55, 80, 90, 96, 98]],
  [0.7, [62, 86, 94, 98, 99]], [0.8, [68, 90, 97, 99, 100]], [0.9, [74, 93.2, 98, 100, 100]],
  [1, [79, 95.5, 99, 100, 100]], [1.1, [83, 97, 100, 100, 100]], [1.2, [86.6, 98, 100, 100, 100]],
  [1.3, [90, 99, 100, 100, 100]], [1.4, [92.5, 100, 100, 100, 100]], [1.5, [95, 100, 100, 100, 100]],
  [1.6, [96, 100, 100, 100, 100]], [1.7, [97, 100, 100, 100, 100]], [1.8, [98, 100, 100, 100, 100]],
  [1.9, [98.5, 100, 100, 100, 100]], [2, [99, 100, 100, 100, 100]],
];
let worst: { c: number; n: number; diff: number } | null = null;
for (const [c, ys] of table) {
  ys.forEach((y, i) => {
    const diff = Math.abs(y - readFigureI12(c, (i + 1) as 1));
    if (i <= 3 && (!worst || diff > worst.diff)) worst = { c, n: i + 1, diff };
    if (i === 4 && c < 0.7) return; // Search 5 di C rendah memang meleset dari tabel (fitting Excel)
    // Ambang 3 poin: deviasi kecil (mis. C=0.1 S3/S4 ±2.2) berasal dari fitting
    // polinomial milik berkas Excel itu sendiri, bukan dari implementasi lib.
    if (diff > 3) { fail += 1; console.log(`GAGAL  C=${c} Search ${i + 1}: tabel=${y} lib=${readFigureI12(c, (i + 1) as 1)}`); }
  });
}
console.log(`Selisih terburuk Search 1-4 vs tabel: C=${worst?.c} S${worst?.n} = ${(worst?.diff ?? 0).toFixed(1)} poin`);
console.log(fail === 0 ? '\nSEMUA COCOK ✓' : `\n${fail} PEMERIKSAAN GAGAL ✗`);
process.exit(fail === 0 ? 0 : 1);
