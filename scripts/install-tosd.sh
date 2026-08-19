#!/usr/bin/env bash

set -euo pipefail

readonly DEFAULT_VERSION="1.0.0-rc.2"
readonly REPOSITORY="${TOSD_GITHUB_REPOSITORY:-brunoborges/toml-schema}"
readonly RELEASE_BASE_URL="${TOSD_RELEASE_BASE_URL:-https://github.com/${REPOSITORY}/releases/download}"

usage() {
    cat <<'EOF'
Usage: install-tosd.sh [--version <version>]

Environment:
  TOSD_INSTALL_DIR       Installation directory (default: $HOME/.local/bin)
  TOSD_VERSION           Version to install when --version is omitted
EOF
}

version="${TOSD_VERSION:-$DEFAULT_VERSION}"
while (($# > 0)); do
    case "$1" in
        --version)
            if (($# < 2)); then
                echo "error: --version requires a value" >&2
                exit 2
            fi
            version="$2"
            shift 2
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "error: unknown argument: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
    echo "error: invalid tosd version: $version" >&2
    exit 2
fi

os="${TOSD_UNAME_S:-$(uname -s)}"
arch="${TOSD_UNAME_M:-$(uname -m)}"
case "$os" in
    Linux)
        platform="linux"
        ;;
    Darwin)
        platform="macos"
        ;;
    *)
        echo "error: unsupported operating system: $os" >&2
        exit 1
        ;;
esac

case "$arch" in
    x86_64|amd64)
        architecture="x86_64"
        ;;
    arm64|aarch64)
        architecture="arm64"
        ;;
    *)
        echo "error: unsupported architecture: $arch" >&2
        exit 1
        ;;
esac

if [[ "$platform" == "macos" && "$architecture" != "arm64" ]]; then
    echo "error: tosd releases support macOS on arm64 only" >&2
    exit 1
fi

asset="tosd-${version}-${platform}-${architecture}.tar.gz"
checksums="tosd-${version}-SHA256SUMS.txt"
release_url="${RELEASE_BASE_URL}/rust-v${version}"
install_dir="${TOSD_INSTALL_DIR:-${HOME}/.local/bin}"
archive_root="${asset%.tar.gz}"

temporary_directory="$(mktemp -d)"
temporary_target=""
cleanup() {
    rm -rf "$temporary_directory"
    if [[ -n "$temporary_target" ]]; then
        rm -f "$temporary_target"
    fi
}
trap cleanup EXIT

curl --fail --location --silent --show-error \
    --output "${temporary_directory}/${asset}" \
    "${release_url}/${asset}"
curl --fail --location --silent --show-error \
    --output "${temporary_directory}/${checksums}" \
    "${release_url}/${checksums}"

checksum_entry="$(
    awk -v asset="$asset" '
        $2 == asset {
            if (found) exit 2
            print
            found = 1
        }
        END {
            if (!found) exit 1
        }
    ' "${temporary_directory}/${checksums}"
)" || {
    echo "error: checksum manifest does not contain exactly one entry for ${asset}" >&2
    exit 1
}
printf '%s\n' "$checksum_entry" > "${temporary_directory}/selected-SHA256SUMS.txt"

if command -v sha256sum >/dev/null 2>&1; then
    (
        cd "$temporary_directory"
        sha256sum -c selected-SHA256SUMS.txt >/dev/null
    ) || {
        echo "error: checksum verification failed for ${asset}" >&2
        exit 1
    }
elif command -v shasum >/dev/null 2>&1; then
    (
        cd "$temporary_directory"
        shasum -a 256 -c selected-SHA256SUMS.txt >/dev/null
    ) || {
        echo "error: checksum verification failed for ${asset}" >&2
        exit 1
    }
else
    echo "error: sha256sum or shasum is required" >&2
    exit 1
fi

archive_listing="$(tar -tzf "${temporary_directory}/${asset}")"
if [[ "$archive_listing" != "${archive_root}/tosd" ]]; then
    echo "error: ${asset} must contain only ${archive_root}/tosd" >&2
    exit 1
fi

tar -xzf "${temporary_directory}/${asset}" \
    -C "$temporary_directory" \
    "${archive_root}/tosd"
if [[ ! -f "${temporary_directory}/${archive_root}/tosd" ||
    -L "${temporary_directory}/${archive_root}/tosd" ]]; then
    echo "error: ${asset} does not contain a regular tosd executable" >&2
    exit 1
fi

mkdir -p "$install_dir"
temporary_target="$(mktemp "${install_dir}/.tosd.XXXXXX")"
install -m 0755 "${temporary_directory}/${archive_root}/tosd" "$temporary_target"
mv -f "$temporary_target" "${install_dir}/tosd"
temporary_target=""

echo "Installed tosd ${version} to ${install_dir}/tosd"
case ":${PATH}:" in
    *":${install_dir}:"*) ;;
    *) echo "Add ${install_dir} to PATH to run tosd." ;;
esac
