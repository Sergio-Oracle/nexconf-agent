#!/bin/bash
set -e

echo "🚀 Installation NexConf Agent..."

apt update
apt install -y git nodejs npm build-essential python3 make g++

echo ""
echo "📦 Installation des dépendances Node..."

cd "$(dirname "$0")"
npm install

echo ""
echo "✅ Installation terminée"
echo ""
echo "Pour lancer l'agent :"
echo "node remote-agent.js --server wss://nexconf.ddns.net --session VOTRE_SESSION"
