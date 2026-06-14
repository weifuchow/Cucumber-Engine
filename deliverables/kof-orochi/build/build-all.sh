#!/usr/bin/env bash
# Reproduce the KOF · Iori vs Orochi deliverable.
#
# Characters are REAL painted art: the user-provided turnaround sheets in
# references/ are cut into per-view, per-facing PNGs (background-keyed) and
# wired into the engine's imageSprite primitive — genuinely off the vector
# plane. Scene + effects remain hand-authored procedural JSON (the asset-
# generator skill's scene/effect recipes).
#
# Needs references/iori_sheet_ref.png + references/orochi_sheet_ref.png present
# (git-ignored; they are the user's source art). art/ (the cut frames) IS
# committed, so rendering works without re-cutting.
set -euo pipefail
cd "$(dirname "$0")/../../.."   # repo root
D=deliverables/kof-orochi

# 1. cut the reference sheets → art/<char>/<view>_<R|L>.png + imageSprite manifests
node $D/build/cut-all.mjs

# 2. assemble runnable project + library
node $D/build/assemble.mjs

# 3. render the storyboard for review
npx tsx scripts/qc-render.ts --kind filmstrip --project $D/project.json --library $D/library.json \
  --big 1 --cols 5 --rows 5 --duration 30 --out $D/renders/storyboard.png
echo "done."
