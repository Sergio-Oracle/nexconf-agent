#!/bin/bash
set -e

echo "🚀 Installation NexConf Agent..."

# ── Dépendances système de base ───────────────────────────────────
apt update
apt install -y git curl build-essential python3 make g++

# ── Vérification version Node.js (besoin de >= 18) ───────────────
NODE_OK=false
if command -v node &>/dev/null; then
  MAJOR=$(node -e "console.log(parseInt(process.versions.node.split('.')[0]))" 2>/dev/null)
  if [ "$MAJOR" -ge 18 ] 2>/dev/null; then
    echo "✅ Node.js $MAJOR détecté — OK"
    NODE_OK=true
  else
    echo "⚠️  Node.js $MAJOR détecté — trop ancien (besoin >= 18)"
  fi
else
  echo "⚠️  Node.js non trouvé"
fi

# ── Installation Node.js 20 LTS via NodeSource si nécessaire ─────
if [ "$NODE_OK" = false ]; then
  echo "📦 Installation de Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
  echo "✅ Node.js $(node -v) installé"
fi

echo "📦 Node.js : $(node -v) | npm : $(npm -v)"

# ── Installation des dépendances dans le dossier du script ───────
cd "$(dirname "$0")"
echo "📦 Installation des dépendances npm dans $(pwd)..."
npm install

echo ""
echo "✅ Installation terminée !"
echo ""
echo "▶ Pour lancer l'agent :"
echo "  node remote-agent.js --server wss://nexconf.ddns.net --session VOTRE_SESSION"
