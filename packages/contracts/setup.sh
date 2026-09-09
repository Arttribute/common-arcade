#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Pinned dependencies; install without changing the parent repository's submodules.
mkdir -p lib
[ -d lib/forge-std ] || git clone --depth 1 --branch v1.9.7 https://github.com/foundry-rs/forge-std lib/forge-std
[ -d lib/openzeppelin-contracts ] || git clone --depth 1 --branch v5.0.2 https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
[ -d lib/safe-contracts ] || git clone --depth 1 --branch v1.4.1 https://github.com/safe-global/safe-smart-account lib/safe-contracts
forge build
