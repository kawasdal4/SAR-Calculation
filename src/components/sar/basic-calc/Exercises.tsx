'use client';

/**
 * Latihan penghitungan dasar SAR — diambil dari materi
 * "Introduction to SAR Calculation" (Ipuk Prasetyarin, Diklat SARPLAN
 * Angkatan XL, Jakarta, 26 Oktober 2026). Semua angka sudah diverifikasi.
 */

import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export interface Exercise {
  label: string;
  question: string;
  given?: string[];
  steps: string[];
  result: string;
}

export interface ExerciseGroup {
  group: string;
  hint: string;
  items: Exercise[];
}

export const EXERCISE_GROUPS: ExerciseGroup[] = [
  {
    group: 'Konversi Waktu',
    hint: 'Kalkulator: tab Konversi Waktu',
    items: [
      {
        label: 'Latihan W1',
        question:
          'Ubahlah ke dalam bentuk jam, menit, dan detik: (a) 1,68 jam  (b) 3,12 jam  (c) 0,735 jam  (d) 9,54 jam',
        steps: [
          'a. 1,68 jam = 1 jam + (0,68 × 60) menit = 1 jam 40,8 menit = 1 jam 40 menit 48 detik',
          'b. 3,12 jam = 3 jam + (0,12 × 60) menit = 3 jam 7,2 menit = 3 jam 7 menit 12 detik',
          'c. 0,735 jam = 0 jam + (0,735 × 60) menit = 44,1 menit = 44 menit 6 detik',
          'd. 9,54 jam = 9 jam + (0,54 × 60) menit = 9 jam 32,4 menit = 9 jam 32 menit 24 detik',
        ],
        result: 'a) 1j 40m 48d · b) 3j 7m 12d · c) 44m 6d · d) 9j 32m 24d',
      },
      {
        label: 'Latihan W2',
        question:
          'Ubahlah ke dalam bentuk desimal: (a) 3 jam 12 menit 18 detik  (b) 24 menit 58 detik  (c) 48 menit 36 detik  (d) 7 jam 24 menit 54 detik',
        steps: [
          'a. 3 jam 12 menit 18 detik = 3 + (12/60) + (18/3600) = 3,205 jam',
          'b. 24 menit 58 detik = (24 + 58/60) : 60 = 0,416 jam',
          'c. 48 menit 36 detik = (48 + 36/60) : 60 = 0,81 jam',
          'd. 7 jam 24 menit 54 detik = 7 + (24/60) + (54/3600) = 7,415 jam',
        ],
        result: 'a) 3,205 jam · b) 0,416 jam · c) 0,81 jam · d) 7,415 jam',
      },
      {
        label: 'Contoh materi',
        question: 'Konversi dua arah: 5,86 jam ↔ 5 jam 51 menit 36 detik',
        steps: [
          '5,86 jam = 5 jam + (0,86 × 60) menit = 5 jam 51,6 menit = 5 jam 51 menit 36 detik',
          '5 jam 51 menit 36 detik = 5 + (51/60) + (36/3600) = 5,86 jam',
        ],
        result: '5,86 jam = 5 jam 51 menit 36 detik',
      },
    ],
  },
  {
    group: 'Zona Waktu',
    hint: 'Kalkulator: tab Zona Waktu',
    items: [
      {
        label: 'Latihan (1)',
        question:
          'JRCC Australia menginformasikan kepada Kantor SAR Kupang bahwa terdapat kapal nelayan asal Kupang yang mengalami kebocoran kapal di Ashmore Reef pada 26 Oktober pukul 1600 UTC. Waktu kapal bocor tersebut setara dengan pukul berapa di wilayah Kantor SAR Kupang?',
        given: ['Waktu kejadian: 1600 UTC (Z), 26 Oktober', 'Kupang berada di wilayah WITA (UTC+8)'],
        steps: ['UTC → WITA = UTC + 8', '= (1600 + 0800) WITA', '= 0000 WITA (0000 H), 27 Oktober'],
        result: '0000 WITA (0000 H) pada 27 Oktober',
      },
      {
        label: 'Latihan (2)',
        question:
          'MV Grace pada TW 1027 0000 Z yang berada di laut Maluku melaporkan ke RCC Indonesia bahwa memerlukan medevac terhadap ABK-nya yang sakit. Setara dengan pukul berapakah waktu laporan tersebut dengan waktu wilayah Kantor SAR Ternate?',
        given: ['Waktu laporan: 0000 UTC (Z)', 'Ternate berada di wilayah WITA (UTC+8)'],
        steps: ['UTC → WITA = UTC + 8', '= (0000 + 0800) WITA', '= 0800 WITA (0800 H)'],
        result: '0800 WITA (0800 H)',
      },
      {
        label: 'Latihan (3)',
        question:
          'RCC Indonesia pada tanggal 26 Oktober pukul 2000 WIB akan menginformasikan kepada JRCC Australia bahwa MV Pacific Ocean yang berada di 110 barat Ujung Kulon mengalami trouble engine. Setara dengan pukul berapakah dalam waktu UTC?',
        given: ['Waktu lokal: 2000 WIB (G)', 'WIB → UTC = UTC − 7'],
        steps: ['= (2000 − 0700) UTC', '= 1300 UTC (1300 Z)'],
        result: '1300 UTC (1300 Z)',
      },
      {
        label: 'Latihan (4)',
        question:
          'RCC Indonesia akan menginformasikan kepada JRCC Australia bahwa telah ditemukan ABK MV Sydney Line di perairan selatan Jawa pada tanggal 26 Oktober pukul 0300 WIB. Setara dengan pukul berapakah dalam waktu UTC?',
        given: ['Waktu lokal: 0300 WIB (G), 26 Oktober', 'WIB → UTC = UTC − 7'],
        steps: ['= (0300 − 0700) UTC', '= −0400 → 2400 − 0400', '= 2000 UTC (2000 Z), 25 Oktober'],
        result: '2000 UTC (2000 Z) pada 25 Oktober',
      },
    ],
  },
  {
    group: 'Konversi Kecepatan',
    hint: 'Kalkulator: tab S·V·T (bagian konversi kecepatan)',
    items: [
      {
        label: 'Latihan K1',
        question: '75 nm/jam (kts) = … km/jam',
        steps: ['= 75 kts × 1,852 km/jam', '= 138,9 km/jam'],
        result: '138,9 km/jam',
      },
      {
        label: 'Latihan K2',
        question: '20 cm/s = … km/jam',
        steps: ['= 20 cm/s × 0,036 km/jam', '= 0,72 km/jam'],
        result: '0,72 km/jam',
      },
      {
        label: 'Latihan K3',
        question: '27 cm/s = … km/jam = … nm/jam (kts)',
        steps: [
          '= 27 cm/s × 0,036 km/jam = 0,972 km/jam',
          '= 27 cm/s × 0,019438444 kts = 0,525 kts',
        ],
        result: '0,972 km/jam = 0,525 kts',
      },
      {
        label: 'Latihan K4',
        question: '1,5 m/s = … km/jam = … nm/jam (kts)',
        steps: [
          '= 1,5 m/s × 3,6 km/jam = 5,4 km/jam',
          '= 1,5 m/s × (100 ÷ 51,4444) kts = 1,5 × 1,9438444 kts = 2,916 kts',
        ],
        result: '5,4 km/jam = 2,916 kts',
      },
      {
        label: 'Latihan K5',
        question: '0,8 m/s = … km/jam = … nm/jam (kts)',
        steps: [
          '= 0,8 m/s × 3,6 km/jam = 2,88 km/jam',
          '= 0,8 m/s × 1,9438444 kts = 1,555 kts',
        ],
        result: '2,88 km/jam = 1,555 kts',
      },
    ],
  },
  {
    group: 'Jarak · Waktu · Kecepatan (S·V·T)',
    hint: 'Kalkulator: tab S·V·T',
    items: [
      {
        label: 'Latihan 1',
        question:
          'Berapakah jarak yang ditempuh oleh helikopter yang terbang dengan kecepatan 75 knot selama 3 jam?',
        given: ['V = 75 kts', 'T = 3 jam'],
        steps: ['S = V × T', '= 75 kts × 3 jam', '= 225 nm'],
        result: 'S = 225 nm',
      },
      {
        label: 'Latihan 2',
        question:
          'Berapa waktu yang diperlukan Kapal Lautan Jaya dari Tanjung Emas – Pulau Karimunjawa yang berjarak 63 nm dengan kecepatan 21 kts?',
        given: ['S = 63 nm', 'V = 21 kts'],
        steps: ['T = S / V', '= 63 nm / 21 kts', '= 3 jam'],
        result: 'T = 3 jam',
      },
      {
        label: 'Latihan 3',
        question:
          'Bis Jaya Sinar dari Karawang, Jawa Barat ke Semarang, Jawa Tengah yang berjarak 396 km dengan waktu tempuh 4,5 jam. Berapakah kecepatan Bis Jaya Sinar tersebut?',
        given: ['S = 396 km', 'T = 4,5 jam'],
        steps: ['V = S / T', '= 396 km / 4,5 jam', '= 88 km/jam'],
        result: 'V = 88 km/jam',
      },
      {
        label: 'Latihan 4',
        question:
          'Kapal Meratus berlayar dengan kecepatan 18 knot. 3 jam kemudian kapal menurunkan kecepatan menjadi 15 knot. Berapa jarak yang ditempuh oleh kapal setelah berlayar selama 4 jam?',
        given: ['V₁ = 18 kts selama T₁ = 3 jam', 'V₂ = 15 kts selama T₂ = 1 jam (4 − 3)'],
        steps: ['S = (V₁ × T₁) + (V₂ × T₂)', '= (18 × 3) + (15 × 1)', '= 54 + 15', '= 69 nm'],
        result: 'S = 69 nm',
      },
      {
        label: 'Latihan 5',
        question:
          'Berapakah waktu yang diperlukan oleh RIB Banten untuk menempuh jarak sejauh 78 nm dengan kecepatan 30 kts?',
        given: ['S = 78 nm', 'V = 30 kts'],
        steps: ['T = S / V', '= 78 nm / 30 kts', '= 2,6 jam = 2 jam 36 menit'],
        result: 'T = 2,6 jam (2 jam 36 menit)',
      },
      {
        label: 'Latihan 6',
        question:
          'Berapakah kecepatan yang diperlukan oleh Bis Jaya Harapan untuk menempuh jarak sejauh 125 km dengan waktu 1,25 jam?',
        given: ['S = 125 km', 'T = 1,25 jam'],
        steps: ['V = S / T', '= 125 km / 1,25 jam', '= 100 km/jam'],
        result: 'V = 100 km/jam',
      },
      {
        label: 'Latihan 7',
        question:
          'Berapa jarak yang ditempuh oleh MV Pangrango selama 10 hari 5 jam dari Darwin dengan kecepatan 11 kts?',
        given: ['T = 10 hari 5 jam = (10 × 24) + 5 = 245 jam', 'V = 11 kts'],
        steps: ['S = V × T', '= 11 kts × 245 jam', '= 2.695 nm'],
        result: 'S = 2.695 nm',
      },
      {
        label: 'Latihan 8',
        question:
          'Berapakah waktu yang diperlukan oleh Pesawat Pas Air untuk menempuh jarak 1.485 nm dengan kecepatan 550 kts dan setelah mencapai jarak 1.485 nm pesawat menurunkan kecepatan 500 kts sampai dengan jarak 2.485 nm?',
        given: [
          'S₁ = 1.485 nm dengan V₁ = 550 kts',
          'S₂ = 2.485 − 1.485 = 1.000 nm dengan V₂ = 500 kts',
        ],
        steps: [
          'T₁ = S₁ / V₁ = 1.485 / 550 = 2,7 jam',
          'T₂ = S₂ / V₂ = 1.000 / 500 = 2 jam',
          'T = T₁ + T₂ = 2,7 + 2 = 4,7 jam',
        ],
        result: 'T = 4,7 jam (4 jam 42 menit)',
      },
    ],
  },
  {
    group: 'Area Pencarian (A·T·V·S)',
    hint: 'Kalkulator: tab Area',
    items: [
      {
        label: 'Latihan 1',
        question: 'Berapa besar area yang dapat disapu dalam pencarian jika T = 4 jam, V = 120 kts, S = 1 nm?',
        given: ['T = 4 jam', 'V = 120 kts', 'S = 1 nm'],
        steps: ['A = T × V × S', '= 4 × 120 × 1', '= 480 nm²'],
        result: 'A = 480 nm²',
      },
      {
        label: 'Latihan 2',
        question:
          'Berapa lama yang dibutuhkan untuk menyapu area seluas 22.980 nm²? (waktu dalam bentuk jam menit) — V = 120 kts, S = 1 nm',
        given: ['A = 22.980 nm²', 'V = 120 kts', 'S = 1 nm'],
        steps: ['T = A / (V × S)', '= 22.980 / (120 × 1)', '= 191,5 jam', '= 191 jam 30 menit'],
        result: 'T = 191,5 jam (191 jam 30 menit)',
      },
      {
        label: 'Latihan 3',
        question:
          'Jika pesawat pencari dapat mencari untuk 3 jam, berapa banyak pesawat yang dibutuhkan untuk menyelesaikan pencarian? — A = 2.880 nm², V = 120 kts, S = 1 nm',
        given: ['A = 2.880 nm²', 'T = 3 jam', 'V = 120 kts', 'S = 1 nm'],
        steps: ['n = A / (T × V × S)', '= 2.880 / (3 × 120 × 1)', '= 2.880 / 360', '= 8 pesawat'],
        result: 'n = 8 pesawat',
      },
      {
        label: 'Latihan 4',
        question:
          'Jika anda mempunyai 6 pesawat dan masing-masing dapat mencari selama 3 jam dengan kecepatan 120 kts, berapa besar area yang akan disapu jika S = 5 nm?',
        given: ['n = 6 pesawat', 'T = 3 jam', 'V = 120 kts', 'S = 5 nm'],
        steps: ['A = n × T × V × S', '= 6 × 3 × 120 × 5', '= 10.800 nm²'],
        result: 'A = 10.800 nm²',
      },
      {
        label: 'Latihan 5',
        question:
          'Jika anda hanya dapat menyapu area seluas 10.800 nm² dari area pencarian seluas 22.980 nm², berapa persentase area pencarian yang dapat anda sapu?',
        given: ['A tersapu = 10.800 nm²', 'A total = 22.980 nm²'],
        steps: ['% = (A tersapu / A total) × 100', '= (10.800 / 22.980) × 100', '= 47%'],
        result: '47%',
      },
      {
        label: 'Latihan 6',
        question:
          'Jika anda mempunyai 6 pesawat — 3 pesawat terbang dengan kecepatan 120 kts, 1 pesawat (180 kts), 1 pesawat (90 kts), dan 1 pesawat (100 kts) — masing-masing dapat mencari dalam waktu 3 jam, berapa luas area yang dapat disapu dengan S = 5 nm?',
        given: ['ΣV = (3 × 120) + 180 + 90 + 100 = 730 kts', 'T = 3 jam', 'S = 5 nm'],
        steps: ['A = (ΣV × T) × S', '= (730 × 3) × 5', '= 2.190 × 5', '= 10.950 nm²'],
        result: 'A = 10.950 nm²',
      },
      {
        label: 'Latihan 7',
        question:
          'Berapa track spacing yang harus anda gunakan untuk menyapu sebuah area seluas 2.970 nm² sebelum last sight dalam waktu 4,5 jam menggunakan 1 pesawat dengan kecepatan 120 kts?',
        given: ['A = 2.970 nm²', 'T = 4,5 jam', 'V = 120 kts'],
        steps: ['S = A / (T × V)', '= 2.970 / (4,5 × 120)', '= 2.970 / 540', '= 5,5 nm'],
        result: 'S = 5,5 nm',
      },
      {
        label: 'Latihan 8',
        question:
          'Jika luas area sebesar 2.300 nm² disapu dengan track spacing 2 nm dengan kecepatan 120 kts, setiap pesawat hanya dapat mencari selama 2 jam, berapa banyak pesawat yang dibutuhkan?',
        given: ['A = 2.300 nm²', 'S = 2 nm', 'V = 120 kts', 'T = 2 jam per pesawat'],
        steps: [
          'n = A / (T × V × S)',
          '= 2.300 / (2 × 120 × 2)',
          '= 2.300 / 480',
          '= 4,79 → dibulatkan ke atas',
        ],
        result: 'n = 5 pesawat',
      },
      {
        label: 'Latihan 9',
        question:
          'Berapa persentase dari area yang dapat disapu dalam 4 jam dari sebuah area pencarian berukuran 24 nm × 33 nm? — S = 6 nm, V = 12 kts',
        given: ['A total = 24 × 33 = 792 nm²', 'T = 4 jam', 'V = 12 kts', 'S = 6 nm'],
        steps: [
          'A tersapu = T × V × S = 4 × 12 × 6 = 288 nm²',
          '% = (288 / 792) × 100',
          '= 36,4%',
        ],
        result: '≈ 36,4%',
      },
      {
        label: 'Latihan 10',
        question:
          'Berapa banyak pesawat yang diperlukan untuk sebuah pencarian, jika A = 560 nm², S = 5 nm, T = 7 jam, V = 10 kts?',
        given: ['A = 560 nm²', 'S = 5 nm', 'T = 7 jam', 'V = 10 kts'],
        steps: [
          'n = A / (T × V × S)',
          '= 560 / (7 × 10 × 5)',
          '= 560 / 350',
          '= 1,6 → dibulatkan ke atas',
        ],
        result: 'n = 2 pesawat',
      },
      {
        label: 'Latihan 11',
        question:
          'Berapa lama waktu yang dibutuhkan untuk menyapu area berukuran 33 nm × 16 nm? — S = 4 nm, 2 unit pencari dengan kecepatan masing-masing 9 kts dan 11 kts',
        given: ['A = 33 × 16 = 528 nm²', 'S = 4 nm', 'ΣV = 9 + 11 = 20 kts'],
        steps: ['T = A / (ΣV × S)', '= 528 / (20 × 4)', '= 528 / 80', '= 6,6 jam = 6 jam 36 menit'],
        result: 'T = 6,6 jam (6 jam 36 menit)',
      },
      {
        label: 'Latihan 12',
        question:
          'Berapa lama waktu yang dibutuhkan untuk menyapu area seluas 3.000 nm², dengan menggunakan track spacing 2 nm dan kecepatan 120 kts?',
        given: ['A = 3.000 nm²', 'S = 2 nm', 'V = 120 kts'],
        steps: [
          'T = A / (V × S)',
          '= 3.000 / (120 × 2)',
          '= 3.000 / 240',
          '= 12,5 jam = 12 jam 30 menit',
        ],
        result: 'T = 12,5 jam (12 jam 30 menit)',
      },
      {
        label: 'Latihan 13',
        question:
          'Berapa kecepatan yang dibutuhkan untuk mencari area seluas 20 nm × 30 nm dalam waktu 2 jam dengan menggunakan track spacing 2 nm?',
        given: ['A = 20 × 30 = 600 nm²', 'T = 2 jam', 'S = 2 nm'],
        steps: ['V = A / (T × S)', '= 600 / (2 × 2)', '= 600 / 4', '= 150 kts'],
        result: 'V = 150 kts',
      },
      {
        label: 'Latihan 14',
        question:
          'Berapa lama waktu yang dibutuhkan untuk menyapu area seluas 23 nm × 17 nm? Jika menggunakan track spacing sebesar 3 nm, dan kecepatan pencari adalah 12 kts',
        given: ['A = 23 × 17 = 391 nm²', 'S = 3 nm', 'V = 12 kts'],
        steps: [
          'T = A / (V × S)',
          '= 391 / (12 × 3)',
          '= 391 / 36',
          '= 10,86 jam = 10 jam 51 menit 40 detik',
        ],
        result: 'T ≈ 10,86 jam (10 jam 51 menit 40 detik)',
      },
    ],
  },
];

