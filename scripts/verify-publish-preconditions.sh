#!/usr/bin/env bash
# Publish preconditions for @millwork/solver. Run from the repository
# root with DIST_TAG and EXPECTED_VERSION set. Exits nonzero (refuses)
# unless every rule holds:
#
#   - the manifest names exactly this package;
#   - the version is stable SemVer (no prerelease, no build metadata) and
#     equals the operator-confirmed EXPECTED_VERSION;
#   - the version is not 0.1.0 -- the pre-repository bootstrap version is
#     immutable, never republished, and never gains a provenance attestation;
#   - the dist-tag matches the permitted pattern; latest is the release default;
#   - no npm auth token is present in the environment or in any applicable
#     npm configuration, and every token inspection must itself succeed --
#     a failing inspection refuses rather than concealing a token;
#   - the registry definitively reports the version absent: the JSON error
#     output must parse cleanly with error code exactly E404 and carry no
#     other failure marker. Mixed or unparseable output (DNS, timeout,
#     auth, 5xx, cached fragments) refuses.
#
# This script performs no publish and no mutation of any kind.
set -euo pipefail

package_name="$(node --print "require('./package.json').name")"
package_version="$(node --print "require('./package.json').version")"

if [ "${package_name}" != "@millwork/solver" ]; then
  echo "::error::This workflow publishes only @millwork/solver; the manifest names ${package_name}." >&2
  exit 1
fi

if ! printf '%s' "${package_version}" | grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'; then
  echo "::error::Version '${package_version}' is not stable SemVer; releases publish stable versions only." >&2
  exit 1
fi

if [ "${package_version}" = "0.1.0" ]; then
  echo "::error::0.1.0 is the immutable bootstrap version. It is never republished and never gains provenance." >&2
  exit 1
fi

if [ -z "${EXPECTED_VERSION:-}" ] || [ "${package_version}" != "${EXPECTED_VERSION:-}" ]; then
  echo "::error::Manifest version '${package_version}' does not equal the operator-confirmed expected version '${EXPECTED_VERSION:-}'." >&2
  exit 1
fi

if ! printf '%s' "${DIST_TAG:-}" | grep -Eq '^[a-z0-9][a-z0-9._-]{0,63}$' ||
   printf '%s' "${DIST_TAG:-}" | grep -Eq '^[0-9]'; then
  echo "::error::dist-tag must match ^[a-z0-9][a-z0-9._-]{0,63}$ and must not start with a number." >&2
  exit 1
fi

# Credential inspection lives in its own fail-closed script so it can be
# exercised against the real pinned npm as well as adversarial fixtures.
# It deliberately avoids the protected _authToken config key, which exits
# nonzero on npm >= 11 even when no token exists.
bash "$(dirname "$0")/verify-token-absence.sh"

lookup_status=0
lookup_output="$(npm view "${package_name}@${package_version}" version --json --registry=https://registry.npmjs.org 2>/dev/null)" || lookup_status=$?
if [ "${lookup_status}" -eq 0 ]; then
  echo "::error::${package_name}@${package_version} already exists on the registry. Published versions are immutable; bump the version instead." >&2
  exit 1
fi
# Only a definitive, cleanly-parsed E404 (version absent) may proceed:
# the entire JSON output must be one object whose error code is exactly
# E404, with no other failure marker anywhere in it. Anything else is
# indistinguishable from an unsafe state and refuses.
if ! printf '%s' "${lookup_output}" | node --input-type=module --eval '
  import { readFileSync } from "node:fs";
  const raw = readFileSync(0, "utf8");
  let parsed;
  try { parsed = JSON.parse(raw); } catch { process.exit(1); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) process.exit(1);
  if (Object.keys(parsed).length !== 1 || !parsed.error) process.exit(1);
  if (parsed.error.code !== "E404") process.exit(1);
  if (/\bE(?:NOTFOUND|TIMEDOUT|CONNREFUSED|AI_AGAIN|OTP|401|403|5\d\d)\b/.test(raw)) process.exit(1);
  process.exit(0);
'; then
  echo "::error::Registry lookup for ${package_name}@${package_version} did not produce a definitive E404; refusing to publish blind." >&2
  printf '%s\n' "${lookup_output}" >&2
  exit 1
fi

echo "${package_name}@${package_version} is definitively unpublished; preconditions hold for dist-tag '${DIST_TAG}'."
