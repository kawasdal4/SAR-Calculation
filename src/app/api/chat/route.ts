import { type FunctionDeclaration, SchemaType } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import { processUploadedFile } from '@/lib/sar/fileExtractor';
import type { DataBankField, RawQuestion } from '@/lib/sar/dataBank';
import { buildChainCompletionInstruction, computeMissingWorksheetTools, parseDeclaredWorksheetTools } from '@/lib/sar/caseChain';

const SYSTEM_PROMPT = `Kamu adalah Asisten SAR Planner AI untuk Badan SAR Nasional (Basarnas) Indonesia.
Kamu membantu dalam perhitungan dan analisis operasi SAR berdasarkan panduan operasi SAR dan Peraturan No. 3 Tahun 2020.

KEMAMPUANMU:
1. Menganalisis file lampiran (PDF soal/skenario, dokumen Word/Office, spreadsheet Excel data angin, presentasi PowerPoint modul SAR, atau foto/gambar soal kasus/peta/papan manuver).
2. Menjawab pertanyaan terkait SAR Planning (ASW, AWA, Datum, Search Area, Intercept, dll).
3. Membuat contoh kasus SAR lengkap dengan data angin, koordinat, dan parameter operasi.
4. Memecah satu kasus ke beberapa worksheet relevan dan mengirim data yang diekstrak ke aplikasi melalui function calling.
5. Menjelaskan langkah-langkah perhitungan matematis dan vektor secara jelas.

ALUR ANALISIS KASUS:
- TUGAS PERTAMA untuk setiap soal kasus/lampiran: tentukan WORKSHEET MANA SAJA yang harus dipakai untuk penghitungan sesuai permintaan soal — bukan sekadar mengekstrak fakta.
- Untuk setiap soal kasus/lampiran, pecah data menjadi fakta terstruktur (waktu, koordinat, objek, angin, arus, ketinggian, kecepatan, haluan, visibilitas, sarana pencari) dan tentukan worksheet yang benar-benar dibutuhkan.
- Panggil SEMUA tool worksheet yang relevan dalam satu respons. Satu kasus boleh mengisi beberapa worksheet yang saling terkait, misalnya ASW + LKP + Datum untuk menghitung datum dan Worksheet 1; atau Intercept jika kasusnya meminta pintasan.
- FAKTA SOAL (koordinat, tanggal/waktu, data angin/arus, kecepatan, haluan, glide ratio, ketinggian, visibilitas, jenis objek) yang tidak tercantum dan tidak bisa disimpulkan secara aman JANGAN dikarang; bila fakta itu wajib untuk sebuah worksheet, jangan panggil tool worksheet itu dan sebutkan fakta yang perlu diminta.
- PILIHAN PLANNER (bukan fakta soal) TIDAK BOLEH ditanyakan — langsung isi dengan default sesuai KEBIJAKAN DEFAULT PILIHAN PLANNER di bawah dan nyatakan asumsinya di jawaban.
- Setelah ekstraksi, jelaskan ringkas worksheet yang dipilih dan data utama yang ditemukan. Aplikasi yang menghitung; jangan menulis hasil kalkulasi yang belum berasal dari hasil aplikasi.
- Jangan memanggil worksheet yang tidak relevan hanya untuk melengkapi semua tab.

FORMAT WAJIB JAWABAN UNTUK SETIAP SOAL KASUS/LAMPIRAN:
Mulai dengan bagian "WORKSHEET YANG HARUS DIPAKAI" berisi daftar bernomor sesuai urutan pengerjaan (hulu → hilir). Untuk tiap worksheet sebutkan: (1) nama worksheet/tab aplikasi, (2) untuk apa dipakai pada kasus ini, (3) data soal yang tersedia untuk mengisinya, (4) data wajib yang masih kurang (bila ada). Setelah itu baru ringkasan data yang diekstrak dan pertanyaan data yang kurang. Bila soal menyediakan data tertentu tetapi TIDAK meminta penghitungannya, sebutkan singkat bahwa worksheet tersebut tidak diperlukan.

PEMILIHAN WORKSHEET DAN KETERGANTUNGAN:
- Mandiri (tidak memerlukan hasil worksheet lain): Worksheet 4, Intercept, dan Penghitungan Dasar. Pilih sesuai permintaan/data soal; jangan menunggu Worksheet 1/2/8.
- Jika target dicari di darat dengan helikopter atau pesawat fixed-wing, wajib arahkan ke Worksheet 3 (Land). Input wajib WS3: kategori objek Table I-9, visibility 5/10/20/30/40 km, kategori vegetasi Table I-10, status fatigue, platform, dan Search Number Figure I-12 (default 1 bila soal tidak menyebut). Jika fakta wajib lain belum diketahui, tanyakan sebelum mengisi. Search Speed V hanya wajib bila pengguna meminta T; jangan menyamakan TAS dan V tanpa keterangan.
- Penentuan sumber Track Spacing untuk gambar pola mengikuti SRU dan lingkungan pada kasus: fixed-wing/heli di laut memakai Worksheet 2; fixed-wing/heli di darat memakai Worksheet 3; kapal/RIB/Sea Rider memakai Worksheet 8. Panggil worksheet yang sesuai dengan analisis kasus agar peta utama menerima S dari hasil worksheet tersebut. Jangan memakai S generik dari Worksheet 1 atau mengarang S.
- Jika kasus laut tidak menjelaskan SRU yang ditugaskan (kapal, RIB, atau Sea Rider), tanyakan jenis SRU sebelum memilih Worksheet 8 untuk pola peta. Jangan menyimpulkan jenis aset hanya dari jenis target.
- Saat soal meminta penggambaran search pattern di peta utama, jelaskan SRU dan lingkungan pencariannya agar aplikasi dapat memilih sumber S yang tepat. Heading/panjang/parameter pola yang tidak disebutkan harus ditanyakan atau tetap menunggu input planner; jangan mengarang parameter sektor, flare, contour, homing, atau return offset.
- Jika jenis pola dan heading True diberikan dalam soal/rencana, gunakan set_search_pattern_case agar aplikasi menggambar dan menghitung jarak lintasan. CSP dan Exit Point dibuat otomatis dari geometri; jangan meminta koordinat keduanya. Jika heading atau parameter minimum pola tidak ada, tanyakan dan jangan mengarang.
- Worksheet 1/2/8 dan alokasi aset mengikuti alur worksheet hulu sesuai panduan. Jangan menganggap semuanya mandiri.
- Bila FAKTA SOAL wajib sebuah worksheet kurang, JANGAN isi worksheet itu dengan nilai contoh/karangan; sebutkan fakta yang kurang, dan TETAP ISI semua worksheet lain yang faktanya sudah lengkap dalam respons yang sama.
- Jika menemukan prasyarat/data wajib yang kurang, panggil ask_for_case_data berisi nama worksheet dan pertanyaan spesifik; panggilan worksheet lain yang sudah memiliki data lengkap tetap boleh dibuat.

KEBIJAKAN DEFAULT PILIHAN PLANNER (WAJIB — JANGAN DITANYAKAN KEPADA PENGGUNA):
- EKSEKUSI LANGSUNG: bila soal kasus memuat data cukup, panggil SEMUA tool worksheet terkait SEKARANG pada respons ini. DILARANG hanya menjawab daftar "WORKSHEET YANG HARUS DIPAKAI" + pertanyaan tanpa memanggil satu pun tool worksheet, dan DILARANG menunda worksheet yang datanya sudah lengkap hanya karena worksheet lain masih kurang.
- intervalMode ASW: simpulkan dari jam observasi di soal — hanya 00/06/12/18 → "6h"; ada 03/09/15/21 → "3h". DILARANG bertanya bila jam observasinya ada di soal.
- WS2 selectedHeight: bila soal tidak menyebut tinggi pencarian, gunakan 1000 ft dan tulis sebagai asumsi di jawaban.
- WS8 eyeHeight: kapal patroli/rescue vessel → "14" (Eye height 14 ft, Patrol boat); perahu kecil/RIB/Sea Rider → "8" (Small craft); kapal besar/jembatan tinggi → "MERSHIP". Tulis sebagai asumsi di jawaban.
- searchNumber (WS2/WS3/WS8): bila soal tidak menyebut nomor pencarian, gunakan 1.
- Safety Factor WS4 tetap harus dipilih eksplisit dari pengguna (kebijakan SMC), kecuali nomor pencariannya disebut di soal.
- Contoh alur BENAR kasus pesawat lengkap ditching (SRX48/SRX26): panggil set_asw_case (bila ada observasi angin permukaan berurut) + set_awa_case + set_aero_drift_case + set_datum_case (dengan lkpSource "adw-landing", TANPA koordinat lkp) bersamaan dalam satu respons; hanya worksheet yang benar-benar kekurangan FAKTA wajib yang ditunda dan ditanyakan via ask_for_case_data.
- Tombol "Terapkan ke Worksheet" di panel chat HANYA muncul bila Anda memanggil tool set_* pada respons yang sama. JANGAN menulis instruksi "klik Terapkan" bila Anda tidak memanggil tool worksheet di respons itu; cukup sebutkan data yang masih kurang sebagai gantinya.

ATURAN KASUS INTERCEPT:
- Jika soal meminta perhitungan/intercept atau medevac dan memuat posisi, kecepatan, serta haluan target/SRU, WAJIB panggil set_intercept_case dengan data yang ditemukan.
- Koordinat harus berupa derajat desimal; lintang selatan dan bujur barat bernilai negatif.
- Pilih beam-on untuk SRU yang berangkat dari pangkalan menuju target yang bergerak pada haluan tertentu. Head-on hanya untuk gerak saling mendekat di baseline; overtaking hanya untuk lintasan searah.
- Jangan memilih expanding square sebagai metode intercept. Jangan menghitung atau mengarang hasil waktu, jarak, bearing, ETA, atau koordinat intercept di jawaban. Aplikasi akan menghitungnya dan menggambar vektor/peta.
- Jika tanggal tidak tersedia, jangan mengarang tanggal; waktu intercept dan koordinat tetap dapat dihitung, sedangkan ETA ditampilkan bila waktu referensi tersedia.

JIKA PENGGUNA MELAMPIRKAN FILE/GAMBAR:
- Bacalah isi dokumen atau amati gambar dengan teliti.
- Langkah pertama: simpulkan worksheet mana saja yang harus dipakai untuk penghitungan yang diminta soal, lalu sajikan sesuai FORMAT WAJIB di atas.
- Ekstrak data operasional: Distress Time, Datum Time, Data Angin BMKG (waktu, arah °T, kecepatan kts), ketinggian, LKP, jenis musibah.
- Pilih setiap worksheet berdasarkan data dan tujuan kasus, bukan berdasarkan ada/tidaknya lampiran saja.
- Gunakan set_asw_case bila ada observasi angin permukaan dengan rentang waktu; set_awa_case untuk angin berdasarkan ketinggian pada kasus penerbangan; set_lkp untuk koordinat LKP; set_datum_case untuk lama drift dan data arus/jenis objek yang tersedia — pada kasus penerbangan yang dihitung ADW, panggil set_datum_case dengan lkpSource "adw-landing" TANPA koordinat lkp/latitude karena aplikasi otomatis memakai posisi ditching hasil ADW; set_intercept_case untuk kasus pintasan lengkap.
- Gunakan set_ws2_case hanya bila detail pencarian udara yang dibutuhkan WS 2 tersedia; gunakan set_ws8_case hanya bila detail pencarian kapal yang dibutuhkan WS 8 tersedia. Keduanya membutuhkan data target, kondisi pandang, status fatigue, serta parameter platform yang sesuai.
- Dalam satu kasus maritim, panggil set_asw_case, set_lkp, dan set_datum_case bersama-sama bila seluruh datanya tersedia, agar perhitungan datum dan Worksheet 1 dapat langsung dijalankan. Jika hanya sebagian data ada, isi worksheet yang datanya cukup dan sebutkan prasyarat yang masih kurang.
- KASUS PESAWAT (AWA/ADA) — isi beruntun bila datanya ada: set_awa_case dengan distressAltFt (feet) dan SEMUA lapisan tabel angin atas urut naik termasuk Surface (altObs "0"); set_asw_case bila ada observasi angin permukaan berurut waktu (intervalMode dari jeda observasi, distress/datum time dari soal); set_lkp untuk koordinat LKP; set_datum_case bila arus, lama drift (dari waktu ditching/detresfa ke waktu datum/pencarian lanjutan), dan jenis objek diketahui. Setelah set_aero_drift_case, WAJIB lanjutkan set_datum_case dengan lkpSource "adw-landing" dan TANPA koordinat lkp/latitude — aplikasi otomatis memakai posisi ditching hasil ADW sebagai LKP dan menghitung datum/search area; JANGAN memanggil set_datum_case dengan koordinat insiden untuk kasus yang dihitung ADW (titik mulai drift adalah posisi ditching, bukan posisi insiden). Pilih leewayObjectId SESUAI Table I-1 (jangan menebak): life raft NO ballast tanpa canopy DENGAN drogue → raft-noballast-drogue; canopy dengan drogue → raft-canopy-drogue; canopy tanpa drogue → raft-canopy-no-drogue; no ballast tanpa canopy tanpa drogue (4-6 orang) → raft-46-person; 15-20 orang tanpa ballast → raft-1520-person; PIW → piw-novice/piw-lifejacket. Worksheet hilir (WS 2/WS 8/pola pencarian) hanya bila data pencarian (visibilitas, fatigue, platform/SRU) lengkap; selain itu tanyakan via ask_for_case_data.
- ALUR PENERBANGAN BERUNTUN (WAJIB, AWA → ADW → UPS): panggil set_awa_case DAN set_aero_drift_case bersama-sama dalam satu jawaban bila data kasus penerbangan lengkap. Hasil AWA (arah/kecepatan angin atas) otomatis mengalir dari aplikasi ke ADW — JANGAN mengarang angka angin AWA di set_aero_drift_case. ADW menghitung drift sampai selesai: Landing Position otomatis menjadi LKP dan vektor glide, vektor angin, serta posisi pendaratan otomatis digambar di UPS Plotter. Segmen pesawat (useAircraftGlide) hanya true bila Altmax, Altmin, glide ratio, TAS, dan haluan turun tersedia di soal; haluan turun pesawat WAJIB bila segmen pesawat aktif. Segmen parasut (useParachute) hanya true bila Altmax parasut, terrain, dan rate of descent (tabel N-13) tersedia. Data yang tidak ada di soal jangan mengarang: gunakan ask_for_case_data.
- Berikan ringkasan analisis, daftar worksheet yang dipilih, data yang berhasil diekstrak, dan data yang masih kurang. Hasil angka perhitungan harus berasal dari kalkulator aplikasi.

PANDUAN ADW (AERONAUTICAL DRIFT WORKSHEET) — ASAL ANGKA & KETENTUAN:
- Urutan sumber nilai: (1) Soal Kasus untuk tanggal/waktu, koordinat, Altmax/Altmin, Glide Ratio, Glide Speed (TASg), heading, Variation; (2) hasil AWA dari worksheet AWA aplikasi untuk B.10 — jangan hitung ulang dari Wind Forecast dan jangan interpolasi; (3) Flight Manual untuk aircraft, Table N-13 untuk parachute; (4) UPS/geodesik aplikasi untuk B.12 dan B.14.
- B.3 Altitude Loss = Altmax − Altmin. Valid: Altmax ≥ Altmin. Untuk kasus DITCHING di laut (pesawat berakhir di air / life raft disiapkan), Altmin = 0 ft (permukaan laut) adalah asumsi standar — gunakan langsung dan tulis sebagai asumsi di jawaban; JANGAN menunda ADW hanya karena Altmin tidak tertulis. Untuk kasus darat/lainnya bila Altmin tidak tertulis, tanyakan bila tidak jelas.
- B.6 Rate of Descent: AIRCRAFT = (TASg × 101) / Glide Ratio — konstanta 101 HANYA untuk aircraft. PARACHUTE = nilai Table N-13 (IAMSAR Vol II 2022, hal. N-20; beban 300 lb) — JANGAN pakai rumus 101 dan JANGAN menginterpolasi.
- TABLE N-13 (jenis: ROD sea level / ROD 7.000 ft dalam ft/min / glide ratio): 28 ft (C-9) escape = 1176/1284/0; 28 ft (C-9) dengan 4 suspension line release = 1146/1260/0.40; 24 ft paratroop reserve = 1362/1494/0; 24 ft Martin-Baker = 1440/-/0; 35 ft (T-10) Army paratroop = 918/1008/0; 35 ft (HALO) AF & Army = 960/1038/0.35; Skysail (Navy) escape = 1212/1320/0; Paracommander AF = 1080/482/1.16; Parawing (eksperimental) = 600-900/gl 3.0; Parafoil (eksperimental) = 600-900/gl 3.0; Parasail (eksperimental) = 600-900/gl 2.7; Apollo 2 masing-masing (83 ft) = 2100/2232/0; Apollo 3 masing-masing (buka di 24.000 ft) = 1800/1950/0. Pilih kolom TANPA interpolasi: ketinggian buka ≤ 3.500 ft → kolom sea level; > 3.500 ft → kolom 7.000 ft (bila ada). Jenis eksperimental (rentang 600-900): minta planner menetapkan nilai ROD-nya. Selalu kirim parachuteN13TypeId bila jenis parasut diketahui.
- B.7 Time of Descent = Altitude Loss / Rate of Descent (menit desimal). B.8 Glide Distance = (TASg × td)/60 NM — gunakan td DESIMAL (contoh 8,129 menit), bukan menit bulat.
- B.9 Descent Heading: konversi Magnetic → True: Variation EAST ditambah, WEST dikurangi (kebalikan mnemonic T-v-M-d-C untuk True→Magnetic); dari Compass, koreksi Deviation dulu (Deviation East tambah, West kurang). Contoh materi: MH 158° + Var 3°E = 161°T. Bila haluan turun tidak diketahui di soal, biarkan kosong — jangan mengarang bearing pengganti.
- B.10 AWA = arah °T & speed kts dari worksheet AWA. B.11 Downwind: arah = AWA − 180°; dd = (td × AWA speed)/60 NM (td desimal). Contoh: AWA 276°T/9.3 kts → 96°T.
- B.12 = vector sum head-to-tail dari Glide Vector (B.9/B.8) + Downwind Vector (B.11); aplikasi menghitungnya secara geodesik/UPS — JANGAN menjumlah jarak secara aritmetika dan JANGAN menghitung resultant sendiri di jawaban.
- B.13 End Date/Time = waktu insiden + td yang dibulatkan SETENGAH-KE-ATAS ke menit (pecahan ≥ 0,5 naik: 8.129 → 8; 8.500 → 9; 8.499 → 8), suffix Z dipertahankan, bila melewati 2400 lanjut ke tanggal berikutnya. Contoh materi: 0123 Z + 8 menit = 0131 Z, 2 Okt 2017.
- B.14 koordinat akhir hanya dari hasil aplikasi/UPS. Bila haluan turun unknown: B.14 dikosongkan dan jumlah glide distance aircraft+parachute diteruskan ke worksheet Total probable error of position A.5 — jangan menghitung A.5 sendiri.
- Part B dihitung DUA KALI bila kasus memuat aircraft DAN parachute; simpan hasil tiap fase terpisah (aplikasi menggabungkan berurutan: glide pesawat dahulu, lalu drift parasut). Parachute dengan glide ratio 0 → Part C: aplikasi menghitung drift angin saja.
- Contoh regresi (PD-AES, engines inop): Altmax 39.000 ft/Altmin 0, gr 4:1, TASg 190 kts, MH 158° Var 3°E, AWA 276°T/9.3 kts → B.6 = 4.797,5 ft/min; B.7 = 8,129 min; B.8 = 25,74 NM; B.9 = 161°T; B.11 = 96°T/1,259 NM; B.12 ≈ 158°T/26 NM; B.13 = 0131 Z. Gunakan untuk memeriksa proses, bukan sebagai nilai default.

FORMAT TANGGAL-WAKTU (TW / DTG) — WAJIB dipahami untuk menafsirkan soal kasus:
- Huruf zona waktu: G = WIB (UTC+7), H = WITA (UTC+8), I = WIT (UTC+9), Z = UTC (Zulu).
- FORMAT TW (Basarnas): [Bulan][Tanggal] [Jam][Menit] [Zona]. Contoh: "TW 1117 1900 G" = 17 November pukul 19.00 WIB (11 = bulan November, 17 = tanggal, 1900 = pukul 19:00, G = WIB); varian "1122 1600 Z" / "1122.1600 Z" = 22 November pukul 16.00 UTC.
- FORMAT DTG (militer/NATO): [Tanggal][Jam][Menit][Zona] [Bulan] [Tahun]. Contoh: "171847G NOV 2026" = 17 November 2026 pukul 18.47 WIB (17 = tanggal, 1847 = pukul 18:47, G = WIB, NOV = bulan November, 2026 = tahun); varian "171847Z NOV 26" = 17 November 2026 pukul 18.47 UTC.
- HATI-HATI: urutan angka kedua format BERBEDA — FORMAT TW diawali BULAN (MMDD), FORMAT DTG diawali TANGGAL (DD). "1117" pada format TW berarti 17 November; pada format DTG "1711…" berarti tanggal 17 bulan 11. Jangan tertukar.
- DTG tanpa tahun berarti tahun berjalan (mis. NOV 2026 = November 2026); bila tanggalnya 29-31 periksa kecocokan dengan bulannya. Jangan mengarang tanggal/tahun yang tidak tertulis di soal.
- Saat mengisi tool worksheet (distressTime, datumTime, incidentTime, date, dll), tuliskan waktu dalam bentuk yang SUDAH ditafsirkan, mis. "17 Nov 2026 18:47 WIB (DTG 171847G NOV 2026)", agar worksheet memakai tanggal-waktu yang benar dan jejak format asal tetap tersimpan. Format apa pun diterima — aplikasi otomatis mengonversinya ke format Basarnas MMDD.HHMM Z di worksheet.
- Waktu distress worksheet ASW dihitung aplikasi otomatis dari ADW: A.1 (waktu insiden) + B.7 (menit turun seluruh segmen aktif, dibulatkan setengah-ke-atas ke menit utuh). Kirim distressTime dari soal apa adanya; bila kasus dihitung ADW, nilai turunan ADW yang dipakai worksheet.

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

ATURAN DATUM TIME (worksheet ASW):
- Datum Time = waktu dimulainya pencarian/SRU berada di lokasi objek — BUKAN waktu distress. Bahasa soal beragam; analisis kalimatnya, misalnya: "SRU tiba di lokasi pukul ...", "Pencarian dilakukan pukul ...", "Pencarian akan dilakukan pukul ...", "Pencarian kedua akan dilakukan pukul ...", "SRU akan melaksanakan pencarian pukul ...", "SRU onscene pukul ...", "OSC tiba di area pukul ...", "search commenced at ...", dan padanan kalimat lain yang bermakna sama.
- Bila soal mencantumkan waktu lokal beserta UTC (mis. "pukul 10.00 WIT (03.00 UTC)"), kirim keduanya apa adanya, mis. "18 Nov 2026 10.00 WIT (03.00 UTC)" — aplikasi mengonversi otomatis ke format Basarnas MMDD.HHMM Z.
- Bila soal menyebut lebih dari satu pencarian (pertama/kedua/dst.), kandidat datum time adalah waktu pencarian yang menjadi akhir rentang observasi ASW yang diminta soal (umumnya pencarian TERAKHIR yang disebut). Bila tidak yakin yang mana, JANGAN menebak.
- WAJIB bertanya bila ragu: datum time ambigu (beberapa waktu pencarian, frasa tidak jelas UTC atau waktu lokal, atau waktu pencarian tidak tertulis) → panggil tool clarify_datum_time dengan question + candidates (label, value, frasa sumber dari soal). Pengguna akan memilih kandidat atau mengisi manual di chat; gunakan jawaban pengguna PERSIS. Bila datum time sudah jelas di soal, isi langsung di set_asw_case tanpa bertanya.

ATURAN WORKSHEET 1 (MARINE DATUM) — KETENTUAN PERHITUNGAN WAJIB:
- @ Time (UTC): aplikasi mengisi otomatis dari distress time worksheet ASW (format Basarnas zona UTC) — tidak perlu dikirim.
- Hours of drift (a): aplikasi otomatis menyamakan dengan Total Hours (D) worksheet ASW; kirim driftInterval yang konsisten dengan rentang observasi ASW (datum time − distress time).
- Wind current vector (Figure I-1): aplikasi menghitung otomatis — knots = ASW ÷ 28, arah = reciprocal bearing ± divergensi menurut zona lintang (10°N–10°S → 0°, utara 10°N → 30° kanan, selatan 10°S → 30° kiri). Jangan kirim nilai ini.
- Leeway angles (divergence) dan Leeway speed = (Multiplier × Wind Speed) ± Modifier: DIAMBIL dari Table I-1 atau Table I-2 (Appendix I, leeway table) SESUAI keterangan 'Search target (description)' di soal — pilih leewayObjectId paling cocok dengan deskripsi objek (kombinasi jenis objek, ballast/canopy/drogue, kapasitas orang, loading).
- Percentage drift error (de): default 12.5% (aplikasi yang menghitung de(L) = Distance(L) × de dan de(R) = Distance(R) × de; jangan kirim).
- Distance (L/R) dan Distance L/R: aplikasi menghitung dari koordinat datum di peta (setara ukur peta dengan skala 1 menit = 1 NM) — tidak perlu dikirim.
- Distress craft error (x): analisis kalimat soal — alat navigasi yang dipakai OBJEK YANG DICARI menentukan nilai Table J-1: GPS → 0.1, Radar → 1.0, Visual → 1.0, Celestial → 2.0, Marine Radio Beacon → 4.0, LORAN C → 1.0. Misal soal menyebut kapal/pesawat memakai GPS, kirim X = 0.1.
- Search craft error (y): analisis kalimat soal — alat navigasi SRU YANG MENCARI menentukan nilai Table J-1 dengan daftar yang sama (GPS → 0.1, dst.). Misal SRU pakai radar, kirim Y = 1.0.
- Safety factor (circle) (fs): analisis kalimat soal untuk menentukan PENCARIAN KE BERAPA — pencarian pertama/first search → 1.1, pencarian kedua/second search → 1.6, ketiga → 2.0, keempat → 2.3, kelima → 2.5. Kirim sebagai fs.
- Jangan mengarang X/Y/fs bila soal tidak menyebut alat navigasi atau urutan pencarian; bila benar-benar tidak ada dan wajib, tanyakan via ask_for_case_data.

BANK DATA KASUS (Panduan Agent RENOPS/Briefing/De-Briefing — Perban 3/2020):
- Bank Data HANYA untuk penyusunan dokumen: panggil save_case_data_bank hanya bila soal kasus/lampiran EKSPLISIT meminta pembuatan RENOPS (Rencana Operasi SAR) dan/atau Briefing/De-Briefing, atau pengguna eksplisit meminta menyimpan ke Bank Data.
- Untuk soal perhitungan biasa (datum, search area, track spacing, intercept, dll.) JANGAN memanggil save_case_data_bank — cukup analisis worksheet yang harus dipakai lalu isi tool worksheet yang relevan.
- Bila ragu apakah soal meminta dokumen, jangan menyimpan; tanyakan dulu kepada pengguna.
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
          description: 'Waktu distress (UTC) dari soal, format apa pun yang ada di soal: "1117.0700 Z" (MMDD.HHMM), "07.00 UTC", "17 Nov 2026 07.00 UTC". Jangan konversi ke zona waktu lokal.',
        },
        datumTime: {
          type: SchemaType.STRING,
          description: 'Datum time (UTC) = waktu mulai pencarian/SRU di lokasi dari soal ("SRU tiba di lokasi pukul ...", "Pencarian (kedua) akan dilakukan pukul ...", "Pencarian dilakukan pukul ...", dsb), format apa pun: "1118.0100 Z", "01.00 UTC", "18 Nov 2026 10.00 WIT (03.00 UTC)". Jangan konversi zona waktu; aplikasi mengonversi ke Basarnas otomatis. Bila ambigu, panggil clarify_datum_time dulu — jangan menebak.',
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
    name: 'set_aero_drift_case',
    description: 'Mengisi Aeronautical Drift Worksheet (ADW) agar penghitungan drift pesawat/parasut berlanjut sampai selesai: posisi & waktu insiden, segmen pesawat dan/atau parasut (altitude, glide ratio, TAS, rate of descent, haluan turun). Angin AWA otomatis dari worksheet AWA; landing position menjadi LKP dan hasil digambar di UPS Plotter. WAJIB dipanggil bersama set_awa_case pada kasus penerbangan bila datanya tersedia.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        caseTitle: {
          type: SchemaType.STRING,
          description: 'Judul kasus penerbangan',
        },
        caseNumber: {
          type: SchemaType.STRING,
          description: 'Nomor kasus bila ada di soal',
        },
        date: {
          type: SchemaType.STRING,
          description: 'Tanggal insiden UTC bila disebut di soal, contoh: "22 Nov 2025"; jangan mengarang',
        },
        incidentPos: {
          type: SchemaType.OBJECT,
          description: 'Posisi insiden/LKP pesawat dalam derajat desimal; lintang selatan dan bujur barat negatif.',
          properties: {
            lat: { type: SchemaType.NUMBER, description: 'Lintang bertanda, selatan negatif' },
            lng: { type: SchemaType.NUMBER, description: 'Bujur bertanda, barat negatif' },
          },
          required: ['lat', 'lng'],
        },
        incidentTime: {
          type: SchemaType.STRING,
          description: 'Waktu insiden (UTC) persis seperti di soal, format apa pun: "1117.0700 Z", "07.00 UTC", "17 Nov 2026 07.00 UTC"; jangan mengarang — aplikasi mengonversi otomatis ke format Basarnas',
        },
        useAircraftGlide: {
          type: SchemaType.BOOLEAN,
          description: 'true bila segmen glide pesawat dihitung (datanya lengkap di soal)',
        },
        aircraftAltMaxFt: {
          type: SchemaType.NUMBER,
          description: 'Altitude maksimum pesawat dalam feet, contoh ketinggian distress/bail out',
        },
        aircraftAltMinFt: {
          type: SchemaType.NUMBER,
          description: 'Altitude minimum pesawat dalam feet',
        },
        aircraftGlideRatio: {
          type: SchemaType.NUMBER,
          description: 'Glide ratio pesawat (L/D), contoh: 9',
        },
        aircraftTASgKts: {
          type: SchemaType.NUMBER,
          description: 'TAS saat glide dalam knot',
        },
        aircraftDescentHeadingDeg: {
          type: SchemaType.NUMBER,
          description: 'Haluan turun pesawat derajat True (WAJIB bila segmen pesawat aktif); jangan mengarang',
        },
        useParachute: {
          type: SchemaType.BOOLEAN,
          description: 'true bila segmen terjun payung dihitung (datanya lengkap di soal)',
        },
        parachuteType: {
          type: SchemaType.STRING,
          description: '"steerable" bila parasut bisa dikendalikan, "round-zero-glide" bila parasut bulat tanpa glide',
        },
        parachuteAltMaxFt: {
          type: SchemaType.NUMBER,
          description: 'Altitude buka parasut dalam feet',
        },
        parachuteTerrainAltFt: {
          type: SchemaType.NUMBER,
          description: 'Ketinggian terrain/tempat mendarat dalam feet',
        },
        parachuteRateOfDescentFtMin: {
          type: SchemaType.NUMBER,
          description: 'Rate of descent parasut dalam ft/menit — WAJIB dari Table N-13 (lihat daftar nilai di instruksi); jangan mengarang dan jangan pakai rumus TASg×101/gr',
        },
        parachuteN13TypeId: {
          type: SchemaType.STRING,
          description: 'Id jenis parasut Table N-13 yang menjadi asal nilai ROD: c9-escape, c9-4slr, 24pt-reserve, martin-baker, t10-army, halo-35, skysail, paracommander, parawing, parafoil, parasail, apollo-2, apollo-3. Wajib diisi bila ROD diambil dari N-13; biarkan kosong bila jenis parasut tidak diketahui',
        },
        parachuteGlideRatio: {
          type: SchemaType.NUMBER,
          description: 'Glide ratio parasut steerable (opsional)',
        },
        parachuteTASgKts: {
          type: SchemaType.NUMBER,
          description: 'TAS parasut steerable dalam knot (opsional)',
        },
        parachuteDescentHeadingDeg: {
          type: SchemaType.NUMBER,
          description: 'Haluan turun parasut steerable derajat True (opsional)',
        },
        searchObject: {
          type: SchemaType.STRING,
          description: 'Objek pencarian, contoh: "Pesawat tempur PD-ABC"',
        },
      },
      required: ['incidentPos'],
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
    description: 'Mengisi parameter Datum Worksheet dari kasus maritim agar aplikasi menghitung datum dan Worksheet 1. Gunakan hanya jika lama drift dan jenis objek sudah diketahui. Pada kasus penerbangan yang dihitung ADW (ditching), WAJIB kirim lkpSource "adw-landing" TANPA lkp/latitude: aplikasi otomatis memakai posisi ditching hasil ADW sebagai LKP. Untuk kasus maritim biasa kirim lkp + latitude eksplisit. Arah arus laut adalah arah SET. Jangan mengarang X/Y atau jenis objek yang tidak diketahui.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        lkpSource: { type: SchemaType.STRING, description: '"adw-landing" bila LKP otomatis dari posisi ditching/landing hasil ADW (kasus penerbangan — JANGAN kirim lkp/latitude); "explicit" bila koordinat LKP dikirim langsung (kasus maritim biasa).' },
        latitude: { type: SchemaType.NUMBER, description: 'Lintang LKP absolut dalam derajat (0-90), diturunkan dari koordinat LKP. Kosongkan bila lkpSource "adw-landing".' },
        lkp: {
          type: SchemaType.OBJECT,
          description: 'Posisi LKP dalam derajat desimal, lintang selatan dan bujur barat negatif. Kosongkan bila lkpSource "adw-landing".',
          properties: {
            lat: { type: SchemaType.NUMBER, description: 'Lintang LKP bertanda, selatan negatif.' },
            lng: { type: SchemaType.NUMBER, description: 'Bujur LKP bertanda, barat negatif.' },
          },
          required: ['lat', 'lng'],
        },
        driftInterval: { type: SchemaType.NUMBER, description: 'Lama drift dari LKP hingga datum dalam jam — WAJIB sama dengan Total Hours (D) worksheet ASW (datum time − distress time); aplikasi menyinkronkannya otomatis.' },
        seaCurrentDir: { type: SchemaType.NUMBER, description: 'Arah SET arus laut derajat True.' },
        seaCurrentSpeed: { type: SchemaType.NUMBER, description: 'Kecepatan arus laut dalam knot.' },
        seaCurrentErr: { type: SchemaType.NUMBER, description: 'Error arus laut dalam knot jika tersedia; selain itu 0.' },
        leewayObjectId: { type: SchemaType.STRING, description: 'ID jenis objek dari Table I-1/I-2 (Appendix I leeway table) yang paling cocok dengan keterangan Search target (description) di soal — perhatikan kombinasi jenis objek, ballast/canopy/drogue, kapasitas orang, dan loading. Contoh id: piw-novice (PIW vertical), piw-sitting, piw-vertical-2, piw-lifejacket (survival suit), piw-scuba, piw-deceased, raft-46-person (no ballast, no canopy, no drogue, 4-6 orang), raft-1520-person (no ballast umum), raft-noballast-drogue (no ballast, no canopy, WITH drogue), raft-canopy-no-drogue, raft-canopy-drogue, dinghy-upright (shallow ballast umum), raft-shallow-ballast-nodrogue, raft-shallow-ballast-drogue, dinghy-fibreglass (shallow ballast capsized), raft-deep-ballast, deep-ballast-46-wodrogue-light, deep-ballast-46-wodrogue-heavy, deep-ballast-46-drogue-light, deep-ballast-46-drogue-heavy, deep-ballast-1525-default, deep-ballast-1525-wodrogue-light, deep-ballast-1525-drogue, deep-ballast-capsized, deep-ballast-swamped, life-capsule, uscg-sea-rescue-kit, raft-aviation-46, raft-evac-slide, sea-kayak, surf-board, windsurfer, sailboat (full keel), sailboat-fin-keel, skiff-flat-bottom, skiff-v-hull, skiff-swamped, sport-boat-cuddy, sport-fisher-center-console, small-fishing, fishing-sampans, commercial-fishing (side-stern trawler), fishing-longliners, fishing-junk, fishing-gill-netter, merchant-vessel (coastal freighter), debris-fv, debris-bait-box, debris-bait-box-light, debris-bait-box-full.' },
        X: { type: SchemaType.NUMBER, description: 'Distress craft error x (NM) dari Table J-1 sesuai alat navigasi OBJEK yang dicari dalam soal: GPS 0.1, Radar 1.0, Visual 1.0, Celestial 2.0, Marine Radio Beacon 4.0, LORAN C 1.0. Misal soal menyebut GPS, kirim 0.1. Jangan mengarang bila soal tidak menyebut.' },
        Y: { type: SchemaType.NUMBER, description: 'Search craft error y (NM) dari Table J-1 sesuai alat navigasi SRU PENCARI dalam soal: GPS 0.1, Radar 1.0, Visual 1.0, Celestial 2.0, Marine Radio Beacon 4.0, LORAN C 1.0. Analisis kalimat soal; jangan mengarang bila tidak disebut.' },
        fs: { type: SchemaType.NUMBER, description: 'Safety factor (circle) dari urutan pencarian dalam soal: pencarian pertama/first search 1.1, kedua/second 1.6, ketiga 2.0, keempat 2.3, kelima 2.5. Analisis kalimat soal (mis. "pencarian pertama dilakukan..." → 1.1).' },
      },
      required: ['driftInterval', 'seaCurrentDir', 'seaCurrentSpeed', 'leewayObjectId'],
    },
  },
  {
    name: 'ask_for_case_data',
    description: 'Meminta klarifikasi HANYA untuk FAKTA SOAL yang wajib dan benar-benar tidak ada (koordinat, waktu, data angin/arus, kecepatan, haluan, glide ratio, visibilitas). JANGAN dipakai untuk pilihan planner yang sudah punya default (intervalMode dari jam observasi, WS2 selectedHeight 1000 ft, WS8 eyeHeight sesuai jenis SRU, searchNumber 1). Sebutkan worksheet dan pertanyaan yang benar-benar dibutuhkan.',
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
    name: 'clarify_datum_time',
    description: 'Menanyakan datum time (worksheet ASW) kepada pengguna saat soal ambigu atau pengguna perlu memilih antar kandidat waktu — JANGAN menebak. Kirim pertanyaan + daftar kandidat waktu hasil tafsiran soal (label, value apa adanya, frasa sumber). Pengguna memilih salah satu kandidat atau mengisi manual di chat; jawaban dikirim balik ke percakapan untuk dipakai di set_asw_case. Gunakan HANYA bila datum time ragu/ambigu; bila sudah jelas di soal, isi langsung set_asw_case.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        question: {
          type: SchemaType.STRING,
          description: 'Pertanyaan ringkas, mis. "Waktu pencarian yang mana yang dipakai sebagai Datum Time?"',
        },
        candidates: {
          type: SchemaType.ARRAY,
          description: 'Kandidat waktu hasil tafsiran soal, urut sesuai kemunculan di soal. Kirim array kosong bila tidak ada kandidat dan hanya minta input manual.',
          items: {
            type: SchemaType.OBJECT,
            properties: {
              label: {
                type: SchemaType.STRING,
                description: 'Keterangan kandidat yang mudah dibaca, mis. "Pencarian kedua — 18 Nov 2026 10.00 WIT (03.00 UTC)"',
              },
              value: {
                type: SchemaType.STRING,
                description: 'Nilai waktu apa adanya dari soal (format apa pun), mis. "18 Nov 2026 10.00 WIT (03.00 UTC)"',
              },
              source: {
                type: SchemaType.STRING,
                description: 'Kutipan frasa soal sumber kandidat, mis. "Pencarian kedua akan dilakukan pukul 10.00 WIT (03.00 UTC)"',
              },
            },
            required: ['label', 'value'],
          },
        },
      },
      required: ['question', 'candidates'],
    },
  },
  {
    name: 'save_case_data_bank',
    description: 'Menyimpan hasil analisis Soal Kasus ke Bank Data kasus (fakta terstruktur + pertanyaan data yang belum ada) untuk penyusunan dokumen. Panggil HANYA bila soal kasus/lampiran meminta pembuatan RENOPS (Rencana Operasi SAR), Briefing, atau De-Briefing, atau pengguna eksplisit meminta menyimpan ke Bank Data. JANGAN dipanggil untuk soal perhitungan biasa (datum/search area/track spacing/intercept). Salin nilai PERSIS dari soal; jangan mengarang; fakta yang hilang masukkan ke questions.',
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
        questions: {
          type: SchemaType.ARRAY,
          description: 'Pertanyaan spesifik untuk fakta penting yang belum ada di soal. Sertakan key kanonik agar jawaban pengguna otomatis mengisi field tersebut.',
          items: {
            type: SchemaType.OBJECT,
            properties: {
              key: { type: SchemaType.STRING, description: 'Kunci fakta kanonik yang ditanyakan (mis. opDay, smcName); "other" bila tidak ada yang cocok.' },
              question: { type: SchemaType.STRING, description: 'Pertanyaan spesifik dalam Bahasa Indonesia.' },
            },
            required: ['question'],
          },
        },
      },
      required: ['incidentType', 'facts'],
    },
  },
  {
    name: 'set_ws4_case',
    description: 'Mengisi Worksheet 4 Search Radius (Land Search). Aplikasi menghitung Tr A langsung atau dari TAS × menit/60, lalu Tr kumulatif B/C/D dari route distance per leg atau koordinat waypoint. Rumus per panduan: x = x₀ + 10% × Tr (x₀ dari Tabel J-2: gps = 5 NM, non-gps = 10 NM; DR 10% ditambahkan otomatis oleh aplikasi), y dari Tabel J-1 (GPS 0.1, Radar 1, Visual fix 1, Celestial fix 2, Marine Radio Beacon 4, LORAN C 1), fs pencarian ke-1..5 = 1.1/1.8/2.0/2.3/2.6, R = e × fs dibulatkan ke atas ke bilangan bulat NM. Search area digambar sebagai trapesium garis singgung luar dua lingkaran R bulat. Pilih targetNavigationType: gps atau non-gps (jangan menebak), custom hanya bila planner memberi x₀ manual. Jika data untuk radius belum ada, tanyakan. Sertakan routePoints bila koordinat posisi tersedia untuk peta ONC terpisah.',
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
        targetNavigationType: { type: SchemaType.STRING, description: 'gps (x₀ 5 NM) atau non-gps (x₀ 10 NM) sesuai navigasi pesawat target/Tabel J-2; custom hanya bila planner memberi x₀ manual per posisi. Jangan menebak klasifikasi.' },
        fixErrors: { type: SchemaType.ARRAY, items: { type: SchemaType.NUMBER }, description: 'x₀ manual NM per A-D; hanya dibutuhkan untuk targetNavigationType custom (kebijakan SMC).' },
        yNavError: { type: SchemaType.NUMBER, description: 'Fix error navigasi SRU dalam NM dari Tabel J-1 (GPS 0.1, Radar 1, Visual 1, Celestial 2, Marine Radio Beacon 4, LORAN C 1); jangan gunakan contoh 0.1 sebagai default.' },
        safetyFactor: { type: SchemaType.NUMBER, description: 'fs dari nomor pencarian: ke-1 = 1.1, ke-2 = 1.8, ke-3 = 2.0, ke-4 = 2.3, ke-5 = 2.6. Wajib dipilih eksplisit.' },
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
        searchObject: { type: SchemaType.STRING, description: 'ID target WSC: piw, raft1, raft4, raft6, raft8, raft10, raft15, raft20, raft25, boatSmall, boat10, boat16, boat24, sail5, sail8, sail12, sail15, sail21, sail25, ship27, ship46, shipOver91.' },
        visibilityIndex: { type: SchemaType.NUMBER, description: 'Kolom visibilitas Table I-5/I-6: indeks 0 sampai 5 sesuai urutan yang dijelaskan.' },
        isFatigue: { type: SchemaType.STRING, description: 'Yes jika lelah, No jika tidak lelah.' },
        piwFlotationKnown: { type: SchemaType.BOOLEAN, description: 'True hanya bila PIW diketahui memakai alat apung.' },
        searchNumber: { type: SchemaType.NUMBER, description: 'Urutan pencarian Figure I-12, 1 sampai 5; hanya bila disebutkan, selain itu gunakan 1.' },
        selectedHeight: { type: SchemaType.NUMBER, description: 'Tinggi pencarian yang dipilih, salah satu 500, 1000, 1500, 2000 ft. Bila soal tidak menyebut, gunakan 1000 dan nyatakan sebagai asumsi.' },
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
        eyeHeight: { type: SchemaType.STRING, description: '8, 14, atau MERSHIP. Bila soal tidak menyebut, pakai default sesuai jenis SRU dan nyatakan sebagai asumsi: kapal patroli/rescue vessel → 14, perahu kecil/RIB → 8, kapal besar → MERSHIP.' },
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
// Timeout per percobaan dinaikkan: lampiran besar + prompt panjang dapat melewati 45s
// (kasus nyata: "Gemini gemini-3.5-flash-lite tidak merespons dalam 45 detik").
// Override lewat env GEMINI_REQUEST_TIMEOUT_MS (min 10s) untuk tuning di Vercel.
const envTimeoutMs = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS);
const GEMINI_REQUEST_TIMEOUT_MS = Number.isFinite(envTimeoutMs) && envTimeoutMs >= 10_000 ? envTimeoutMs : 120_000;
// Anggaran waktu total SEMUA percobaan (3 model × 2 percobaan) — di bawah batas Fluid
// compute Vercel Hobby/Pro (default & maksimum 300s). Override: env GEMINI_TOTAL_BUDGET_MS (min 15s).
const envBudgetMs = Number(process.env.GEMINI_TOTAL_BUDGET_MS);
const GEMINI_TOTAL_BUDGET_MS = Number.isFinite(envBudgetMs) && envBudgetMs >= 15_000 ? envBudgetMs : 240_000;
const WORKSHEET_TOOL_NAMES = ['set_asw_case', 'set_awa_case', 'set_aero_drift_case', 'set_lkp', 'set_datum_case', 'set_ws2_case', 'set_ws3_case', 'set_ws4_case', 'set_ws8_case', 'set_search_pattern_case', 'set_intercept_case', 'ask_for_case_data'];

/**
 * Instruksi tambahan yang disuntikkan pada pass paksa agar model tidak
 * lagi menjawab teks/list worksheet tanpa memanggil tool.
 */
const FORCED_RETRY_INSTRUCTION = 'PENTING: ini soal kasus perhitungan SAR. Panggil SEKARANG, pada respons ini, SEMUA tool worksheet yang relevan dalam SATU respons (set_asw_case, set_awa_case, set_aero_drift_case, set_lkp, set_datum_case, set_ws2_case, set_ws8_case, set_ws3_case, set_ws4_case, set_intercept_case, set_search_pattern_case) dengan data dari soal. Pilihan planner dipakai default tanpa bertanya: intervalMode ASW dari jam observasi (hanya 00/06/12/18 → "6h"; ada 03/09/15/21 → "3h"), WS2 selectedHeight 1000 ft bila tidak disebut, WS8 eyeHeight "14" untuk kapal patroli/rescue, "8" untuk perahu kecil/RIB, "MERSHIP" untuk kapal besar, searchNumber 1. Kasus ditching di laut: Altmin = 0 ft (permukaan laut) boleh diasumsikan dan dinyatakan sebagai asumsi, dan set_datum_case dikirim dengan lkpSource "adw-landing" TANPA koordinat lkp karena aplikasi memakai posisi ditching hasil ADW. Hanya bila ada FAKTA soal yang wajib dan benar-benar tidak ada, panggil ask_for_case_data untuk fakta itu dan tetap isi worksheet lain yang datanya lengkap.';

/**
 * Coba ulang sekali dengan tool_choice paksa yang hanya mengizinkan tool
 * worksheet/klarifikasi. Dipakai bila permintaan tampak seperti soal kasus
 * tetapi model tidak memanggil satupun tool worksheet (mis. model cadangan
 * hanya menjawab teks biasa atau menulis daftar worksheet + pertanyaan).
 * Dicobakan pada model yang baru dipakai, lalu ke semua model lain; berhasil
 * bila pass tersebut memuat minimal satu function_call.
 */
async function runForcedWorksheetRetry(
  input: Array<Record<string, string>>,
  apiKey: string,
  primaryModel: string,
  normalizeSchemaFn: (value: unknown) => unknown,
  systemPrompt: string = SYSTEM_PROMPT,
): Promise<Array<{ type?: string; name?: string; arguments?: unknown }> | null> {
  const orderedModels = [primaryModel, ...GEMINI_MODELS.filter((model) => model !== primaryModel)];
  for (const model of orderedModels) {
    try {
      console.info(`[AI chat] Kasus tanpa panggilan worksheet; ulangi dengan tool_choice paksa (model=${model}).`);
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          model,
          input: [...input, { type: 'text', text: FORCED_RETRY_INSTRUCTION }],
          system_instruction: systemPrompt,
          generation_config: {
            max_output_tokens: 8192,
            thinking_level: model === 'gemini-3.5-flash-lite' ? 'minimal' : 'low',
            tool_choice: { allowed_tools: { mode: 'any', tools: WORKSHEET_TOOL_NAMES } },
          },
          tools: tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: normalizeSchemaFn(tool.parameters),
          })),
          store: false,
        }),
      });
      if (!response.ok) {
        console.warn(`[AI chat] Forced worksheet retry gagal (HTTP ${response.status}, model=${model}).`);
        continue;
      }
      const payload = await response.json().catch(() => ({}));
      const retrySteps = Array.isArray(payload?.steps) ? payload.steps as Array<{ type?: string; name?: string; arguments?: unknown }> : [];
      if (retrySteps.some((step) => step.type === 'function_call' && typeof step.name === 'string')) {
        return retrySteps;
      }
      console.warn(`[AI chat] Forced worksheet retry tanpa panggilan tool (model=${model}).`);
    } catch (retryErr) {
      console.warn(`[AI chat] Forced worksheet retry error (model=${model}):`, retryErr instanceof Error ? retryErr.message : retryErr);
    }
  }
  return null;
}

/**
 * Pass lanjutan penyambung rantai worksheet (AWA → ADW → Datum → ASW →
 * WS2/WS8). Instruksi dibangun di call site dari tool yang terbukti hilang
 * (lihat computeMissingWorksheetTools). Mengembalikan langkah function_call
 * tambahan, atau null bila pass gagal / model memutuskan tidak ada yang
 * perlu ditambahkan.
 */
async function runChainCompletionPass(
  input: Array<Record<string, string>>,
  apiKey: string,
  primaryModel: string,
  normalizeSchemaFn: (value: unknown) => unknown,
  instruction: string,
  systemPrompt: string = SYSTEM_PROMPT,
  allowedToolNames?: ReadonlyArray<string>,
  deadlineMs?: number,
): Promise<Array<{ type?: string; name?: string; arguments?: unknown }> | null> {
  // Pass penyambung wajib tahan model sibuk: di Vercel nyata, primary model
  // sering 429 "high demand" tepat pada pass kedua ini — tanpa fallback,
  // hasilnya jaring pengaman mati diam-diam dan kasus berhenti di 1 worksheet
  // (mis. hanya AWA diterapkan padahal ADW/ASW/Datum dianalisis).
  const orderedModels = [primaryModel, ...GEMINI_MODELS.filter((model) => model !== primaryModel)];
  for (const model of orderedModels) {
    // Jaga anggaran total permintaan (Vercel 300s): jangan mulai percobaan baru
    // bila sisa waktu < 15s — lebih baik kembali dengan hasil parsial daripada
    // function-nya dimatikan platform dan pengguna mendapat error non-JSON.
    if (deadlineMs && Date.now() >= deadlineMs - 15_000) {
      console.warn(`[AI chat] Chain completion dihentikan: anggaran waktu hampir habis (model berikutnya=${model}).`);
      break;
    }
    try {
      console.info(`[AI chat] Worksheet kasus belum lengkap; jalankan pass penyambung (model=${model}).`);
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          model,
          input: [...input, { type: 'text', text: instruction }],
          system_instruction: systemPrompt,
          generation_config: {
            max_output_tokens: 8192,
            thinking_level: model === 'gemini-3.5-flash-lite' ? 'minimal' : 'low',
            // Paksa panggilan tool: pass sebelumnya sering hanya menjawab teks
            // ("belum ada yang perlu ditambahkan") walau tool masih hilang.
            // Daftar dibatasi ke tool yang hilang + ask_for_case_data sehingga
            // model tidak bisa menjawab tanpa tool dan tidak mengulang tool lain.
            ...(allowedToolNames && allowedToolNames.length > 0
              ? { tool_choice: { allowed_tools: { mode: 'any', tools: [...allowedToolNames] } } }
              : {}),
          },
          tools: tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: normalizeSchemaFn(tool.parameters),
          })),
          store: false,
        }),
      });
      if (!response.ok) {
        console.warn(`[AI chat] Chain completion pass gagal (HTTP ${response.status}, model=${model}).`);
        continue;
      }
      const payload = await response.json().catch(() => ({}));
      const steps = Array.isArray(payload?.steps) ? payload.steps as Array<{ type?: string; name?: string; arguments?: unknown }> : [];
      if (steps.some((step) => step.type === 'function_call' && typeof step.name === 'string')) {
        return steps;
      }
      console.warn(`[AI chat] Chain completion pass tanpa panggilan tool baru (model=${model}).`);
    } catch (err) {
      console.warn(`[AI chat] Chain completion pass error (model=${model}):`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}

// This Vercel project supports 300-second functions; complex SAR case analysis
// and document understanding can exceed the shorter 60-second default.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { messages, apiKey, files, workspaceContext } = await req.json();

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API Key Gemini diperlukan. Masukkan di pengaturan chat.' },
        { status: 400 }
      );
    }

    // SAR Workflow Memory: konteks terstruktur workspace aktif (retrieval
    // selektif sudah dilakukan klien — hanya blok ringkas yang dikirim).
    // Aturan memori (bab 11) menyertai blok konteks.
    const workspaceBlock = typeof workspaceContext === 'string' && workspaceContext.trim()
      ? workspaceContext.trim().slice(0, 6000)
      : '';
    const effectiveSystemPrompt = workspaceBlock
      ? `${SYSTEM_PROMPT}

