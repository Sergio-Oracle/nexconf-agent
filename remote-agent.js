import 'dotenv/config';
import WebSocket from 'ws';
import screenshot from 'screenshot-desktop';
import sharp from 'sharp';
import robot from 'robotjs';

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
};

const SERVER_URL  = getArg('--server')  || process.env.REMOTE_SERVER_URL;
const SESSION_ID  = getArg('--session') || process.env.REMOTE_SESSION_ID || 'default';
const FPS         = parseInt(getArg('--fps') || '12');
const QUALITY     = parseInt(getArg('--quality') || '60');
const SCALE       = parseFloat(getArg('--scale') || '0.8');

if (!SERVER_URL) {
  console.error("❌ --server requis");
  process.exit(1);
}

const INTERVAL_MS = Math.round(1000 / FPS);

console.log(`
🖥️  NexConf Remote Agent
Serveur : ${SERVER_URL}
Session : ${SESSION_ID}
`);

robot.setMouseDelay(0);
robot.setKeyboardDelay(0);

const screen = robot.getScreenSize();
const SCREEN_W = Math.round(screen.width * SCALE);
const SCREEN_H = Math.round(screen.height * SCALE);

let ws;
let streaming = false;
let streamInterval = null;

function connect() {
  const url = `${SERVER_URL}/ws/agent?session=${encodeURIComponent(SESSION_ID)}`;

  ws = new WebSocket(url, {
    rejectUnauthorized: false // utile si certificat auto-signé
  });

  ws.on('open', () => {
    console.log("✅ Connecté au serveur");
    send({ type: 'screen-info', width: SCREEN_W, height: SCREEN_H, scale: SCALE });
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'start-stream') startStream();
      if (msg.type === 'stop-stream') stopStream();
    } catch {}
  });

  ws.on('close', () => {
    console.log("⚠️ Reconnexion dans 3s...");
    stopStream();
    setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    console.error("❌ WS error:", err.message);
  });
}

function send(data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

async function captureFrame() {
  try {
    const buf = await screenshot({ format: 'png' });
    const jpeg = await sharp(buf)
      .resize(SCREEN_W, SCREEN_H)
      .jpeg({ quality: QUALITY })
      .toBuffer();

    ws.send(JSON.stringify({
      type: 'frame',
      data: jpeg.toString('base64')
    }));
  } catch {}
}

function startStream() {
  if (streaming) return;
  streaming = true;
  streamInterval = setInterval(captureFrame, INTERVAL_MS);
}

function stopStream() {
  streaming = false;
  if (streamInterval) clearInterval(streamInterval);
}

connect();
