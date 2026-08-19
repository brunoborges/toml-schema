#!/usr/bin/env bash

set -euo pipefail

readonly REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly INSTALLER="${REPOSITORY_ROOT}/scripts/install-tosd.sh"
readonly VERSION="1.0.0-rc.2"

temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

release_directory="${temporary_directory}/releases/download/rust-v${VERSION}"
mkdir -p "$release_directory"

create_archive() {
    local platform="$1"
    local asset="tosd-${VERSION}-${platform}"
    local root="${temporary_directory}/${asset}"

    mkdir -p "$root"
    printf '#!/usr/bin/env sh\nprintf "tosd fixture\\n"\n' > "${root}/tosd"
    chmod 0755 "${root}/tosd"
    tar -C "$temporary_directory" -czf "${release_directory}/${asset}.tar.gz" "${asset}/tosd"
    rm -rf "$root"
}

create_archive "linux-x86_64"
create_archive "linux-arm64"
create_archive "macos-arm64"

(
    cd "$release_directory"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum *.tar.gz
    else
        shasum -a 256 *.tar.gz
    fi
) > "${release_directory}/tosd-${VERSION}-SHA256SUMS.txt"

install_directory="${temporary_directory}/installed"
TOSD_RELEASE_BASE_URL="file://${temporary_directory}/releases/download" \
TOSD_INSTALL_DIR="$install_directory" \
TOSD_UNAME_S="Linux" \
TOSD_UNAME_M="x86_64" \
    "$INSTALLER" --version "$VERSION"
[[ "$("${install_directory}/tosd")" == "tosd fixture" ]]

arm_install_directory="${temporary_directory}/installed-arm"
TOSD_RELEASE_BASE_URL="file://${temporary_directory}/releases/download" \
TOSD_INSTALL_DIR="$arm_install_directory" \
TOSD_UNAME_S="Linux" \
TOSD_UNAME_M="aarch64" \
    "$INSTALLER"
[[ "$("${arm_install_directory}/tosd")" == "tosd fixture" ]]

mac_install_directory="${temporary_directory}/installed-mac"
TOSD_RELEASE_BASE_URL="file://${temporary_directory}/releases/download" \
TOSD_INSTALL_DIR="$mac_install_directory" \
TOSD_UNAME_S="Darwin" \
TOSD_UNAME_M="arm64" \
    "$INSTALLER"
[[ "$("${mac_install_directory}/tosd")" == "tosd fixture" ]]

if TOSD_RELEASE_BASE_URL="file://${temporary_directory}/releases/download" \
    TOSD_INSTALL_DIR="${temporary_directory}/unsupported" \
    TOSD_UNAME_S="Darwin" \
    TOSD_UNAME_M="x86_64" \
    "$INSTALLER" >/dev/null 2>&1; then
    echo "expected macOS x86_64 installation to fail" >&2
    exit 1
fi

printf 'corrupt\n' >> "${release_directory}/tosd-${VERSION}-linux-x86_64.tar.gz"
if TOSD_RELEASE_BASE_URL="file://${temporary_directory}/releases/download" \
    TOSD_INSTALL_DIR="${temporary_directory}/corrupt" \
    TOSD_UNAME_S="Linux" \
    TOSD_UNAME_M="x86_64" \
    "$INSTALLER" >/dev/null 2>&1; then
    echo "expected checksum verification to fail" >&2
    exit 1
fi

echo "Installer tests passed"
