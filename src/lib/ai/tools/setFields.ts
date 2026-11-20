/**
 * TOOL `set_fields` (Fase 2 AI Copilot) — tool generik untuk mengisi BEBERAPA
 * field worksheet sekaligus (keputusan implementasi no. 5).
 *
 * ATURAN MUTLAK:
 * 1. HANYA field yang TERDAFTAR di registry bawah ini yang boleh diubah —
 *    nama field = nama field worksheet asli (interface InitialState).
 * 2. DILARANG mengubah field lewat JSON bebas / arbitrary path — nilai json
 *    hanya untuk field ber-tipe 'json' yang terdaftar (mis. observations).
 * 3. Tipe, satuan, dan rentang divalidasi di sini (server & client memakai
 *    fungsi yang sama) sebelum menyentuh state.
 * 4. Satu mekanisme penyimpanan: hasil validasi diteruskan ke applier halaman
 *    (onApplySetFields di page.tsx) yang menulis state worksheet lewat setter
 *    yang SAMA dengan handler apply AI lain — tidak ada jalur update kedua.
 */

/** Worksheet target `set_fields`. */
export const SET_FIELDS_WORKSHEETS = [
  'asw', 'awa', 'aero', 'datum', 'ws2', 'ws3', 'ws8', 'ws4',
  'assets', 'pattern', 'intercept', 'lkp', 'briefing', 'renops',
] as const;
export type SetFieldsWorksheet = (typeof SET_FIELDS_WORKSHEETS)[number];

export type SetFieldsFieldType = 'number' | 'string' | 'boolean' | 'json';

export interface SetFieldsFieldDef {
  type: SetFieldsFieldType;
  /** Penjelasan singkat untuk description tool (Bahasa Indonesia). */
  description: string;
  /** Nilai enum yang diizinkan (bila ada). */
  enum?: readonly string[];
}

/** Registry field terdaftar per worksheet — SUMBER KEBENARAN tool set_fields.
 *  Nama field persis seperti interface InitialState worksheet (1:1). */
