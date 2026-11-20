#!/bin/bash
# Fix the merge: repo project files must win over scaffold files at root.
set -euo pipefail

ROOT=/home/z/my-project
REPO=$ROOT/SAR-Calculation
cd "$ROOT"

# 1. Stop the dev server running the wrong (scaffold) app
pkill -f "next dev" 2>/dev/null || true
pkill -f "bun run dev" 2>/dev/null || true
sleep 2

# 2. Repo version wins for every conflicted project file/dir
for item in Caddyfile bun.lock components.json eslint.config.mjs examples mini-services next.config.ts package.json package-lock.json postcss.config.mjs prisma public src tailwind.config.ts tests tsconfig.json vercel.json GEMINI.md build_mef.py test_build_mef.py requirements.txt; do
  if [ -e "$REPO/$item" ]; then
    rm -rf "$ROOT/$item"
    mv "$REPO/$item" "$ROOT/$item"
    echo "repo->root: $item"
  fi
done

# 3. Merge repo scripts/* into root scripts/ (keep my helper scripts too)
if [ -d "$REPO/scripts" ]; then
  cp -rn "$REPO/scripts/"* "$ROOT/scripts/" 2>/dev/null || true
  rm -rf "$REPO/scripts"
fi

# 4. Repo .zscripts = stale sandbox scripts from original environment -> backup
if [ -d "$REPO/.zscripts" ]; then
  mkdir -p "$ROOT/scripts/repo-zscripts-backup"
  cp -r "$REPO/.zscripts/"* "$ROOT/scripts/repo-zscripts-backup/" 2>/dev/null || true
  rm -rf "$REPO/.zscripts"
fi

# 5. Remove leftover empty dirs + scaffold build artifacts
rm -rf "$REPO"
rm -rf "$ROOT/.next" "$ROOT/next-env.d.ts"

# 6. Ignore runtime db dir in git
grep -q '^/db/$' "$ROOT/.gitignore" || printf '\n# local sqlite db\n/db/\n' >> "$ROOT/.gitignore"

echo "=== Fix done ==="
ls -a "$ROOT"
echo "=== leftover in repo dir ==="
ls -a "$REPO" 2>/dev/null || echo "(removed)"
