#!/usr/bin/env bash
# Apply ops.json to jobs/*.json and push. Several runs can happen at once, so on a push
# race: reset to the latest dev, re-apply (ops are idempotent), retry.
set -euo pipefail
message="$1"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
for i in 1 2 3 4 5; do
  git fetch -q origin dev
  git reset -q --hard origin/dev
  node scripts/review-job.js apply ops.json
  if git diff --quiet; then exit 0; fi
  git commit -qam "$message"
  if git push -q origin HEAD:dev; then exit 0; fi
  sleep $((i * 3))
done
echo "Could not push after 5 attempts" >&2
exit 1
