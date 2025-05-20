// Plantastica v2 main logic: full featured synth with all controls as in the advanced HTML
class PlantasiaApp {
  constructor() {
    // DOM cache
    this.$ = id => document.getElementById(id);
    this.canvas = this.$('waveCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.infoDisplay = this.$('infoDisplay');
    this.drawer = this.$('drawer');
    this.openDrawerBtn = this.$('openDrawer');
    this.closeDrawerBtn = this.$('closeDrawer');
    this.presetSelect = this.$('preset');
    this.waveformSelect = this.$('waveformSelect');
    this.bpmSlider = this.$('bpm');
    this.lfoRateSlider = this.$('lfoRate');
    this.lfoAmtSlider = this.$('lfoAmt');
    this.lfoDestSelect = this.$('lfoDest');
    this.volumeSlider = this.$('volume');
    this.delaySlider = this.$('delay');
    this.echoSlider = this.$('echo');
    this.filterSlider = this.$('filter');
    this.freqSlider = this.$('freq');
    this.playBtn = this.$('play');
    this.stopBtn = this.$('stop');
    this.toggleDisplayBtn = this.$('toggleDisplay');
    this.toggleMidiInBtn = this.$('toggleMidiIn');
    this.midiChannelSelect = this.$('midiChannelSelect');
    this.lfoRateValue = this.$('lfoRateValue');
    this.lfoAmtValue = this.$('lfoAmtValue');

    // State
    this.userWaveform = null;
    this.currentWaveColor = "#00FF7F";
    this.presetSettings = this.getPresetSettings();
    this.trailFrames = [];
    this.animationRunning = false;
    this.stopped = true;
    this.bpm = parseInt(this.bpmSlider.value);
    this.polyNotes = [];
    this.audioCtx = null;
    this.analyser = null;
    this.masterGain = null;
    this.reverbNode = null;
    this.bufferLength = null;
    this.dataArray = null;
    this.bpmTimer = null;
    this.animationFrameId = null;
    this.resizeTimeout = null;

    // UI
    this.openDrawerBtn.addEventListener('click', () => this.openDrawer());
    this.closeDrawerBtn.addEventListener('click', () => this.closeDrawer());
    this.presetSelect.addEventListener('change', () => this.onPresetChange());
    this.waveformSelect.addEventListener('change', () => this.userWaveform = this.waveformSelect.value);
    this.bpmSlider.addEventListener('input', () => this.onBpmChange());
    this.lfoRateSlider.addEventListener('input', () => this.updateLfoDisplay());
    this.lfoAmtSlider.addEventListener('input', () => this.updateLfoDisplay());
    this.playBtn.addEventListener('click', () => this.start());
    this.stopBtn.addEventListener('click', () => this.stop());
    this.toggleDisplayBtn.addEventListener('click', () => this.toggleDisplay());
    this.volumeSlider.addEventListener('input', () => this.setVolume());
    window.addEventListener('resize', () => this.debouncedResize());

    // Update LFO values UI
    this.updateLfoDisplay();
    this.setCanvasSize();
    this.onPresetChange();
    setInterval(() => this.updateDisplay(), 250);

    // MIDI Controls
    this.midiChannel = 9;
    this.midiInEnabled = true;
    this.midiChannelSelect.value = this.midiChannel;
    this.midiChannelSelect.addEventListener('change', () => {
      this.midiChannel = Number(this.midiChannelSelect.value);
      console.log("MIDI channel set to", this.midiChannel);
    });
    this.toggleMidiInBtn.addEventListener('click', () => {
      this.midiInEnabled = !this.midiInEnabled;
      this.toggleMidiInBtn.textContent = "midi" + (this.midiInEnabled ? "" : " off");
      console.log("MIDI in", this.midiInEnabled ? "enabled" : "disabled");
    });

    // ----- MIDI initialization -----
    this.midiAccess = null;
    this.activeMidiNotes = new Set();
    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess({ sysex: false }).then(
        (midiAccess) => this.onMIDISuccess(midiAccess),
        () => this.onMIDIFailure()
      );
    } else {
      console.warn("Web MIDI API not supported in this browser.");
    }
  }

  // --- MIDI methods ---
  onMIDISuccess(midiAccess) {
    this.midiAccess = midiAccess;
    for (let input of midiAccess.inputs.values()) {
      input.onmidimessage = (msg) => this.handleMIDIMessage(msg);
    }
    midiAccess.onstatechange = (e) => {
      for (let input of midiAccess.inputs.values()) {
        input.onmidimessage = (msg) => this.handleMIDIMessage(msg);
      }
    };
    console.log("MIDI ready!");
  }

