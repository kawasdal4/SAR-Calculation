#!/bin/bash
# Uji end-to-end Bank Data & Generator Dokumen (Panduan Agent RENOPS/Briefing/De-Briefing)
set -e
BASE=http://localhost:3000

SOAL='SOAL KASUS SAR — KAPAL HILANG KONTAK
Pada tanggal 14 Maret 2026 pukul 05.30 WIB, RCC Denpasar menerima laporan dari PT. Bali Wisata Bahari bahwa KM NUSANTARA 07 (panggilan radio YDD-4421) tidak menjawab panggilan telepon satelit sejak pukul 22.15 WIB tanggal 13 Maret 2026. Kapal berangkat dari Pelabuhan Benoa menuju Pelabuhan Lembar dengan rute khatulistiwa, membawa 12 awak dan 46 penumpang, total 58 orang di atas kapal (POB).
Posisi terakhir yang dilaporkan nakhoda pada pukul 21.00 WIB adalah 12 NM tenggara Pelabuhan Benoa (lintang -8.9167, bujur 115.2833). Cuaca dilaporkan angin timuran 18 knot, gelombang 2.5 meter. Kapal membawa kargo umum 180 ton dan bahan bakar 22.000 liter. Kapal berwarna putih dengan lambung biru, berbendera Indonesia.
Frekuensi darurat kapal: VHF CH 16 dan CH 07. SARAS udara yang siap dikerahkan: 1 unit CN-235 dari Mako Lanud Halim Perdanakusuma. Unit laut: KRI BUNG TOMO berada 40 NM tenggara LKP. Belum ada upaya pencarian sebelumnya.'

echo "=== 1. POST /api/data-bank (analisis AI soal kasus ACCIDENT) ==="
RESP=$(curl -s -X POST $BASE/api/data-bank -H 'Content-Type: application/json' -d "$(python3 -c "
import json,sys
print(json.dumps({'rawText': sys.argv[1]}))
" "$SOAL")")
BANK_ID=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('bank',{}).get('id',''))")
echo "$RESP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if 'error' in d: print('ERROR:', d['error']); sys.exit(1)
s=d.get('summary',{})
print('bankId:', d['bank']['id'][:12])
print('caseTitle:', d['bank'].get('caseTitle'))
print('incidentType:', d.get('incidentType'))
print('summary:', s)
for f in d['bank']['fields'][:12]:
    print(' -', f['key'], '=', (f.get('value') or '')[:60], '|', f['status'])
"
echo "BANK_ID=$BANK_ID"

echo ""
echo "=== 2. PATCH /api/data-bank/[id] (jawab pertanyaan PENDING) ==="
PEND_KEY=$(curl -s $BASE/api/data-bank/$BANK_ID | python3 -c "
import json,sys
d=json.load(sys.stdin)
for f in d['bank']['fields']:
    if f['status']=='PENDING' and f.get('key','').startswith('q_'):
        print(f['key']); break
")
if [ -n "$PEND_KEY" ]; then
  curl -s -X PATCH $BASE/api/data-bank/$BANK_ID -H 'Content-Type: application/json' \
    -d "{\"key\":\"lkpCoord\",\"value\":\"8°55.00' S 115°17.00' E (12 NM tenggara Benoa, laporan nakhoda 21.00 WIB)\"}" | python3 -c "
import json,sys
d=json.load(sys.stdin)
f=[x for x in d['bank']['fields'] if x['key']=='lkpCoord'][0]
print('lkpCoord setelah PATCH:', f['value'][:60], '| status:', f['status'], '| source:', f['sourceType'])
"
else
  echo "(tidak ada q_ pending; patch langsung field lkpCoord)"
fi

echo ""
echo "=== 3. POST /api/documents/generate (AUTO dari bank) ==="
curl -s -X POST $BASE/api/documents/generate -H 'Content-Type: application/json' \
  -d "{\"bankId\":\"$BANK_ID\",\"docType\":\"AUTO\",\"snapshot\":null}" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if 'error' in d: print('ERROR:', d['error']); sys.exit(1)
doc=d['document']
print('draftId:', d['draftId'][:12])
print('docType:', doc.get('docType'), '|', doc.get('title'))
print('validation:', d.get('summary'))
print('sections:', len(doc.get('sections',[])))
print('questions (minta data ke user):')
for q in doc.get('questions',[])[:6]:
    print('  ?', q.get('label'), '->', q.get('question')[:70])
"

echo ""
echo "=== 4. PATCH field lkpCoord jawaban manual (jika belum) ==="
curl -s -X PATCH $BASE/api/data-bank/$BANK_ID -H 'Content-Type: application/json' \
  -d "{\"key\":\"lkpCoord\",\"value\":\"-8.9167, 115.2833 (laporan nakhoda 21.00 WIB)\"}" > /dev/null && echo "ok"
