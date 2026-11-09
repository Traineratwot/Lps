#!/usr/bin/env bash
# Removes the installed binary. The database and icons are kept.
set -euo pipefail

echo "==> removing /usr/local/bin/lps"
sudo rm -f /usr/local/bin/lps

echo "kept: /var/lib/lps (database + icons) — remove manually if needed:"
echo "  sudo rm -rf /var/lib/lps"
