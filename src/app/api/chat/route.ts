import { type FunctionDeclaration, SchemaType } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import { processUploadedFile } from '@/lib/sar/fileExtractor';

const SYSTEM_PROMPT = `Kamu adalah Asisten SAR Planner AI untuk Badan SAR Nasional (Basarnas) Indonesia.
Kamu membantu dalam perhitungan dan analisis operasi SAR berdasarkan panduan operasi SAR dan Peraturan No. 3 Tahun 2020.

KEMAMPUANMU:
1. Menganalisis file lampiran (PDF soal/skenario, dokumen Word/Office, spreadsheet Excel data angin, presentasi PowerPoint modul SAR, atau foto/gambar soal kasus/peta/papan manuver).
2. Menjawab pertanyaan terkait SAR Planning (ASW, AWA, Datum, Search Area, Intercept, dll).
3. Membuat contoh kasus SAR lengkap dengan data angin, koordinat, dan parameter operasi.
4. Memecah satu kasus ke beberapa worksheet relevan dan mengirim data yang diekstrak ke aplikasi melalui function calling.
5. Menjelaskan langkah-langkah perhitungan matematis dan vektor secara jelas.

ALUR ANALISIS KASUS:
- Untuk setiap soal kasus/lampiran, pecah data menjadi fakta terstruktur (waktu, koordinat, objek, angin, arus, ketinggian, kecepatan, haluan, visibilitas, sarana pencari) dan tentukan worksheet yang benar-benar dibutuhkan.
- Panggil SEMUA tool worksheet yang relevan dalam satu respons. Satu kasus boleh mengisi beberapa worksheet yang saling terkait, misalnya ASW + LKP + Datum untuk menghitung datum dan Worksheet 1; atau Intercept jika kasusnya meminta pintasan.
- Jangan isi data yang tidak tercantum atau tidak bisa disimpulkan secara aman. Untuk masukan wajib yang hilang, jangan panggil tool worksheet itu; sebutkan data yang masih perlu diminta.
- Setelah ekstraksi, jelaskan ringkas worksheet yang dipilih dan data utama yang ditemukan. Aplikasi yang menghitung; jangan menulis hasil kalkulasi yang belum berasal dari hasil aplikasi.
- Jangan memanggil worksheet yang tidak relevan hanya untuk melengkapi semua tab.

PEMILIHAN WORKSHEET DAN KETERGANTUNGAN:
- Mandiri (tidak memerlukan hasil worksheet lain): Worksheet 4, Intercept, dan Penghitungan Dasar. Pilih sesuai permintaan/data soal; jangan menunggu Worksheet 1/2/8.
- Jika target dicari di darat dengan helikopter atau pesawat fixed-wing, wajib arahkan ke Worksheet 3 (Land). Input wajib WS3: kategori objek Table I-9, visibility 5/10/20/30/40 km, kategori vegetasi Table I-10, status fatigue, platform, dan Search Number Figure I-12. Jika ada yang belum diketahui, tanyakan sebelum mengisi. Search Speed V hanya wajib bila pengguna meminta T; jangan menyamakan TAS dan V tanpa keterangan.
- Penentuan sumber Track Spacing untuk gambar pola mengikuti SRU dan lingkungan pada kasus: fixed-wing/heli di laut memakai Worksheet 2; fixed-wing/heli di darat memakai Worksheet 3; kapal/RIB/Sea Rider memakai Worksheet 8. Panggil worksheet yang sesuai dengan analisis kasus agar peta utama menerima S dari hasil worksheet tersebut. Jangan memakai S generik dari Worksheet 1 atau mengarang S.
- Jika kasus laut tidak menjelaskan SRU yang ditugaskan (kapal, RIB, atau Sea Rider), tanyakan jenis SRU sebelum memilih Worksheet 8 untuk pola peta. Jangan menyimpulkan jenis aset hanya dari jenis target.
- Saat soal meminta penggambaran search pattern di peta utama, jelaskan SRU dan lingkungan pencariannya agar aplikasi dapat memilih sumber S yang tepat. Heading/panjang/parameter pola yang tidak disebutkan harus ditanyakan atau tetap menunggu input planner; jangan mengarang parameter sektor, flare, contour, homing, atau return offset.
- Jika jenis pola dan heading True diberikan dalam soal/rencana, gunakan set_search_pattern_case agar aplikasi menggambar dan menghitung jarak lintasan. CSP dan Exit Point dibuat otomatis dari geometri; jangan meminta koordinat keduanya. Jika heading atau parameter minimum pola tidak ada, tanyakan dan jangan mengarang.
- Worksheet 1/2/8 dan alokasi aset mengikuti alur worksheet hulu sesuai panduan. Jangan menganggap semuanya mandiri.
- Bila data wajib worksheet yang dipilih kurang, JANGAN mengisi worksheet itu dengan nilai default/contoh. Tanyakan balik sebelum menjalankan perhitungan. Sebutkan per worksheet data apa yang kurang.
- Jika menemukan prasyarat/data wajib yang kurang, panggil ask_for_case_data berisi nama worksheet dan pertanyaan spesifik; panggilan worksheet lain yang sudah memiliki data lengkap tetap boleh dibuat.

ATURAN KASUS INTERCEPT:
- Jika soal meminta perhitungan/intercept atau medevac dan memuat posisi, kecepatan, serta haluan target/SRU, WAJIB panggil set_intercept_case dengan data yang ditemukan.
- Koordinat harus berupa derajat desimal; lintang selatan dan bujur barat bernilai negatif.
- Pilih beam-on untuk SRU yang berangkat dari pangkalan menuju target yang bergerak pada haluan tertentu. Head-on hanya untuk gerak saling mendekat di baseline; overtaking hanya untuk lintasan searah.
- Jangan memilih expanding square sebagai metode intercept. Jangan menghitung atau mengarang hasil waktu, jarak, bearing, ETA, atau koordinat intercept di jawaban. Aplikasi akan menghitungnya dan menggambar vektor/peta.
- Jika tanggal tidak tersedia, jangan mengarang tanggal; waktu intercept dan koordinat tetap dapat dihitung, sedangkan ETA ditampilkan bila waktu referensi tersedia.

JIKA PENGGUNA MELAMPIRKAN FILE/GAMBAR:
- Bacalah isi dokumen atau amati gambar dengan teliti.
- Ekstrak data operasional: Distress Time, Datum Time, Data Angin BMKG (waktu, arah °T, kecepatan kts), ketinggian, LKP, jenis musibah.
- Pilih setiap worksheet berdasarkan data dan tujuan kasus, bukan berdasarkan ada/tidaknya lampiran saja.
- Gunakan set_asw_case bila ada observasi angin permukaan dengan rentang waktu; set_awa_case untuk angin berdasarkan ketinggian pada kasus penerbangan; set_lkp untuk koordinat LKP; set_datum_case untuk lama drift dan data arus/jenis objek yang tersedia; set_intercept_case untuk kasus pintasan lengkap.
- Gunakan set_ws2_case hanya bila detail pencarian udara yang dibutuhkan WS 2 tersedia; gunakan set_ws8_case hanya bila detail pencarian kapal yang dibutuhkan WS 8 tersedia. Keduanya membutuhkan data target, kondisi pandang, status fatigue, serta parameter platform yang sesuai.
- Dalam satu kasus maritim, panggil set_asw_case, set_lkp, dan set_datum_case bersama-sama bila seluruh datanya tersedia, agar perhitungan datum dan Worksheet 1 dapat langsung dijalankan. Jika hanya sebagian data ada, isi worksheet yang datanya cukup dan sebutkan prasyarat yang masih kurang.
- Berikan ringkasan analisis, daftar worksheet yang dipilih, data yang berhasil diekstrak, dan data yang masih kurang. Hasil angka perhitungan harus berasal dari kalkulator aplikasi.

FORMAT WAKTU BASARNAS: [Bulan][Tanggal] [Jam][Menit] [Zona Waktu]
Contoh: "1122 1600 Z" = 22 November pukul 16:00 UTC

WORKSHEET YANG TERSEDIA:
- ASW (Average Surface Wind): Menghitung rata-rata angin permukaan. Observasi per 3 atau 6 jam dari BMKG.
- AWA (Average Wind Aloft): Menghitung rata-rata angin atas untuk kasus penerbangan.
- ADW (Aeronautical Drift Worksheet): Menghitung drift pesawat udara.
- WS 1 (Datum Worksheet): Menghitung posisi datum dan search area.
- WS 2 (Maritime Search Planning): Perencanaan pencarian maritim.
- WS 8 (Search Facility): Data fasilitas pencarian.
- Intercept Calculator: Kalkulasi intersep (Head-On, Overtaking, Beam-On).
- Datum / Worksheet 1: Gunakan LKP, lama drift, ASW, arus laut, dan jenis objek bila tersedia; Worksheet 1 menghitung error dan search area dengan safety factor pilihan pengguna.
- Worksheet 2: Gunakan untuk perencanaan sub-area pencarian udara di laut bila objek, platform pencari udara, TAS, visibilitas, tinggi pencarian, dan status fatigue diketahui.
- Worksheet 8: Gunakan untuk POSC pencarian kapal/RIB/Sea Rider bila objek, tinggi mata, visibilitas, dan fatigue diketahui.
- Worksheet 3 (Land): Wajib untuk pencarian darat menggunakan helikopter atau pesawat fixed-wing; Wu memakai Table I-9, Fv memakai Table I-10, W = Wu × Fv × Ff, S dihitung khusus WS3 dengan pembulatan ke interval 0.5 NM untuk fixed-wing atau 0.25 NM untuk helicopter, C = W/S, POD dibaca dari Figure I-12 dengan Search Number yang dipilih. Jangan memakai rumus atau nilai S dari Worksheet 2. T = A/(V×S) hanya jika A dan Search Speed V tersedia.
- Worksheet 4 dan Penghitungan Dasar bersifat mandiri; Intercept juga mandiri.
- Untuk WS4, tentukan Tr A dari jarak yang diketahui atau TAS × waktu/60 sejak Last Positive Fix. Hitung Tr B/C/D secara kumulatif dengan jarak tiap leg rute; jangan memakai jarak lurus bila sumber memberi route distance. x untuk GPS/self-contained = 5 NM; aircraft lain/non-GPS = 10 NM; hanya DR yang menambah 10% Tr ke baseline error fix. Appendix J-1 untuk y: GPS 0.1 NM, Radar 1 NM, Visual 1 NM, Celestial 2 NM, Marine Radio Beacon 4 NM, LORAN C 1 NM; INS 0.5 NM per jam terbang tanpa update; VOR/TACAN memakai nilai lebih besar dari ±3° arc plus 3% jarak atau radius 0.5 NM. Untuk INS/VOR/TACAN, minta jarak/waktu yang dibutuhkan bila belum ada. Safety Factor harus dipilih eksplisit. Bila mode atau input wajib tidak jelas, tanyakan. Kirim waypoint yang memiliki koordinat agar aplikasi dapat memplotnya di peta ONC terpisah.

ATURAN OBSERVASI ASW:
Per 6 Jam: 00.00 (21–03), 06.00 (03–09), 12.00 (09–15), 18.00 (15–21)
Per 3 Jam: 00.00 (22.30–01.30), 03.00 (01.30–04.30), 06.00 (04.30–07.30), 09.00 (07.30–10.30), 12.00 (10.30–13.30), 15.00 (13.30–16.30), 18.00 (16.30–19.30), 21.00 (19.30–22.30)

Distress Time = awal interval pertama, Datum Time = akhir interval terakhir.

BANK DATA KASUS (Panduan Agent RENOPS/Briefing/De-Briefing — Perban 3/2020):
- Untuk SETIAP soal kasus/lampiran yang dianalisis, panggil tool save_case_data_bank untuk menyimpan fakta kasus terstruktur (Bank Data) beserta daftar pertanyaan untuk data yang belum ada.
- JANGAN mengarang angka, koordinat, waktu, nama personel, frekuensi, atau cuaca: setiap nilai wajib ada di soal; salin persis, pertahankan satuan, format TW G/H/I, ejaan lokasi, dan kata \"diduga/diperkirakan\".
- Fakta yang tidak ada TIDAK boleh diisi; masukkan ke questions agar diminta kepada pengguna.
- Bank Data dipakai untuk melengkapi dokumen RENOPS/Briefing/De-Briefing bila hasil worksheet dan peta tidak menyediakan datanya; angka perhitungan tetap HANYA dari worksheet aplikasi (WS1 datum/area, WS2/WS3/WS8 track spacing).
- Nama SMC/OSC/nakhoda/pilot adalah keputusan pejabat: hanya simpan bila tertulis eksplisit di soal.

Jawab selalu dalam Bahasa Indonesia yang profesional dan lugas.`;