export const SET_FIELDS_REGISTRY: Record<SetFieldsWorksheet, Record<string, SetFieldsFieldDef>> = {
  asw: {
    distressTime: { type: 'string', description: 'Waktu distress (MAYDAY) — format apa pun dari soal, dikonversi Basarnas oleh worksheet.' },
    datumTime: { type: 'string', description: 'Datum Time (mulai pencarian berikutnya).' },
    obsIntervalMode: { type: 'string', description: 'Mode interval observasi ASW.', enum: ['6h', '3h'] },
    aswErr: { type: 'number', description: 'Galat ASW (knot) — dve input manual planner.' },
    caseTitle: { type: 'string', description: 'Judul kasus pada lembar ASW.' },
    observations: { type: 'json', description: 'Array observasi ASW utuh: [{timeObs, timeStart, timeEnd, hours, windDirFrom, windSpeed}] — ganti seluruh baris.' },
  },
  awa: {
    distressAltFt: { type: 'number', description: 'Ketinggian target AWA (ft); FL200 → 20000.' },
    observations: { type: 'json', description: 'Array lapis angin utuh: [{altObs, windDirFrom, windSpeed}] — altObs "Surface" atau angka ft (string).' },
    caseTitle: { type: 'string', description: 'Judul kasus pada lembar AWA.' },
    forecastSource: { type: 'string', description: 'Sumber prakiraan (mis. BMKG).' },
    forecastValidTime: { type: 'string', description: 'Waktu berlaku prakiraan.' },
  },
  aero: {
    caseTitle: { type: 'string', description: 'Judul kasus ADW.' },
    caseNumber: { type: 'string', description: 'Callsign/nomor kasus ADW.' },
    date: { type: 'string', description: 'Tanggal kasus.' },
    incidentPos: { type: 'json', description: 'Koordinat LKP/insiden {lat, lng} desimal bertanda (S/W negatif).' },
    incidentTime: { type: 'string', description: 'Waktu insiden/kontak terakhir (A.1).' },
    useAircraftGlide: { type: 'boolean', description: 'Aktifkan segmen glide pesawat.' },
    aircraftAltMaxFt: { type: 'number', description: 'Ketinggian maksimum pesawat (ft).' },
    aircraftAltMinFt: { type: 'number', description: 'Ketinggian minimum pesawat (ft; laut → 0).' },
    aircraftGlideRatio: { type: 'number', description: 'Glide ratio (L:D), mis. 6 untuk 6:1.' },
    aircraftTASgKts: { type: 'number', description: 'Glide speed (knot, TASg).' },
    aircraftDescentHeadingDeg: { type: 'number', description: 'Heading descent pesawat (0–360).' },
    aircraftHeadingReference: { type: 'string', description: 'Referensi heading.', enum: ['true', 'magnetic', 'compass'] },
    magneticVariationDeg: { type: 'number', description: 'Variasi magnetik (derajat, nilai positif).' },
    magneticVariationDirection: { type: 'string', description: 'Arah variation (E ditambah, W dikurangi).', enum: ['E', 'W'] },
    aircraftDeviationDeg: { type: 'number', description: 'Deviation kompas pesawat (derajat).' },
    aircraftDeviationDirection: { type: 'string', description: 'Arah deviation.', enum: ['E', 'W'] },
    useParachute: { type: 'boolean', description: 'Aktifkan segmen parasut.' },
    parachuteType: { type: 'string', description: 'Jenis parasut.', enum: ['steerable', 'round-zero-glide'] },
    parachuteAltMaxFt: { type: 'number', description: 'Ketinggian buka parasut (ft).' },
    parachuteTerrainAltFt: { type: 'number', description: 'Ketinggian medan (ft).' },
    parachuteRateOfDescentFtMin: { type: 'number', description: 'Rate of descent parasut (ft/min, Table N-13).' },
    parachuteGlideRatio: { type: 'number', description: 'Glide ratio parasut steerable.' },
    fixErrorXNm: { type: 'number', description: 'Fix error X (NM).' },
    safetyFactorFs: { type: 'number', description: 'Safety factor Fs ADW (mis. 1.1).' },
  },
  datum: {
    driftInterval: { type: 'number', description: 'Hours of drift (a) — default = Total Hours ASW.' },
    latitude: { type: 'number', description: 'Lintang untuk divergensi arus angin (|lat| LKP).' },
    seaCurrentDir: { type: 'number', description: 'Arah arus laut — arah KE (°T).' },
    seaCurrentSpeed: { type: 'number', description: 'Kecepatan arus laut (knot).' },
    seaCurrentErr: { type: 'number', description: 'Galat arus (knot).' },
    leewayObjectId: { type: 'string', description: 'Id kategori leeway Tabel I-1/I-2 (mis. raft-aviation-46).' },
    X: { type: 'number', description: 'Galat posisi distress craft x (NM, Tabel J-1).' },
    Y: { type: 'number', description: 'Galat navigasi SRU y (NM).' },
    useWindCurrent: { type: 'boolean', description: 'Hitung arus angin (§4.7.44) — default true.' },
  },
  ws2: {
    sruName: { type: 'string', description: 'Nama SRU pemilik lembar (1 alut = 1 lembar).' },
    searchPlatform: { type: 'string', description: 'Platform pencari udara.', enum: ['fixed-wing', 'helicopter'] },
    searchTas: { type: 'number', description: 'TAS pencarian di area (knot).' },
    searchObject: { type: 'string', description: 'Id objek pencarian Tabel I-5/I-6 (mis. raft6, piw, ship27).' },
    visibilityIndex: { type: 'number', description: 'Indeks kolom visibility (0=2 km, 1=5, 2=10, 3=20, 4=30, 5=>40 km).' },
    isFatigue: { type: 'string', description: 'Kondisi fatigue observer.', enum: ['Yes', 'No'] },
    piwFlotationKnown: { type: 'boolean', description: 'Flotation PIW diketahui (Wu ×4 @500 ft).' },
    searchNumber: { type: 'number', description: 'Nomor pencarian 1–5 (kurva POD & fs).' },
    selectedHeight: { type: 'number', description: 'Ketinggian terpilih (ft).', enum: ['500', '1000', '1500', '2000'] },
    hoursAvailable: { type: 'number', description: 'Jam pencarian tersedia.' },
    caseWindDirFrom: { type: 'number', description: 'Angin kasus (°T, arah DARI) — penentu Fw header.' },
    caseWindSpeed: { type: 'number', description: 'Angin kasus (knot).' },
    caseWaveHeightM: { type: 'number', description: 'Tinggi gelombang kasus (meter).' },
    fwOverride: { type: 'number', description: 'Override faktor cuaca Fw (0 = kembali ke tabel).' },
    fsOverride: { type: 'number', description: 'Override faktor kecepatan Fs (0 = kembali ke tabel).' },
  },
  ws3: {
    sruName: { type: 'string', description: 'Nama SRU/tim pemilik lembar.' },
    searchObject: { type: 'string', description: 'Objek pencarian darat (person, vehicle, aircraft-under-5700, aircraft-over-5700).' },
    visibilityKm: { type: 'number', description: 'Visibility (km) — 5/10/20/30/40.' },
    vegetationType: { type: 'string', description: 'Vegetasi (under-15, 15-60, 60-85, over-85).' },
    isFatigue: { type: 'boolean', description: 'Fatigue (Ff 0.9 bila true).' },
    searchPlatform: { type: 'string', description: 'Platform pencari darat.' },
    searchNumber: { type: 'number', description: 'Nomor pencarian 1–5.' },
    searchSpeedKts: { type: 'number', description: 'Kecepatan pencarian (knot).' },
    hoursAvailable: { type: 'number', description: 'Jam pencarian tersedia.' },
    searchAreaNm2: { type: 'number', description: 'Luas area pencarian darat (NM²).' },
    fvOverride: { type: 'number', description: 'Override Fv vegetasi (0 = kembali ke tabel).' },
  },
  ws8: {
    sruName: { type: 'string', description: 'Nama SRU kapal pemilik lembar.' },
    sruType: { type: 'string', description: 'Jenis kapal.', enum: ['rescue-vessel', 'patrol-boat', 'rib', 'sea-rider'] },
    eyeHeight: { type: 'string', description: 'Tinggi mata observer (ft) / MERSHIP.', enum: ['8', '14', 'MERSHIP'] },
    searchObject: { type: 'string', description: 'Id objek pencarian Tabel I-3/I-4 (mis. raft6, person, boat12to20).' },
    visibilityKm: { type: 'string', description: 'Label kolom visibility (2, 5, 10, 15, 20, >25).' },
    isFatigue: { type: 'string', description: 'Kondisi fatigue observer.', enum: ['Yes', 'No'] },
    searchNumber: { type: 'number', description: 'Nomor pencarian 1–5.' },
    vesselSpeedKts: { type: 'number', description: 'Kecepatan kapal di area pencarian (knot).' },
    hoursAvailable: { type: 'number', description: 'Jam pencarian tersedia.' },
    caseWindDirFrom: { type: 'number', description: 'Angin kasus (°T, arah DARI).' },
    caseWindSpeed: { type: 'number', description: 'Angin kasus (knot).' },
    caseWaveHeightM: { type: 'number', description: 'Tinggi gelombang kasus (meter).' },
    fwOverride: { type: 'number', description: 'Override Fw (0 = kembali ke tabel).' },
  },
  ws4: {
    caseTitle: { type: 'string', description: 'Judul kasus WS 4.' },
    callsign: { type: 'string', description: 'Callsign tim darat.' },
    latitude: { type: 'number', description: 'Lintang IPP/last known (desimal).' },
    longitude: { type: 'number', description: 'Bujang IPP/last known (desimal).' },
    commenceUtc: { type: 'string', description: 'Waktu mulai pencarian (UTC).' },
    distressTimeUtc: { type: 'string', description: 'Waktu distress (UTC).' },
    trStartMode: { type: 'string', description: 'Mode TR awal.', enum: ['manual', 'elapsed-time'] },
    initialTrNm: { type: 'number', description: 'TR awal (NM).' },
    elapsedMinutesSinceLastFix: { type: 'number', description: 'Menit sejak fix terakhir.' },
    targetTasKts: { type: 'number', description: 'TAS target darat (knot).' },
    routeLegDistancesNm: { type: 'json', description: 'Array jarak 3 leg rute (NM): [a, b, c].' },
    yNavError: { type: 'number', description: 'Galat navigasi y (NM).' },
    safetyFactor: { type: 'number', description: 'Safety factor darat (1.1/1.8/2/2.3/2.6).' },
  },
  assets: {
    name: { type: 'string', description: 'Nama/callsign aset (kunci pencocokan sruName).' },
    type: { type: 'string', description: 'Jenis aset.', enum: ['rescue-vessel', 'patrol-boat', 'rib', 'sea-rider', 'helicopter', 'fixed-wing-aircraft'] },
    homeBaseName: { type: 'string', description: 'Nama pangkalan asal.' },
    homeBasePos: { type: 'json', description: 'Koordinat pangkalan {lat, lng} desimal.' },
    transitSpeedKts: { type: 'number', description: 'Kecepatan transit (knot).' },
    searchSpeedKts: { type: 'number', description: 'Kecepatan pencarian (knot).' },
    enduranceHours: { type: 'number', description: 'Endurance (jam desimal; 2j45m → 2.75).' },
    sweepWidthNm: { type: 'number', description: 'Track spacing S (NM) — biasanya dari lembar WS 2/8.' },
    assignedSubArea: { type: 'string', description: 'Sub-area yang ditugaskan.' },
    airEngineType: { type: 'string', description: 'Jenis mesin alut udara.', enum: ['piston', 'turbine'] },
    tafCondition: { type: 'string', description: 'Kondisi TAF alut udara.', enum: ['cerah', 'inter', 'tempo'] },
  },
  pattern: {
    patternType: { type: 'string', description: 'Jenis pola pencarian.', enum: ['PS', 'CS', 'SS', 'VS', 'TS'] },
    patternOrientationText: { type: 'string', description: 'Orientasi area (derajat °T, teks).' },
    patternTurn: { type: 'string', description: 'Arah belok SS/VS.', enum: ['right', 'left'] },
    patternEnvironment: { type: 'string', description: 'Lingkungan pola.', enum: ['water', 'land'] },
    patternLandHeight: { type: 'number', description: 'Ketinggian medan darat (ft).' },
    sectorAngleText: { type: 'string', description: 'Sudut sektor VS (derajat, teks).' },
    sectorLegLengthText: { type: 'string', description: 'Panjang leg sektor VS (NM, teks).' },
    sectorLegCountText: { type: 'string', description: 'Jumlah leg sektor VS (teks).' },
    trackLineLengthText: { type: 'string', description: 'Panjang garis haluan TS (NM, teks).' },
    tsReturnOffsetText: { type: 'string', description: 'Offset return TS (NM, teks).' },
    tsReturn: { type: 'boolean', description: 'Track line dengan return track?' },
  },
  intercept: {
    type: { type: 'string', description: 'Jenis intersep.', enum: ['beam-on', 'head-on', 'overtaking'] },
    referenceTime: { type: 'string', description: 'Waktu referensi intersep.' },
    target: { type: 'json', description: 'Objek target {name, pos:{lat,lng}, speedKts, courseDeg, departureTime}.' },
    sru: { type: 'json', description: 'Objek SRU {name, pos:{lat,lng}, speedKts, departureTime, enduranceHours}.' },
  },
  lkp: {
    lat: { type: 'number', description: 'Lintang LKP (desimal, S negatif).' },
    lng: { type: 'number', description: 'Bujur LKP (desimal, W negatif).' },
  },
  // Form Rencops/Briefing: field-nya string bebas sesuai form (Perban 3/2020);
  // kunci dikenali form — nilai di-coerce ke string.
  briefing: {
    __freeStringForm: { type: 'string', description: 'Form briefing menerima field string sesuai daftar form (opTitle, date, sruName, captainPilot, accidentDetails, targetDetails, pobCount, targetFrequencies, searchAreaDesc, searchAreaCoords, searchPattern, aircraftAltitude, weatherData, cspCoords, commsFreqs, dan field de-briefing).' },
  },
  renops: {
    __freeStringForm: { type: 'string', description: 'Form Rencana Operasi menerima field string sesuai blok A SITUASI / B TUGAS / C PELAKSANAAN / D LOGISTIK / E KOMANDO (twInfo, infoSource, callSign, route, pobCrew, pobPassengers, cause, effortsDone, taskMission, searchAreaSize, datumPos, areaCoords, logistics, smcName, oscName, commsFreqs, dst.).' },
  },
};