export default function BasicCalcExercises() {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Klik setiap latihan untuk melihat pembahasan langkah demi langkah. Semua soal berasal dari
        materi &ldquo;Introduction to SAR Calculation&rdquo; — Diklat SARPLAN Angkatan XL.
      </div>
      {EXERCISE_GROUPS.map((group) => (
        <div key={group.group} className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-semibold text-slate-800">{group.group}</span>
            <Badge variant="outline" className="text-[10px] font-normal text-slate-500">
              {group.hint}
            </Badge>
          </div>
          <Accordion type="multiple" className="px-3">
            {group.items.map((ex) => (
              <AccordionItem key={ex.label} value={`${group.group}-${ex.label}`}>
                <AccordionTrigger className="py-3 text-xs sm:text-sm">
                  <span className="text-left">
                    <span className="mr-2 font-mono text-[10px] font-semibold uppercase text-emerald-700">
                      {ex.label}
                    </span>
                    {ex.question}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-2">
                  {ex.given && ex.given.length > 0 && (
                    <div className="text-xs text-slate-600">
                      <span className="font-semibold text-slate-700">Diketahui: </span>
                      {ex.given.join('; ')}
                    </div>
                  )}
                  <div className="rounded-md bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-700">
                    {ex.steps.map((step, i) => (
                      <div key={i}>{step}</div>
                    ))}
                  </div>
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs font-semibold text-emerald-800">
                    Jawaban: {ex.result}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      ))}
    </div>
  );
}
