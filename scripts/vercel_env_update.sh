#!/usr/bin/env bash
# Update R2 env vars on Vercel (foe-station/sarcalculation)
# Targets: production, preview, development (type: encrypted/secret, default)
# Values are read from environment variables -> nothing is hardcoded in this file.
set -u

TOKEN="${VERCEL_TOKEN:?VERCEL_TOKEN is required}"

cd /home/z/my-project

NAMES=(R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME)

fail=0
for name in "${NAMES[@]}"; do
  value="${!name:?missing value for $name}"
  if printf '%s' "$value" | vercel env add "$name" \
      --environment production,preview,development \
      --force --yes \
      --token "$TOKEN" >/tmp/vercel_env_last.log 2>&1; then
    echo "OK    $name -> production,preview,development (secret)"
  else
    echo "FAIL  $name"
    tail -5 /tmp/vercel_env_last.log
    fail=1
  fi
done

exit $fail
