// Control del carrito por Web Serial con simulación animada.
// Envía exactamente los comandos que ya entiende el código del Arduino:
// a = adelante, r = reversa, d = derecha, i = izquierda, p = parar (9600 baudios).
// Igual que en el Arduino, cada comando se mantiene hasta que llega otro (por ejemplo 'p').

const BAUD = 9600;
const ARDUINO_RESET_MS = 2000; // el Arduino se reinicia al abrir el puerto serie

const NAMES = { a: 'adelante', r: 'reversa', i: 'izquierda', d: 'derecha', p: 'parar' };

// Sentido de cada motor: [motor A (IN1, IN2), motor B (IN3, IN4)]
// 1 = adelante, -1 = reversa, 0 = detenido. Coincide con los digitalWrite del Arduino.
// Si en tu carrito real el giro sale al revés, intercambia los valores de 'i' y 'd'.
const MOVES = {
  a: [1, 1],
  r: [-1, -1],
  i: [-1, 1],
  d: [1, -1],
  p: [0, 0]
};

const KEYMAP = {
  ArrowUp: 'a', KeyW: 'a',
  ArrowDown: 'r', KeyS: 'r',
  ArrowLeft: 'i', KeyA: 'i',
  ArrowRight: 'd', KeyD: 'd',
  Space: 'p'
};

const connectBtn = document.getElementById('connectBtn');
const simBtn = document.getElementById('simBtn');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const lastCmd = document.getElementById('lastCmd');
const warning = document.getElementById('warning');
const stage = document.getElementById('stage');
const car = document.getElementById('car');
const keys = document.querySelectorAll('.key');
const wheelsLeft = document.querySelectorAll('.wheel.izq');
const wheelsRight = document.querySelectorAll('.wheel.der');
const encoder = new TextEncoder();

const motorA = {
  card: document.getElementById('motorA'),
  dir: document.getElementById('dirA'),
  pins: [document.getElementById('in1'), document.getElementById('in2')]
};
const motorB = {
  card: document.getElementById('motorB'),
  dir: document.getElementById('dirB'),
  pins: [document.getElementById('in3'), document.getElementById('in4')]
};

let port = null;
let writer = null;
let current = null; // último comando enviado
let simMode = false; // true = simulación sin Arduino

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

/* ---------- Animación del carrito y de los motores ---------- */

const SPEED = 120; // píxeles por segundo
const TURN = 2.4;  // radianes por segundo al girar
let motorL = 0;
let motorR = 0;
let x = 0;
let y = 0;
let camX = 0;
let camY = 0;
let heading = 0;
let lastTime = performance.now();

function setWheels(wheels, dir) {
  wheels.forEach((w) => {
    w.classList.toggle('fwd', dir > 0);
    w.classList.toggle('rev', dir < 0);
  });
}

// Cada pin se muestra como un LED con un 1 (HIGH) o un 0 (LOW)
function setPin(el, high) {
  el.textContent = high ? '1' : '0';
  el.classList.toggle('high', high);
  el.setAttribute('aria-label', `${el.dataset.name}: ${high ? 'HIGH' : 'LOW'}`);
}

// Muestra el estado de un motor: eje girando, flecha y pines del puente H.
function updateMotor(motor, dir) {
  motor.card.classList.toggle('active', dir !== 0);
  motor.card.classList.toggle('fwd', dir > 0);
  motor.card.classList.toggle('rev', dir < 0);
  motor.dir.textContent = dir > 0 ? 'Gira hacia adelante' : dir < 0 ? 'Gira en reversa' : 'Detenido';
  setPin(motor.pins[0], dir > 0);
  setPin(motor.pins[1], dir < 0);
}

function setMotion(cmd) {
  [motorL, motorR] = MOVES[cmd];
  setWheels(wheelsLeft, motorL);
  setWheels(wheelsRight, motorR);
  updateMotor(motorA, motorL);
  updateMotor(motorB, motorR);
}

function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  if (motorL || motorR) {
    heading += ((motorL - motorR) / 2) * TURN * dt;
    const v = ((motorL + motorR) / 2) * SPEED * dt;
    x += Math.sin(heading) * v;
    y -= Math.cos(heading) * v;

    // Al llegar a una pared, la cámara lo sigue y el piso se desplaza
    const maxX = stage.clientWidth / 2 - 50;
    const maxY = stage.clientHeight / 2 - 50;
    if (x - camX > maxX) camX = x - maxX;
    else if (x - camX < -maxX) camX = x + maxX;
    if (y - camY > maxY) camY = y - maxY;
    else if (y - camY < -maxY) camY = y + maxY;

    car.style.transform = `translate(${x - camX}px, ${y - camY}px) rotate(${heading}rad)`;
    stage.style.backgroundPosition = `${-camX}px ${-camY}px`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------- Envío de comandos ---------- */

async function send(cmd) {
  if ((!writer && !simMode) || cmd === current) return;
  current = cmd;
  lastCmd.textContent = NAMES[cmd];
  // El botón del comando activo queda hundido (excepto Parar)
  keys.forEach((k) => k.classList.toggle('pressed', k.dataset.cmd === cmd && cmd !== 'p'));
  setMotion(cmd);
  if (simMode) return; // en simulación no se envía nada al puerto serie
  try {
    await writer.write(encoder.encode(cmd));
  } catch (err) {
    await cleanup('Se perdió la conexión');
  }
}

/* ---------- Conexión serie ---------- */

async function cleanup(message = 'Desconectado') {
  setControls(false);
  current = null;
  keys.forEach((k) => k.classList.remove('pressed'));
  setMotion('p');
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
  simBtn.disabled = true;
  if (port) await disconnect(); else await connect();
  connectBtn.disabled = !('serial' in navigator);
  simBtn.disabled = !!port;
});

/* ---------- Modo simulación (sin Arduino) ---------- */

function startSim() {
  simMode = true;
  simBtn.textContent = 'Salir de la simulación';
  simBtn.setAttribute('aria-pressed', 'true');
  connectBtn.disabled = true;
  setStatus('on', 'Modo simulación (sin Arduino)');
  setControls(true);
}

async function stopSim() {
  simMode = false;
  simBtn.textContent = 'Modo simulación';
  simBtn.setAttribute('aria-pressed', 'false');
  connectBtn.disabled = !('serial' in navigator);
  await cleanup();
}

simBtn.addEventListener('click', () => (simMode ? stopSim() : startSim()));

/* ---------- Botones y teclado ---------- */

keys.forEach((key) => {
  key.addEventListener('click', () => send(key.dataset.cmd));
});

// Teclado: flechas o W A S D para mover, espacio para parar.
window.addEventListener('keydown', (e) => {
  const cmd = KEYMAP[e.code];
  if (!cmd || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  if (!e.repeat) send(cmd);
});

// Seguridad: si la pestaña se oculta o se cierra, el carrito se detiene.
window.addEventListener('pagehide', () => send('p'));
document.addEventListener('visibilitychange', () => { if (document.hidden) send('p'); });

// Si se desenchufa el cable USB.
if ('serial' in navigator) {
  navigator.serial.addEventListener('disconnect', (e) => {
    if (e.target === port) cleanup('Cable USB desconectado');
  });
}

// Estado inicial: motores detenidos y los cuatro LEDs en 0
setMotion('p');