  onMIDIFailure() {
    console.warn("Could not access your MIDI devices.");
  }

  handleMIDIMessage(event) {
    if (!this.midiInEnabled) return;
    const data = event.data;
    const status = data[0] & 0xf0;
    const channel = data[0] & 0x0f;
    const note = data[1];
    const velocity = data[2];

    // Channel filter: -1 means "all", otherwise match to this.midiChannel
    if (this.midiChannel !== -1 && channel !== this.midiChannel) return;

    if (status === 0x90 && velocity > 0) {
      // Note on
      this.noteOn(note, velocity, channel);
    } else if ((status === 0x80) || (status === 0x90 && velocity === 0)) {
      // Note off
      this.noteOff(note, channel);
    }
  }

  noteOn(note, velocity, channel) {
    // Convert MIDI note (0–127) to frequency
    const freq = 440 * Math.pow(2, (note - 69) / 12);

    // Velocity range: 0-127, map to 0.1–1.0
    const velGain = 0.1 + (velocity / 127) * 0.9;

    // Play with the current synth engine
    if (!this.audioCtx) this.initAudio();
    if (this.audioCtx.state === "suspended") this.audioCtx.resume();

    const params = { ...this.getPresetParams() };
    params.freq = freq;
    params.waveform = this.getWaveformFromPreset();
    params.delay = parseFloat(this.delaySlider.value);
    params.echo = parseFloat(this.echoSlider.value);
    params.filterFreq = parseFloat(this.filterSlider.value);
    params.reverb = 0.3 + parseFloat(this.echoSlider.value) * 0.5;
    params.attack = params.attack || 0.01;
    params.release = params.release || 0.2;
    params.velocityGain = velGain;

    // Store active note for noteOff
    this.activeMidiNotes.add(note);

    this.playInstrument(params);
    // For debugging:
    console.log(`MIDI Note ON: note=${note} freq=${freq.toFixed(2)} vel=${velocity} channel=${channel}`);
  }

  noteOff(note, channel) {
    // Remove from active notes
    this.activeMidiNotes.delete(note);
    // For simplicity, stop all notes (expand for true polyphony/note-matching if desired)
    this.stop();
    console.log(`MIDI Note OFF: note=${note} channel=${channel}`);
  }

