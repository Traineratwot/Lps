#!/usr/bin/env bash
# Builds dist/lps and installs it system-wide (needs sudo).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> building dist/lps"
bun run build

echo "==> installing to /usr/local/bin/lps"
sudo install -d -m 0755 /var/lib/lps
sudo install -m 0755 dist/lps /usr/local/bin/lps

echo
echo "installed: $(command -v lps)"
echo
echo "next steps:"
echo "  sudo lps scan                  # fill the index (~1-2 min)"
echo "  lps list packages              # works without sudo"
echo "  lps show git"
echo "  lps doctor"
