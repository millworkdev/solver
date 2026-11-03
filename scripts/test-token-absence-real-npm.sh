#!/usr/bin/env bash
# Exercise the credential gate with the installed npm, in isolated config.
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
clean_env=(
  PATH="$PATH"
  NPM_CONFIG_USERCONFIG="${scratch}/user.npmrc"
  NPM_CONFIG_GLOBALCONFIG="${scratch}/global.npmrc"
  npm_config_cache="${scratch}/cache"
)

env -i "${clean_env[@]}" bash "${script_dir}/verify-token-absence.sh" >"${scratch}/clean.out"
grep -q 'credential inspection clean' "${scratch}/clean.out"

if env -i "${clean_env[@]}" NODE_AUTH_TOKEN="synthetic-nonsecret-test-value" bash "${script_dir}/verify-token-absence.sh" >"${scratch}/token.out" 2>&1; then
  echo "FAIL credential inspection accepted a populated token variable" >&2
  exit 1
fi
grep -q 'auth token is present' "${scratch}/token.out"
echo "real-npm credential inspection negative passed"