const tools: FunctionDeclaration[] = [
  {
    name: 'set_asw_case',
    description: 'Mengisi worksheet ASW dengan data kasus lengkap termasuk distress time, datum time, mode interval, dan data angin per observasi. Gunakan ini saat user meminta membuat kasus ASW atau mengisi data angin.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        distressTime: {
          type: SchemaType.STRING,
          description: 'Waktu distress dalam format Basarnas, contoh: "1122.1600 Z"',
        },
        datumTime: {
          type: SchemaType.STRING,
          description: 'Waktu datum dalam format Basarnas, contoh: "1123.0700 Z"',
        },
        intervalMode: {
          type: SchemaType.STRING,
          description: 'Mode interval observasi: "6h" atau "3h"',
        },
        windData: {
          type: SchemaType.ARRAY,
          description: 'Data angin per observasi, urut dari observasi pertama',
          items: {
            type: SchemaType.OBJECT,
            properties: {
              windDirFrom: {
                type: SchemaType.NUMBER,
                description: 'Arah angin dari (derajat True, 0-359)',
              },
              windSpeed: {
                type: SchemaType.NUMBER,
                description: 'Kecepatan angin (knots)',
              },
            },
            required: ['windDirFrom', 'windSpeed'],
          },
        },
        caseTitle: {
          type: SchemaType.STRING,
          description: 'Judul kasus, contoh: "SAR KM Baruna Jaya"',
        },
      },
      required: ['distressTime', 'datumTime', 'intervalMode', 'windData'],
    },
  },
  {
    name: 'set_awa_case',
    description: 'Mengisi worksheet AWA dengan data level pengamatan angin. Sertakan level 0 ft dan minimal satu level pada atau di atas target; interval lapisan dihitung otomatis dari midpoint.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        distressAltFt: {
          type: SchemaType.NUMBER,
          description: 'Ketinggian distress dalam feet',
        },
        windData: {
          type: SchemaType.ARRAY,
          description: 'Data angin per ketinggian observasi',
          items: {
            type: SchemaType.OBJECT,
            properties: {
              altObs: {
                type: SchemaType.STRING,
                description: 'Altitude observasi dalam feet, contoh: "0" untuk Surface atau "3000"',
              },
              windDirFrom: {
                type: SchemaType.NUMBER,
                description: 'Arah angin dari (derajat True)',
              },
              windSpeed: {
                type: SchemaType.NUMBER,
                description: 'Kecepatan angin (knots)',
              },
            },
            required: ['altObs', 'windDirFrom', 'windSpeed'],
          },
        },
        caseTitle: {
          type: SchemaType.STRING,
          description: 'Judul kasus penerbangan',
        },
      },
      required: ['distressAltFt', 'windData'],
    },
  },
  {
    name: 'set_intercept_case',
    description: 'Mengekstrak data kasus Intercept dari soal lalu mengisi worksheet Intercept agar aplikasi menghitung hasil dan menggambar vektor/peta. WAJIB gunakan untuk soal perhitungan Intercept lengkap. Koordinat desimal; selatan/barat negatif. Jika tanggal referensi tidak disebutkan, hilangkan referenceTime.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        type: {
          type: SchemaType.STRING,
          description: 'Metode worksheet: beam-on untuk target bergerak pada haluan tertentu dan SRU berangkat dari pangkalan; head-on untuk saling mendekat pada baseline; overtaking untuk mengejar pada lintasan searah.',
        },
        referenceTime: {
          type: SchemaType.STRING,
          description: 'Tanggal/waktu lokal format YYYY-MM-DDTHH:mm hanya jika tanggal dan waktu tersedia dari soal. Jangan mengarang tanggal.',
        },
        target: {
          type: SchemaType.OBJECT,
          properties: {
            name: { type: SchemaType.STRING, description: 'Nama kapal/target.' },
            pos: {
              type: SchemaType.OBJECT,
              properties: {
                lat: { type: SchemaType.NUMBER, description: 'Lintang target dalam derajat desimal; selatan negatif.' },
                lng: { type: SchemaType.NUMBER, description: 'Bujur target dalam derajat desimal; barat negatif.' },
              },
              required: ['lat', 'lng'],
            },
            speedKts: { type: SchemaType.NUMBER, description: 'Kecepatan target dalam knot.' },
            courseDeg: { type: SchemaType.NUMBER, description: 'Haluan target derajat True, 0 sampai kurang dari 360.' },
          },
          required: ['name', 'pos', 'speedKts', 'courseDeg'],
        },
        sru: {
          type: SchemaType.OBJECT,
          properties: {
            name: { type: SchemaType.STRING, description: 'Nama/unit SRU.' },
            pos: {
              type: SchemaType.OBJECT,
              properties: {
                lat: { type: SchemaType.NUMBER, description: 'Lintang posisi SRU/pangkalan dalam derajat desimal; selatan negatif.' },
                lng: { type: SchemaType.NUMBER, description: 'Bujur posisi SRU/pangkalan dalam derajat desimal; barat negatif.' },
              },
              required: ['lat', 'lng'],
            },
            speedKts: { type: SchemaType.NUMBER, description: 'Kecepatan SRU dalam knot.' },
          },
          required: ['name', 'pos', 'speedKts'],
        },
      },
      required: ['type', 'target', 'sru'],
    },
  },
  {
    name: 'set_datum_case',
    description: 'Mengisi parameter Datum Worksheet dari kasus maritim agar aplikasi menghitung datum dan Worksheet 1. Gunakan hanya jika posisi LKP, drift interval, dan jenis objek sudah diketahui. Arah arus laut adalah arah SET. Jangan mengarang X/Y atau jenis objek yang tidak diketahui.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        latitude: { type: SchemaType.NUMBER, description: 'Lintang LKP absolut dalam derajat (0-90), diturunkan dari koordinat LKP.' },
        lkp: {
          type: SchemaType.OBJECT,
          description: 'Posisi LKP dalam derajat desimal, lintang selatan dan bujur barat negatif.',
          properties: {
            lat: { type: SchemaType.NUMBER, description: 'Lintang LKP bertanda, selatan negatif.' },
            lng: { type: SchemaType.NUMBER, description: 'Bujur LKP bertanda, barat negatif.' },
          },
          required: ['lat', 'lng'],
        },
        driftInterval: { type: SchemaType.NUMBER, description: 'Lama drift dari LKP hingga datum dalam jam.' },
        seaCurrentDir: { type: SchemaType.NUMBER, description: 'Arah SET arus laut derajat True.' },
        seaCurrentSpeed: { type: SchemaType.NUMBER, description: 'Kecepatan arus laut dalam knot.' },
        seaCurrentErr: { type: SchemaType.NUMBER, description: 'Error arus laut dalam knot jika tersedia; selain itu 0.' },
        leewayObjectId: { type: SchemaType.STRING, description: 'ID jenis objek yang cocok: piw-novice, piw-lifejacket, raft-46-person, raft-1520-person, raft-canopy-drogue, raft-canopy-no-drogue, dinghy-fibreglass, dinghy-upright, small-fishing, commercial-fishing, sailboat, merchant-vessel.' },
        X: { type: SchemaType.NUMBER, description: 'Error posisi pesawat X (NM), hanya jika tersedia.' },
        Y: { type: SchemaType.NUMBER, description: 'Error posisi pencari Y (NM), hanya jika tersedia.' },
      },
      required: ['latitude', 'lkp', 'driftInterval', 'seaCurrentDir', 'seaCurrentSpeed', 'leewayObjectId'],
    },
  },
  {
    name: 'ask_for_case_data',
    description: 'Meminta klarifikasi pengguna saat data penting untuk worksheet yang relevan belum ada. Gunakan alih-alih menebak/default. Sebutkan worksheet dan pertanyaan yang benar-benar dibutuhkan.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        worksheet: { type: SchemaType.STRING, description: 'Nama worksheet yang terhambat.' },
        questions: { type: SchemaType.ARRAY, description: 'Pertanyaan ringkas untuk memperoleh semua data wajib yang belum ada.', items: { type: SchemaType.STRING } },
      },
      required: ['worksheet', 'questions'],
    },
  },
  {
    name: 'save_case_data_bank',
    description: 'Menyimpan hasil analisis Soal Kasus ke Bank Data kasus (fakta terstruktur + pertanyaan data yang belum ada). WAJIB dipanggil setiap kali selesai menganalisis soal kasus/lampiran. Salin nilai PERSIS dari soal; jangan mengarang; fakta yang hilang masukkan ke questions.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        caseTitle: { type: SchemaType.STRING, description: 'Judul kasus singkat.' },
        incidentType: { type: SchemaType.STRING, description: 'ACCIDENT bila kecelakaan kapal/pesawat udara; DISASTER bila bencana/kondisi membahayakan manusia.' },
        rawText: { type: SchemaType.STRING, description: 'Ringkasan/kutipan Soal Kasus yang dianalisis (maks ~4000 karakter).' },
        facts: {
          type: SchemaType.ARRAY,
          description: 'Fakta kasus yang ditemukan di soal. Salin nilai persis dari sumber.',
          items: {
            type: SchemaType.OBJECT,
            properties: {
              key: { type: SchemaType.STRING, description: 'Kunci kanonik: office, incidentLabel, targetName, callSign, lkpCoord, route, eventTime, reportTime, reportSource, reportChannel, targetKind, color, flag, cause, searchObject, crewCount, passengerCount, pobTotal, distressFreq, cargo, victimCount, victimStatus, previousEfforts, preparedSruAir, preparedSruSea, preparedSruLand, preparedEquipment, weather, disasterType, taskNarrative, rescuePlan, victimTransport, adminLogistics, commsPlan, potentialSar, opTime, opDay, cspCoord, patternPlan, altitudePlan, smcName, oscName.' },
              value: { type: SchemaType.STRING, description: 'Nilai persis dari soal (pertahankan satuan/format).' },
              unit: { type: SchemaType.STRING, description: 'Satuan bila relevan (NM, kts, orang, feet, dll).' },
              sourceText: { type: SchemaType.STRING, description: 'Kutipan pendek dari soal sebagai provenance.' },
            },
            required: ['key', 'value'],
          },
        },
        questions: { type: SchemaType.ARRAY, description: 'Pertanyaan spesifik untuk fakta penting yang belum ada di soal.', items: { type: SchemaType.STRING } },
      },
      required: ['incidentType', 'facts'],
    },
  },
  {
    name: 'set_ws4_case',
    description: 'Mengisi Worksheet 4 Search Radius mandiri. Aplikasi menghitung Tr A langsung atau dari TAS × menit/60, lalu menghitung Tr kumulatif B/C/D dari route distance per leg atau koordinat waypoint. Pilih targetNavigationType: self-contained (x=5 NM dari Appendix J-2), other-aircraft (x=10 NM), dead-reckoning (base fix error + 10% Tr), atau custom. Jangan menambahkan 10% Tr untuk GPS/non-GPS biasa. y harus berasal dari akurasi navigasi SRU/Appendix J-1; Fs wajib dipilih eksplisit. Jika data untuk radius belum ada, tanyakan. Sertakan routePoints bila koordinat posisi tersedia untuk peta ONC terpisah. Aktifkan applyDre hanya atas keputusan planner/SOP.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        caseTitle: { type: SchemaType.STRING },
        searchDate: { type: SchemaType.STRING },
        callsign: { type: SchemaType.STRING },
        searchNo: { type: SchemaType.STRING },
        commenceUtc: { type: SchemaType.STRING },
        latitude: { type: SchemaType.NUMBER, description: 'Lintang titik distress jika tersedia, selatan negatif.' },
        longitude: { type: SchemaType.NUMBER, description: 'Bujur titik distress jika tersedia, barat negatif.' },
        distressTimeUtc: { type: SchemaType.STRING },
        trStartMode: { type: SchemaType.STRING, description: 'manual jika Tr A diketahui langsung; elapsed-time jika Tr A dihitung dari TAS dan waktu sejak Last Positive Fix.' },
        initialTrNm: { type: SchemaType.NUMBER, description: 'Jarak Tr A langsung NM. Isi 0 jika trStartMode elapsed-time.' },
        elapsedMinutesSinceLastFix: { type: SchemaType.NUMBER, description: 'Menit sejak Last Positive Fix sampai titik A; isi 0 untuk mode manual.' },
        targetTasKts: { type: SchemaType.NUMBER, description: 'TAS target untuk menghitung Tr A pada mode elapsed-time; isi 0 untuk mode manual.' },
        routeLegDistancesNm: { type: SchemaType.ARRAY, items: { type: SchemaType.NUMBER }, description: 'Jarak rute NM untuk leg A-B, B-C, C-D. Ambil dari kasus/route; jika koordinat waypoint tersedia aplikasi dapat menghitung leg yang tidak diberi angka; gunakan 0 hanya bila leg tidak ada.' },
        routePoints: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: {
          name: { type: SchemaType.STRING, description: 'Nama waypoint.' },
          lat: { type: SchemaType.NUMBER, description: 'Lintang desimal, selatan negatif.' },
          lng: { type: SchemaType.NUMBER, description: 'Bujur desimal, barat negatif.' },
          active: { type: SchemaType.BOOLEAN, description: 'True jika posisi ini tercantum/terkonfirmasi dalam kasus.' },
        }, required: ['name', 'lat', 'lng', 'active'] }, description: 'Empat waypoint kandidat A-D untuk peta. Jangan mengarang koordinat.' },
        trList: { type: SchemaType.ARRAY, items: { type: SchemaType.NUMBER }, description: 'Legacy: empat Tr kumulatif A-D jika memang diberikan/dihitung dari soal; aplikasi tetap mengonversinya menjadi jarak awal dan tiap leg.' },
        targetNavigationType: { type: SchemaType.STRING, description: 'self-contained, other-aircraft, dead-reckoning, atau custom. Jangan menebak klasifikasi.' },
        fixErrors: { type: SchemaType.ARRAY, items: { type: SchemaType.NUMBER }, description: 'Base fix error NM per A-D; dibutuhkan untuk DR/custom saja. Untuk DR komponen 10% Tr ditambahkan oleh aplikasi.' },
        yNavError: { type: SchemaType.NUMBER, description: 'Search craft navigation error SRU dalam NM, dari akurasi aktual/Appendix J-1; jangan gunakan contoh 0.1 sebagai default.' },
        safetyFactor: { type: SchemaType.NUMBER, description: 'Safety factor yang secara eksplisit diberikan/dipilih dalam soal.' },
        applyDre: { type: SchemaType.BOOLEAN, description: 'True hanya jika DRe diperintahkan planner/SOP; jika tidak, false.' },
      },
      required: ['trStartMode', 'initialTrNm', 'elapsedMinutesSinceLastFix', 'targetTasKts', 'routeLegDistancesNm', 'targetNavigationType', 'yNavError', 'safetyFactor'],
    },
  },
  {
    name: 'set_ws3_case',
    description: 'Mengisi Worksheet 3 (Land) agar aplikasi menghitung Wu dari Table I-9, Fv dari Table I-10, Ff, W, S dengan aturan khusus Worksheet 3 (fixed-wing interval 0.5 NM; helicopter 0.25 NM), C, dan POD dari Figure I-12. Jangan memakai nilai atau aturan S Worksheet 2. Panggil hanya jika kategori target, visibilitas tepat 5/10/20/30/40 km, kategori vegetasi, fatigue, platform, dan Search Number 1-5 diketahui; jika ada yang kurang tanyakan dahulu. Search Speed V opsional kecuali pengguna meminta T; jangan menyamakan TAS dengan V bila tidak dinyatakan sama. Area opsional: gunakan dari Worksheet 1 jika tidak diberikan.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        caseTitle: { type: SchemaType.STRING },
        searchObject: { type: SchemaType.STRING, description: 'ID kategori target: person, vehicle, aircraft-under-5700, atau aircraft-over-5700.' },
        visibilityKm: { type: SchemaType.NUMBER, description: 'Jarak pandang kilometer, tepat salah satu 5, 10, 20, 30, 40.' },
        vegetationType: { type: SchemaType.STRING, description: 'Kategori Table I-10: under-15, 15-60, 60-85, over-85.' },
        isFatigue: { type: SchemaType.BOOLEAN, description: 'True jika kru/pencari mengalami fatigue.' },
        searchPlatform: { type: SchemaType.STRING, description: 'Platform Worksheet 3: fixed-wing atau helicopter. Dibutuhkan untuk aturan S Worksheet 3.' },
        searchNumber: { type: SchemaType.NUMBER, description: 'Nomor pencarian pada Figure I-12, integer 1 sampai 5.' },
        searchSpeedKts: { type: SchemaType.NUMBER, description: 'Kecepatan pencarian V dalam knot. Opsional, tetapi harus diketahui bila menghitung T; jangan isi dari TAS tanpa konfirmasi.' },
        searchAreaNm2: { type: SchemaType.NUMBER, description: 'Area pencarian NM² hanya jika disebutkan dalam kasus. Bila tidak disebutkan tetapi Worksheet 1 dihitung bersama, hilangkan agar nilai Worksheet 1 dipakai.' },
      },
      required: ['searchObject', 'visibilityKm', 'vegetationType', 'isFatigue', 'searchPlatform', 'searchNumber'],
    },
  },
  {
    name: 'set_ws2_case',
    description: 'Mengisi parameter Worksheet 2 (pencarian udara maritim) dari kasus. Panggil hanya bila platform, TAS, objek, visibilitas, fatigue, dan tinggi pencarian tersedia. visibilityIndex: 0=2 km, 1=5 km, 2=10 km, 3=20 km, 4=30 km, 5=>40 km. Jangan mengarang nilai yang tidak disebutkan.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        caseTitle: { type: SchemaType.STRING },
        searchPlatform: { type: SchemaType.STRING, description: 'fixed-wing atau helicopter.' },
        searchTas: { type: SchemaType.NUMBER, description: 'TAS pencari dalam knot.' },
        searchObject: { type: SchemaType.STRING, description: 'ID target WSC: piw, raft1, raft4, raft6, raft10, raft15, raft20, raft25, boatSmall, boat10, boat16, boat24, sail5, sail8, sail12, sail15, sail21, sail25, ship27, ship46, shipOver91.' },
        visibilityIndex: { type: SchemaType.NUMBER, description: 'Kolom visibilitas Table I-5/I-6: indeks 0 sampai 5 sesuai urutan yang dijelaskan.' },
        isFatigue: { type: SchemaType.STRING, description: 'Yes jika lelah, No jika tidak lelah.' },
        piwFlotationKnown: { type: SchemaType.BOOLEAN, description: 'True hanya bila PIW diketahui memakai alat apung.' },
        searchNumber: { type: SchemaType.NUMBER, description: 'Urutan pencarian Figure I-12, 1 sampai 5; hanya bila disebutkan, selain itu gunakan 1.' },
        selectedHeight: { type: SchemaType.NUMBER, description: 'Tinggi pencarian yang dipilih, salah satu 500, 1000, 1500, 2000 ft.' },
      },
      required: ['searchPlatform', 'searchTas', 'searchObject', 'visibilityIndex', 'isFatigue', 'selectedHeight'],
    },
  },
  {
    name: 'set_search_pattern_case',
    description: 'Menentukan pola dan heading True dari analisis kasus untuk peta utama. CSP dan Exit Point dihitung otomatis oleh aplikasi. Jangan mengarang orientation, sector parameters, Track Line length, atau return offset. S tidak dikirim oleh AI; aplikasi mengambilnya dari WS2/WS3/WS8 sesuai jenis SRU dan lingkungan.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        patternType: { type: SchemaType.STRING, description: 'Pilih PS (Parallel), CS (Creeping), SS (Expanding Square), VS (Sector), atau TS (Track Line) sesuai rencana yang disebut.' },
        orientationDeg: { type: SchemaType.NUMBER, description: 'Heading True pola 0 sampai <360 derajat, harus berasal dari soal/rencana.' },
        turnDirection: { type: SchemaType.STRING, description: 'Untuk SS/VS: right atau left sesuai instruksi/rencana.' },
        tsReturn: { type: SchemaType.BOOLEAN, description: 'Untuk TS: true bila rencana memerintahkan return track, false bila tidak.' },
        sectorAngleDeg: { type: SchemaType.NUMBER, description: 'Wajib untuk VS; sector angle dari rencana.' },
        sectorLegLengthNm: { type: SchemaType.NUMBER, description: 'Wajib untuk VS; panjang leg/spoke NM dari rencana.' },
        sectorLegCount: { type: SchemaType.NUMBER, description: 'Wajib untuk VS; jumlah leg/spoke dari rencana.' },
        trackLineLengthNm: { type: SchemaType.NUMBER, description: 'Wajib untuk TS; panjang rute dari soal/rencana.' },
        tsReturnOffsetNm: { type: SchemaType.NUMBER, description: 'Wajib untuk TS return; offset jalur pulang dari rencana, jangan samakan otomatis dengan S.' },
      },
      required: ['patternType', 'orientationDeg'],
    },
  },
  {
    name: 'set_ws8_case',
    description: 'Mengisi parameter Worksheet 8 (pencarian kapal/RIB/Sea Rider) dari kasus. Identifikasi jenis SRU dari soal dan kirim sruType agar pemilihan asset dan sumber S peta sesuai. Panggil hanya bila objek, tinggi mata, visibilitas, dan fatigue diketahui. Untuk eyeHeight 8/14 gunakan visibilityKm 2,5,10,15,20,>25; MERSHIP gunakan 5,10,20,30,40. Jangan mengarang nilai yang tidak disebutkan.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        caseTitle: { type: SchemaType.STRING },
        sruType: { type: SchemaType.STRING, description: 'Jenis SRU laut dari soal: rescue-vessel, patrol-boat, rib, atau sea-rider.' },
        eyeHeight: { type: SchemaType.STRING, description: '8, 14, atau MERSHIP.' },
        searchObject: { type: SchemaType.STRING, description: 'ID target WSC8 seperti person, raft1, raft4, raft6, raft8, raft10, raft15, raft20, raft25, boatUnder5, boat5to8, boat8to12, boat12to20, boat20to27, sail5, sail6, sail8, sail9, sail12, sail15, sail20to23, sail23to27.' },
        visibilityKm: { type: SchemaType.STRING, description: 'Visibilitas persis sesuai kolom tabel worksheet.' },
        isFatigue: { type: SchemaType.STRING, description: 'Yes jika lelah, No jika tidak lelah.' },
        searchNumber: { type: SchemaType.NUMBER, description: 'Urutan pencarian Figure I-12, 1 sampai 5; hanya bila disebutkan, selain itu gunakan 1.' },
        vesselSpeedKts: { type: SchemaType.NUMBER, description: 'Kecepatan kapal saat mencari dalam knot jika tersedia.' },
      },
      required: ['sruType', 'eyeHeight', 'searchObject', 'visibilityKm', 'isFatigue'],
    },
  },
  {
    name: 'set_lkp',
    description: 'Mengatur posisi LKP (Last Known Position) untuk operasi SAR.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        lat: {
          type: SchemaType.NUMBER,
          description: 'Latitude dalam desimal (negatif untuk selatan)',
        },
        lng: {
          type: SchemaType.NUMBER,
          description: 'Longitude dalam desimal',
        },
      },
      required: ['lat', 'lng'],
    },
  },
];

