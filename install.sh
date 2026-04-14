#!/usr/bin/env bash
set -euo pipefail

BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[32m'
PURPLE='\033[35m'
RED='\033[31m'
RESET='\033[0m'

REPO_URL="https://github.com/Rohit-Yadav-47/koda.git"
INSTALL_DIR="$HOME/.koda-app"
BIN_DIR="/usr/local/bin"
DATA_DIR="$HOME/.koda"
GH_RELEASES="https://github.com/Rohit-Yadav-47/koda/releases/download"

fetch_latest_tag() {
  curl -sL "https://api.github.com/repos/Rohit-Yadav-47/koda/releases/latest" 2>/dev/null | grep -o '"tag_name": "[^"]*"' | grep -o 'v[0-9]\.[0-9]\.[0-9]*' | head -1
}

get_latest_tag() {
  if [ -n "${KODA_VERSION:-}" ]; then
    echo "$KODA_VERSION"
  else
    fetch_latest_tag
  fi
}

TAG="$(get_latest_tag)"
GH_DOWNLOAD="$GH_RELEASES/$TAG"

printf "\n  ${PURPLE}${BOLD}koda${RESET}  AI coding agent for the terminal\n\n"

OS_TYPE="$(uname -s)"
ARCH_TYPE="$(uname -m)"
case "$OS_TYPE" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  *)      printf "  ${RED}Unsupported OS: $OS_TYPE${RESET}\n\n"; exit 1 ;;
esac
case "$ARCH_TYPE" in
  arm64)   ARCH="arm64" ;;
  x86_64) ARCH="x86_64" ;;
  *)       printf "  ${RED}Unsupported arch: $ARCH_TYPE${RESET}\n\n"; exit 1 ;;
esac

BUNDLE_NAME="koda-release-${OS}-${ARCH}"
BUNDLE_PATH="$INSTALL_DIR/$BUNDLE_NAME"

install_prebuilt() {
  printf "  ${DIM}Downloading native binary (${OS}-${ARCH})...${RESET}\n"
  printf "  ${DIM}URL: ${GH_DOWNLOAD}/${BUNDLE_NAME}${RESET}\n"
  mkdir -p "$INSTALL_DIR"
  if curl -fsSL "$GH_DOWNLOAD/$BUNDLE_NAME" -o "$BUNDLE_PATH" 2>&1; then
    chmod +x "$BUNDLE_PATH"
    return 0
  fi
  printf "  ${DIM}Download failed, falling back to source build${RESET}\n"
  return 1
}

build_from_source() {
  command -v bun >/dev/null 2>&1 || {
    printf "  ${RED}bun required for build. Install: https://bun.sh${RESET}\n\n"
    exit 1
  }
  printf "  ${DIM}Building native binary from source...${RESET}\n"
  if [ -d "$INSTALL_DIR/.git" ]; then
    cd "$INSTALL_DIR" && git pull --ff-only 2>/dev/null || { rm -rf "$INSTALL_DIR"; git clone "$REPO_URL" "$INSTALL_DIR" --quiet; }
  else
    rm -rf "$INSTALL_DIR" 2>/dev/null; git clone "$REPO_URL" "$INSTALL_DIR" --quiet
  fi
  cd "$INSTALL_DIR"
  bun install 2>/dev/null || bun install
  bun build --compile --target=bun --outfile="$BUNDLE_PATH" src/index.ts
  chmod +x "$BUNDLE_PATH"
}

link_binary() {
  printf "  ${DIM}Linking binary...${RESET}\n"
  if [ -w "$BIN_DIR" ]; then
    ln -sf "$BUNDLE_PATH" "$BIN_DIR/koda"
  else
    sudo ln -sf "$BUNDLE_PATH" "$BIN_DIR/koda" 2>/dev/null || {
      mkdir -p "$HOME/.local/bin"
      ln -sf "$BUNDLE_PATH" "$HOME/.local/bin/koda"
      BIN_DIR="$HOME/.local/bin"
      printf "\n  ${DIM}Added to ~/.local/bin — ensure it's in your PATH${RESET}\n"
    }
  fi
}

if [ -f "$BUNDLE_PATH" ]; then
  printf "  ${DIM}Using existing binary${RESET}\n"
elif install_prebuilt; then
  printf "  ${GREEN}✓${RESET} Downloaded native binary\n"
else
  printf "  ${DIM}No pre-built binary for ${OS}-${ARCH}${RESET}\n"
  build_from_source
fi

link_binary

printf "\n  ${GREEN}✓${RESET} Installed to ${DIM}$INSTALL_DIR${RESET}\n"
printf "  ${GREEN}✓${RESET} Binary at ${DIM}$(command -v koda 2>/dev/null || echo "$BIN_DIR/koda")${RESET}\n"
printf "  ${GREEN}✓${RESET} Data in ${DIM}$DATA_DIR${RESET}\n"
printf "\n  ${BOLD}Usage:${RESET}\n"
printf "    ${PURPLE}koda${RESET}              ${DIM}start chatting${RESET}\n"
printf "    ${PURPLE}koda${RESET} \"fix bug\"    ${DIM}run with prompt${RESET}\n"
printf "\n  ${BOLD}First run:${RESET} type ${PURPLE}/config set api_key YOUR_KEY${RESET}\n\n"