/** Form bebas string (briefing/renops): semua nama field string diterima. */
function isFreeStringForm(worksheet: SetFieldsWorksheet): boolean {
  return worksheet === 'briefing' || worksheet === 'renops';
}

// ---------------------------------------------------------------------------
// Argumen tool (subset OpenAPI — tipe bebas dihindari sesuai keputusan no.5)
// ---------------------------------------------------------------------------

export interface SetFieldsArgField {
  /** Nama field TERDAFTAR (kecuali form bebas briefing/renops). */
  name: string;
  /** Nilai string (untuk field string / angka berformat "1.000 ft"). */
  value_string?: string;
  /** Nilai angka (untuk field number). */
  value_number?: number;
  /** String JSON untuk field json (diparse & divalidasi di backend). */
  value_json?: string;
}

export interface SetFieldsArgs {
  worksheet: SetFieldsWorksheet;
  /** Untuk lembar per-SRU (ws2/ws3/ws8) atau aset: pencocokan nama lembar/aset. */
  sruName?: string;
  fields: SetFieldsArgField[];
}

export interface SetFieldsApplied {
  worksheet: SetFieldsWorksheet;
  sruName?: string;
  /** Pasangan nama → nilai (JSON-safe) siap merge ke state oleh applier halaman. */
  values: Record<string, unknown>;
}