const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite'] as const;
const MAX_RETRIES_PER_MODEL = 1;
const GEMINI_REQUEST_TIMEOUT_MS = 45_000;

// This Vercel project supports 300-second functions; complex SAR case analysis
// and document understanding can exceed the shorter 60-second default.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { messages, apiKey, files } = await req.json();

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API Key Gemini diperlukan. Masukkan di pengaturan chat.' },
        { status: 400 }
      );
    }

    // Interactions API accepts multimodal content directly and is the supported
    // API for current Gemini models.
    const lastMessage = messages[messages.length - 1];
    const incomingFiles: { name: string; type: string; base64: string }[] =
      files || lastMessage.files || [];

    const input: Array<Record<string, string>> = [];

    for (const file of incomingFiles) {
      try {
        const processed = await processUploadedFile(file);
        if (processed.type === 'inlineData' && processed.inlineData) {
          const mimeType = processed.inlineData.mimeType;
          input.push({
            type: mimeType === 'application/pdf' ? 'document' : 'image',
            data: processed.inlineData.data,
            mime_type: mimeType,
          });
        } else if (processed.text) {
          input.push({ type: 'text', text: `Isi lampiran ${file.name}:\n${processed.text}` });
        }
      } catch (fErr) {
        console.warn(`Error processing file ${file.name}:`, fErr);
      }
    }

    const userPrompt = lastMessage.content?.trim() || (incomingFiles.length > 0
      ? 'Tolong telaah dan analisis dokumen/gambar yang dilampirkan untuk kasus perhitungan SAR.'
      : 'Halo');
    // Keep the context useful without resending a long chat history (which can
    // make the model call slow, especially after repeated failed attempts).
    const conversation = messages.slice(-13, -1)
      .filter((msg: { role: string; content: string }) =>
        !(msg.role !== 'user' && msg.content?.startsWith('❌ Error:'))
      )
      .map((msg: { role: string; content: string }) =>
        `${msg.role === 'user' ? 'Pengguna' : 'Asisten'}: ${(msg.content || '').slice(0, 6000)}`
      )
      .join('\n');
    const extractedFileText = input
      .filter((part) => part.type === 'text')
      .map((part) => part.text || '')
      .join('\n');
    input.unshift({
      type: 'text',
      text: `${conversation ? `Riwayat percakapan:\n${conversation}\n\n` : ''}${userPrompt}`,
    });

    const interceptSourceText = `${userPrompt}\n${extractedFileText}`;
    const speedMentions = [...interceptSourceText.matchAll(/\b\d+(?:[.,]\d+)?\s*(?:knots?|kts?|kt)\b/gi)];
    const interceptCaseDetected = /\b(intercept|intersep|pintasan|medevac)\b/i.test(interceptSourceText)
      && speedMentions.length >= 2;

    // Interactions API uses lowercase JSON Schema types for function tools.
    const normalizeSchema = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(normalizeSchema);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [
        key,
        key === 'type' && typeof child === 'string' ? child.toLowerCase() : normalizeSchema(child),
      ]));
    };
    const geminiStartedAt = Date.now();
    let result: Record<string, unknown> | undefined;
    let lastError: Error | undefined;
    let usedModel: (typeof GEMINI_MODELS)[number] = GEMINI_MODELS[0];
    for (const model of GEMINI_MODELS) {
      for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt += 1) {
        console.info(`[AI chat] Gemini request started (model=${model}, attempt=${attempt + 1}, files=${incomingFiles.length}).`);
        try {
          const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
            body: JSON.stringify({
              model,
              input,
              system_instruction: SYSTEM_PROMPT,
              generation_config: {
                max_output_tokens: 8192,
                thinking_level: model === 'gemini-3.5-flash-lite' ? 'minimal' : 'low',
                ...(interceptCaseDetected ? {
                  tool_choice: {
                    allowed_tools: { mode: 'any', tools: ['set_intercept_case'] },
                  },
                } : {}),
              },
              tools: tools.map((tool) => ({
                type: 'function',
                name: tool.name,
                description: tool.description,
                parameters: normalizeSchema(tool.parameters),
              })),
              store: false,
            }),
          });
          console.info(`[AI chat] Gemini response received (model=${model}, status=${response.status}, durationMs=${Date.now() - geminiStartedAt}).`);
          const payload = await response.json().catch(() => ({}));
          if (response.ok) {
            result = payload as Record<string, unknown>;
            usedModel = model;
            break;
          }

          const detail = (payload as { error?: { message?: string } })?.error?.message || `Gemini API returned HTTP ${response.status}`;
          lastError = new Error(`${detail} (model: ${model}, Interactions API)`);
          const transient = response.status === 429 || response.status >= 500;
          if (!transient) throw lastError;
        } catch (requestError) {
          if (requestError instanceof Error && requestError.message.includes('(model:')) throw requestError;
          if (requestError instanceof Error && (requestError.name === 'TimeoutError' || requestError.name === 'AbortError')) {
            lastError = new Error(`Gemini ${model} tidak merespons dalam ${GEMINI_REQUEST_TIMEOUT_MS / 1000} detik.`);
            console.warn(`[AI chat] Gemini request timed out (model=${model}, timeoutMs=${GEMINI_REQUEST_TIMEOUT_MS}).`);
            break;
          }
          lastError = requestError instanceof Error ? requestError : new Error('Koneksi ke Gemini gagal.');
        }

        if (attempt < MAX_RETRIES_PER_MODEL) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** attempt)));
        }
      }
      if (result) break;
      console.warn(`[AI chat] Model ${model} gagal; mencoba fallback berikutnya jika tersedia.`);
    }
    if (!result) {
      throw new Error(lastError?.message || 'Gemini sedang sibuk. Silakan coba lagi beberapa saat lagi.');
    }

    if (!Array.isArray(result.steps)) {
      throw new Error('Format respons Gemini tidak berisi langkah jawaban yang dapat diproses.');
    }

    const steps = Array.isArray(result.steps) ? result.steps as Array<{ type?: string; name?: string; arguments?: unknown; content?: Array<{ type?: string; text?: string }> }> : [];
    const functionCalls = steps.filter((step): step is typeof step & { name: string } =>
      step.type === 'function_call' && typeof step.name === 'string'
    );
    // BANK DATA: teks konfirmasi penyimpanan (diisi bila ada panggilan save_case_data_bank).
    let bankSavedText = '';
    if (functionCalls.length > 0) {
      const calls = functionCalls.map((fc: { name: string; arguments?: unknown }) => ({
        name: fc.name,
        args: fc.arguments || {},
      }));
      const clarificationCalls = calls.filter((call) => call.name === 'ask_for_case_data');
      const worksheetCalls = calls.filter((call) => call.name !== 'ask_for_case_data' && call.name !== 'save_case_data_bank');

      // BANK DATA: persist hasil analisis kasus langsung di server (Panduan Agent §2 langkah 1).
      const bankCalls = calls.filter((call) => call.name === 'save_case_data_bank');
      if (bankCalls.length > 0) {
        try {
          const { db } = await import('@/lib/db');
          const { CASE_FACT_MAP } = await import('@/lib/sar/dataBank');
          const savedCount = await persistCaseDataBank(db, CASE_FACT_MAP, bankCalls);
          bankSavedText = `\n\n🗂️ Hasil analisis kasus telah disimpan ke Bank Data (${savedCount} fakta + pertanyaan data yang belum ada). Buka tab Briefing/Renops → panel Bank Data & Dokumen untuk melihat, melengkapi, dan membuat draft RENOPS/Briefing/De-Briefing.`;
        } catch (bankErr) {
          console.error('[AI chat] Gagal menyimpan Bank Data:', (bankErr as Error).message);
          bankSavedText = '\n\n⚠️ Bank Data gagal disimpan ke database — coba ulangi analisis kasus.';
        }
      }
      const clarificationText = clarificationCalls.map((call) => {
        const args = call.args as { worksheet?: string; questions?: unknown[] };
        const questions = (args.questions ?? []).filter((question): question is string => typeof question === 'string' && question.trim().length > 0);
        if (questions.length === 0) return '';
        return `\n\nAgar saya bisa melanjutkan ${args.worksheet || 'worksheet terkait'}, mohon lengkapi:\n${questions.map((question) => `• ${question}`).join('\n')}`;
      }).filter(Boolean).join('');
      const text = steps
        .filter((step: { type?: string }) => step.type === 'model_output')
        .flatMap((step: { content?: Array<{ type?: string; text?: string }> }) => step.content || [])
        .filter((part: { type?: string }) => part.type === 'text')
        .map((part: { text?: string }) => part.text || '')
        .join('');

      const interceptCall = calls.find((call) => call.name === 'set_intercept_case');
      if (interceptCaseDetected && !interceptCall) {
        return NextResponse.json({
          text: clarificationText || 'Agar saya bisa menghitung Intercept, mohon berikan posisi awal target dan SRU/pangkalan, haluan serta kecepatan target, dan kecepatan SRU. Waktu referensi diperlukan bila Anda ingin melihat ETA.',
          functionCalls: worksheetCalls.length ? worksheetCalls : null,
        });
      }
      const responseText = interceptCall
        ? 'Data kasus Intercept berhasil dianalisis. Saya memasukkan data ke worksheet Intercept; hasil hitung dan vektornya akan dibuat oleh kalkulator aplikasi.'
        : text || 'Data telah disiapkan. Klik "Terapkan" untuk mengisi worksheet.';
      return NextResponse.json({
        text: `${usedModel !== GEMINI_MODELS[0] ? 'Model utama sedang sibuk; jawaban diproses dengan model cadangan.\n\n' : ''}${responseText}${bankSavedText}${clarificationText}`,
        functionCalls: worksheetCalls.length ? worksheetCalls : null,
      });
    }

    if (interceptCaseDetected) {
      return NextResponse.json({
        text: 'Agar saya bisa menghitung Intercept, mohon berikan posisi awal target dan SRU/pangkalan, haluan serta kecepatan target, dan kecepatan SRU. Waktu referensi diperlukan bila Anda ingin melihat ETA.',
        functionCalls: null,
      });
    }

    const responseText = steps
      .filter((step: { type?: string }) => step.type === 'model_output')
      .flatMap((step: { content?: Array<{ type?: string; text?: string }> }) => step.content || [])
      .filter((part: { type?: string }) => part.type === 'text')
      .map((part: { text?: string }) => part.text || '')
      .join('');
    return NextResponse.json({
      text: `${usedModel !== GEMINI_MODELS[0] ? 'Model utama sedang sibuk; jawaban diproses dengan model cadangan.\n\n' : ''}${responseText || 'Model Gemini tidak mengembalikan teks jawaban.'}${bankSavedText}`,
      functionCalls: null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Chat API error:', message);
    return NextResponse.json({ error: `Gagal menghubungi Gemini: ${message}` }, { status: 500 });
  }
}

