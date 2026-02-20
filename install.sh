#!/bin/bash
# Claude Remote — Instalador automático
# Uso: curl -sL <url> | bash  o  bash install.sh

set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

print_banner() {
  echo -e "${CYAN}"
  echo "  ╔══════════════════════════════════════════╗"
  echo "  ║                                          ║"
  echo "  ║   Claude Remote — Instalador             ║"
  echo "  ║   Puente cifrado Telegram ↔ Claude Code  ║"
  echo "  ║                                          ║"
  echo "  ╚══════════════════════════════════════════╝"
  echo -e "${NC}"
}

ok()   { echo -e "  ${GREEN}✔${NC} $1"; }
fail() { echo -e "  ${RED}✖${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
info() { echo -e "  ${CYAN}→${NC} $1"; }

check_requirement() {
  local cmd=$1
  local name=$2
  local install_hint=$3

  if command -v "$cmd" &> /dev/null; then
    local version=$($cmd --version 2>&1 | head -1)
    ok "$name encontrado: $version"
    return 0
  else
    fail "$name no encontrado"
    if [ -n "$install_hint" ]; then
      info "Instalar: $install_hint"
    fi
    return 1
  fi
}

print_banner

echo -e "${BOLD}Verificando requisitos...${NC}\n"

errors=0

# Node.js
if ! check_requirement "node" "Node.js" "https://nodejs.org o brew install node"; then
  errors=$((errors + 1))
else
  # Check version >= 20
  node_version=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$node_version" -lt 20 ]; then
    fail "Node.js 20+ requerido (tienes v${node_version})"
    errors=$((errors + 1))
  fi
fi

# npm
check_requirement "npm" "npm" "viene con Node.js" || errors=$((errors + 1))

# Claude Code
if ! check_requirement "claude" "Claude Code CLI" "npm install -g @anthropic-ai/claude-code"; then
  errors=$((errors + 1))
fi

echo ""

if [ $errors -gt 0 ]; then
  fail "Faltan $errors requisito(s). Instálalos antes de continuar."
  exit 1
fi

ok "Todos los requisitos cumplidos"
echo ""

# Install dependencies
echo -e "${BOLD}Instalando dependencias...${NC}\n"
npm install --production 2>&1 | tail -1
ok "Dependencias instaladas"
echo ""

# Run setup wizard
echo -e "${BOLD}Lanzando configurador...${NC}\n"
node src/setup.js

echo ""
echo -e "${GREEN}${BOLD}Instalación completada.${NC}"
echo ""
echo -e "  Para arrancar:  ${CYAN}npm start${NC}"
echo -e "  Para desarrollo: ${CYAN}npm run dev${NC}"
echo -e "  Para tests:      ${CYAN}npm test${NC}"
echo ""