export type SetFieldsParseResult =
  | { ok: true; applied: SetFieldsApplied }
  | { ok: false; errors: string[] };

/** Parse & validasi argumen tool set_fields. Dipakai server (deklarasi/ringkasan)
 *  DAN client (sebelum apply) — satu sumber aturan. TIDAK pernah melempar. */
export function parseSetFieldsArgs(rawArgs: unknown): SetFieldsParseResult {
  const errors: string[] = [];
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const worksheet = typeof args.worksheet === 'string' ? (args.worksheet.trim().toLowerCase() as string) : '';
  if (!(SET_FIELDS_WORKSHEETS as readonly string[]).includes(worksheet)) {
    return { ok: false, errors: [`worksheet "${worksheet || '(kosong)'}" tidak dikenal. Gunakan salah satu: ${SET_FIELDS_WORKSHEETS.join(', ')}.`] };
  }
  const worksheetKey = worksheet as SetFieldsWorksheet;
  const sruName = typeof args.sruName === 'string' && args.sruName.trim() ? args.sruName.trim() : undefined;
  const rawFields = Array.isArray(args.fields) ? args.fields : [];
  if (rawFields.length === 0) {
    return { ok: false, errors: ['fields kosong — sediakan minimal satu {name, value_*}.'] };
  }
  const registry = SET_FIELDS_REGISTRY[worksheetKey];
  const freeForm = isFreeStringForm(worksheetKey);
  const values: Record<string, unknown> = {};
  for (const [index, rawField] of rawFields.entries()) {
    const field = (rawField ?? {}) as Record<string, unknown>;
    const name = typeof field['name'] === 'string' ? field['name'].trim() : '';
    if (!name) {
      errors.push(`fields[${index}]: name wajib diisi.`);
      continue;
    }
    if (!freeForm && !registry[name]) {
      errors.push(`fields[${index}]: field "${name}" tidak terdaftar untuk worksheet ${worksheetKey}. Field terdaftar: ${Object.keys(registry).join(', ')}.`);
      continue;
    }
    const def: SetFieldsFieldDef | undefined = freeForm
      ? { type: 'string', description: 'Field form string.' }
      : registry[name];
    const provided: string[] = [];
    if (field['value_string'] !== undefined) provided.push('value_string');
    if (field['value_number'] !== undefined) provided.push('value_number');
    if (field['value_json'] !== undefined) provided.push('value_json');
    if (provided.length !== 1) {
      errors.push(`fields[${index}] (${name}): isi TEPAT SATU dari value_string / value_number / value_json (terisi: ${provided.length > 0 ? provided.join(', ') : 'tidak ada'}).`);
      continue;
    }
    // Coerce sesuai tipe terdaftar (angka boleh datang sebagai string berformat).
    if (def!.type === 'number') {
      const raw = field['value_number'] ?? field['value_string'];
      const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : '';
      const cleaned = text.toString().replace(/(kts?|kt|kn|nm|ft|feet|km|°|menit|min|jam|j\b|m\b)/gi, '').replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
      const value = Number(cleaned);
      if (!Number.isFinite(value)) {
        errors.push(`fields[${index}] (${name}): nilai "${text}" bukan angka valid.`);
        continue;
      }
      if (def!.enum && !(def!.enum as readonly string[]).includes(String(value))) {
        errors.push(`fields[${index}] (${name}): ${value} tidak ada dalam nilai yang diizinkan (${def!.enum.join(', ')}).`);
        continue;
      }
      values[name] = value;
    } else if (def!.type === 'boolean') {
      const raw = field['value_json'] ?? field['value_string'];
      const text = typeof raw === 'string' ? raw.trim().toLowerCase() : raw === true ? 'true' : raw === false ? 'false' : '';
      if (['true', 'ya', 'yes', '1'].includes(text)) values[name] = true;
      else if (['false', 'tidak', 'no', '0'].includes(text)) values[name] = false;
      else {
        errors.push(`fields[${index}] (${name}): boolean tidak dikenali dari "${text}".`);
        continue;
      }
    } else if (def!.type === 'json') {
      const text = typeof field['value_json'] === 'string' ? field['value_json'] : typeof field['value_string'] === 'string' ? (field['value_string'] as string) : '';
      try {
        values[name] = JSON.parse(text);
      } catch {
        errors.push(`fields[${index}] (${name}): value_json bukan JSON valid.`);
        continue;
      }
    } else {
      // string
      const raw = field['value_string'] ?? (typeof field['value_number'] === 'number' ? String(field['value_number']) : undefined);
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (!value) {
        errors.push(`fields[${index}] (${name}): value_string kosong.`);
        continue;
      }
      if (def!.enum) {
        // Normalisasi ke bentuk kanonik enum (case-insensitive) — "Helicopter"
        // disimpan sebagai "helicopter" agar state worksheet konsisten.
        const match = (def!.enum as readonly string[]).find((option) => option.toLowerCase() === value.toLowerCase());
        if (!match) {
          errors.push(`fields[${index}] (${name}): "${value}" tidak ada dalam nilai yang diizinkan (${def!.enum.join(', ')}).`);
          continue;
        }
        values[name] = match;
        continue;
      }
      values[name] = value;
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, applied: { worksheet: worksheetKey, sruName, values } };
}

const SchemaTypeLiteral = {
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  INTEGER: 'INTEGER',
  BOOLEAN: 'BOOLEAN',
  OBJECT: 'OBJECT',
  ARRAY: 'ARRAY',
} as const;

/** Description tool `set_fields` untuk functionDeclarations (di-generate dari
 *  registry agar tidak ada nama karangan). */
export function setFieldsToolDescription(): string {
  return `Isi beberapa field worksheet/form sekaligus. ATURAN: worksheet wajib salah satu dari ${SET_FIELDS_WORKSHEETS.join(', ')}. HANYA field terdaftar yang boleh diubah (nama field persis seperti worksheet); tiap field mengisi TEPAT SATU dari value_string / value_number / value_json. Untuk lembar per-SRU (ws2/ws3/ws8/assets) sertakan sruName (1 alut = 1 lembar). ANALISA DARAT/LAUT WAJIB: bila LKP/area pencarian berada DI DARAT (pendaki hilang, pesawat jatuh di darat, rute darat) dan SRU-nya pesawat fixed wing/helikopter → pakai worksheet "ws3" (Land), BUKAN ws2; ws2 hanya untuk pencarian DI LAUT. Contoh: worksheet "datum", fields [{name:"seaCurrentDir", value_number:250}, {name:"seaCurrentSpeed", value_number:0.3}]. Angin = arah DARI; arus = arah KE.`;
}

/** Ringkas parameter JSON Schema untuk declaration (subset OpenAPI). */
export function setFieldsToolParameters(): Record<string, unknown> {
  return {
    type: SchemaTypeLiteral.OBJECT,
    properties: {
      worksheet: {
        type: SchemaTypeLiteral.STRING,
        description: `Worksheet tujuan. Nilai: ${SET_FIELDS_WORKSHEETS.join(', ')}.`,
        enum: [...SET_FIELDS_WORKSHEETS],
      },
      sruName: {
        type: SchemaTypeLiteral.STRING,
        description: 'Nama SRU/lembar untuk worksheet per-SRU (ws2, ws3, ws8, assets). Wajib bila ada lebih dari satu lembar.',
      },
      fields: {
        type: SchemaTypeLiteral.ARRAY,
        description: `Daftar field yang diisi. Nama field WAJIB terdaftar per worksheet: ${Object.entries(SET_FIELDS_REGISTRY)
          .map(([sheet, fields]) => `${sheet}: ${Object.keys(fields).join(', ')}`)
          .join(' | ')}`,
        items: {
          type: SchemaTypeLiteral.OBJECT,
          properties: {
            name: { type: SchemaTypeLiteral.STRING, description: 'Nama field terdaftar.' },
            value_string: { type: SchemaTypeLiteral.STRING, description: 'Nilai string (angka juga boleh lewat sini, mis. "1.000 ft").' },
            value_number: { type: SchemaTypeLiteral.NUMBER, description: 'Nilai angka.' },
            value_json: { type: SchemaTypeLiteral.STRING, description: 'Nilai objek/array sebagai string JSON (hanya field bertipe json seperti observations, incidentPos, target).' },
          },
          required: ['name'],
        },
      },
    },
    required: ['worksheet', 'fields'],
  };
}
