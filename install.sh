#!/bin/bash

echo "🚀 Installation NexConf Agent..."

apt update
apt install -y git nodejs npm build-essential python3 make g++

if [ ! -d "nexconf-agent" ]; then
  git clone https://github.com/Sergio-Oracle/nexconf-agent.git
fi

cd nexconf-agent

npm install

echo ""
echo "✅ Installation terminée"
echo ""
echo "Pour lancer l'agent :"
echo "node remote-agent.js --server wss://nexconf.ddns.net --session VOTRE_SESSION"
