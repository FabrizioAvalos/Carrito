// Control del carrito por Web Serial.
// Envía exactamente los comandos que ya entiende el código del Arduino:
// a = adelante, r = reversa, d = derecha, i = izquierda, p = parar (9600 baudios).

const BAUD = 9600;
const ARDUINO_RESET_MS = 2000; // el Arduino se reinicia al abrir el puerto serie

const NAMES = { a: 'adelante', r: 'reversa', i: 'izquierda', d: 'derecha', p: 'parar' };

const KEYMAP = {
  ArrowUp: 'a', KeyW: 'a',
  ArrowDown: 'r', KeyS: 'r',
  ArrowLeft: 'i', KeyA: 'i',
  ArrowRight: 'd', KeyD: 'd',
  Space: 'p'
};

const connectBtn = document.getElementById('connectBtn');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const lastCmd = document.getElementById('lastCmd');
const warning = document.getElementById('warning');
const keys = document.querySelectorAll('.key');
const encoder = new TextEncoder();

let port = null;
let writer = null;
let current = null; // último comando enviado
const held = [];    // teclas de movimiento que siguen presionadas

if (!('serial' in navigator)) {
  warning.hidden = false;
  connectBtn.disabled = true;
}

function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusText.textContent = text;
}

function setControls(enabled) {
  keys.forEach((k) => { k.disabled = !enabled; });
}

async function send(cmd) {
  if (!writer || cmd === current) return;
  current = cmd;
  lastCmd.textContent = NAMES[cmd];
  keys.forEach((k) => k.classList.toggle('pressed', k.dataset.cmd === cmd && cmd !== 'p'));
  try {
    await writer.write(encoder.encode(cmd));
  } catch (err) {
    await cleanup('Se perdió la conexión');
  }
}

async function cleanup(message = 'Desconectado') {
  setControls(false);
  current = null;
  held.length = 0;
  keys.forEach((k) => k.classList.remove('pressed'));
  try { writer?.releaseLock(); } catch (e) { /* ya liberado */ }
  try { await port?.close(); } catch (e) { /* ya cerrado */ }
  writer = null;
  port = null;
  connectBtn.textContent = 'Conectar al Arduino';
  setStatus('off', message);
}

async function connect() {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: BAUD });
    writer = port.writable.getWriter();
    setStatus('wait', 'Iniciando el Arduino…');
    await new Promise((r) => setTimeout(r, ARDUINO_RESET_MS));
    setStatus('on', 'Conectado');
    connectBtn.textContent = 'Desconectar';
    setControls(true);
  } catch (err) {
    if (err.name === 'NotFoundError') {
      await cleanup();
    } else {
      await cleanup('No se pudo abrir el puerto. Cierra el Monitor Serie del Arduino IDE.');
    }
  }
}

async function disconnect() {
  try { await writer?.write(encoder.encode('p')); } catch (e) { /* sin conexión */ }
  await cleanup();
}

connectBtn.addEventListener('click', async () => {
  connectBtn.disabled = true;
  if (port) await disconnect(); else await connect();
  connectBtn.disabled = !('serial' in navigator);
});

// Botones en pantalla: mover mientras se mantiene presionado, parar al soltar.
keys.forEach((key) => {
  const cmd = key.dataset.cmd;
  key.addEventListener('pointerdown', (e) => {
    key.setPointerCapture(e.pointerId);
    send(cmd);
  });
  if (cmd !== 'p') {
    key.addEventListener('pointerup', () => send('p'));
    key.addEventListener('pointercancel', () => send('p'));
  }
  key.addEventListener('contextmenu', (e) => e.preventDefault());
});

// Teclado: flechas o W A S D para mover, espacio para parar.
window.addEventListener('keydown', (e) => {
  const cmd = KEYMAP[e.code];
  if (!cmd || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  if (e.repeat) return;
  if (cmd === 'p') {
    held.length = 0;
    send('p');
    return;
  }
  if (!held.includes(e.code)) held.push(e.code);
  send(cmd);
});

window.addEventListener('keyup', (e) => {
  const cmd = KEYMAP[e.code];
  if (!cmd || cmd === 'p') return;
  const i = held.indexOf(e.code);
  if (i >= 0) held.splice(i, 1);
  send(held.length ? KEYMAP[held[held.length - 1]] : 'p');
});

// Seguridad: si la página pierde el foco o se oculta, el carrito se detiene.
function stopAll() {
  held.length = 0;
  send('p');
}
window.addEventListener('blur', stopAll);
window.addEventListener('pagehide', stopAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopAll(); });

// Si se desenchufa el cable USB.
if ('serial' in navigator) {
  navigator.serial.addEventListener('disconnect', (e) => {
    if (e.target === port) cleanup('Cable USB desconectado');
  });
}
