// ─── backend/remote-agent.js ─────────────────────────────────────────────────
// Agent Bureau à Distance — NexConf
//
// Cet agent tourne sur la MACHINE À CONTRÔLER.
// Il capture l'écran, le streame vers le serveur relais,
// et exécute les commandes souris/clavier reçues via RobotJS.
//
// ── Instructions pour l'utilisateur ──────────────────────────────────────────
// 1. Installer Node.js et npm si ce n'est pas déjà fait.
// 2. Installer les dépendances : `npm install`
// 3. Démarrer l'agent avec :
//      node backend/remote-agent.js --server ws://VOTRE_SERVEUR:3000 --session VOTRE_CODE
//    - --server : URL du serveur WebSocket relais (ex: ws://192.168.0.10:3000)
//    - --session : code unique de session pour identifier votre machine
// 4. L'agent envoie l'écran au serveur et applique les commandes souris/clavier
//    que le visualiseur envoie depuis le front-end.
//
// Options facultatives :
//      --fps     : frames par seconde du stream (défaut 12)
//      --quality : qualité JPEG (1-100, défaut 60)
//      --scale   : échelle de l'image capturée (0.1 à 1, défaut 0.8)
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import WebSocket from 'ws';
import screenshot from 'screenshot-desktop';
import sharp from 'sharp';
import robot from 'robotjs';

// ── Arguments CLI ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
};

const SERVER_URL  = getArg('--server')  || process.env.REMOTE_SERVER_URL || 'ws://localhost:3000';
const SESSION_ID  = getArg('--session') || process.env.REMOTE_SESSION_ID || 'default';
const FPS         = parseInt(getArg('--fps') || '12');
const QUALITY     = parseInt(getArg('--quality') || '60');  // qualité JPEG
const SCALE       = parseFloat(getArg('--scale') || '0.8'); // échelle écran
const INTERVAL_MS = Math.round(1000 / FPS);

// ── Affichage informations utilisateur ─────────────────────────────────────────
console.log(`\n🖥️  Agent Bureau à Distance — NexConf`);
console.log(`   Serveur  : ${SERVER_URL}`);
console.log(`   Session  : ${SESSION_ID}`);
console.log(`   FPS      : ${FPS} | Qualité : ${QUALITY}% | Scale : ${SCALE}`);
console.log(`\n   Connexion en cours…\n`);

// ── Configuration RobotJS ─────────────────────────────────────────────────────
robot.setMouseDelay(0);
robot.setKeyboardDelay(0);

// ── Taille écran adaptée à l'échelle ──────────────────────────────────────────
const screen = robot.getScreenSize();
const SCREEN_W = Math.round(screen.width  * SCALE);
const SCREEN_H = Math.round(screen.height * SCALE);

// ── Touches spéciales supportées ──────────────────────────────────────────────
const SPECIAL_KEYS = {
  'Enter': 'enter', 'Backspace': 'backspace', 'Delete': 'delete',
  'Tab': 'tab', 'Escape': 'escape', 'ArrowUp': 'up', 'ArrowDown': 'down',
  'ArrowLeft': 'left', 'ArrowRight': 'right', 'Home': 'home', 'End': 'end',
  'PageUp': 'pageup', 'PageDown': 'pagedown', 'F1': 'f1', 'F2': 'f2', 'F3': 'f3',
  'F4': 'f4', 'F5': 'f5', 'F6': 'f6', 'F7': 'f7', 'F8': 'f8', 'F9': 'f9', 'F10': 'f10',
  'F11': 'f11', 'F12': 'f12', ' ': 'space', 'Control': 'control', 'Alt': 'alt',
  'Shift': 'shift', 'Meta': 'command',
};

// ── Variables WebSocket et streaming ─────────────────────────────────────────
let ws;
let streaming = false;
let streamInterval = null;
let reconnectTimeout = null;

// ── Connexion au serveur WebSocket ───────────────────────────────────────────
function connect() {
  const url = `${SERVER_URL}/ws/agent?session=${encodeURIComponent(SESSION_ID)}`;
  ws = new WebSocket(url, { rejectUnauthorized: false }); // permet certificats auto-signés

  ws.on('open', () => {
    console.log(`✅  Connecté au serveur relais`);
    console.log(`   En attente d'un visualiseur…\n`);
    send({ type: 'screen-info', width: SCREEN_W, height: SCREEN_H, scale: SCALE });
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleCommand(msg);
    } catch {}
  });

  ws.on('close', () => {
    console.log('⚠️   Connexion perdue. Reconnexion dans 3s…');
    stopStream();
    reconnectTimeout = setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    console.error('❌  Erreur WebSocket :', err.message);
  });
}

// ── Envoi de données au serveur ───────────────────────────────────────────────
function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ── Traitement des commandes reçues ───────────────────────────────────────────
function handleCommand(msg) {
  switch (msg.type) {
    case 'start-stream': startStream(); break;
    case 'stop-stream': stopStream(); break;
    case 'mouse-move': {
      robot.moveMouse(Math.round(msg.x * screen.width), Math.round(msg.y * screen.height));
      break;
    }
    case 'mouse-click': {
      const x = Math.round(msg.x * screen.width);
      const y = Math.round(msg.y * screen.height);
      const btn = msg.button === 2 ? 'right' : 'left';
      robot.moveMouse(x, y);
      robot.mouseClick(btn, msg.double || false);
      break;
    }
    case 'mouse-down': {
      const x = Math.round(msg.x * screen.width);
      const y = Math.round(msg.y * screen.height);
      robot.moveMouse(x, y);
      robot.mouseToggle('down', 'left');
      break;
    }
    case 'mouse-up': {
      const x = Math.round(msg.x * screen.width);
      const y = Math.round(msg.y * screen.height);
      robot.moveMouse(x, y);
      robot.mouseToggle('up', 'left');
      break;
    }
    case 'mouse-scroll':
      robot.scrollMouse(msg.dx || 0, msg.dy || 0);
      break;
    case 'key-press': {
      const key = SPECIAL_KEYS[msg.key] || msg.key.toLowerCase();
      const mods = [];
      if (msg.ctrl)  mods.push('control');
      if (msg.alt)   mods.push('alt');
      if (msg.shift) mods.push('shift');
      if (msg.meta)  mods.push('command');
      try { mods.length ? robot.keyTap(key, mods) : robot.keyTap(key); } catch {}
      break;
    }
    case 'type-text':
      if (msg.text) try { robot.typeString(msg.text); } catch {}
      break;
  }
}

// ── Capture écran et envoi au serveur ────────────────────────────────────────
async function captureFrame() {
  try {
    const buf = await screenshot({ format: 'png' });
    const jpeg = await sharp(buf)
      .resize(SCREEN_W, SCREEN_H, { fit: 'fill' })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toBuffer();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'frame', data: jpeg.toString('base64'), ts: Date.now() }));
    }
  } catch {}
}

// ── Gestion du streaming ─────────────────────────────────────────────────────
function startStream() {
  if (streaming) return;
  streaming = true;
  captureFrame(); // premier frame immédiat
  streamInterval = setInterval(captureFrame, INTERVAL_MS);
}
function stopStream() {
  streaming = false;
  if (streamInterval) { clearInterval(streamInterval); streamInterval = null; }
}

// ── Démarrage ───────────────────────────────────────────────────────────────
connect();

// ── Arrêt propre à Ctrl+C ────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n👋  Arrêt de l\'agent…');
  stopStream();
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (ws) ws.close();
  process.exit(0);
});
