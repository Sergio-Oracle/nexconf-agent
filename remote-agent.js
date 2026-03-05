// ─── remote-agent.js ─────────────────────────────────────────────────────────
// Agent Bureau à Distance — NexConf v4
//
// VIDÉO    : ffmpeg capture l'écran (x11grab) → stream LiveKit (WebRTC/H.264)
// CONTRÔLE : WebSocket → serveur relais → RobotJS (souris + clavier)
//
// Prérequis sur la machine agent (rtn) :
//   sudo apt install -y ffmpeg
//   # Installer lk-cli :
//   wget https://github.com/livekit/livekit-cli/releases/download/v2.4.4/lk_linux_amd64.tar.gz
//   tar -xzf lk_linux_amd64.tar.gz && sudo mv lk /usr/local/bin/ && rm lk_linux_amd64.tar.gz
//
// Usage :
//   export XDG_RUNTIME_DIR=/run/user/1001
//   export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1001/bus
//   export WAYLAND_DISPLAY=wayland-0
//   node remote-agent.js --server wss://nexconf.ddns.net --session VOTRE_CODE
//
// Options :
//   --fps     : frames par seconde (défaut 15)
//   --scale   : échelle écran 0.1-1.0 pour le contrôle souris (défaut 1.0)
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import WebSocket           from 'ws';
import robot               from 'robotjs';
import { execFile, spawn } from 'child_process';
import { promisify }       from 'util';

const execFileAsync = promisify(execFile);

// ── Arguments CLI ─────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const SERVER_URL = getArg('--server')  || process.env.REMOTE_SERVER_URL || 'wss://nexconf.ddns.net';
const SESSION_ID = getArg('--session') || process.env.REMOTE_SESSION_ID || 'default';
const FPS        = parseInt(getArg('--fps')   || '15');
const SCALE      = parseFloat(getArg('--scale') || '1.0');

// URL HTTP du serveur pour récupérer le token LiveKit
const NEXCONF_HTTP = SERVER_URL.replace('wss://', 'https://').replace('ws://', 'http://');
const LIVEKIT_URL  = process.env.LIVEKIT_URL || 'wss://livekit.ec2lt.sn';

// ── Environnement graphique ───────────────────────────────────────────────────
const DISPLAY         = process.env.DISPLAY         || ':0';
const WAYLAND_DISPLAY = process.env.WAYLAND_DISPLAY || 'wayland-0';
const XDG_RUNTIME_DIR = process.env.XDG_RUNTIME_DIR || '/run/user/1001';
const DBUS_ADDR       = process.env.DBUS_SESSION_BUS_ADDRESS
                        || `unix:path=${XDG_RUNTIME_DIR}/bus`;

const GFX_ENV = {
  ...process.env,
  DISPLAY,
  WAYLAND_DISPLAY,
  XDG_RUNTIME_DIR,
  DBUS_SESSION_BUS_ADDRESS: DBUS_ADDR,
};

// ── RobotJS ───────────────────────────────────────────────────────────────────
robot.setMouseDelay(0);
robot.setKeyboardDelay(0);
const screen = robot.getScreenSize();

// ── Touches spéciales ─────────────────────────────────────────────────────────
const SPECIAL_KEYS = {
  'Enter':'enter','Backspace':'backspace','Delete':'delete','Tab':'tab',
  'Escape':'escape','ArrowUp':'up','ArrowDown':'down','ArrowLeft':'left',
  'ArrowRight':'right','Home':'home','End':'end','PageUp':'pageup',
  'PageDown':'pagedown','F1':'f1','F2':'f2','F3':'f3','F4':'f4','F5':'f5',
  'F6':'f6','F7':'f7','F8':'f8','F9':'f9','F10':'f10','F11':'f11','F12':'f12',
  ' ':'space','Control':'control','Alt':'alt','Shift':'shift','Meta':'command',
};