  // --- Synthesis and app logic below (as before) ---
  getPresetOrder() {
    return [
      'plants','mold','bacteria','mushrooms','harmony',
      'plantasiaClassic','greenhouse','cosmicdew','daybeam','spiralback',
      'rockflora','mycomurk','microburst','fibonaccishift'
    ];
  }
  getPresetSettings() {
    return {
      plants: { scale: [174, 220, 285, 396, 528, 660], color: "#00FF7F", waveform: "triangle", attack: 0.25, release: 2.0, detuneCents: [-7, 0, 7], pan: 0, filterType: "lowpass", filterFreq: 1800, delay: 0.4, echo: 0.34, reverb: 0.5 },
      mold: { scale: [432, 639, 741, 852], color: "#8A2BE2", waveform: "sawtooth", attack: 0.04, release: 0.7, detuneCents: [-10, 0, 10], pan: () => Math.random()*2-1, filterType: "bandpass", filterFreq: 1100, delay: 0.5, echo: 0.51, reverb: 0.25 },
      bacteria: { scale: [528, 554, 585, 728, 311], color: "#FF4500", waveform: "square", attack: 0.01, release: 0.18, detuneCents: [-12, 0, 12], pan: () => Math.random()*2-1, filterType: "highpass", filterFreq: 1400, delay: 0.2, echo: 0.17, reverb: 0.12 },
      mushrooms: { scale: [417, 444, 528, 639, 392], color: "#FFD700", waveform: "sine", attack: 0.11, release: 1.1, detuneCents: [-6, 0, 6], pan: () => Math.sin(performance.now()/950), filterType: "lowpass", filterFreq: 1600, delay: 0.38, echo: 0.24, reverb: 0.44 },
      harmony: { scale: [261, 329, 392, 466, 528, 639], color: "#00FFFF", waveform: "triangle", attack: 0.27, release: 2.1, detuneCents: [-8, 0, 8], pan: 0, filterType: "lowpass", filterFreq: 2400, delay: 0.22, echo: 0.32, reverb: 0.63 },
      plantasiaClassic: { scale: [174, 220, 261.63, 329.63, 392, 523.25], color: "#8fd694", waveform: "triangle", attack: 0.35, release: 2.8, detuneCents: [-7, 0, 7], pan: 0, filterType: "lowpass", filterFreq: 1400, delay: 0.23, echo: 0.32, reverb: 0.44 },
      greenhouse: { scale: [432, 512, 538, 576, 648], color: "#56f28c", waveform: "sine", attack: 0.45, release: 2.5, detuneCents: [-12, -3, 7, 12], pan: 0, filterType: "lowpass", filterFreq: 500, delay: 0.4, echo: 0.5, reverb: 0.65 },
      cosmicdew: { scale: [528, 1056, 792, 1584, 2112], color: "#a5e6f4", waveform: "triangle", attack: 0.6, release: 3.2, detuneCents: [-24, 0, 11], pan: () => Math.sin(performance.now()/370), filterType: "highpass", filterFreq: 800, delay: 0.6, echo: 0.7, reverb: 1.0 },
      daybeam: { scale: [440, 660, 880, 990, 1320], color: "#ffe56c", waveform: "sawtooth", attack: 0.09, release: 0.18, detuneCents: [-4, 0, 4], pan: () => Math.random()*2-1, filterType: "bandpass", filterFreq: 1200, delay: 0.2, echo: 0.4, reverb: 0.22 },
      spiralback: { scale: [321.9, 521.3, 843.2, 987, 1598.3], color: "#ffb44f", waveform: "triangle", attack: 0.21, release: 0.89, detuneCents: [-13, 0, 8, 21], pan: 0, filterType: "lowpass", filterFreq: 987, delay: 0.618, echo: 0.382, reverb: 0.5 },
      rockflora: { scale: [440, 660, 880, 1350, 1760], color: "#9df0ff", waveform: "square", attack: 0.03, release: 0.13, detuneCents: [-8, 0, 8], pan: () => Math.random()*2-1, filterType: "highpass", filterFreq: 1350, delay: 0.18, echo: 0.28, reverb: 0.15 },
      mycomurk: { scale: [198, 259, 396, 420, 792], color: "#4e3e57", waveform: "sawtooth", attack: 0.22, release: 2.1, detuneCents: [-24, 0, 12, 19], pan: () => Math.random()*2-1, filterType: "lowpass", filterFreq: 420, delay: 0.35, echo: 0.45, reverb: 0.6 },
      microburst: { scale: [333, 666, 999, 555, 777], color: "#ff9e57", waveform: "triangle", attack: 0.01, release: 0.07, detuneCents: [-18, 0, 4, 13], pan: () => Math.random()*2-1, filterType: "highpass", filterFreq: 1300, delay: 0.1, echo: 0.9, reverb: 0.18 },
      fibonaccishift: { scale: [233, 377, 610, 987, 1597], color: "#aab6ff", waveform: "triangle", attack: 0.07, release: 0.3, detuneCents: [-21, 0, 5, 13], pan: 0, filterType: "bandpass", filterFreq: 987, delay: 0.377, echo: 0.233, reverb: 0.23 }
    };
  }
  getPreset() { return this.presetSelect.value; }
  getPresetParams() { return this.presetSettings[this.getPreset()]; }
  getScaleFromPreset() { return this.getPresetParams().scale; }
  getColorFromPreset() { return this.getPresetParams().color; }
  getWaveformFromPreset() { return this.userWaveform || this.getPresetParams().waveform; }

