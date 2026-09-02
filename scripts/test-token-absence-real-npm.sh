#!/usr/bin/env bash
# Credential-inspection tests against the REAL npm on PATH -- no shim. This
# is the regression for the protected-config-key failure mode: on npm >= 11,
# `npm config get //registry.npmjs.org/:_authToken` exits nonzero even when
# no token exists, so an inspection built on it can never pass in the real
# publish workflow. These cases prove the inspection passes on a genuinely
# clean environment with the real npm, and still refuses token-bearing
# adversarial fixtures. Read-only against npm; nothing publishes.
#
# Run: bash scripts/test-token-absence-real-npm.sh
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
work_directory="$(mktemp -d)"
trap 'rm -rf "${work_directory}"' EXIT

failures=0
npm_version="$(npm --version)"

run_case() {
  local case_name="$1" expectation="$2" home_directory="$3"
  shift 3
  local case_status=0
  (
    cd "${home_directory}" &&
    env "$@" HOME="${home_directory}" bash "${repository_root}/scripts/verify-token-absence.sh"
  ) > "${home_directory}/output" 2>&1 || case_status=$?
  if [ "${expectation}" = "refuses" ] && [ "${case_status}" -eq 0 ]; then
    echo "FAIL ${case_name}: expected refusal with real npm ${npm_version}, but it passed"
    cat "${home_directory}/output"
    failures=$((failures + 1))
  elif [ "${expectation}" = "passes" ] && [ "${case_status}" -ne 0 ]; then
    echo "FAIL ${case_name}: expected a clean pass with real npm ${npm_version}, but it refused"
    cat "${home_directory}/output"
    failures=$((failures + 1))
  else
    echo "ok ${case_name} (${expectation}, real npm ${npm_version})"
  fi
}

# A genuinely clean environment must pass with the real npm -- this is the
# case the protected config key used to break.
clean_home="${work_directory}/clean"
mkdir -p "${clean_home}"
run_case "clean-environment-passes" passes "${clean_home}"

# The inert setup-node placeholder (environment reference, no literal
# value) must also pass: the environment checks cover the resolved value.
placeholder_home="${work_directory}/placeholder"
mkdir -p "${placeholder_home}"
printf '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n' > "${placeholder_home}/.npmrc"
run_case "setup-node-placeholder-passes" passes "${placeholder_home}"

# Adversarial fixtures must refuse with the real npm.
env_home="${work_directory}/env-token"
mkdir -p "${env_home}"
run_case "environment-token-refuses" refuses "${env_home}" NODE_AUTH_TOKEN=realNpmAdversarialFixture

literal_home="${work_directory}/literal-token"
mkdir -p "${literal_home}"
printf '//registry.npmjs.org/:_authToken=realNpmAdversarialFixture\n' > "${literal_home}/.npmrc"
run_case "literal-npmrc-token-refuses" refuses "${literal_home}"

userconfig_home="${work_directory}/userconfig-token"
mkdir -p "${userconfig_home}"
printf '//registry.npmjs.org/:_authToken=realNpmAdversarialFixture\n' > "${userconfig_home}/custom-npmrc"
run_case "userconfig-token-refuses" refuses "${userconfig_home}" NPM_CONFIG_USERCONFIG="${userconfig_home}/custom-npmrc"

# The reproduced bypass: an npmrc auth entry referencing a NON-standard
# environment variable that is populated is a real credential and must
# refuse -- the reference is only inert while its variable is unset.
alt_reference_home="${work_directory}/alt-env-reference"
mkdir -p "${alt_reference_home}"
printf '//registry.npmjs.org/:_authToken=${ALT_AUTH_TOKEN}\n' > "${alt_reference_home}/.npmrc"
run_case "populated-alt-env-reference-refuses" refuses "${alt_reference_home}" ALT_AUTH_TOKEN=realNpmAdversarialFixture

unbraced_reference_home="${work_directory}/unbraced-env-reference"
mkdir -p "${unbraced_reference_home}"
printf '//registry.npmjs.org/:_authToken=$ALT_AUTH_TOKEN\n' > "${unbraced_reference_home}/.npmrc"
run_case "populated-unbraced-reference-refuses" refuses "${unbraced_reference_home}" ALT_AUTH_TOKEN=realNpmAdversarialFixture

unset_alt_home="${work_directory}/unset-alt-reference"
mkdir -p "${unset_alt_home}"
printf '//registry.npmjs.org/:_authToken=${ALT_AUTH_TOKEN}\n' > "${unset_alt_home}/.npmrc"
run_case "unset-alt-env-reference-passes" passes "${unset_alt_home}"

if [ "${failures}" -gt 0 ]; then
  echo "${failures} real-npm credential case(s) failed"
  exit 1
fi
echo "real-npm credential inspection ok (8 cases, npm ${npm_version})"
