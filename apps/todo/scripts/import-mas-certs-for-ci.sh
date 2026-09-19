#!/usr/bin/env bash
# Import Mac App Store signing identities into an ephemeral CI keychain.
#
# Required env:
#   MAC_APP_STORE_CERTIFICATE_BASE64       Apple Distribution .p12 (base64)
#   MAC_APP_STORE_CERTIFICATE_PASSWORD     password for Distribution .p12
#   KEYCHAIN_PASSWORD                      ephemeral keychain password
#
# Optional env (if Distribution + Installer were exported separately):
#   MAC_APP_STORE_INSTALLER_CERTIFICATE_BASE64
#   MAC_APP_STORE_INSTALLER_CERTIFICATE_PASSWORD   defaults to MAC_APP_STORE_CERTIFICATE_PASSWORD
#
# Optional identity verification (full identity strings):
#   APPLE_APP_IDENTITY        e.g. "Apple Distribution: … (TEAMID)"
#   APPLE_INSTALLER_IDENTITY  e.g. "3rd Party Mac Developer Installer: … (TEAMID)"
#
# Optional provisioning profile (written for build:mas):
#   MAC_APP_STORE_PROVISIONING_PROFILE_BASE64
#   → $RUNNER_TEMP/mas.provisionprofile and APPLE_PROVISIONING_PROFILE_PATH

set -euo pipefail

: "${MAC_APP_STORE_CERTIFICATE_BASE64:?MAC_APP_STORE_CERTIFICATE_BASE64 is required}"
: "${MAC_APP_STORE_CERTIFICATE_PASSWORD:?MAC_APP_STORE_CERTIFICATE_PASSWORD is required}"
: "${KEYCHAIN_PASSWORD:?KEYCHAIN_PASSWORD is required}"

# Trim accidental whitespace/newlines/quotes from GitHub secret paste.
trim_secret() {
  echo -n "$1" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}
APPLE_APP_IDENTITY="$(trim_secret "${APPLE_APP_IDENTITY:-}")"
APPLE_INSTALLER_IDENTITY="$(trim_secret "${APPLE_INSTALLER_IDENTITY:-}")"

KEYCHAIN_PATH="${KEYCHAIN_PATH:-$RUNNER_TEMP/mas-signing.keychain-db}"

import_p12() {
  local label="$1"
  local b64="$2"
  local password="$3"
  local path="$RUNNER_TEMP/${label}.p12"

  echo "Importing ${label} certificate..."
  # Strip whitespace/newlines that sometimes sneak into base64 secrets.
  echo "$b64" | tr -d '[:space:]' | base64 --decode > "$path"
  local size
  size="$(wc -c < "$path" | tr -d ' ')"
  if [[ "$size" -lt 100 ]]; then
    echo "ERROR: decoded ${label} .p12 is only ${size} bytes — check the base64 secret." >&2
    exit 1
  fi
  security import "$path" \
    -P "$password" \
    -A -t cert -f pkcs12 \
    -T /usr/bin/codesign \
    -T /usr/bin/productbuild \
    -T /usr/bin/security \
    -k "$KEYCHAIN_PATH"
  rm -f "$path"
}

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

import_p12 "mas-distribution" "$MAC_APP_STORE_CERTIFICATE_BASE64" "$MAC_APP_STORE_CERTIFICATE_PASSWORD"

if [ -n "${MAC_APP_STORE_INSTALLER_CERTIFICATE_BASE64:-}" ]; then
  INSTALLER_PASSWORD="${MAC_APP_STORE_INSTALLER_CERTIFICATE_PASSWORD:-$MAC_APP_STORE_CERTIFICATE_PASSWORD}"
  import_p12 "mas-installer" "$MAC_APP_STORE_INSTALLER_CERTIFICATE_BASE64" "$INSTALLER_PASSWORD"
fi

security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

