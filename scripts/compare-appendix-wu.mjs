#!/usr/bin/env node
/**
 * Bandingkan nilai Wu aplikasi (wscPodTables.ts) vs teks resmi Appendix I
 * (APPENDIX.pdf, ekstraksi pdftotext -layout). Nama baris dibuang dulu agar
 * angka pada nama (Raft 1, Power Boat 10, dst.) tidak menggeser kolom.
 */
import { readFileSync } from 'node:fs';

const APP_TS = '/home/z/my-project/src/lib/sar/wscPodTables.ts';

const NAME_MAP = [
  [/^Person in Water/, 'piw'],
  [/^Raft 1 person/, 'raft1'],
  [/^Raft 4 person/, 'raft4'],
  [/^Raft 6 person/, 'raft6'],
  [/^Raft 8 person/, 'raft8'],
  [/^Raft 10 person/, 'raft10'],
  [/^Raft 15 person/, 'raft15'],
  [/^Raft 20 person/, 'raft20'],
  [/^Raft 25 person/, 'raft25'],
  [/^Power Boat <5/, 'boatSmall'],
  [/^Power Boat 10/, 'boat10'],
  [/^Power Boat 16/, 'boat16'],
  [/^Power Boat 24/, 'boat24'],
  [/^Sail Boat 5 /, 'sail5'],
  [/^Sail Boat 8 /, 'sail8'],
  [/^Sail Boat 12/, 'sail12'],
  [/^Sail Boat 15/, 'sail15'],
  [/^Sail Boat 21/, 'sail21'],
  [/^Sail Boat 25/, 'sail25'],
  [/^Ship 27-46/, 'ship27'],
  [/^Ship 46-91/, 'ship46'],
  [/^Ship > ?91/, 'shipOver91'],
];

/** Parse baris: buang nama, ambil tepat 12 angka (6 kolom vis per altitude). */
function parseLine(line) {
  const trimmed = line.trim();
  const hit = NAME_MAP.find(([re]) => re.test(trimmed));
  if (!hit) return null;
  const rest = trimmed.replace(hit[0], '');
  // Nilai tabel selalu desimal (x.y); angka pada nama baris (15 ft, 33 ft, dst.)
  // selalu bulat tanpa titik — ambil hanya desimal agar tidak bergeser.
  const nums = rest.match(/\d+\.\d+/g);
  if (!nums || nums.length < 12) return null;
  const v = nums.slice(0, 12).map(Number);
  return { id: hit[1], low: v.slice(0, 6), high: v.slice(6, 12) };
}

/** File tabel gabungan: kolom kiri = 500/1500, kanan = 1000/2000. */
function loadOfficialPair(file) {
  const rows = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    rows[parsed.id] = { left: parsed.low, right: parsed.high };
  }
  return rows;
}

function loadApp() {
  const ts = readFileSync(APP_TS, 'utf8');
  const grab = (blockName) => {
    const start = ts.indexOf(`const ${blockName}`);
    if (start < 0) throw new Error(`blok ${blockName} tidak ketemu`);
    const end = ts.indexOf('\n};', start);
    const body = ts.slice(start, end);
    const out = {};
    for (const alt of [500, 1000, 1500, 2000]) {
      const m = body.match(new RegExp(`${alt}: \\{([\\s\\S]*?)\\},`));
      if (!m) continue;
      const row = {};
      for (const rm of m[1].matchAll(/(\w+):\[([^\]]*)\]/g)) {
        row[rm[1]] = rm[2].split(',').map((s) => Number(s.trim()));
      }
      out[alt] = row;
    }
    return out;
  };
  return { FW: grab('FIXED'), HELI: grab('HELI') };
}

const fw = loadOfficialPair('/tmp/fw500_1000.txt');
const heli = loadOfficialPair('/tmp/heli500_1000.txt');
const fwHigh = loadOfficialPair('/tmp/fw1500_2000.txt');
const heliHigh = loadOfficialPair('/tmp/heli1500_2000.txt');

const official = {
  FW: {
    500: Object.fromEntries(Object.entries(fw).map(([k, v]) => [k, v.left])),
    1000: Object.fromEntries(Object.entries(fw).map(([k, v]) => [k, v.right])),
    1500: Object.fromEntries(Object.entries(fwHigh).map(([k, v]) => [k, v.left])),
    2000: Object.fromEntries(Object.entries(fwHigh).map(([k, v]) => [k, v.right])),
  },
  HELI: {
    500: Object.fromEntries(Object.entries(heli).map(([k, v]) => [k, v.left])),
    1000: Object.fromEntries(Object.entries(heli).map(([k, v]) => [k, v.right])),
    1500: Object.fromEntries(Object.entries(heliHigh).map(([k, v]) => [k, v.left])),
    2000: Object.fromEntries(Object.entries(heliHigh).map(([k, v]) => [k, v.right])),
  },
};

const app = loadApp();
const VIS = ['2km', '5km', '10km', '20km', '30km', '>40km'];
let mismatchCount = 0;

for (const block of ['FW', 'HELI']) {
  for (const alt of [500, 1000, 1500, 2000]) {
    const appRow = app[block][alt] ?? {};
    const offRow = official[block][alt] ?? {};
    for (const target of Object.keys(offRow)) {
      if (target === 'raft8' && !appRow.raft8) {
        console.log(`INFO ${block} ${alt}ft raft8: tidak ada di aplikasi (official ${offRow.raft8.join(',')})`);
        continue;
      }
      const appArr = appRow[target];
      if (!appArr) { console.log(`INFO ${block} ${alt}ft ${target}: tidak ada di aplikasi (official ${offRow[target].join(',')})`); continue; }
      const offArr = offRow[target];
      for (let i = 0; i < 6; i += 1) {
        if (Math.abs((appArr[i] ?? NaN) - offArr[i]) > 1e-9) {
          mismatchCount += 1;
          console.log(`BEDA ${block} ${alt}ft ${target} ${VIS[i]}: app=${appArr[i]} official=${offArr[i]}`);
        }
      }
    }
  }
}
console.log(`\nTotal sel beda: ${mismatchCount}`);
