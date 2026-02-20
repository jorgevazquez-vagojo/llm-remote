#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  LLM Remote — Instalador Corporativo
#  Redegal · Digital Consulting Group
#
#  Uso:
#    curl -sL <URL>/installer.sh | bash
#    o
#    bash installer.sh
#
#  Qué hace:
#    1. Verifica requisitos (Node.js 20+, claude CLI)
#    2. Descarga/actualiza LLM Remote
#    3. Instala dependencias
#    4. Ejecuta configurador interactivo
#    5. (Opcional) Crea servicio auto-arranque
#
#  Seguridad:
#    - Cada usuario tiene su propio cifrado AES-256-GCM
#    - PIN individual por sesión
#    - Nada se comparte entre instalaciones
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuración ──────────────────────────────────────────────────
INSTALL_DIR="${LLM_REMOTE_DIR:-$HOME/llm-remote}"
REPO_URL="${LLM_REMOTE_REPO:-https://github.com/jorgevazquez-vagojo/llm-remote.git}"
BRANCH="main"
MIN_NODE_VERSION=20
SERVICE_NAME="com.redegal.llm-remote"

# ── Colores ────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  BOLD='\033[1m'
  DIM='\033[2m'
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[1;33m'
  CYAN='\033[0;36m'
  MAGENTA='\033[0;35m'
  NC='\033[0m'
else
  BOLD='' DIM='' GREEN='' RED='' YELLOW='' CYAN='' MAGENTA='' NC=''
fi

# ── Helpers ────────────────────────────────────────────────────────
ok()    { echo -e "  ${GREEN}✔${NC} $1"; }
fail()  { echo -e "  ${RED}✖${NC} $1"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $1"; }
info()  { echo -e "  ${CYAN}→${NC} $1"; }
step()  { echo -e "\n${BOLD}${MAGENTA}[$1/$TOTAL_STEPS]${NC} ${BOLD}$2${NC}"; }

ask_yn() {
  local prompt="$1"
  local default="${2:-s}"
  local yn
  if [[ "$default" == "s" ]]; then
    read -rp "  $prompt [S/n]: " yn
    [[ -z "$yn" || "$yn" =~ ^[sS]$ ]]
  else
    read -rp "  $prompt [s/N]: " yn
    [[ "$yn" =~ ^[sS]$ ]]
  fi
}

# ── Banner ─────────────────────────────────────────────────────────
print_banner() {
  echo -e "${CYAN}"
  cat << 'BANNER'

   ╔═══════════════════════════════════════════════════════╗
   ║                                                       ║
   ║  ██╗     ██╗     ███╗   ███╗                          ║
   ║  ██║     ██║     ████╗ ████║                          ║
   ║  ██║     ██║     ██╔████╔██║                          ║
   ║  ██║     ██║     ██║╚██╔╝██║                          ║
   ║  ███████╗███████╗██║ ╚═╝ ██║                          ║
   ║  ╚══════╝╚══════╝╚═╝     ╚═╝                          ║
   ║      ██████╗ ███████╗███╗   ███╗ ██████╗ ████████╗    ║
   ║      ██╔══██╗██╔════╝████╗ ████║██╔═══██╗╚══██╔══╝   ║
   ║      ██████╔╝█████╗  ██╔████╔██║██║   ██║   ██║      ║
   ║      ██╔══██╗██╔══╝  ██║╚██╔╝██║██║   ██║   ██║      ║
   ║      ██║  ██║███████╗██║ ╚═╝ ██║╚██████╔╝   ██║      ║
   ║      ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝ ╚═════╝    ╚═╝     ║
   ║                                                       ║
   ║   Telegram ↔ IA · Cifrado Extremo a Extremo           ║
   ║   Redegal · Grupo de Consultoría Digital               ║
   ║                                                       ║
   ╚═══════════════════════════════════════════════════════╝

BANNER
  echo -e "${NC}"
}

# ── Detección de OS ────────────────────────────────────────────────
detect_os() {
  case "$(uname -s)" in
    Darwin*)  OS="macos" ;;
    Linux*)   OS="linux" ;;
    MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
    *)        OS="unknown" ;;
  esac

  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
  esac
}