# Put CI keychain first; keep existing user keychains for Apple intermediates.
EXISTING_KEYCHAINS="$(security list-keychains -d user | sed -E 's/^ *"//;s/"$//' | tr '\n' ' ')"
# shellcheck disable=SC2086
security list-keychains -d user -s "$KEYCHAIN_PATH" $EXISTING_KEYCHAINS
security default-keychain -s "$KEYCHAIN_PATH"

if [ -n "${MAC_APP_STORE_PROVISIONING_PROFILE_BASE64:-}" ]; then
  PROFILE_PATH="${RUNNER_TEMP}/mas.provisionprofile"
  echo "$MAC_APP_STORE_PROVISIONING_PROFILE_BASE64" | tr -d '[:space:]' | base64 --decode > "$PROFILE_PATH"
  export APPLE_PROVISIONING_PROFILE_PATH="$PROFILE_PATH"
  echo "Wrote provisioning profile to $PROFILE_PATH ($(wc -c < "$PROFILE_PATH" | tr -d ' ') bytes)"
fi

if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "KEYCHAIN_PATH=$KEYCHAIN_PATH"
    if [ -n "${APPLE_PROVISIONING_PROFILE_PATH:-}" ]; then
      echo "APPLE_PROVISIONING_PROFILE_PATH=$APPLE_PROVISIONING_PROFILE_PATH"
    fi
    # Re-export trimmed identity strings so later steps don't keep a trailing newline.
    if [ -n "${APPLE_APP_IDENTITY}" ]; then
      echo "APPLE_APP_IDENTITY<<EOF"
      echo "${APPLE_APP_IDENTITY}"
      echo "EOF"
    fi
    if [ -n "${APPLE_INSTALLER_IDENTITY}" ]; then
      echo "APPLE_INSTALLER_IDENTITY<<EOF"
      echo "${APPLE_INSTALLER_IDENTITY}"
      echo "EOF"
    fi
  } >> "$GITHUB_ENV"
fi

echo ""
echo "Code signing identities available in CI keychain:"
security find-identity -v -p codesigning "$KEYCHAIN_PATH" || true
echo ""
echo "Installer / productbuild identities:"
security find-identity -v "$KEYCHAIN_PATH" | grep -E "3rd Party Mac Developer Installer|Mac Developer Installer" || true

CODESIGN_COUNT="$(security find-identity -v -p codesigning "$KEYCHAIN_PATH" | grep -c 'Apple Distribution' || true)"
if [[ "${CODESIGN_COUNT}" -lt 1 ]]; then
  echo "ERROR: No 'Apple Distribution' codesigning identity in the CI keychain after import." >&2
  echo "Check MAC_APP_STORE_CERTIFICATE_BASE64 / PASSWORD (export cert + private key as .p12)." >&2
  exit 1
fi

if [ -n "${APPLE_APP_IDENTITY}" ]; then
  if ! security find-identity -v -p codesigning "$KEYCHAIN_PATH" | grep -F "${APPLE_APP_IDENTITY}" >/dev/null; then
    echo "ERROR: APPLE_APP_IDENTITY not found in keychain after import." >&2
    echo "Expected substring: ${APPLE_APP_IDENTITY}" >&2
    echo "Available codesigning identities:" >&2
    security find-identity -v -p codesigning "$KEYCHAIN_PATH" >&2 || true
    exit 1
  fi
  echo "App identity OK (matched Apple Distribution in keychain)"
fi

if [ -n "${APPLE_INSTALLER_IDENTITY}" ]; then
  if ! security find-identity -v "$KEYCHAIN_PATH" | grep -F "${APPLE_INSTALLER_IDENTITY}" >/dev/null; then
    echo "ERROR: APPLE_INSTALLER_IDENTITY not found in keychain after import." >&2
    echo "Expected substring: ${APPLE_INSTALLER_IDENTITY}" >&2
    security find-identity -v "$KEYCHAIN_PATH" >&2 || true
    exit 1
  fi
  echo "Installer identity OK"
fi
