// Plantastica App: Simple Synth with Visualizer

// --- DOM Elements ---
const canvas = document.getElementById('waveCanvas');
const ctx = canvas.getContext('2d');
const infoDisplay = document.getElementById('infoDisplay');
const drawer = document.getElementById('drawer');
const openDrawerBtn = document.getElementById('openDrawer');
const closeDrawerBtn = document.getElementById('closeDrawer');
const instrumentSelect = document.getElementById('instrumentSelect');
const volumeSlider = document.getElementById('volumeSlider');
const modType = document.getElementById('modType');
const modRate = document.getElementById('modRate');
const modDepth = document.getElementById('modDepth');
const modRateVal = document.getElementById('modRateVal');
const modDepthVal = document.getElementById('modDepthVal');
const resetBtn = document.getElementById('resetBtn');

// --- State ---
let audioCtx, gainNode, osc, analyser, modOsc, modGain;
let currentNote = null;
let animationId;
let modTypeValue = 'none';

// --- Audio Setup ---
function setupAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    gainNode = audioCtx.createGain();
    gainNode.gain.value = parseFloat(volumeSlider.value);
    analyser = audioCtx.createAnalyser();
    gainNode.connect(analyser);
    analyser.connect(audioCtx.destination);
  }
}

// --- Play Note ---
function playNote(freq) {
  stopNote();
  setupAudio();

  osc = audioCtx.createOscillator();
  osc.type = instrumentSelect.value;
  osc.frequency.value = freq;

  // Modulation
  if (modType.value !== 'none') {
    modOsc = audioCtx.createOscillator();
    modGain = audioCtx.createGain();
    modOsc.type = 'sine';
    modOsc.frequency.value = parseFloat(modRate.value);
    modGain.gain.value = parseFloat(modDepth.value) * (modType.value === 'vibrato' ? 12 : 1);

    if (modType.value === 'vibrato') {
      modOsc.connect(modGain).connect(osc.frequency);
    } else if (modType.value === 'tremolo') {
      modOsc.connect(modGain).connect(gainNode.gain);
    }
    modOsc.start();
  }

  osc.connect(gainNode);
  osc.start();
  currentNote = freq;
}

// --- Stop Note ---
function stopNote() {
  if (osc) {
    osc.stop();
    osc.disconnect();
    osc = null;
  }
  if (modOsc) {
    modOsc.stop();
    modOsc.disconnect();
    modOsc = null;
    modGain.disconnect();
    modGain = null;
  }
  currentNote = null;
}

// --- Visualizer ---
function drawWave() {
  if (!analyser) return;
  analyser.fftSize = 1024;
  const bufferLength = analyser.fftSize;
  const dataArray = new Uint8Array(bufferLength);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  analyser.getByteTimeDomainData(dataArray);

  ctx.lineWidth = 3;
  ctx.strokeStyle = '#39fca4';
  ctx.beginPath();
  const sliceWidth = canvas.width * 1.0 / bufferLength;
  let x = 0;
  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = v * canvas.height / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += sliceWidth;
  }
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();

  animationId = requestAnimationFrame(drawWave);
}

// --- Resize Handler ---
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- UI Events ---
openDrawerBtn.addEventListener('click', () => {
  drawer.classList.remove('closed');
  drawer.classList.add('open');
});
closeDrawerBtn.addEventListener('click', () => {
  drawer.classList.remove('open');
  drawer.classList.add('closed');
});

volumeSlider.addEventListener('input', () => {
  if (gainNode) gainNode.gain.value = parseFloat(volumeSlider.value);
});

instrumentSelect.addEventListener('change', () => {
  if (osc && currentNote) playNote(currentNote);
});

modType.addEventListener('change', () => {
  if (osc && currentNote) playNote(currentNote);
});
modRate.addEventListener('input', () => {
  modRateVal.textContent = parseFloat(modRate.value).toFixed(1);
  if (osc && currentNote) playNote(currentNote);
});
modDepth.addEventListener('input', () => {
  modDepthVal.textContent = parseFloat(modDepth.value).toFixed(2);
  if (osc && currentNote) playNote(currentNote);
});

// --- Mouse/Keyboard Controls ---
canvas.addEventListener('mousedown', e => {
  // Map X position to frequency (MIDI note 40–80)
  const freq = 55 * Math.pow(2, ((e.clientX / window.innerWidth) * 40) / 12);
  playNote(freq);
  drawWave();
});
canvas.addEventListener('mouseup', () => {
  stopNote();
  cancelAnimationFrame(animationId);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  const touch = e.touches[0];
  const freq = 55 * Math.pow(2, ((touch.clientX / window.innerWidth) * 40) / 12);
  playNote(freq);
  drawWave();
});
canvas.addEventListener('touchend', () => {
  stopNote();
  cancelAnimationFrame(animationId);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// --- Reset ---
resetBtn.addEventListener('click', () => {
  volumeSlider.value = 0.2;
  instrumentSelect.value = 'sine';
  modType.value = 'none';
  modRate.value = 4;
  modDepth.value = 0.5;
  modRateVal.textContent = '4.0';
  modDepthVal.textContent = '0.50';
  if (osc) stopNote();
  if (animationId) cancelAnimationFrame(animationId);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// --- Info Display ---
infoDisplay.textContent =
`Plantastica – Modular Synth
Click or tap the canvas to play a note.
Use the drawer for controls and try modulation!
Inspired by Mort Garson's Plantasia.`;

