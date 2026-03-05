#!/usr/bin/env bash
# ─── install.sh ──────────────────────────────────────────────────────────────
# NexConf Agent — Installation complète
# Usage : bash install.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║        NexConf Agent — Installation v4           ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── 1. Dépendances système ────────────────────────────────────────────────────
echo "📦 Installation des dépendances système…"
sudo apt-get update -qq
sudo apt-get install -y \
  git curl build-essential python3 make g++ \
  ffmpeg \
  scrot gnome-screenshot \
  xdotool
echo "✅ Dépendances système OK"

# ── 2. Node.js via nvm ────────────────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node -e 'process.exit(parseInt(process.version.slice(1)) < 20 ? 1 : 0)' ; echo $?)" == "1" ]]; then
  echo "📦 Installation de Node.js 20 via nvm…"
  export NVM_DIR="$HOME/.nvm"
  if [ ! -d "$NVM_DIR" ]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  fi
  source "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
  nvm alias default 20
  echo "✅ Node.js $(node -v) installé"
else
  echo "✅ Node.js $(node -v) déjà installé"
fi

# ── 3. lk-cli (LiveKit CLI) ───────────────────────────────────────────────────
if ! command -v lk &>/dev/null; then
  echo "📦 Installation de lk-cli (LiveKit)…"
  LK_ARCH="amd64"
  # Détection architecture
  case "$(uname -m)" in
    aarch64|arm64) LK_ARCH="arm64" ;;
    armv7l)        LK_ARCH="arm"   ;;
  esac
  # Récupérer la dernière version dynamiquement
  LK_VERSION=$(curl -s https://api.github.com/repos/livekit/livekit-cli/releases/latest \
    | grep -o '"tag_name": "v[^"]*"' | grep -o 'v[^"]*' | sed 's/^v//')
  if [ -z "$LK_VERSION" ]; then
    LK_VERSION="2.14.0"  # fallback si l'API est indisponible
  fi
  # Format correct : lk_VERSION_linux_ARCH.tar.gz
  LK_URL="https://github.com/livekit/livekit-cli/releases/download/v${LK_VERSION}/lk_${LK_VERSION}_linux_${LK_ARCH}.tar.gz"
  echo "   Version: v${LK_VERSION}"
  echo "   Téléchargement: $LK_URL"
  curl -L "$LK_URL" -o /tmp/lk.tar.gz
  tar -xzf /tmp/lk.tar.gz -C /tmp/
  sudo mv /tmp/lk /usr/local/bin/lk
  sudo chmod +x /usr/local/bin/lk
  rm -f /tmp/lk.tar.gz
  echo "✅ lk-cli $(lk --version 2>/dev/null || echo 'installé') OK"
else
  echo "✅ lk-cli déjà installé : $(lk --version 2>/dev/null || echo 'OK')"
fi

# ── 4. Dépendances Node.js du projet ─────────────────────────────────────────
echo "📦 Installation des modules Node.js…"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
npm install
echo "✅ Modules Node.js OK"

# ── 5. Fichier .env si absent ─────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "📝 Création du fichier .env…"
  cat > .env << 'ENV'
# Serveur NexConf relais
REMOTE_SERVER_URL=wss://nexconf.ddns.net

# LiveKit
LIVEKIT_URL=wss://livekit.ec2lt.sn
ENV
  echo "✅ .env créé"
fi

# ── 6. Vérifications ──────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║              Vérifications finales               ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo -n "   Node.js    : "; node -v 2>/dev/null || echo "❌ absent"
echo -n "   npm        : "; npm -v  2>/dev/null || echo "❌ absent"
echo -n "   ffmpeg     : "; ffmpeg -version 2>&1 | head -1 || echo "❌ absent"
echo -n "   lk-cli     : "; lk --version 2>/dev/null || echo "❌ absent"
echo -n "   scrot       : "; which scrot       &>/dev/null && echo "✅" || echo "⚠️ absent (fallback)"
echo -n "   gnome-shot  : "; which gnome-screenshot &>/dev/null && echo "✅" || echo "⚠️ absent (fallback)"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║              Installation terminée !             ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Lancer l'agent (en tant que sergio) :           ║"
echo "║                                                  ║"
echo "║  export XDG_RUNTIME_DIR=/run/user/1001           ║"
echo "║  export WAYLAND_DISPLAY=wayland-0                ║"
echo "║  export DBUS_SESSION_BUS_ADDRESS=                ║"
echo "║    unix:path=/run/user/1001/bus                  ║"
echo "║                                                  ║"
echo "║  node remote-agent.js \\                          ║"
echo "║    --server wss://nexconf.ddns.net \\             ║"
echo "║    --session VOTRE_CODE                          ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