console.log(`\n🖥️  NexConf Agent v4`);
console.log(`   Serveur   : ${SERVER_URL}`);
console.log(`   Session   : ${SESSION_ID}`);
console.log(`   FPS       : ${FPS}`);
console.log(`   Écran     : ${screen.width}x${screen.height}`);
console.log(`   LiveKit   : ${LIVEKIT_URL}`);
console.log(`\n   Connexion en cours…\n`);

// ── Récupérer un token LiveKit ────────────────────────────────────────────────
async function getLiveKitToken(room, identity) {
  const url = `${NEXCONF_HTTP}/api/token?room=${encodeURIComponent(room)}&username=${encodeURIComponent(identity)}`;
  const res  = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Token HTTP ${res.status}`);
  const data = await res.json();
  if (!data.token) throw new Error('Pas de token dans la réponse');
  return data.token;
}

// ── Stream LiveKit via ffmpeg + lk publish ────────────────────────────────────
let ffmpegProc   = null;
let lkProc       = null;
let streamActive = false;

async function startLiveKitStream() {
  if (streamActive) return;

  const room     = `remote-${SESSION_ID}`;
  const identity = `agent-${SESSION_ID}`;

  try {
    // Vérifier que ffmpeg est installé
    await execFileAsync('which', ['ffmpeg']);
  } catch {
    console.error('❌ ffmpeg introuvable — installez-le : sudo apt install -y ffmpeg');
    return;
  }

  try {
    // Vérifier que lk-cli est installé
    await execFileAsync('which', ['lk']);
  } catch {
    console.error('❌ lk-cli introuvable — voir install.sh pour l\'installation');
    return;
  }

  let token;
  try {
    token = await getLiveKitToken(room, identity);
    console.log(`🔑  Token LiveKit obtenu → room: ${room}`);
  } catch (err) {
    console.error('❌ Impossible d\'obtenir le token LiveKit:', err.message);
    return;
  }

  // ── ffmpeg : capture x11grab → mp4 fragmented sur stdout ──────────────────
  // x11grab fonctionne sur XWayland (:0) et X11 classique
  ffmpegProc = spawn('ffmpeg', [
    '-loglevel', 'warning',
    // Source : capture X11/XWayland
    '-f',         'x11grab',
    '-framerate', String(FPS),
    '-i',         DISPLAY,
    // Encodage H.264 ultrafast zerolatency
    '-vf',        'scale=trunc(iw/2)*2:trunc(ih/2)*2',  // dimensions paires obligatoires
    '-vcodec',    'libx264',
    '-preset',    'ultrafast',
    '-tune',      'zerolatency',
    '-crf',       '28',
    '-g',         String(FPS * 2),   // keyframe toutes les 2s
    '-pix_fmt',   'yuv420p',
    // Sortie mp4 fragmented (compatible streaming pipe)
    '-f',         'mp4',
    '-movflags',  'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  ], { env: GFX_ENV, stdio: ['ignore', 'pipe', 'pipe'] });

  // ── lk publish-file : reçoit le mp4 depuis stdin et publie sur LiveKit ─────
  lkProc = spawn('lk', [
    'room', 'join',
    '--url',      LIVEKIT_URL,
    '--token',    token,
    '--publish',  'pipe:0',
    '--identity', identity,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  // Pipeline ffmpeg stdout → lk stdin
  ffmpegProc.stdout.pipe(lkProc.stdin);

  ffmpegProc.stderr.on('data', (d) => {
    const line = d.toString().trim();
    if (line && !line.startsWith('frame=')) console.log('[ffmpeg]', line);
    else if (line) process.stdout.write(`\r🎥  ${line}`);
  });

  lkProc.stdout.on('data', (d) => console.log('[lk]', d.toString().trim()));
  lkProc.stderr.on('data', (d) => {
    const line = d.toString().trim();
    if (line) console.log('[lk]', line);
  });

  ffmpegProc.on('close', (code) => {
    console.log(`\n⏹️  ffmpeg terminé (code ${code})`);
    streamActive = false;
    lkProc?.kill('SIGTERM');
  });

  lkProc.on('close', (code) => {
    console.log(`⏹️  lk terminé (code ${code})`);
    streamActive = false;
    ffmpegProc?.kill('SIGTERM');
  });

  lkProc.on('error', (err) => console.error('❌ lk erreur:', err.message));
  ffmpegProc.on('error', (err) => console.error('❌ ffmpeg erreur:', err.message));

  streamActive = true;
  console.log(`✅  Stream LiveKit démarré → room: ${room} @ ${FPS}fps`);
}

function stopLiveKitStream() {
  if (!streamActive) return;
  streamActive = false;
  ffmpegProc?.kill('SIGTERM'); ffmpegProc = null;
  lkProc?.kill('SIGTERM');     lkProc     = null;
  console.log('⏹️  Stream LiveKit arrêté');
}

// ── WebSocket — canal de contrôle souris/clavier ──────────────────────────────
let ws;
let reconnectTimeout = null;

function connect() {
  const url = `${SERVER_URL}/ws/agent?session=${encodeURIComponent(SESSION_ID)}`;
  ws = new WebSocket(url, { rejectUnauthorized: false, perMessageDeflate: false });

  ws.on('open', () => {
    console.log(`✅  Connecté au serveur relais`);
    // Envoyer les infos écran + room LiveKit au viewer
    send({
      type:    'screen-info',
      width:   screen.width,
      height:  screen.height,
      scale:   SCALE,
      lkRoom:  `remote-${SESSION_ID}`,
      lkUrl:   LIVEKIT_URL,
    });
    console.log(`   En attente d'un visualiseur…\n`);
  });

  ws.on('message', (raw) => {
    try { handleCommand(JSON.parse(raw.toString())); } catch {}
  });

  ws.on('close', () => {
    console.log('⚠️  Connexion perdue. Reconnexion dans 3s…');
    stopLiveKitStream();
    reconnectTimeout = setTimeout(connect, 3000);
  });

  ws.on('error', (err) => console.error('❌ WebSocket:', err.message));
}

