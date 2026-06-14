#!/usr/bin/env bash
# Reproduce the whole KOF · Iori vs Orochi deliverable from scratch.
# Pipeline: build-character-shape (skill's required base) → painterlyize →
# finalize-meta → assemble → qc render. Scene + effects are hand-authored JSON
# already in assets/ (per the asset-generator skill's scene/effect recipes).
set -euo pipefail
cd "$(dirname "$0")/../../.."   # repo root
D=deliverables/kof-orochi
TMP=$(mktemp -d)

# --- Iori ---
npx tsx scripts/build-character-shape.ts --emit manifest --views all --spec '{
  "assetId":"character_iori_001","name":"八神庵","displayName":"庵",
  "palette":{"body":"#7a1622","skin":"#e7b892","hair":"#c8202a","pants":"#15121a"},
  "hairStyle":"spiky","costume":"vest","eyeStyle":"narrow"}' > "$TMP/iori_base.json"
node $D/build/painterlyize.mjs --in "$TMP/iori_base.json" --out "$TMP/iori_p.json" \
  --rim "rgba(176,118,255,0.72)" --hair "#d8242f" --hairDark "#7d1320"
node $D/build/finalize-meta.mjs --in "$TMP/iori_p.json" --out "$D/assets/character_iori_001.json" --json '{
  "scope":"project","tags":["kof","iori","fighter","character","painterly"],"displayName":"庵",
  "soundEffectIds":{"attack":"soundEffect_iori_slash_001","victory":"soundEffect_iori_laugh_001"},
  "references":[{"sourceType":"web","source":"https://snk.fandom.com/wiki/Iori_Yagami","note":"crimson coat, red hair, purple flames — re-stylized chibi"}]}'

# --- Orochi ---
npx tsx scripts/build-character-shape.ts --emit manifest --views all --spec '{
  "assetId":"character_orochi_001","name":"大蛇","displayName":"大蛇",
  "palette":{"body":"#d6d2e0","skin":"#ecdfd6","hair":"#dfe3ee","pants":"#eeecf2"},
  "hairStyle":"flowing","costume":"tank","eyeStyle":"narrow"}' > "$TMP/orochi_base.json"
node $D/build/painterlyize.mjs --in "$TMP/orochi_base.json" --out "$TMP/orochi_p.json" \
  --rim "rgba(120,245,190,0.72)" --hair "#e6e9f2" --hairDark "#aab0c8"
node $D/build/finalize-meta.mjs --in "$TMP/orochi_p.json" --out "$D/assets/character_orochi_001.json" --json '{
  "scope":"project","tags":["kof","orochi","boss","character","painterly"],"displayName":"大蛇",
  "soundEffectIds":{"attack":"soundEffect_orochi_blast_001","victory":"soundEffect_orochi_roar_001"},
  "references":[{"sourceType":"web","source":"https://snk.fandom.com/wiki/Orochi","note":"pale host, silver hair, green energy — re-stylized chibi"}]}'

# --- bake procedural → raster sprites (off the vector plane) ---
for c in iori orochi; do
  npx tsx scripts/bake-character-sprites.ts \
    --file "$D/assets/character_${c}_001.json" \
    --outDir "$D/sprites" --srcBase "$D/sprites" \
    --out "$D/assets/character_${c}_001.json"
done

# --- assemble + render ---
node $D/build/assemble.mjs
npx tsx scripts/qc-render.ts --kind filmstrip --project $D/project.json --library $D/library.json \
  --big 1 --cols 5 --rows 5 --duration 30 --out $D/renders/storyboard.png
echo "done."
