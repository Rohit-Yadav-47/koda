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

printf "\n  ${PURPLE}${BOLD}koda${RESET}  AI coding agent for the terminal\n\n"

# --- Check prerequisites ---
command -v git >/dev/null 2>&1 || { printf "  ${RED}git is required. Install it first.${RESET}\n\n"; exit 1; }
command -v node >/dev/null 2>&1 || { printf "  ${RED}node is required (v20+). Install it first.${RESET}\n\n"; exit 1; }

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  printf "  ${RED}Node v20+ required. You have $(node -v).${RESET}\n\n"
  exit 1
fi

command -v npm >/dev/null 2>&1 || { printf "  ${RED}npm is required.${RESET}\n\n"; exit 1; }

# --- Update or clone ---
if [ -d "$INSTALL_DIR/.git" ]; then
  printf "  ${DIM}Updating koda...${RESET}\n"
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || {
    printf "  ${RED}Git pull failed. Remove $INSTALL_DIR and retry.${RESET}\n\n"
    exit 1
  }
else
  if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
  fi
  printf "  ${DIM}Cloning koda...${RESET}\n"
  git clone "$REPO_URL" "$INSTALL_DIR" --quiet
  cd "$INSTALL_DIR"
fi

# --- Install & build ---
printf "  ${DIM}Installing dependencies...${RESET}\n"
npm install --production=false --silent 2>/dev/null || npm install --production=false

printf "  ${DIM}Building...${RESET}\n"
npm run build

# --- Create symlink ---
printf "  ${DIM}Linking binary...${RESET}\n"
if [ -w "$BIN_DIR" ]; then
  ln -sf "$INSTALL_DIR/dist/index.js" "$BIN_DIR/koda"
else
  sudo ln -sf "$INSTALL_DIR/dist/index.js" "$BIN_DIR/koda" 2>/dev/null || {
    mkdir -p "$HOME/.local/bin" 2>/dev/null
    ln -sf "$INSTALL_DIR/dist/index.js" "$HOME/.local/bin/koda"
    BIN_DIR="$HOME/.local/bin"
    printf "\n  ${DIM}Note: Added to ~/.local/bin — make sure it's in your PATH:${RESET}\n"
    printf "    export PATH=\"\$HOME/.local/bin:\$PATH\"\n"
  }
fi

chmod +x "$INSTALL_DIR/dist/index.js"

# --- Done ---
printf "\n  ${GREEN}✓${RESET} Installed to ${DIM}$INSTALL_DIR${RESET}\n"
printf "  ${GREEN}✓${RESET} Binary linked at ${DIM}$(command -v koda 2>/dev/null || echo "$BIN_DIR/koda")${RESET}\n"
printf "  ${GREEN}✓${RESET} Data stored in ${DIM}$DATA_DIR${RESET}\n"
printf "\n  ${BOLD}Usage:${RESET}\n"
printf "    ${PURPLE}koda${RESET}              ${DIM}start chatting${RESET}\n"
printf "    ${PURPLE}koda${RESET} \"fix the bug\"  ${DIM}run with a prompt${RESET}\n"
printf "\n  ${BOLD}Setup:${RESET}\n"
printf "    type ${PURPLE}/config set api_key${RESET} YOUR_KEY on first run\n"
printf "\n  ${BOLD}Update:${RESET}\n"
printf "    ${DIM}curl -fsSL <install-url> | bash${RESET}\n\n"