# ── Verificar requisitos ──────────────────────────────────────────
check_requirements() {
  local errors=0

  # Node.js
  if command -v node &> /dev/null; then
    local node_version
    node_version=$(node -v | sed 's/v//' | cut -d. -f1)
    if [[ "$node_version" -ge "$MIN_NODE_VERSION" ]]; then
      ok "Node.js $(node -v)"
    else
      fail "Node.js $(node -v) — se requiere v${MIN_NODE_VERSION}+"
      info "Actualizar: https://nodejs.org"
      errors=$((errors + 1))
    fi
  else
    fail "Node.js no encontrado"
    echo ""
    if [[ "$OS" == "macos" ]]; then
      info "Instalar con Homebrew:  ${BOLD}brew install node${NC}"
      info "O descargar de:         ${BOLD}https://nodejs.org${NC}"
    elif [[ "$OS" == "linux" ]]; then
      info "Instalar:  ${BOLD}curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs${NC}"
    fi
    errors=$((errors + 1))
  fi

  # npm
  if command -v npm &> /dev/null; then
    ok "npm $(npm -v)"
  else
    fail "npm no encontrado (viene con Node.js)"
    errors=$((errors + 1))
  fi

  # git
  if command -v git &> /dev/null; then
    ok "git $(git --version | cut -d' ' -f3)"
  else
    fail "git no encontrado"
    if [[ "$OS" == "macos" ]]; then
      info "Instalar: ${BOLD}xcode-select --install${NC}"
    else
      info "Instalar: ${BOLD}sudo apt-get install git${NC}"
    fi
    errors=$((errors + 1))
  fi

  # Claude Code CLI (opcional pero recomendado)
  if command -v claude &> /dev/null; then
    ok "Claude Code CLI encontrado"
  else
    warn "Claude Code CLI no encontrado (opcional)"
    info "Sin él, solo funcionarán OpenAI, Gemini, Groq y Anthropic API"
    info "Instalar: ${BOLD}npm install -g @anthropic-ai/claude-code${NC}"
  fi

  return $errors
}

# ── Instalar/Actualizar proyecto ──────────────────────────────────
install_project() {
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Instalación existente detectada, actualizando..."
    cd "$INSTALL_DIR"
    git pull --rebase origin "$BRANCH" 2>/dev/null || {
      warn "No se pudo actualizar desde remoto. Continuando con versión local."
    }
  elif [[ -d "$INSTALL_DIR" ]]; then
    # Directorio existe pero sin git — usar archivos locales
    info "Directorio existente sin git. Usando archivos locales."
    cd "$INSTALL_DIR"
  else
    info "Descargando LLM Remote..."
    if git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR" 2>/dev/null; then
      ok "Descargado desde repositorio"
    else
      # Si no existe el repo remoto, crear desde local
      warn "Repositorio remoto no disponible. Creando instalación local..."
      mkdir -p "$INSTALL_DIR"
      # Si se ejecuta desde el directorio del proyecto, copiar archivos
      local script_dir
      script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
      if [[ -f "$script_dir/package.json" ]]; then
        cp -R "$script_dir"/{package.json,package-lock.json,src,.env.example,.gitignore,README.md,install.sh} "$INSTALL_DIR/" 2>/dev/null || true
        ok "Archivos copiados desde directorio local"
      else
        fail "No se encontró el proyecto. Descárgalo manualmente."
        exit 1
      fi
    fi
    cd "$INSTALL_DIR"
  fi
}

# ── Instalar dependencias ─────────────────────────────────────────
install_deps() {
  cd "$INSTALL_DIR"
  npm install --production --silent 2>&1 | tail -1
  ok "Dependencias instaladas ($(ls node_modules | wc -l | tr -d ' ') paquetes)"
}

# ── Crear servicio de auto-arranque ───────────────────────────────
setup_autostart() {
  if [[ "$OS" == "macos" ]]; then
    setup_launchd
  elif [[ "$OS" == "linux" ]]; then
    setup_systemd
  fi
}

setup_launchd() {
  local plist_path="$HOME/Library/LaunchAgents/${SERVICE_NAME}.plist"
  local node_path
  node_path="$(which node)"

  cat > "$plist_path" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node_path}</string>
    <string>${INSTALL_DIR}/src/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${INSTALL_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${INSTALL_DIR}/data/llm-remote.log</string>
  <key>StandardErrorPath</key>
  <string>${INSTALL_DIR}/data/llm-remote.error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
PLIST

  # Cargar el servicio
  launchctl unload "$plist_path" 2>/dev/null || true
  launchctl load "$plist_path"

  ok "Servicio macOS creado: ${SERVICE_NAME}"
  info "Arranca automáticamente al iniciar sesión"
  info "Controlar:"
  echo -e "    ${DIM}Parar:     launchctl unload $plist_path${NC}"
  echo -e "    ${DIM}Arrancar:  launchctl load $plist_path${NC}"
  echo -e "    ${DIM}Logs:      tail -f $INSTALL_DIR/data/llm-remote.log${NC}"
}

