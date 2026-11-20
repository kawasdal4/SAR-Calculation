// Ekspor data kantor SAR & batas KANSAR dari bank data repo (terverifikasi)
// menjadi GeoJSON di public/data untuk peta darat Worksheet 4 (Leaflet).
//
// Sumber (JANGAN diubah isinya di sini — ini hanya transformasi format):
//   - src/data/sarOffices.json      : 44 lokasi kantor SAR hasil audit pemilik
//   - src/data/kansarBoundaries.json: 43 batas wilayah KANSAR (KMZ 9 Okt 2021)
//
// Skema properti diminta planner: { nama, kode } + provenance dipertahankan.
// KOORDINAT SAMA SEKALI TIDAK dihasilkan/karang — disalin apa adanya.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data');

const offices = JSON.parse(readFileSync(join(ROOT, 'src/data/sarOffices.json'), 'utf8'));
const kansar = JSON.parse(readFileSync(join(ROOT, 'src/data/kansarBoundaries.json'), 'utf8'));

if (!Array.isArray(offices) || offices.length === 0) throw new Error('sarOffices.json kosong/tak valid');
if (kansar?.type !== 'FeatureCollection' || !Array.isArray(kansar.features)) throw new Error('kansarBoundaries.json bukan FeatureCollection');

// Kode singkat kantor: dari kategori (KP, KANSAR, SARBASE dst) — tidak mengarang koordinat.
const kodeByCategory = {
  'kantor-pusat': 'KP',
  'kansar': 'KANSAR',
  'sar-base': 'SARBASE',
  'sar-post': 'SARPOST',
  'sar-station': 'SARSTAT',
};

const kantorGeo = {
  type: 'FeatureCollection',
  name: 'kantor_sar',
  sumber: 'Ekspor src/data/sarOffices.json — 44 lokasi kantor SAR hasil audit pemilik (bank data repo)',
  features: offices.map((office) => {
    const lat = Number(office.lat);
    const lng = Number(office.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`Koordinat tidak valid: ${office.id}`);
    return {
      type: 'Feature',
      properties: {
        nama: office.name,
        kode: `${kodeByCategory[office.category] ?? 'SAR'}-${office.id.replace(/^loc-/, '')}`,
        kategori: office.category,
        alamat: office.specs?.address ?? '',
        koordinat: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        sumber: office.source ?? '',
      },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    };
  }),
};

const batasGeo = {
  type: 'FeatureCollection',
  name: 'batas_kansar',
  sumber: kansar.sumber,
  features: kansar.features.map((feature) => ({
    type: 'Feature',
    properties: {
      nama: feature.properties.kansar,
      kode: feature.properties.kansarId,
      sumber: feature.properties.sumber ?? kansar.sumber,
    },
    geometry: feature.geometry,
  })),
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'kantor_sar.geojson'), JSON.stringify(kantorGeo, null, 1));
writeFileSync(join(OUT_DIR, 'batas_kansar.geojson'), JSON.stringify(batasGeo, null, 1));

console.log(`kantor_sar.geojson   : ${kantorGeo.features.length} fitur (Point)`);
console.log(`batas_kansar.geojson : ${batasGeo.features.length} fitur (${kansar.features[0].geometry.type})`);
