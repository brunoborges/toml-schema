#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
go_output="$script_dir/go/target/toml-schema"

run_step() {
    local label="$1"
    shift

    printf '\n==> %s\n' "$label"
    "$@"
}

run_step "Building Java reference implementation" \
    mvn -B -f "$script_dir/java/pom.xml" package

mkdir -p "$(dirname "$go_output")"
run_step "Building Go reference implementation" \
    go -C "$script_dir/go" build -o "$go_output" .

run_step "Building Rust reference implementation" \
    cargo build --locked --release --manifest-path "$script_dir/rust/Cargo.toml"

printf '\nAll reference implementations built successfully.\n'