setup_systemd() {
  local service_path="$HOME/.config/systemd/user/llm-remote.service"
  local node_path
  node_path="$(which node)"

  mkdir -p "$HOME/.config/systemd/user"

  cat > "$service_path" << SERVICE
[Unit]
Description=LLM Remote — Telegram IA Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=${node_path} ${INSTALL_DIR}/src/index.js
Restart=on-failure
RestartSec=10
StandardOutput=append:${INSTALL_DIR}/data/llm-remote.log
StandardError=append:${INSTALL_DIR}/data/llm-remote.error.log
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
SERVICE

  systemctl --user daemon-reload
  systemctl --user enable llm-remote
  systemctl --user start llm-remote

  ok "Servicio systemd creado: llm-remote"
  info "Controlar:"
  echo -e "    ${DIM}Estado:    systemctl --user status llm-remote${NC}"
  echo -e "    ${DIM}Parar:     systemctl --user stop llm-remote${NC}"
  echo -e "    ${DIM}Logs:      journalctl --user -u llm-remote -f${NC}"
}

# ── Desinstalar ───────────────────────────────────────────────────
uninstall() {
  print_banner
  echo -e "${BOLD}Desinstalador de LLM Remote${NC}\n"

  if [[ ! -d "$INSTALL_DIR" ]]; then
    fail "LLM Remote no está instalado en $INSTALL_DIR"
    exit 1
  fi

  echo -e "  Se eliminará:"
  echo -e "    ${DIM}$INSTALL_DIR${NC}"

  if [[ "$OS" == "macos" ]]; then
    local plist="$HOME/Library/LaunchAgents/${SERVICE_NAME}.plist"
    if [[ -f "$plist" ]]; then
      echo -e "    ${DIM}$plist${NC}"
    fi
  elif [[ "$OS" == "linux" ]]; then
    local svc="$HOME/.config/systemd/user/llm-remote.service"
    if [[ -f "$svc" ]]; then
      echo -e "    ${DIM}$svc${NC}"
    fi
  fi

  echo ""
  if ! ask_yn "¿Confirmar desinstalación?" "n"; then
    info "Cancelado."
    exit 0
  fi

  # Parar servicio
  if [[ "$OS" == "macos" ]]; then
    local plist="$HOME/Library/LaunchAgents/${SERVICE_NAME}.plist"
    launchctl unload "$plist" 2>/dev/null || true
    rm -f "$plist"
    ok "Servicio macOS eliminado"
  elif [[ "$OS" == "linux" ]]; then
    systemctl --user stop llm-remote 2>/dev/null || true
    systemctl --user disable llm-remote 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/llm-remote.service"
    systemctl --user daemon-reload 2>/dev/null || true
    ok "Servicio systemd eliminado"
  fi

  rm -rf "$INSTALL_DIR"
  ok "LLM Remote desinstalado"
  echo ""
  info "Tu configuración (.env) ha sido eliminada."
  info "Los datos cifrados del audit log también."
}

# ── Mostrar resumen final ─────────────────────────────────────────
print_summary() {
  local has_service="$1"

  echo -e "\n${GREEN}"
  cat << 'DONE'
  ╔═══════════════════════════════════════════════════╗
  ║                                                   ║
  ║   ✔  Instalación completada                       ║
  ║                                                   ║
  ╚═══════════════════════════════════════════════════╝
DONE
  echo -e "${NC}"

  echo -e "  ${BOLD}Directorio:${NC}  $INSTALL_DIR"
  echo -e "  ${BOLD}Config:${NC}      $INSTALL_DIR/.env ${DIM}(chmod 600)${NC}"
  echo ""

  if [[ "$has_service" == "true" ]]; then
    echo -e "  ${BOLD}Estado:${NC} El bot ya está corriendo en segundo plano."
    echo ""
    echo -e "  ${BOLD}En Telegram:${NC}"
    echo -e "    1. Busca tu bot"
    echo -e "    2. Envía ${CYAN}/auth <tu-PIN>${NC}"
    echo -e "    3. Escribe cualquier mensaje"
    echo ""
    echo -e "  ${BOLD}Comandos útiles:${NC}"
    echo -e "    ${CYAN}/ia${NC}              Ver proveedores IA disponibles"
    echo -e "    ${CYAN}/ia gemini${NC}       Cambiar a Gemini (gratis)"
    echo -e "    ${CYAN}/ia groq${NC}         Cambiar a Groq/Llama (gratis)"
    echo -e "    ${CYAN}/project <ruta>${NC}  Cambiar directorio de trabajo"
    echo -e "    ${CYAN}/lock${NC}            Bloquear sesión"
  else
    echo -e "  ${BOLD}Para arrancar manualmente:${NC}"
    echo -e "    cd $INSTALL_DIR && npm start"
    echo ""
    echo -e "  ${BOLD}En Telegram:${NC}"
    echo -e "    1. Busca tu bot"
    echo -e "    2. Envía ${CYAN}/auth <tu-PIN>${NC}"
    echo -e "    3. Escribe cualquier mensaje"
  fi

  echo ""
  echo -e "  ${BOLD}Proveedores IA:${NC}"
  echo -e "    🟣 Claude Code    ${DIM}Agéntico (lee/escribe ficheros)${NC}"
  echo -e "    🟢 OpenAI GPT-4o  ${DIM}Chat por API${NC}"
  echo -e "    🔵 Gemini Flash   ${DIM}Chat por API (gratis)${NC}"
  echo -e "    🟠 Groq Llama     ${DIM}Chat por API (gratis, ultra-rápido)${NC}"
  echo -e "    🟣 Anthropic      ${DIM}Chat por API${NC}"
  echo ""
  echo -e "  ${BOLD}Seguridad:${NC}"
  echo -e "    ${DIM}• Cifrado AES-256-GCM + HMAC para datos en reposo${NC}"
  echo -e "    ${DIM}• PIN + lista blanca + anti-fuerza bruta + bloqueo automático${NC}"
  echo -e "    ${DIM}• Cada instalación tiene su propio cifrado${NC}"
  echo ""
  echo -e "  ${DIM}Documentación: $INSTALL_DIR/README.md${NC}"
  echo -e "  ${DIM}Reconfigurar:  cd $INSTALL_DIR && npm run setup${NC}"
  echo ""
}

