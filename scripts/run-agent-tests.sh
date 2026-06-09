#!/usr/bin/env bash
# @spec AGENT_ARCHITECTURE_UPGRADE.md §4 Phase 4 — Test Runner shell wrapper
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo "=== Running agent test suite ==="
pnpm test --reporter=json > /tmp/test_output.json 2>&1 || true

echo "=== Test output written to /tmp/test_output.json ==="
cat /tmp/test_output.json
