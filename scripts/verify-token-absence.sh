#!/usr/bin/env bash
# Fail-closed npm credential inspection for trusted publishing. Exits
# nonzero (refuses) when any usable npm credential is present -- or when an
# inspection itself cannot complete, because a failed inspection could
# conceal a token.
#
# Deliberately avoids `npm config get //registry.npmjs.org/:_authToken`:
# on npm >= 11 that key is protected and the command exits nonzero even
# when no token exists, which is indistinguishable from a real failure.
# The supported inspection is:
#
#   1. token-bearing environment variables refuse;
#   2. `npm whoami` succeeding proves a usable credential and refuses
#      (its failure proves nothing and defers to the file scan);
#   3. every applicable npm configuration file (project, user, global) is
#      scanned for auth entries. A literal value refuses. An
#      environment-reference value (the line setup-node writes) is
#      resolved generically: it is inert only while the referenced
#      variable is unset or empty -- a populated referenced variable is a
#      real credential and refuses, whatever the variable is named. Any
#      other unrecognized value form refuses.
#
# This script performs no mutation of any kind.
set -euo pipefail

if [ -n "${NODE_AUTH_TOKEN:-}" ] || [ -n "${NPM_TOKEN:-}" ]; then
  echo "::error::An npm auth token is present in the environment; trusted publishing must be token-free." >&2
  exit 1
fi
if env | grep -Eiq '^npm_config_[^=]*(authtoken|_auth)[^=]*='; then
  echo "::error::An npm auth setting is present in npm_config_* environment variables; trusted publishing must be token-free." >&2
  exit 1
fi

if npm whoami --registry=https://registry.npmjs.org >/dev/null 2>&1; then
  echo "::error::npm whoami succeeded, so a usable npm credential is present; trusted publishing must be token-free." >&2
  exit 1
fi

globalconfig_status=0
globalconfig_path="$(npm config get globalconfig 2>&1)" || globalconfig_status=$?
if [ "${globalconfig_status}" -ne 0 ]; then
  echo "::error::Could not discover the npm global config path (exit ${globalconfig_status}); refusing rather than concealing a token." >&2
  printf '%s\n' "${globalconfig_path}" >&2
  exit 1
fi

for npmrc_path in ./.npmrc "${NPM_CONFIG_USERCONFIG:-${HOME}/.npmrc}" "${globalconfig_path}"; do
  [ -n "${npmrc_path}" ] || continue
  [ "${npmrc_path}" = "undefined" ] && continue
  [ -e "${npmrc_path}" ] || continue
  if [ ! -r "${npmrc_path}" ]; then
    echo "::error::npm config file ${npmrc_path} exists but is unreadable; refusing rather than concealing a token." >&2
    exit 1
  fi
  while IFS= read -r auth_entry_value; do
    if [ -z "${auth_entry_value}" ]; then
      continue
    fi
    referenced_variable=""
    case "${auth_entry_value}" in
      '${'*'}')
        referenced_variable="${auth_entry_value#'${'}"
        referenced_variable="${referenced_variable%'}'}"
        ;;
      '$'*)
        referenced_variable="${auth_entry_value#'$'}"
        ;;
      *)
        echo "::error::${npmrc_path} carries a literal npm auth entry; trusted publishing must be token-free." >&2
        exit 1
        ;;
    esac
    if ! printf '%s' "${referenced_variable}" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*$'; then
      echo "::error::${npmrc_path} carries an npm auth entry with an unrecognized value form; refusing rather than concealing a token." >&2
      exit 1
    fi
    if [ -n "$(printenv "${referenced_variable}" || true)" ]; then
      echo "::error::${npmrc_path} references environment variable ${referenced_variable} in an npm auth entry and that variable is populated; trusted publishing must be token-free." >&2
      exit 1
    fi
  done < <(grep -E '(_authToken|_auth)[[:space:]]*=' "${npmrc_path}" | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]+$//')
done

echo "npm credential inspection clean (environment, whoami, config files)."
