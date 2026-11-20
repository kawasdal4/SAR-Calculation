#!/bin/bash
# Move cloned SAR-Calculation repo contents to the workspace root
# so the auto dev server (which runs at /home/z/my-project) picks it up.
set -euo pipefail

ROOT=/home/z/my-project
REPO=$ROOT/SAR-Calculation
cd "$ROOT"

# 1. Replace scaffold .git with the repo's .git (preserve repo history)
rm -rf "$ROOT/.git"
mv "$REPO/.git" "$ROOT/.git"

# 2. Merge runtime artifact dirs into scaffold dirs (same-purpose folders)
#    scaffold upload/ is empty -> move repo upload contents in
mv "$REPO/upload/"* "$ROOT/upload/"
#    download/: overwrite README, move subdirs/files
mv -f "$REPO/download/README.md" "$ROOT/download/README.md"
for item in "$REPO/download/"*; do
  base=$(basename "$item")
  if [ -d "$item" ]; then
    cp -r "$item" "$ROOT/download/$base.tmp" && rm -rf "$ROOT/download/$base" && mv "$ROOT/download/$base.tmp" "$ROOT/download/$base"
  else
    mv -f "$item" "$ROOT/download/"
  fi
done
rm -rf "$REPO/download"

# 3. Merge .gitignore: keep repo's, append sandbox-specific tail entries
mv "$REPO/.gitignore" "$ROOT/.gitignore"
cat >> "$ROOT/.gitignore" << 'EOF'
local-*
.claude
.z-ai-config
*.log
dev.log
dev.out.log
test
prompt
server.log
# Skills directory
/skills/
EOF

# 4. Move .env.example and everything else (files + dirs, including hidden)
mv "$REPO/.env.example" "$ROOT/.env.example"
shopt -s dotglob nullglob
for item in "$REPO"/*; do
  base=$(basename "$item")
  if [ -e "$ROOT/$base" ]; then
    echo "CONFLICT at root for: $base (keeping root version)"
    continue
  fi
  mv "$item" "$ROOT/"
done
shopt -u dotglob nullglob

# 5. Remove now-empty repo dir
rmdir "$REPO"

echo "=== Done. Root now contains the repo. ==="
ls -a "$ROOT" | head -40
