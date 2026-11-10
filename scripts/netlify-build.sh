#!/usr/bin/env bash
# Netlify build for the AIRa frontend.
#
# The Payload admin/API in this project is backed by Figma Cloud (database,
# storage, auth) through @payloadcms/figma, which only resolves inside the
# Figma Make lifecycle. The public AIRa app does not read Payload data, so on
# Netlify we build the Next.js frontend without the Payload route group.
# Figma Make publishing (.figma/make/deploy) is unaffected and still runs
# `payload build` with the platform-provided environment.
set -euo pipefail

if [ "${NETLIFY:-}" != "true" ]; then
  echo "netlify-build.sh only runs in Netlify CI; use 'pnpm run build' locally." >&2
  exit 1
fi

# Remove the Payload admin/API routes from this ephemeral CI checkout only.
rm -rf "src/app/(payload)"

export NODE_OPTIONS=--no-deprecation
exec pnpm exec next build