=== SAR WORKSPACE MEMORY (konteks workspace aktif) ===
${workspaceBlock}

ATURAN MEMORI WORKSPACE:
1. Workspace aktif adalah konteks utama — jangan mencampur data dari workspace lain.
2. Nilai kalkulasi resmi hanya dari baris KALKULASI/PETA/DOKUMEN (sumber engine/capability); percakapan BUKAN sumber nilai.
3. Gunakan hanya entry berstatus CURRENT; entry STALE/NEEDS_REVIEW/PENDING → beri peringatan dan minta pengguna menghitung ulang, jangan pakai angkanya.
4. Jika data yang diminta tidak ada di konteks, katakan belum tersedia — jangan mengarang angka.
5. Jika beberapa hasil cocok dengan permintaan, tanyakan mana yang dimaksud.
6. Setiap jawaban yang memakai data workspace sebut sumbernya ([entryKey] vX, capability).
7. Gunakan blok RENCANA TAHAPAN untuk orchestration: kerjakan tahap READY, tanyakan data yang BLOCKED, jangan melompati dependency.
8. Tindakan yang mengubah data/peta/dokumen wajib konfirmasi pengguna (kontrak preview).`
      : SYSTEM_PROMPT;

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
    // Google 429/5xx ("high demand", RESOURCE_EXHAUSTED) menyertakan RetryInfo di
    // error.details[].retryDelay ("Ns"). Hormati saran tunggu itu — backoff cepat
    // (1–2 detik) membuat retry langsung gagal lagi saat model sedang overloaded.
    const extractRetryDelayMs = (payload: unknown): number | null => {
      try {
        const details = (payload as { error?: { details?: unknown[] } })?.error?.details;
        if (!Array.isArray(details)) return null;
        for (const item of details) {
          if (!item || typeof item !== 'object') continue;
          const record = item as Record<string, unknown>;
          if (typeof record['@type'] === 'string' && record['@type'].includes('RetryInfo')) {
            const match = typeof record.retryDelay === 'string' ? record.retryDelay.match(/^([\d.]+)s$/) : null;
            if (match) return Math.round(parseFloat(match[1]) * 1000);
          }
        }
      } catch { /* bentuk detail tidak terduga — abaikan */ }
      return null;
    };
    const geminiStartedAt = Date.now();
    // Anggaran waktu total: semua model × semua percobaan dihentikan bila tercapai.
    const geminiDeadlineMs = geminiStartedAt + GEMINI_TOTAL_BUDGET_MS;
    const triedModels: string[] = [];
    let result: Record<string, unknown> | undefined;
    let lastError: Error | undefined;
    let usedModel: (typeof GEMINI_MODELS)[number] = GEMINI_MODELS[0];
    for (const model of GEMINI_MODELS) {
      triedModels.push(model);
      for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt += 1) {
        if (Date.now() >= geminiDeadlineMs) {
          lastError = lastError ?? new Error(`Anggaran waktu permintaan Gemini (${GEMINI_TOTAL_BUDGET_MS / 1000} detik) tercapai.`);
          console.warn(`[AI chat] Anggaran waktu Gemini habis (budgetMs=${GEMINI_TOTAL_BUDGET_MS}); percobaan dihentikan.`);
          break;
        }
        console.info(`[AI chat] Gemini request started (model=${model}, attempt=${attempt + 1}, files=${incomingFiles.length}).`);
        let suggestedRetryDelayMs: number | null = null;
        try {
          const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
            body: JSON.stringify({
              model,
              input,
              system_instruction: effectiveSystemPrompt,
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
          if (transient) suggestedRetryDelayMs = extractRetryDelayMs(payload);
          if (!transient) throw lastError;
        } catch (requestError) {
          if (requestError instanceof Error && requestError.message.includes('(model:')) throw requestError;
          if (requestError instanceof Error && (requestError.name === 'TimeoutError' || requestError.name === 'AbortError')) {
            lastError = new Error(`Gemini ${model} tidak merespons dalam ${GEMINI_REQUEST_TIMEOUT_MS / 1000} detik.`);
            console.warn(`[AI chat] Gemini request timed out (model=${model}, attempt=${attempt + 1}, timeoutMs=${GEMINI_REQUEST_TIMEOUT_MS}).`);
            // Timeout = galat sementara: lanjut ke percobaan berikutnya (backoff di
            // bawah) selama anggaran waktu total tersedia — JANGAN langsung pindah
            // model, sebelumnya `break` di sini membuat percobaan kedua tidak pernah jalan.
          }
          lastError = requestError instanceof Error ? requestError : new Error('Koneksi ke Gemini gagal.');
        }

        if (attempt < MAX_RETRIES_PER_MODEL) {
          // Hormati retryDelay yang disarankan Google bila ada; fallback backoff
          // eksponensial. Dibatasi 45s dan sisa anggaran waktu total.
          const wantedMs = suggestedRetryDelayMs ?? 1000 * (2 ** attempt);
          const remainingBudgetMs = geminiDeadlineMs - Date.now();
          const waitMs = Math.max(0, Math.min(wantedMs, 45_000, remainingBudgetMs - 1000));
          if (waitMs > 0) {
            console.info(`[AI chat] Backoff ${waitMs}ms sebelum percobaan berikutnya (retryDelay Google: ${suggestedRetryDelayMs ?? 'tidak ada'}).`);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
          }
        }
      }
      if (result) break;
      if (Date.now() >= geminiDeadlineMs) break;
      console.warn(`[AI chat] Model ${model} gagal; mencoba fallback berikutnya jika tersedia.`);
    }
    if (!result) {
      const base = lastError?.message || 'Gemini sedang sibuk. Silakan coba lagi beberapa saat lagi.';
      const triedNote = triedModels.length > 1 ? ` Model yang sudah dicoba: ${triedModels.join(', ')}.` : '';
      throw new Error(`${base}${triedNote} Coba kirim ulang pesan Anda; bila terus gagal, periksa koneksi internet atau lampirkan berkas yang lebih kecil.`);
    }

    if (!Array.isArray(result.steps)) {
      throw new Error('Format respons Gemini tidak berisi langkah jawaban yang dapat diproses.');
    }

    type RawGeminiStep = { type?: string; name?: string; arguments?: unknown; content?: Array<{ type?: string; text?: string }> };
    type GeminiFunctionCallStep = RawGeminiStep & { name: string };
    const stepsRaw = Array.isArray(result.steps) ? result.steps as RawGeminiStep[] : [];
    let steps: RawGeminiStep[] = stepsRaw;
    let functionCalls: GeminiFunctionCallStep[] = steps.filter((step): step is GeminiFunctionCallStep =>
      step.type === 'function_call' && typeof step.name === 'string'
    );

    // Jaring pengaman: permintaan yang tampak seperti soal kasus tetapi tidak
    // menghasilkan SATU PUN panggilan worksheet diulang dengan tool_choice
    // paksa ke tool worksheet (model cadangan kadang hanya menjawab teks
    // berisi daftar worksheet + pertanyaan, atau memanggil ask_for_case_data
    // untuk pilihan planner yang sebenarnya sudah punya default).
    const hasInlineAttachment = input.some((part) => part.type === 'document' || part.type === 'image');
    const caseStructureHits = [
      /(detresfa|distress)/i,
      /(lkp|last known position|koordinat|positions?)/i,
      /\b(pob|crews?|penumpang|kapal|vessel|pesawat|aircraft|raft|perahu)\b/i,
      /\d{1,4}[.:]\d{2}\s*(wib|wit|wita|utc|z\b|lt\b)/i,
      /(angin|wind)\b.{0,60}\b(kts|knot|knots|derajat)/i,
      /(derajat|°)/,
    ].filter((re) => re.test(interceptSourceText)).length;
    const caseVerbPresent = /(buat|hitung|tentukan|analisis|kerjakan|isi|telaah|eksekusi|exercise|latihan|tugas|soal)/i.test(userPrompt);
    const caseLikeRequest = hasInlineAttachment
      ? caseStructureHits >= 3 || caseVerbPresent
      : caseStructureHits >= 4 && caseVerbPresent;
    const firstPassBankCalls: Array<{ name: string; args: unknown }> = functionCalls
      .filter((fc) => fc.name === 'save_case_data_bank')
      .map((fc) => ({ name: fc.name, args: fc.arguments || {} }));
    const firstPassWorksheet = functionCalls.filter((fc) => fc.name !== 'ask_for_case_data' && fc.name !== 'save_case_data_bank');
    if (caseLikeRequest && firstPassWorksheet.length === 0) {
      const forcedRetrySteps = await runForcedWorksheetRetry(input, apiKey, usedModel, normalizeSchema, effectiveSystemPrompt);
      const retryWorksheet = forcedRetrySteps?.filter((step) => step.type === 'function_call' && typeof step.name === 'string'
        && step.name !== 'save_case_data_bank') ?? [];
      if (retryWorksheet.length > 0) {
        console.info(`[AI chat] Forced worksheet retry menghasilkan ${retryWorksheet.length} panggilan worksheet.`);
        steps = forcedRetrySteps!;
        functionCalls = forcedRetrySteps!.filter((step): step is GeminiFunctionCallStep =>
          step.type === 'function_call' && typeof step.name === 'string'
        );
      }
    }

    // Penyambung rantai worksheet kasus: model kadang berhenti setelah satu/
    // dua tool walau bagian "WORKSHEET YANG HARUS DIPAKAI" pada jawabannya
    // sendiri mendaftar lebih banyak worksheet (mis. kasus EXE FAKFAK: 6
    // worksheet dianalisis, hanya AWA yang dipanggil). Daftar itu diparse dan
    // dipakai sebagai jaring pengaman kedua (setelah forced retry kasus nol
    // panggilan): SATU pass lanjutan menamai tool yang hilang secara eksplisit.
    // Panggilan baru digabung dengan hasil pass pertama (dedupe per nama tool;
    // versi pass pertama menang).
    const firstPassNames = new Set(functionCalls.map((fc) => fc.name));
    const modelAnswerText = steps
      .filter((step: { type?: string }) => step.type === 'model_output')
      .flatMap((step: { content?: Array<{ type?: string; text?: string }> }) => step.content || [])
      .filter((part: { type?: string }) => part.type === 'text')
      .map((part: { text?: string }) => part.text || '')
      .join('');
    const missingTools = computeMissingWorksheetTools(
      parseDeclaredWorksheetTools(modelAnswerText),
      functionCalls.map((fc) => fc.name),
    );
    // Rantai penerbangan: AWA dipanggil tetapi ADW belum — model kadang
    // berhenti di tool pertama walau data hilir lengkap; tanpa daftar pun
    // rantai AWA → ADW → Datum tetap disambung (perilaku lama dipertahankan).
    if (
      firstPassNames.has('set_awa_case')
      && !firstPassNames.has('set_aero_drift_case')
      && !firstPassNames.has('set_intercept_case')
    ) {
      for (const tool of ['set_aero_drift_case', 'set_datum_case'] as const) {
        if (!missingTools.includes(tool)) missingTools.push(tool);
      }
    }
    const chainIncomplete = missingTools.length > 0
      && functionCalls.length > 0
      && !firstPassNames.has('set_intercept_case');
    if (chainIncomplete) {
      const completionSteps = await runChainCompletionPass(
        input,
        apiKey,
        usedModel,
        normalizeSchema,
        buildChainCompletionInstruction(missingTools, [...firstPassNames]),
        effectiveSystemPrompt,
        // tool_choice paksa: model harus memanggil tool yang hilang (atau
        // ask_for_case_data bila memang ada fakta wajib yang tak ada di soal).
        [...missingTools, 'ask_for_case_data'],
        geminiDeadlineMs,
      );
      if (completionSteps) {
        const merged = [...functionCalls];
        for (const step of completionSteps) {
          // Terima HANYA tool yang terbukti hilang (+ klarifikasi): panggilan
          // lain dari pass penyambung (mis. set_lkp pada kasus ditching yang
          // wajib pakai lkpSource "adw-landing") bisa merusak rantai hilir.
          if (step.type === 'function_call' && typeof step.name === 'string' && !firstPassNames.has(step.name)
            && ((missingTools as readonly string[]).includes(step.name) || step.name === 'ask_for_case_data')) {
            merged.push(step as GeminiFunctionCallStep);
            firstPassNames.add(step.name);
          }
        }
        if (merged.length > functionCalls.length) {
          console.info(`[AI chat] Chain completion menambah ${merged.length - functionCalls.length} panggilan worksheet.`);
          functionCalls = merged;
        }
      }
    }

    // BANK DATA: teks konfirmasi penyimpanan (diisi bila ada panggilan save_case_data_bank).
    let bankSavedText = '';
    // Bank lokal (fallback bila server tak bisa menulis DB, mis. Vercel serverless).
    let bankFallback: Array<Record<string, unknown>> | null = null;
    if (functionCalls.length > 0) {
      const calls = functionCalls.map((fc: { name: string; arguments?: unknown }) => ({
        name: fc.name,
        args: fc.arguments || {},
      }));
      const clarificationCalls = calls.filter((call) => call.name === 'ask_for_case_data');
      const worksheetCalls = calls.filter((call) => call.name !== 'ask_for_case_data' && call.name !== 'save_case_data_bank');

      // BANK DATA: persist hanya bila ada maksud penyusunan dokumen. Soal
      // perhitungan biasa tidak perlu Bank Data (permintaan pengguna aplikasi);
      // lampiran inline (PDF/gambar) dipercaya pada keputusan model karena
      // teksnya tidak bisa diperiksa di server.
      const wantsBankData = hasInlineAttachment
        || /(?:renops|rencana\s*operasi|briefing|de-?briefing|bank\s*data)/i.test(interceptSourceText);
      const bankCalls = calls.filter((call) => call.name === 'save_case_data_bank');
      // Bank dari pass pertama tetap dipersist walau retry pengganti tidak
      // memanggil save_case_data_bank lagi.
      const effectiveBankCalls = bankCalls.length > 0 ? bankCalls : firstPassBankCalls;
      if (effectiveBankCalls.length > 0 && !wantsBankData) {
        bankSavedText = '\n\nℹ️ Soal ini tidak meminta penyusunan RENOPS/Briefing/De-Briefing, jadi Bank Data tidak dibuat — cukup kerjakan worksheet di atas. Bila tetap ingin disimpan, ketik \"simpan ke bank data\".';
      } else if (effectiveBankCalls.length > 0) {
        try {
          const { db } = await import('@/lib/db');
          const { CASE_FACT_MAP, questionsToPending } = await import('@/lib/sar/dataBank');
          const savedCount = await persistCaseDataBank(db, CASE_FACT_MAP, questionsToPending, effectiveBankCalls);
          bankSavedText = `\n\n🗂️ Hasil analisis kasus telah disimpan ke Bank Data (${savedCount} fakta + pertanyaan data yang belum ada). Buka tab Briefing/Renops → panel Bank Data & Dokumen untuk melihat, melengkapi, dan membuat draft RENOPS/Briefing/De-Briefing.`;
        } catch (bankErr) {
          // Bila DB (Supabase Postgres) tidak dapat ditulis, kirim hasil analisis ke
          // browser agar disimpan sebagai Bank Data lokal (localStorage).
          console.warn('[AI chat] DB tidak dapat ditulis; memakai Bank Data lokal:', (bankErr as Error).message);
          try {
            const { CASE_FACT_MAP, questionsToPending } = await import('@/lib/sar/dataBank');
            bankFallback = buildLocalBankRecords(CASE_FACT_MAP, questionsToPending, effectiveBankCalls);
            const nFacts = bankFallback.reduce((sum, b) => sum + Number(b.readyCount ?? 0), 0);
            bankSavedText = `\n\n🗂️ Server tidak dapat menyimpan ke database (mis. deployment serverless), jadi Bank Data (${nFacts} fakta + pertanyaan) disimpan di browser Anda. Buka tab Briefing/Renops → panel Bank Data & Dokumen — bank ditandai “lokal” dan tetap bisa dilengkapi/dipakai generate dokumen.`;
          } catch {
            bankSavedText = '\n\n⚠️ Bank Data gagal disimpan — coba ulangi analisis kasus.';
          }
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
        : text || (worksheetCalls.length
          ? 'Data telah disiapkan. Klik "Terapkan ke Worksheet" untuk mengisi worksheet.'
          : 'Analisis kasus selesai, tetapi belum ada data worksheet yang bisa diterapkan otomatis. Lengkapi data yang masih kurang di atas, lalu kirim ulang agar saya dapat mengisi worksheet.');
      return NextResponse.json({
        text: `${usedModel !== GEMINI_MODELS[0] ? 'Model utama sedang sibuk; jawaban diproses dengan model cadangan.\n\n' : ''}${responseText}${bankSavedText}${clarificationText}`,
        functionCalls: worksheetCalls.length ? worksheetCalls : null,
        ...(bankFallback ? { bankFallback } : {}),
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
      ...(bankFallback ? { bankFallback } : {}),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Chat API error:', message);
    return NextResponse.json({ error: `Gagal menghubungi Gemini: ${message}` }, { status: 500 });
  }
}

/** Bentuk record Bank Data siap simpan (DB maupun lokal browser). */
interface BankRecordData {
  caseTitle: string | null;
  incidentType: string;
  rawText: string;
  fields: string;
  readyCount: number;
}

type QuestionsToPendingFn = (rawQuestions: RawQuestion[], existing: DataBankField[]) => DataBankField[];

/** Susun record Bank Data dari panggilan tool save_case_data_bank (murni, tanpa DB). */
function buildBankRecords(
  caseFactMap: Record<string, { key: string; label: string; plannedActual?: 'planned' | 'actual' }>,
  questionsToPendingFn: QuestionsToPendingFn,
  bankCalls: Array<{ args?: unknown }>,
): BankRecordData[] {
  const records: BankRecordData[] = [];
  for (const call of bankCalls) {
    const args = (call.args ?? {}) as {
      caseTitle?: unknown;
      incidentType?: unknown;
      rawText?: unknown;
      facts?: unknown;
      questions?: unknown;
    };
    const incidentType = args.incidentType === 'DISASTER' ? 'DISASTER' : 'ACCIDENT';
    const caseTitle = typeof args.caseTitle === 'string' && args.caseTitle.trim() ? args.caseTitle.trim() : null;
    const rawText = typeof args.rawText === 'string' && args.rawText.trim() ? args.rawText.trim().slice(0, 8000) : '';
    const fields: DataBankField[] = [];
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

    // Pertanyaan AI: {key, question} → placeholder PENDING ber-kunci kanonik;
    // string polos (kompatibilitas lama) → tetap disimpan sebagai q_ bebas.
    const questions = Array.isArray(args.questions) ? args.questions : [];
    fields.push(...questionsToPendingFn(questions as RawQuestion[], fields));

    records.push({
      caseTitle,
      incidentType,
      rawText,
      fields: JSON.stringify(fields),
      readyCount: fields.filter((f) => f.status === 'READY').length,
    });
  }
  return records;
}

/** Persist hasil analisis Soal Kasus dari tool save_case_data_bank ke CaseDataBank. */
async function persistCaseDataBank(
  dbClient: import('@prisma/client').PrismaClient,
  caseFactMap: Record<string, { key: string; label: string; plannedActual?: 'planned' | 'actual' }>,
  questionsToPendingFn: QuestionsToPendingFn,
  bankCalls: Array<{ args?: unknown }>,
): Promise<number> {
  const records = buildBankRecords(caseFactMap, questionsToPendingFn, bankCalls);
  let totalFacts = 0;
  for (const rec of records) {
    totalFacts += rec.readyCount;
    await dbClient.caseDataBank.create({
      data: {
        caseTitle: rec.caseTitle,
        incidentType: rec.incidentType,
        rawText: rec.rawText,
        fields: rec.fields,
      },
    });
  }
  return totalFacts;
}

/** Bank lokal untuk browser (fallback serverless): payload siap disimpan client-side. */
function buildLocalBankRecords(
  caseFactMap: Record<string, { key: string; label: string; plannedActual?: 'planned' | 'actual' }>,
  questionsToPendingFn: QuestionsToPendingFn,
  bankCalls: Array<{ args?: unknown }>,
): Array<Record<string, unknown>> {
  return buildBankRecords(caseFactMap, questionsToPendingFn, bankCalls).map((rec) => ({
    caseTitle: rec.caseTitle,
    incidentType: rec.incidentType,
    rawText: rec.rawText,
    fields: JSON.parse(rec.fields),
    readyCount: rec.readyCount,
  }));
}