  updateLfoDisplay() {
    this.lfoRateValue.textContent = this.lfoRateSlider.value;
    this.lfoAmtValue.textContent = this.lfoAmtSlider.value;
  }
  setVolume() {
    if (this.masterGain)
      this.masterGain.gain.value = parseFloat(this.volumeSlider.value) / 100;
  }
  updateDisplay() {
    const p = this.getPresetParams();
    this.infoDisplay.textContent =
      "PRESET     : " + this.getPreset() + "\n" +
      "SCALE      : [" + p.scale.join(", ") + "]\n" +
      "OSC/WAVE   : " + this.getWaveformFromPreset() + "\n" +
      "ATTACK     : " + p.attack + "s\n" +
      "RELEASE    : " + p.release + "s\n" +
      "DETUNE     : [" + p.detuneCents.join(", ") + "]\n" +
      "FILTER     : " + p.filterType + " " + this.filterSlider.value + "Hz\n" +
      "DELAY      : " + this.delaySlider.value + "s\n" +
      "ECHO       : " + this.echoSlider.value + "\n" +
      "REVERB     : " + (0.3 + parseFloat(this.echoSlider.value)*0.5).toFixed(2) + "\n" +
      "VOLUME     : " + this.volumeSlider.value + "\n" +
      "BPM        : " + this.bpmSlider.value +
      "\nLFO        : " + this.lfoDestSelect.value + " " + this.lfoRateSlider.value + "Hz x " + this.lfoAmtSlider.value;
  }
  toggleDisplay() {
    this.infoDisplay.style.display = this.infoDisplay.style.display === "none" ? "block" : "none";
  }
  setCanvasSize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }
  debouncedResize() {
    clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(() => this.setCanvasSize(), 160);
  }
  startAnimation() {
    if (this.animationRunning) return;
    this.animationRunning = true;
    this.animate();
  }
  stopAnimation() {
    this.animationRunning = false;
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
  }
  animate() {
    if (!this.ctx || !this.analyser || !this.animationRunning) return;
    this.animationFrameId = requestAnimationFrame(() => this.animate());
    this.analyser.getByteTimeDomainData(this.dataArray);
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.trailFrames.length > 12) this.trailFrames.shift();
    this.trailFrames.push([...this.dataArray]);

    const grad = this.ctx.createLinearGradient(0, 0, this.canvas.width, 0);
    grad.addColorStop(0, this.currentWaveColor);
    grad.addColorStop(1, "#000000");

    for (let t = 0; t < this.trailFrames.length; t++) {
      const data = this.trailFrames[t];
      const slice = this.canvas.width / data.length;
      this.ctx.beginPath();
      let x = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128.0;
        const y = (v * this.canvas.height / 2.0 * 0.9) + this.canvas.height / 2;
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
        x += slice;
      }
      const alpha = 0.06 + (t / this.trailFrames.length) * 0.13;
      this.ctx.strokeStyle = grad;
      this.ctx.globalAlpha = alpha;
      this.ctx.shadowBlur = 15;
      this.ctx.shadowColor = this.currentWaveColor;
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;
      this.ctx.globalAlpha = 1.0;
    }
  }
  initAudio() {
    if (this.audioCtx) return;
    this.setCanvasSize();
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({latencyHint: 'interactive'});
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(this.bufferLength);
    this.masterGain = this.audioCtx.createGain();
    this.masterGain.gain.value = parseFloat(this.volumeSlider.value) / 100;

    this.reverbNode = this.audioCtx.createDelay();
    const reverbFeedback = this.audioCtx.createGain();
    this.reverbNode.delayTime.value = 0.4;
    reverbFeedback.gain.value = 0.4;
    this.reverbNode.connect(reverbFeedback);
    reverbFeedback.connect(this.reverbNode);
    this.reverbNode.connect(this.masterGain);
    this.masterGain.connect(this.audioCtx.destination);
    this.masterGain.connect(this.analyser);
  }
  start() {
    this.initAudio();
    this.stopped = false;
    this.currentWaveColor = this.getColorFromPreset();
    this.scheduleNotes(this.getScaleFromPreset());
    this.startAnimation();
  }
  stop() {
    this.stopped = true;
    clearInterval(this.bpmTimer);
    this.stopAnimation();
    // Disconnect all active notes
    for (const note of this.polyNotes) {
      if (note.osc) {
        try { note.osc.stop(); } catch {}
        try { note.osc.disconnect(); } catch {}
      }
    }
    this.polyNotes = [];
  }
  onBpmChange() {
    this.bpm = parseInt(this.bpmSlider.value);
    if (!this.stopped)
      this.scheduleNotes(this.getScaleFromPreset());
  }
  onPresetChange() {
    this.userWaveform = null;
    this.waveformSelect.value = this.getPresetParams().waveform || "triangle";
    this.currentWaveColor = this.getColorFromPreset();
    if (!this.stopped)
      this.scheduleNotes(this.getScaleFromPreset());
  }
  scheduleNotes(scale) {
    clearInterval(this.bpmTimer);
    this.bpmTimer = setInterval(() => {
      if (!this.stopped) {
        const freq = scale[Math.floor(Math.random() * scale.length)];
        this.playTone(freq);
      }
    }, 60000 / this.bpm);
  }
  playTone(freq) {
    if (!this.audioCtx) this.initAudio();
    if (this.audioCtx.state === "suspended") this.audioCtx.resume();

    const params = { ...this.getPresetParams() };
    params.freq = freq;
    params.waveform = this.getWaveformFromPreset();
    params.delay = parseFloat(this.delaySlider.value);
    params.echo = parseFloat(this.echoSlider.value);
    params.filterFreq = parseFloat(this.filterSlider.value);
    params.reverb = 0.3 + parseFloat(this.echoSlider.value) * 0.5;

    this.playInstrument(params);
  }
  playInstrument(params, when) {
    const now = this.audioCtx.currentTime;
    const startTime = when !== undefined ? when : now;
    // Clean up finished notes
    this.polyNotes = this.polyNotes.filter(n => n.endTime > now);
    // Limit polyphony
    if (this.polyNotes.length > 8) {
      const oldNote = this.polyNotes.shift();
      if (oldNote.osc) {
        try { oldNote.osc.stop(); } catch {}
        try { oldNote.osc.disconnect(); } catch {}
      }
    }

    const filterNode = this.audioCtx.createBiquadFilter();
    filterNode.type = params.filterType || "lowpass";
    filterNode.frequency.value = params.filterFreq;
    filterNode.Q.value = 7;

    const shaper = this.audioCtx.createWaveShaper();
    shaper.curve = (() => {
      let c = new Float32Array(65536);
      for (let i = 0; i < 65536; ++i) {
        let x = (i - 32768) / 32768;
        c[i] = Math.tanh(x * 1.5) * 0.8 + x * 0.2;
      }
      return c;
    })();

    const delayNode = this.audioCtx.createDelay();
    delayNode.delayTime.value = params.delay;
    const feedbackNode = this.audioCtx.createGain();
    feedbackNode.gain.value = params.echo;
    const reverbSend = this.audioCtx.createDelay();
    reverbSend.delayTime.value = params.reverb || 0.3;

    const gainNode = this.audioCtx.createGain();
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.3 * (params.velocityGain || 1), startTime + params.attack);
    gainNode.gain.linearRampToValueAtTime(0.0, startTime + params.attack + params.release);

    const panNode = this.audioCtx.createStereoPanner();
    panNode.pan.value = typeof params.pan === "function" ? params.pan() : (params.pan || 0);

    // LFO
    const lfoType = "sine";
    const lfoRate = parseFloat(this.lfoRateSlider.value);
    const lfoAmt = parseFloat(this.lfoAmtSlider.value);
    const lfoDest = this.lfoDestSelect.value;

    let lfo, lfoGain;
    if (lfoAmt > 0) {
      lfo = this.audioCtx.createOscillator();
      lfo.type = lfoType;
      lfo.frequency.value = lfoRate;
      lfoGain = this.audioCtx.createGain();
      lfoGain.gain.value = lfoAmt;

      if (lfoDest === "filter")
        lfo.connect(lfoGain).connect(filterNode.frequency);
      else if (lfoDest === "pan")
        lfo.connect(lfoGain).connect(panNode.pan);
      // No pitch LFO in this skeleton, but can be implemented as needed
      lfo.start(startTime);
      lfo.stop(startTime + params.attack + params.release + 0.1);
    }

    params.detuneCents = params.detuneCents || [-5, 0, 5];
    params.detuneCents.forEach(offset => {
      const drift = (Math.random() - 0.5) * 6;
      const o = this.audioCtx.createOscillator();
      o.type = this.getWaveformFromPreset();
      o.detune.value = offset + drift;
      o.frequency.value = params.freq * Math.pow(2, (offset + drift)/1200);
      o.connect(gainNode);
      o.start(startTime);
      o.stop(startTime + params.attack + params.release + 0.1);
      o.onended = () => { try { o.disconnect(); } catch {} };
      this.polyNotes.push({osc: o, endTime: startTime + params.attack + params.release + 0.1});
    });

    gainNode.connect(panNode);
    panNode.connect(filterNode);
    filterNode.connect(shaper);
    shaper.connect(delayNode);
    delayNode.connect(feedbackNode);
    feedbackNode.connect(delayNode);
    delayNode.connect(reverbSend);
    reverbSend.connect(this.reverbNode);
    gainNode.connect(this.analyser);
  }
  openDrawer() {
    this.drawer.classList.remove('closed');
    this.drawer.classList.add('open');
    this.openDrawerBtn.style.display = 'none';
  }
  closeDrawer() {
    this.drawer.classList.remove('open');
    this.drawer.classList.add('closed');
    this.openDrawerBtn.style.display = '';
  }
}

// App entry
document.addEventListener('DOMContentLoaded', () => new PlantasiaApp());
