#!/usr/bin/env bash
# Negative cases for scripts/verify-publish-preconditions.sh. Each scenario
# shims `npm` on PATH (never touching the real registry) and asserts the
# guard refuses -- or, for the one safe case, proceeds. The mixed-output
# scenarios reproduce a cached E404 fragment inside a DNS failure, which
# must refuse. Nothing here dispatches a workflow or publishes.
#
# Run: bash scripts/test-publish-preconditions.sh
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
work_directory="$(mktemp -d)"
trap 'rm -rf "${work_directory}"' EXIT

failures=0

# Build an isolated copy of the guard's inputs so scenarios can vary the
# manifest and npm behavior without touching the repository.
stage_scenario() {
  local scenario_name="$1" version="$2" view_mode="$3" config_mode="$4"
  local scenario_directory="${work_directory}/${scenario_name}"
  mkdir -p "${scenario_directory}/bin"
  node --eval "
    const manifest = require('${repository_root}/package.json');
    manifest.version = '${version}';
    require('node:fs').writeFileSync('${scenario_directory}/package.json', JSON.stringify(manifest, null, 2));
  "
  cp "${repository_root}/scripts/verify-publish-preconditions.sh" "${scenario_directory}/verify.sh"
  cp "${repository_root}/scripts/verify-token-absence.sh" "${scenario_directory}/verify-token-absence.sh"
  cat > "${scenario_directory}/bin/npm" <<SHIM
#!/usr/bin/env bash
if [ "\$1" = "whoami" ]; then
  case "${config_mode}" in
    has-credential) echo "shim-user"; exit 0 ;;
    *) echo "npm error code ENEEDAUTH" >&2; exit 1 ;;
  esac
fi
if [ "\$1" = "config" ]; then
  case "${config_mode}" in
    clean|has-credential) echo "${scenario_directory}/global-npmrc-absent"; exit 0 ;;
    globalconfig-fails) echo "npm config inspection unavailable" >&2; exit 1 ;;
  esac
fi
case "${view_mode}" in
  clean-e404) printf '{"error":{"code":"E404","summary":"No match found","detail":"not in this registry"}}\n'; exit 1 ;;
  version-exists) echo '"9.9.9"'; exit 0 ;;
  network-failure) echo "npm error code ENOTFOUND -- getaddrinfo failed" >&2; exit 1 ;;
  mixed-text) printf 'npm error code ENOTFOUND\ncached fragment: E404 Not Found\n'; exit 1 ;;
  mixed-json) printf '{"error":{"code":"E404","summary":"cached E404 after ENOTFOUND retry","detail":"stale"}}\n'; exit 1 ;;
esac
exit 1
SHIM
  chmod +x "${scenario_directory}/bin/npm" "${scenario_directory}/verify.sh"
  printf '%s' "${scenario_directory}"
}

run_scenario() {
  local scenario_name="$1" version="$2" view_mode="$3" config_mode="$4" dist_tag="$5" expected_version="$6" expectation="$7"
  shift 7
  local scenario_directory
  scenario_directory="$(stage_scenario "${scenario_name}" "${version}" "${view_mode}" "${config_mode}")"
  local guard_status=0
  (
    cd "${scenario_directory}" &&
    env "$@" PATH="${scenario_directory}/bin:${PATH}" NPM_CONFIG_USERCONFIG="${scenario_directory}/user-npmrc-absent" \
      DIST_TAG="${dist_tag}" EXPECTED_VERSION="${expected_version}" bash verify.sh
  ) > "${scenario_directory}/output" 2>&1 || guard_status=$?
  if [ "${expectation}" = "refuses" ] && [ "${guard_status}" -eq 0 ]; then
    echo "FAIL ${scenario_name}: expected the guard to refuse, but it proceeded"
    cat "${scenario_directory}/output"
    failures=$((failures + 1))
  elif [ "${expectation}" = "proceeds" ] && [ "${guard_status}" -ne 0 ]; then
    echo "FAIL ${scenario_name}: expected the guard to proceed, but it refused"
    cat "${scenario_directory}/output"
    failures=$((failures + 1))
  else
    echo "ok ${scenario_name} (${expectation})"
  fi
}

#            name                          version      view_mode       config_mode dist_tag  expected  expectation
run_scenario unpublished-version-proceeds  9.9.9        clean-e404      clean       candidate 9.9.9     proceeds
run_scenario existing-version-refuses      9.9.9        version-exists  clean       candidate 9.9.9     refuses
run_scenario network-failure-refuses       9.9.9        network-failure clean       candidate 9.9.9     refuses
run_scenario mixed-text-e404-refuses       9.9.9        mixed-text      clean       candidate 9.9.9     refuses
run_scenario mixed-json-e404-refuses       9.9.9        mixed-json      clean       candidate 9.9.9     refuses
run_scenario bootstrap-version-refuses     0.1.0        clean-e404      clean       candidate 0.1.0     refuses
run_scenario prerelease-version-refuses    9.9.9-rc.1   clean-e404      clean       candidate 9.9.9-rc.1 refuses
run_scenario version-mismatch-refuses      9.9.9        clean-e404      clean       candidate 9.9.8     refuses
run_scenario empty-expected-refuses        9.9.9        clean-e404      clean       candidate ""        refuses
run_scenario malformed-dist-tag-refuses        9.9.9        clean-e404      clean       bad/tag   9.9.9     refuses
run_scenario latest-dist-tag-proceeds       9.9.9        clean-e404      clean       latest    9.9.9     proceeds
run_scenario npm-token-refuses             9.9.9        clean-e404      clean       latest    9.9.9     refuses NPM_TOKEN=shim-token-value
run_scenario numeric-tag-refuses           9.9.9        clean-e404      clean       1.2.3     9.9.9     refuses
run_scenario ambient-token-refuses         9.9.9        clean-e404      clean       candidate 9.9.9     refuses NODE_AUTH_TOKEN=shim-token-value
run_scenario env-config-auth-refuses       9.9.9        clean-e404      clean       candidate 9.9.9     refuses npm_config_registry_authtoken=shim-token-value
run_scenario globalconfig-probe-refuses    9.9.9        clean-e404      globalconfig-fails candidate 9.9.9 refuses
run_scenario whoami-credential-refuses     9.9.9        clean-e404      has-credential candidate 9.9.9  refuses

# .npmrc token entries refuse even when every other probe is clean.
npmrc_directory="$(stage_scenario npmrc-token-refuses 9.9.9 clean-e404 clean)"
printf '//registry.npmjs.org/:_authToken=shim-token-value\n' > "${npmrc_directory}/.npmrc"
npmrc_status=0
(
  cd "${npmrc_directory}" &&
  env PATH="${npmrc_directory}/bin:${PATH}" NPM_CONFIG_USERCONFIG="${npmrc_directory}/user-npmrc-absent" \
    DIST_TAG=candidate EXPECTED_VERSION=9.9.9 bash verify.sh
) > "${npmrc_directory}/output" 2>&1 || npmrc_status=$?
if [ "${npmrc_status}" -eq 0 ]; then
  echo "FAIL npmrc-token-refuses: expected the guard to refuse, but it proceeded"
  cat "${npmrc_directory}/output"
  failures=$((failures + 1))
else
  echo "ok npmrc-token-refuses (refuses)"
fi

if [ "${failures}" -gt 0 ]; then
  echo "${failures} precondition scenario(s) failed"
  exit 1
fi
echo "publish-precondition negatives ok (18 scenarios)"