/** Persist hasil analisis Soal Kasus dari tool save_case_data_bank ke CaseDataBank. */
async function persistCaseDataBank(
  dbClient: import('@prisma/client').PrismaClient,
  caseFactMap: Record<string, { key: string; label: string; plannedActual?: 'planned' | 'actual' }>,
  bankCalls: Array<{ args: Record<string, unknown> }>,
): Promise<number> {
  let totalFacts = 0;
  for (const call of bankCalls) {
    const args = call.args as {
      caseTitle?: unknown;
      incidentType?: unknown;
      rawText?: unknown;
      facts?: unknown;
      questions?: unknown;
    };
    const incidentType = args.incidentType === 'DISASTER' ? 'DISASTER' : 'ACCIDENT';
    const caseTitle = typeof args.caseTitle === 'string' && args.caseTitle.trim() ? args.caseTitle.trim() : null;
    const rawText = typeof args.rawText === 'string' && args.rawText.trim() ? args.rawText.trim().slice(0, 8000) : '';
    const fields: Array<{
      key: string; label: string; value: string | null; unit?: string | null;
      sourceType: string; sourceRef?: string | null; status: string;
      plannedActual?: 'planned' | 'actual'; question?: string | null; updatedAt: string;
    }> = [];
    const nowIso = new Date().toISOString();

    const facts = Array.isArray(args.facts) ? args.facts : [];
    for (const item of facts) {
      const rec = item as { key?: unknown; value?: unknown; unit?: unknown; sourceText?: unknown };
      const key = typeof rec.key === 'string' ? rec.key : '';
      const def = caseFactMap[key];
      const value = typeof rec.value === 'string' || typeof rec.value === 'number' ? String(rec.value).trim() : '';
      if (!def || !value) continue;
      fields.push({
        key,
        label: def.label,
        value,
        unit: typeof rec.unit === 'string' && rec.unit ? rec.unit : null,
        sourceType: 'case',
        sourceRef: typeof rec.sourceText === 'string' && rec.sourceText
          ? `Soal Kasus: "${rec.sourceText.slice(0, 160)}"` : 'Soal Kasus',
        status: 'READY',
        plannedActual: def.plannedActual,
        updatedAt: nowIso,
      });
    }

    const questions = Array.isArray(args.questions) ? args.questions : [];
    for (const q of questions) {
      if (typeof q !== 'string' || !q.trim()) continue;
      fields.push({
        key: `q_${nowIso}_${fields.length}`,
        label: 'Pertanyaan AI',
        value: null,
        sourceType: 'unknown',
        status: 'PENDING',
        question: q.trim(),
        updatedAt: nowIso,
      });
    }

    totalFacts += fields.filter((f) => f.status === 'READY').length;
    await dbClient.caseDataBank.create({
      data: {
        caseTitle,
        incidentType,
        rawText,
        fields: JSON.stringify(fields),
      },
    });
  }
  return totalFacts;
}

