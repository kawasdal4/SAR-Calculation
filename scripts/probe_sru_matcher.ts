/* Probe cepat matcher pangkalan → bank data (validasi asumsi test). */
import { matchSruBaseFacility } from '../src/lib/sar/sruBases';

const queries = [
  'Pelabuhan Belawan',
  'Bandara Juanda',
  'SUB',
  'Kantor SAR Kupang',
  'Terminal Kupang',
  'Dermaga Benoa',
  'Pelabuhan Jakarta',
  'Pelabuhan Tanjung Priok',
  'Dermaga Navigasi Teluk Bayur',
  'Pangkalan tidak dikenal di wilayah xzyq',
  'KN Sar Sorong',
];
for (const q of queries) {
  const m = matchSruBaseFacility(q);
  console.log(q, '=>', m ? `${m.entry.name} [${m.entry.kind}/${m.entry.verification}] score=${m.score.toFixed(2)}` : 'null');
}