function send(data) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// ── Commandes reçues ──────────────────────────────────────────────────────────
function handleCommand(msg) {
  switch (msg.type) {

    case 'start-stream':
      startLiveKitStream();
      break;

    case 'stop-stream':
      stopLiveKitStream();
      break;

    // ── Souris ──────────────────────────────────────────────────
    case 'mouse-move':
      robot.moveMouse(
        Math.round(msg.x * screen.width),
        Math.round(msg.y * screen.height)
      );
      break;

    case 'mouse-click': {
      const x = Math.round(msg.x * screen.width);
      const y = Math.round(msg.y * screen.height);
      robot.moveMouse(x, y);
      robot.mouseClick(msg.button === 2 ? 'right' : 'left', msg.double || false);
      break;
    }

    case 'mouse-down':
      robot.moveMouse(
        Math.round(msg.x * screen.width),
        Math.round(msg.y * screen.height)
      );
      robot.mouseToggle('down', msg.button === 2 ? 'right' : 'left');
      break;

    case 'mouse-up':
      robot.moveMouse(
        Math.round(msg.x * screen.width),
        Math.round(msg.y * screen.height)
      );
      robot.mouseToggle('up', msg.button === 2 ? 'right' : 'left');
      break;

    case 'mouse-scroll':
      robot.scrollMouse(msg.dx || 0, msg.dy || 0);
      break;

    // ── Clavier ─────────────────────────────────────────────────
    case 'key-press': {
      const key = SPECIAL_KEYS[msg.key] || (msg.key.length === 1 ? msg.key.toLowerCase() : null);
      if (!key) break;
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

// ── Démarrage ─────────────────────────────────────────────────────────────────
connect();

process.on('SIGINT', () => {
  console.log('\n👋  Arrêt de l\'agent…');
  stopLiveKitStream();
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (ws) ws.close();
  process.exit(0);
});