# ══════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════

main() {
  # Handle --uninstall flag
  if [[ "${1:-}" == "--uninstall" || "${1:-}" == "--desinstalar" ]]; then
    detect_os
    uninstall
    exit 0
  fi

  # Handle --help
  if [[ "${1:-}" == "--help" || "${1:-}" == "--ayuda" || "${1:-}" == "-h" ]]; then
    echo "LLM Remote — Instalador"
    echo ""
    echo "Uso:"
    echo "  bash installer.sh              Instalar/actualizar"
    echo "  bash installer.sh --uninstall  Desinstalar"
    echo "  bash installer.sh --status     Ver estado del servicio"
    echo "  bash installer.sh --help       Esta ayuda"
    echo ""
    echo "Variables de entorno:"
    echo "  LLM_REMOTE_DIR   Directorio de instalación (default: ~/llm-remote)"
    echo "  LLM_REMOTE_REPO  URL del repositorio git"
    exit 0
  fi

  # Handle --status
  if [[ "${1:-}" == "--status" || "${1:-}" == "--estado" ]]; then
    detect_os
    echo -e "${BOLD}Estado de LLM Remote${NC}\n"
    if [[ "$OS" == "macos" ]]; then
      launchctl list | grep -q "$SERVICE_NAME" && ok "Servicio activo" || fail "Servicio no activo"
    elif [[ "$OS" == "linux" ]]; then
      systemctl --user is-active llm-remote &>/dev/null && ok "Servicio activo" || fail "Servicio no activo"
    fi
    if [[ -f "$INSTALL_DIR/.env" ]]; then
      ok "Configuración encontrada"
    else
      fail "Sin configuración"
    fi
    exit 0
  fi

  TOTAL_STEPS=5

  print_banner
  detect_os

  echo -e "  ${DIM}Sistema: $OS ($ARCH)${NC}"
  echo -e "  ${DIM}Destino: $INSTALL_DIR${NC}"
  echo ""

  # Step 1: Requirements
  step 1 "Verificando requisitos"
  echo ""
  if ! check_requirements; then
    echo ""
    fail "Instala los requisitos marcados con ✖ y vuelve a ejecutar el instalador."
    exit 1
  fi

  # Step 2: Download/Update
  step 2 "Instalando LLM Remote"
  echo ""
  install_project
  ok "Proyecto listo en $INSTALL_DIR"

  # Step 3: Dependencies
  step 3 "Instalando dependencias"
  echo ""
  install_deps

  # Step 4: Configuration
  step 4 "Configuración"
  echo ""
  if [[ -f "$INSTALL_DIR/.env" ]]; then
    info "Configuración existente encontrada."
    if ask_yn "¿Reconfigurar?" "n"; then
      node "$INSTALL_DIR/src/setup.js"
    else
      ok "Configuración existente conservada"
    fi
  else
    info "Primera instalación — lanzando configurador..."
    echo ""
    node "$INSTALL_DIR/src/setup.js"
  fi

  # Verify .env exists after setup
  if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    fail "No se generó .env. Ejecuta 'npm run setup' manualmente."
    exit 1
  fi

  # Step 5: Autostart service
  step 5 "Servicio de auto-arranque"
  echo ""
  local has_service="false"
  if ask_yn "¿Crear servicio para que arranque automáticamente?" "s"; then
    mkdir -p "$INSTALL_DIR/data"
    setup_autostart
    has_service="true"
  else
    info "Servicio no creado. Arranca manualmente con: npm start"
  fi

  # Done!
  print_summary "$has_service"
}

main "$@"
