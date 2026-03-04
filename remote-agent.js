// ─── remote-agent.js ─────────────────────────────────────────────────────────
// Agent Bureau à Distance — NexConf
//
// Capture l'écran via gnome-screenshot (Wayland/GNOME) ou scrot (X11),
// streame vers le serveur relais, et exécute les commandes souris/clavier.
//
// Usage :
//   node remote-agent.js --server wss://nexconf.ddns.net --session VOTRE_CODE
//
// Options :
//   --fps     : frames par seconde (défaut 10)
//   --quality : qualité JPEG 1-100 (défaut 60)
//   --scale   : échelle 0.1-1 (défaut 0.8)
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import WebSocket            from 'ws';
import sharp                from 'sharp';
import robot                from 'robotjs';
import { execFile }         from 'child_process';
import { promisify }        from 'util';
import { readFile, unlink } from 'fs/promises';
import { tmpdir }           from 'os';
import { join }             from 'path';

const execFileAsync = promisify(execFile);

// ── Arguments CLI ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
};

const SERVER_URL  = getArg('--server')  || process.env.REMOTE_SERVER_URL || 'ws://localhost:3000';
const SESSION_ID  = getArg('--session') || process.env.REMOTE_SESSION_ID || 'default';
const FPS         = parseInt(getArg('--fps')     || '10');
const QUALITY     = parseInt(getArg('--quality') || '60');
const SCALE       = parseFloat(getArg('--scale') || '0.8');
const INTERVAL_MS = Math.round(1000 / FPS);

console.log(`\n🖥️  Agent Bureau à Distance — NexConf`);
console.log(`   Serveur  : ${SERVER_URL}`);
console.log(`   Session  : ${SESSION_ID}`);
console.log(`   FPS      : ${FPS} | Qualité : ${QUALITY}% | Scale : ${SCALE}`);
console.log(`\n   Connexion en cours…\n`);

// ── Configuration RobotJS ─────────────────────────────────────────────────────
robot.setMouseDelay(0);
robot.setKeyboardDelay(0);

const screen   = robot.getScreenSize();
const SCREEN_W = Math.round(screen.width  * SCALE);
const SCREEN_H = Math.round(screen.height * SCALE);

// ── Touches spéciales ─────────────────────────────────────────────────────────
const SPECIAL_KEYS = {
  'Enter':'enter','Backspace':'backspace','Delete':'delete','Tab':'tab',
  'Escape':'escape','ArrowUp':'up','ArrowDown':'down','ArrowLeft':'left',
  'ArrowRight':'right','Home':'home','End':'end','PageUp':'pageup',
  'PageDown':'pagedown','F1':'f1','F2':'f2','F3':'f3','F4':'f4','F5':'f5',
  'F6':'f6','F7':'f7','F8':'f8','F9':'f9','F10':'f10','F11':'f11','F12':'f12',
  ' ':'space','Control':'control','Alt':'alt','Shift':'shift','Meta':'command',
};

// ── Détection de la méthode de capture ───────────────────────────────────────
// Ordre de priorité :
//   1. gnome-screenshot  → Wayland/GNOME (Ubuntu récent)
//   2. scrot             → X11 classique
const DISPLAY          = process.env.DISPLAY          || ':0';
const WAYLAND_DISPLAY  = process.env.WAYLAND_DISPLAY  || 'wayland-0';
const XDG_RUNTIME_DIR  = process.env.XDG_RUNTIME_DIR  || `/run/user/${process.getuid()}`;
const DBUS_ADDR        = process.env.DBUS_SESSION_BUS_ADDRESS
                         || `unix:path=${XDG_RUNTIME_DIR}/bus`;

// Environnement complet pour les outils graphiques
const GFX_ENV = {
  ...process.env,
  DISPLAY,
  WAYLAND_DISPLAY,
  XDG_RUNTIME_DIR,
  DBUS_SESSION_BUS_ADDRESS: DBUS_ADDR,
};

// Détecter gnome-screenshot au démarrage
let useGnomeScreenshot = false;
try {
  await execFileAsync('which', ['gnome-screenshot']);
  useGnomeScreenshot = true;
  console.log('📸  Capture : gnome-screenshot (Wayland/GNOME)');
} catch {
  console.log('📸  Capture : scrot (X11)');
}

// ── Capture écran ─────────────────────────────────────────────────────────────
let frameInProgress = false;

async function captureFrame() {
  if (frameInProgress) return;
  frameInProgress = true;

  const tmpFile = join(tmpdir(), `nexconf_${Date.now()}.png`);
  try {
    if (useGnomeScreenshot) {
      // gnome-screenshot : fonctionne sur Wayland/GNOME
      await execFileAsync('gnome-screenshot', ['-f', tmpFile], {
        env:     GFX_ENV,
        timeout: 4000,
      });
    } else {
      // scrot : fonctionne sur X11 classique
      await execFileAsync('scrot', ['-z', tmpFile], {
        env:     GFX_ENV,
        timeout: 3000,
      });
    }

    const buf  = await readFile(tmpFile);
    const jpeg = await sharp(buf)
      .resize(SCREEN_W, SCREEN_H, { fit: 'fill' })
      .jpeg({ quality: QUALITY })
      .toBuffer();

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'frame',
        data: jpeg.toString('base64'),
        ts:   Date.now(),
      }));
    }
  } catch (e) {
    // Silencieux en production — décommenter pour déboguer :
    // console.error('❌ captureFrame:', e.message);
  } finally {
    frameInProgress = false;
    try { await unlink(tmpFile); } catch {}
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
let ws;
let streaming        = false;
let streamInterval   = null;
let reconnectTimeout = null;

function connect() {
  const url = `${SERVER_URL}/ws/agent?session=${encodeURIComponent(SESSION_ID)}`;
  ws = new WebSocket(url, { rejectUnauthorized: false });

  ws.on('open', () => {
    console.log(`✅  Connecté au serveur relais`);
    console.log(`   En attente d'un visualiseur…\n`);
    send({ type: 'screen-info', width: SCREEN_W, height: SCREEN_H, scale: SCALE });
  });

  ws.on('message', (raw) => {
    try { handleCommand(JSON.parse(raw.toString())); } catch {}
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

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// ── Commandes reçues ──────────────────────────────────────────────────────────
function handleCommand(msg) {
  switch (msg.type) {
    case 'start-stream': startStream(); break;
    case 'stop-stream':  stopStream();  break;

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
      robot.mouseToggle('down', 'left');
      break;

    case 'mouse-up':
      robot.moveMouse(
        Math.round(msg.x * screen.width),
        Math.round(msg.y * screen.height)
      );
      robot.mouseToggle('up', 'left');
      break;

    case 'mouse-scroll':
      robot.scrollMouse(msg.dx || 0, msg.dy || 0);
      break;

    case 'key-press': {
      const key  = SPECIAL_KEYS[msg.key] || (msg.key.length === 1 ? msg.key.toLowerCase() : null);
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

// ── Streaming ─────────────────────────────────────────────────────────────────
function startStream() {
  if (streaming) return;
  streaming = true;
  console.log('🎥  Stream démarré');
  captureFrame();
  streamInterval = setInterval(captureFrame, INTERVAL_MS);
}

function stopStream() {
  if (!streaming) return;
  streaming = false;
  if (streamInterval) { clearInterval(streamInterval); streamInterval = null; }
  console.log('⏹️   Stream arrêté');
}

// ── Démarrage ─────────────────────────────────────────────────────────────────
connect();

process.on('SIGINT', () => {
  console.log('\n👋  Arrêt de l\'agent…');
  stopStream();
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (ws) ws.close();
  process.exit(0);
});
