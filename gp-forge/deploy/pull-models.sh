#!/usr/bin/env bash
# Pre-pull models on a NETWORK-CONNECTED machine, THEN move the appliance to its locked-egress VLAN.
# Models/updates are side-loaded, never pulled from the internet at runtime.
set -euo pipefail

docker compose exec ollama ollama pull qwen3:30b-a3b
# Lighter fallback:
# docker compose exec ollama ollama pull gpt-oss:20b

echo
echo "Models pulled. Next:"
echo "  1) Lock egress at the firewall (allow-list ONLY the Medicus API host)."
echo "  2) Set GPF_ALLOW_OPEN_EGRESS=false and restart gp-forge."
echo "  3) Confirm GP Forge logs: 'egress locked ✓'."
