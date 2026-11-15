#!/usr/bin/env bash
# ============================================================================
# vercel-env-sync.sh — push .env vars to Vercel via CLI (never prints values)
#
# PRASYARAT (salah satu):
#   a) Sudah login:  npx vercel login
#   b) Atau punya token:  export VERCEL_TOKEN=<token-dari-vercel.com/account/tokens>
#
# DAN project sudah di-link:
#   npx vercel link          # pilih scope + project, atau:
#   npx vercel link --yes --project=<nama-project> --scope=<team>
#
# PEMAKAIAN:
#   bash scripts/vercel-env-sync.sh                  # push ke production+preview+development
#   TARGETS=production bash scripts/vercel-env-sync.sh
#   ENV_FILE=.env.production bash scripts/vercel-env-sync.sh
#
# CATATAN:
#   - Nilai variabel TIDAK pernah di-echo ke layar atau log.
#   - Variabel NEXT_PUBLIC_* yang kosong di .env dilewati.
#   - Jika key sudah ada di Vercel, `vercel env add` akan menolak — script
#     otomatis menghapus versi lama dulu (`vercel env rm`) lalu menambah ulang.
# ============================================================================
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
TARGETS="${TARGETS:-production preview development}"
cd "$(dirname "$0")/.."

command -v npx >/dev/null 2>&1 || { echo "ERROR: npx tidak ditemukan"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "ERROR: file $ENV_FILE tidak ditemukan"; exit 1; }
[ -d ".vercel" ] || { echo "ERROR: project belum di-link. Jalankan: npx vercel link"; exit 1; }

if ! npx vercel whoami >/dev/null 2>&1; then
  echo "ERROR: belum login. Jalankan 'npx vercel login' atau set VERCEL_TOKEN."
  exit 1
fi

echo "==> Push var dari $ENV_FILE ke target: $TARGETS"
echo "==> (nilai disembunyikan)"

pushed=0
skipped=0

# Baca .env tanpa mengecho nilai. Lewati baris kosong/komentar.
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|\#*) continue ;;
  esac
  key="${line%%=*}"
  value="${line#*=}"
  # Lewati variabel kosong (mis. NEXT_PUBLIC_BATNAS_COG_URL= tanpa nilai)
  if [ -z "$value" ]; then
    echo "  SKIP  $key (kosong)"
    skipped=$((skipped+1))
    continue
  fi
  for target in $TARGETS; do
    # Hapus dulu bila sudah ada (agar idempoten), abaikan error bila belum ada.
    npx vercel env rm "$key" "$target" --force -y >/dev/null 2>&1 || true
    # Tambah dengan nilai dari stdin agar tidak muncul di ps/argv.
    printf '%s' "$value" | npx vercel env add "$key" "$target" >/dev/null 2>&1 || {
      printf '%s' "$value" | npx vercel env add "$key" "$target" 2>/dev/null | grep -q . \
        && { echo "  OK    $key [$target] (sudah ada, diperbarui)"; } \
        || { echo "  FAIL  $key [$target]"; exit 1; }
      continue
    }
    echo "  OK    $key [$target]"
  done
  pushed=$((pushed+1))
done < "$ENV_FILE"

echo "==> Selesai: $pushed var diproses, $skipped dilewati."
echo "==> Selanjutnya: redeploy agar NEXT_PUBLIC_* ter-bake ke bundle:"
echo "    npx vercel deploy --prod  (atau: npx vercel deploy --prebuilt)"
