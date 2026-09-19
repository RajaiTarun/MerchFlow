#!/usr/bin/env bash
# Redeploys all MerchFlow services on Render with one command, no git commit
# involved. Reads RENDER_API_KEY and RENDER_SERVICE_IDS (comma-separated) from
# the root .env file:
#
#   ./redeploy-all.sh
#
# Values already exported in the shell take precedence over .env.

set -euo pipefail

ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.env"

# Read a single KEY=value line from .env. We don't `source` the file: it holds
# unquoted URLs (with & and ?) and free-text lines that would break bash.
get_env() {
  { grep -E "^$1=" "$ENV_FILE" || true; } | tail -1 | cut -d= -f2- \
    | sed -E -e 's/^["'\'']//' -e 's/["'\'']?[[:space:]]*$//'
}

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy .env.example to .env and fill it in."
  exit 1
fi

RENDER_API_KEY="${RENDER_API_KEY:-$(get_env RENDER_API_KEY)}"
RENDER_SERVICE_IDS="${RENDER_SERVICE_IDS:-$(get_env RENDER_SERVICE_IDS)}"

if [ -z "$RENDER_API_KEY" ] || [ -z "$RENDER_SERVICE_IDS" ]; then
  echo "Add these to $ENV_FILE:"
  echo "  RENDER_API_KEY=your-key"
  echo "  RENDER_SERVICE_IDS=srv-aaa,srv-bbb,..."
  exit 1
fi

IFS=',' read -r -a SERVICE_IDS <<< "$(echo "$RENDER_SERVICE_IDS" | tr -d '[:space:]')"

for id in "${SERVICE_IDS[@]}"; do
  echo "Triggering deploy for $id..."
  curl -s -X POST "https://api.render.com/v1/services/$id/deploys" \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"clearCache":"do_not_clear"}'
  echo
done

echo "All ${#SERVICE_IDS[@]} redeploys triggered — check the Render dashboard for progress."
