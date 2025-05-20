/**
 * Plantastica v2 - Moogified: Vintage Sound, Responsive, Distinct Visuals
 * All enhancements: fat detuned analog drift, ladder filter, drive, ADSR, LFO, velocity, aftertouch (mod wheel for vibrato), preset visuals.
 * This is a complete file: copy/paste to src/js/app.js
 */
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
    this.midiNotes = {}; // key: midi note number, value: {osc, ...}
    this.audioCtx = null;
    this.analyser = null;
    this.masterGain = null;
    this.reverbNode = null;
    this.bufferLength = null;
    this.dataArray = null;
    this.bpmTimer = null;
    this.animationFrameId = null;
    this.resizeTimeout = null;

    this.modWheelDepth = 0; // for aftertouch/modwheel vibrato

    // UI
    this.openDrawerBtn.addEventListener('click', () => this.openDrawer());
    this.closeDrawerBtn.addEventListener('click', () => this.closeDrawer());
    this.presetSelect.addEventListener('change', () => this.onPresetChange());
    this.waveformSelect.addEventListener('change', () => this.userWaveform = this.waveformSelect.value);
    this.bpmSlider.addEventListener('input', () => this.onBpmChange());
    this.lfoRateSlider.addEventListener('input', () => this.updateLfoDisplay());
    this.lfoAmtSlider.addEventListener('input', () => this.updateLfoDisplay());
    this.playBtn.addEventListener('click', () => {
      this.initAudio();
      this.audioCtx.resume();
      this.start();
    });
    this.stopBtn.addEventListener('click', () => this.stop());
    this.toggleDisplayBtn.addEventListener('click', () => this.toggleDisplay());
    this.volumeSlider.addEventListener('input', () => this.setVolume());
    window.addEventListener('resize', () => this.debouncedResize());

    // Debounce slider UI
    ["bpmSlider", "lfoRateSlider", "lfoAmtSlider", "filterSlider", "delaySlider", "echoSlider", "volumeSlider"].forEach(id => {
      let t;
      this.$(id).addEventListener('input', e => {
        clearTimeout(t);
        t = setTimeout(() => this.onPresetChange(), 50);
      });
    });

    // Update LFO values UI
    this.updateLfoDisplay();
    this.setCanvasSize();
    this.onPresetChange();
    setInterval(() => this.updateDisplay(), 250);

    // MIDI Controls
    this.midiChannel = -1;
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

    // MIDI initialization
    this.midiAccess = null;
    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess({ sysex: false }).then(
        (midiAccess) => this.onMIDISuccess(midiAccess),
        () => this.onMIDIFailure()
      );
    } else {
      console.warn("Web MIDI API not supported in this browser.");
    }
  }

  // MIDI
  onMIDISuccess(midiAccess) {
    this.midiAccess = midiAccess;
    for (let input of midiAccess.inputs.values()) {
      input.onmidimessage = (msg) => this.handleMIDIMessage(msg);
    }
    midiAccess.onstatechange = () => {
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

    // Channel filter: -1 means all, otherwise match to this.midiChannel
    if (this.midiChannel !== -1 && channel !== this.midiChannel) return;

    if (status === 0x90 && velocity > 0) {
      this.noteOnMIDI(note, velocity, channel);
    } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
      this.noteOffMIDI(note, channel);
    } else if (status === 0xE0) {
      // Pitch bend (can be implemented for extra Mooginess)
    } else if (data[0] === 0xB0 + channel && data[1] === 1) {
      // Mod wheel (CC 1) for vibrato/aftertouch
      this.modWheelDepth = velocity / 127;
    }
  }
  noteOnMIDI(note, velocity, channel) {
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    const velGain = 0.1 + (velocity / 127) * 0.9;
    if (!this.audioCtx) this.initAudio();
    this.audioCtx.resume();

    // Velocity mapped to filter cutoff for expressiveness
    const params = { ...this.getPresetParams() };
    params.freq = freq;
    params.waveform = this.getWaveformFromPreset();
    params.delay = parseFloat(this.delaySlider.value);
    params.echo = parseFloat(this.echoSlider.value);
    params.filterFreq = parseFloat(this.filterSlider.value) + velocity * 6; // velocity to cutoff
    params.resonance = params.resonance !== undefined ? params.resonance : 0.7;
    params.drive = params.drive !== undefined ? params.drive : 0.7;
    params.attack = params.attack !== undefined ? params.attack : 0.01;
    params.decay = params.decay !== undefined ? params.decay : 0.07;
    params.sustain = params.sustain !== undefined ? params.sustain : 0.6;
    params.release = params.release !== undefined ? params.release : 0.2;
    params.velocityGain = velGain;
    params.midiNote = note;

    this.midiNotes[note] = this.playInstrument(params, undefined, true);
    this.startAnimation();
  }
  noteOffMIDI(note, channel) {
    if (this.midiNotes[note]) {
      const {oscillators, gainNode, lfo, lfoGain, envTimeout} = this.midiNotes[note];
      if (gainNode) {
        // Release phase for envelope
        gainNode.gain.cancelScheduledValues(this.audioCtx.currentTime);
        gainNode.gain.setValueAtTime(gainNode.gain.value, this.audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + 0.19); // fast release
      }
      if (oscillators) {
        setTimeout(() => {
          for (const osc of oscillators) {
            try { osc.stop(); } catch {}
            try { osc.disconnect(); } catch {}
          }
        }, 200);
      }
      if (lfo) {
        try { lfo.stop(); } catch {}
        try { lfo.disconnect(); } catch {}
      }
      if (lfoGain) {
        try { lfoGain.disconnect(); } catch {}
      }
      if (envTimeout) clearTimeout(envTimeout);
      delete this.midiNotes[note];
    }
    if (Object.keys(this.midiNotes).length === 0 && this.stopped) {
      this.stopAnimation();
    }
  }

  // --- Synthesis and app logic below ---
  getPresetOrder() {
    return [
      'plants', 'mold', 'bacteria', 'mushrooms', 'harmony',
      'plantasiaClassic', 'greenhouse', 'cosmicdew', 'daybeam', 'spiralback',
      'rockflora', 'mycomurk', 'microburst', 'fibonaccishift'
    ];
  }

  // --- PRESET SETTINGS: add color, resonance, drive, ADSR, visual style ---
  getPresetSettings() {
    return {
      plants: {
        scale: [174, 220, 285, 396, 528, 660],
        color: "#20ff40", waveform: "triangle", visual: "classic",
        attack: 0.12, decay: 0.18, sustain: 0.7, release: 0.8,
        detuneCents: [-7, 0, 7], fatOsc: 3, pan: 0,
        filterType: "ladder", filterFreq: 1800, resonance: 0.55, drive: 0.6,
        visualStyle: { line: true, glow: true }
      },
      mold: {
        scale: [432, 639, 741, 852],
        color: "#b08fff", waveform: "sawtooth", visual: "blobs",
        attack: 0.04, decay: 0.17, sustain: 0.3, release: 0.2,
        detuneCents: [-12, 0, 12], fatOsc: 4, pan: () => Math.random()*2-1,
        filterType: "ladder", filterFreq: 1300, resonance: 0.72, drive: 0.8,
        visualStyle: { blobs: true }
      },
      bacteria: {
        scale: [528, 554, 585, 728, 311],
        color: "#ff6f3c", waveform: "square", visual: "dots",
        attack: 0.01, decay: 0.12, sustain: 0.4, release: 0.07,
        detuneCents: [-16, 0, 16], fatOsc: 2, pan: () => Math.random()*2-1,
        filterType: "ladder", filterFreq: 2100, resonance: 0.8, drive: 0.55,
        visualStyle: { dots: true }
      },
      mushrooms: {
        scale: [417, 444, 528, 639, 392],
        color: "#ffd700", waveform: "sine", visual: "shimmer",
        attack: 0.11, decay: 0.25, sustain: 0.4, release: 1.1,
        detuneCents: [-6, 0, 6], fatOsc: 2, pan: () => Math.sin(performance.now()/950),
        filterType: "ladder", filterFreq: 1200, resonance: 0.5, drive: 0.5,
        visualStyle: { shimmer: true }
      },
      harmony: {
        scale: [261, 329, 392, 466, 528, 639],
        color: "#00ffff", waveform: "triangle", visual: "bars",
        attack: 0.19, decay: 0.22, sustain: 0.65, release: 1.1,
        detuneCents: [-8, 0, 8], fatOsc: 3, pan: 0,
        filterType: "ladder", filterFreq: 1900, resonance: 0.43, drive: 0.6,
        visualStyle: { bars: true }
      },
      plantasiaClassic: {
        scale: [174, 220, 261.63, 329.63, 392, 523.25],
        color: "#8fd694", waveform: "triangle", visual: "classic",
        attack: 0.23, decay: 0.34, sustain: 0.5, release: 2.1,
        detuneCents: [-7, 0, 7], fatOsc: 2, pan: 0,
        filterType: "ladder", filterFreq: 1400, resonance: 0.7, drive: 0.5,
        visualStyle: { line: true }
      },
      greenhouse: {
        scale: [432, 512, 538, 576, 648],
        color: "#56f28c", waveform: "sine", visual: "wobble",
        attack: 0.23, decay: 0.16, sustain: 0.8, release: 1.3,
        detuneCents: [-8, -2, 10, 13], fatOsc: 2, pan: 0,
        filterType: "ladder", filterFreq: 900, resonance: 0.43, drive: 0.7,
        visualStyle: { wobble: true }
      },
      cosmicdew: {
        scale: [528, 1056, 792, 1584, 2112],
        color: "#a5e6f4", waveform: "triangle", visual: "star",
        attack: 0.12, decay: 0.18, sustain: 0.4, release: 1.2,
        detuneCents: [-24, 0, 11], fatOsc: 3, pan: () => Math.sin(performance.now()/370),
        filterType: "ladder", filterFreq: 1000, resonance: 0.75, drive: 0.5,
        visualStyle: { star: true }
      },
      daybeam: {
        scale: [440, 660, 880, 990, 1320],
        color: "#ffe56c", waveform: "sawtooth", visual: "shimmer",
        attack: 0.09, decay: 0.09, sustain: 0.2, release: 0.18,
        detuneCents: [-4, 0, 4], fatOsc: 2, pan: () => Math.random()*2-1,
        filterType: "ladder", filterFreq: 1600, resonance: 0.6, drive: 0.7,
        visualStyle: { shimmer: true }
      },
      spiralback: {
        scale: [321.9, 521.3, 843.2, 987, 1598.3],
        color: "#ffb44f", waveform: "triangle", visual: "spiral",
        attack: 0.21, decay: 0.15, sustain: 0.5, release: 0.89,
        detuneCents: [-13, 0, 8, 21], fatOsc: 3, pan: 0,
        filterType: "ladder", filterFreq: 987, resonance: 0.65, drive: 0.44,
        visualStyle: { spiral: true }
      },
      rockflora: {
        scale: [440, 660, 880, 1350, 1760],
        color: "#9df0ff", waveform: "square", visual: "bars",
        attack: 0.03, decay: 0.12, sustain: 0.7, release: 0.13,
        detuneCents: [-8, 0, 8], fatOsc: 2, pan: () => Math.random()*2-1,
        filterType: "ladder", filterFreq: 1350, resonance: 0.85, drive: 0.9,
        visualStyle: { bars: true }
      },
      mycomurk: {
        scale: [198, 259, 396, 420, 792],
        color: "#4e3e57", waveform: "sawtooth", visual: "blobs",
        attack: 0.22, decay: 0.25, sustain: 0.7, release: 2.1,
        detuneCents: [-24, 0, 12, 19], fatOsc: 4, pan: () => Math.random()*2-1,
        filterType: "ladder", filterFreq: 420, resonance: 0.65, drive: 0.7,
        visualStyle: { blobs: true }
      },
      microburst: {
        scale: [333, 666, 999, 555, 777],
        color: "#ff9e57", waveform: "triangle", visual: "dots",
        attack: 0.01, decay: 0.03, sustain: 0.2, release: 0.07,
        detuneCents: [-18, 0, 4, 13], fatOsc: 2, pan: () => Math.random()*2-1,
        filterType: "ladder", filterFreq: 1300, resonance: 0.4, drive: 0.6,
        visualStyle: { dots: true }
      },
      fibonaccishift: {
        scale: [233, 377, 610, 987, 1597],
        color: "#aab6ff", waveform: "triangle", visual: "star",
        attack: 0.07, decay: 0.09, sustain: 0.5, release: 0.3,
        detuneCents: [-21, 0, 5, 13], fatOsc: 2, pan: 0,
        filterType: "ladder", filterFreq: 987, resonance: 0.6, drive: 0.6,
        visualStyle: { star: true }
      }
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
      "DECAY      : " + p.decay + "s\n" +
      "SUSTAIN    : " + p.sustain + "\n" +
      "RELEASE    : " + p.release + "s\n" +
      "DETUNE     : [" + p.detuneCents.join(", ") + "]\n" +
      "FILTER     : " + p.filterType + " " + this.filterSlider.value + "Hz\n" +
      "RESONANCE  : " + (p.resonance || 0.7) + "\n" +
      "DRIVE      : " + (p.drive || 0.7) + "\n" +
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

    // Fade trails
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.trailFrames.length > 12) this.trailFrames.shift();
    this.trailFrames.push([...this.dataArray]);

    // Distinct visual styles
    const p = this.getPresetParams();
    const grad = this.ctx.createLinearGradient(0, 0, this.canvas.width, 0);
    grad.addColorStop(0, p.color);
    grad.addColorStop(1, "#000000");
    const style = p.visualStyle;

    for (let t = 0; t < this.trailFrames.length; t++) {
      const data = this.trailFrames[t];
      const slice = this.canvas.width / data.length;
      this.ctx.save();
      // Classic line
      if (style.line || style.classic) {
        this.ctx.beginPath();
        let x = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128.0;
          const y = (v * this.canvas.height / 2.0 * 0.9) + this.canvas.height / 2;
          if (i === 0) this.ctx.moveTo(x, y);
          else this.ctx.lineTo(x, y);
          x += slice;
        }
        const alpha = 0.1 + (t / this.trailFrames.length) * 0.18;
        this.ctx.strokeStyle = grad;
        this.ctx.globalAlpha = alpha;
        this.ctx.shadowBlur = 12;
        this.ctx.shadowColor = p.color;
        this.ctx.lineWidth = 2 + t * 0.7;
        this.ctx.stroke();
      }
      // Blobs
      if (style.blobs) {
        const alpha = 0.13 + (t / this.trailFrames.length) * 0.18;
        for (let i = 0; i < data.length; i += 16) {
          const x = i * slice;
          const v = (data[i] - 128) / 128.0;
          const y = (v * this.canvas.height / 2.0 * 0.9) + this.canvas.height / 2;
          this.ctx.beginPath();
          this.ctx.arc(x, y, 8 + Math.abs(v) * 22, 0, 2 * Math.PI);
          this.ctx.fillStyle = grad;
          this.ctx.globalAlpha = alpha * 0.6;
          this.ctx.shadowBlur = 10;
          this.ctx.shadowColor = p.color;
          this.ctx.fill();
        }
      }
      // Dots
      if (style.dots) {
        const alpha = 0.13 + (t / this.trailFrames.length) * 0.2;
        for (let i = 0; i < data.length; i += 32) {
          const x = i * slice;
          const v = (data[i] - 128) / 128.0;
          const y = (v * this.canvas.height / 2.0 * 0.9) + this.canvas.height / 2;
          this.ctx.beginPath();
          this.ctx.arc(x, y, 3 + Math.abs(v) * 7, 0, 2 * Math.PI);
          this.ctx.fillStyle = grad;
          this.ctx.globalAlpha = alpha;
          this.ctx.shadowBlur = 0;
          this.ctx.fill();
        }
      }
      // Bars
      if (style.bars) {
        const alpha = 0.12 + (t / this.trailFrames.length) * 0.15;
        for (let i = 0; i < data.length; i += 24) {
          const x = i * slice;
          const v = (data[i] - 128) / 128.0;
          const y = (v * this.canvas.height / 2.0 * 0.9) + this.canvas.height / 2;
          this.ctx.beginPath();
          this.ctx.rect(x, this.canvas.height / 2, 9, y - this.canvas.height / 2);
          this.ctx.fillStyle = grad;
          this.ctx.globalAlpha = alpha;
          this.ctx.shadowBlur = 0;
          this.ctx.fill();
        }
      }
      // Star
      if (style.star) {
        const alpha = 0.09 + (t / this.trailFrames.length) * 0.13;
        for (let i = 0; i < data.length; i += 24) {
          const x = i * slice;
          const v = (data[i] - 128) / 128.0;
          const y = (v * this.canvas.height / 2.0 * 0.9) + this.canvas.height / 2;
          this.ctx.save();
          this.ctx.translate(x, y);
          this.ctx.rotate(Math.PI/5 * (v+1));
          this.ctx.globalAlpha = alpha;
          this.ctx.strokeStyle = p.color;
          this.ctx.lineWidth = 2;
          this.ctx.beginPath();
          for (let j = 0; j < 5; j++) {
            this.ctx.lineTo(0, 6 + Math.abs(v) * 12);
            this.ctx.rotate(Math.PI / 2.5);
          }
          this.ctx.closePath();
          this.ctx.stroke();
          this.ctx.restore();
        }
      }
      // Spiral
      if (style.spiral) {
        const alpha = 0.13 + (t / this.trailFrames.length) * 0.17;
        for (let i = 0; i < data.length; i += 24) {
          const x = i * slice;
          const v = (data[i] - 128) / 128.0;
          const y = (v * this.canvas.height / 2.0 * 0.9) + this.canvas.height / 2;
          this.ctx.save();
          this.ctx.translate(x, y);
          this.ctx.globalAlpha = alpha;
          this.ctx.strokeStyle = p.color;
          this.ctx.lineWidth = 1.5;
          this.ctx.beginPath();
          for (let a = 0; a < 2 * Math.PI; a += 0.3) {
            const r = 5 + Math.abs(v) * 13 + a * 2;
            this.ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          this.ctx.stroke();
          this.ctx.restore();
        }
      }
      // Shimmer
      if (style.shimmer) {
        const alpha = 0.14 + (t / this.trailFrames.length) * 0.1;
        for (let i = 0; i < data.length; i += 18) {
          const x = i * slice;
          const v = (data[i] - 128) / 128.0;
          const y = (v * this.canvas.height / 2.0 * 0.9) + this.canvas.height / 2 + Math.sin(i + performance.now()/150)*9;
          this.ctx.beginPath();
          this.ctx.arc(x, y, 5 + Math.abs(v)*3, 0, 2 * Math.PI);
          this.ctx.fillStyle = grad;
          this.ctx.globalAlpha = alpha * 0.7;
          this.ctx.shadowBlur = 5;
          this.ctx.shadowColor = p.color;
          this.ctx.fill();
        }
      }
      // Wobble
      if (style.wobble) {
        const alpha = 0.14 + (t / this.trailFrames.length) * 0.11;
        this.ctx.beginPath();
        let x = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128.0;
          const y = (v * this.canvas.height / 2.0 * 0.9) +
            this.canvas.height / 2 + Math.sin(i + performance.now()/100)*6;
          if (i === 0) this.ctx.moveTo(x, y);
          else this.ctx.lineTo(x, y);
          x += slice;
        }
        this.ctx.strokeStyle = grad;
        this.ctx.globalAlpha = alpha;
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = p.color;
        this.ctx.lineWidth = 2.5;
        this.ctx.stroke();
      }
      this.ctx.restore();
    }
    // restore default
    this.ctx.globalAlpha = 1;
    this.ctx.shadowBlur = 0;
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

    // Master reverb (subtle, not Moog but nice)
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
    this.audioCtx.resume();
    this.stopped = false;
    this.currentWaveColor = this.getColorFromPreset();
    this.scheduleNotes(this.getScaleFromPreset());
    this.startAnimation();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.bpmTimer);

    // Stop sequencer notes
    for (const note of this.polyNotes) {
      if (note.osc) {
        try { note.osc.stop(); } catch {}
        try { note.osc.disconnect(); } catch {}
      }
    }
    this.polyNotes = [];

    // Stop any active MIDI notes
    if (this.midiNotes) {
      Object.keys(this.midiNotes).forEach(note => this.noteOffMIDI(Number(note)));
    }

    // Always stop the animation and clear the waveform instantly
    this.stopAnimation();
    this.trailFrames = [];
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
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
    this.initAudio();
    this.audioCtx.resume();
    const params = { ...this.getPresetParams() };
    params.freq = freq;
    params.waveform = this.getWaveformFromPreset();
    params.delay = parseFloat(this.delaySlider.value);
    params.echo = parseFloat(this.echoSlider.value);
    params.filterFreq = parseFloat(this.filterSlider.value);
    this.playInstrument(params);
  }

  /**
   * Moog-style synth: fat detuned oscillators, ladder filter, drive, ADSR, LFO, velocity
   * @param {*} params - all synth params
   * @param {*} when
   * @param {*} forMIDI
   * @returns
   */
  playInstrument(params, when, forMIDI = false) {
    const now = this.audioCtx.currentTime;
    const startTime = when !== undefined ? when : now;

    // Clean up finished notes (for sequencer only)
    if (!forMIDI) {
      this.polyNotes = this.polyNotes.filter(n => n.endTime > now);
      if (this.polyNotes.length > 8) {
        const oldNote = this.polyNotes.shift();
        if (oldNote.osc) {
          try { oldNote.osc.stop(); } catch {}
          try { oldNote.osc.disconnect(); } catch {}
        }
      }
    }

    // Envelope (ADSR)
    const attack = params.attack || 0.03;
    const decay = params.decay || 0.1;
    const sustain = params.sustain || 0.5;
    const release = params.release || 0.19;

    // Gain envelope
    const gainNode = this.audioCtx.createGain();
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.3 * (params.velocityGain || 1), startTime + attack);
    gainNode.gain.linearRampToValueAtTime((0.3 * sustain) * (params.velocityGain || 1), startTime + attack + decay);
    // Release handled on noteOff

    // Pan
    const panNode = this.audioCtx.createStereoPanner();
    panNode.pan.value = typeof params.pan === "function" ? params.pan() : (params.pan || 0);

    // Ladder filter: cascade of 4 biquads, with feedback for resonance
    let ladderNodes = [];
    let input = gainNode;
    let lastNode = input;
    const resonance = params.resonance !== undefined ? params.resonance : 0.7;
    const cutoff = params.filterFreq || 1500;
    let prevBiquad = null;
    for (let i = 0; i < 4; i++) {
      const biquad = this.audioCtx.createBiquadFilter();
      biquad.type = "lowpass";
      biquad.frequency.value = cutoff;
      biquad.Q.value = resonance * 10;
      lastNode.connect(biquad);
      lastNode = biquad;
      ladderNodes.push(biquad);
      if (prevBiquad) {
        // Feedback for resonance
        prevBiquad.connect(biquad);
      }
      prevBiquad = biquad;
    }
    // Drive (waveshaper)
    const driveNode = this.audioCtx.createWaveShaper();
    driveNode.curve = makeDriveCurve(params.drive || 0.7);
    ladderNodes[ladderNodes.length-1].connect(driveNode);

    // Shaper for Moog warmth (soft tanh clipping, more aggressive with higher drive)
    function makeDriveCurve(amount) {
      const k = typeof amount === 'number' ? amount * 70 : 70;
      const n_samples = 44100, curve = new Float32Array(n_samples);
      const deg = Math.PI / 180;
      for (let i = 0; i < n_samples; ++i) {
        const x = (i * 2) / n_samples - 1;
        curve[i] = Math.tanh(k * x) * 0.9 + x * 0.1;
      }
      return curve;
    }

    // Delay/Echo/Reverb
    const delayNode = this.audioCtx.createDelay();
    delayNode.delayTime.value = params.delay || 0.2;
    const feedbackNode = this.audioCtx.createGain();
    feedbackNode.gain.value = params.echo || 0.18;
    const reverbSend = this.audioCtx.createDelay();
    reverbSend.delayTime.value = params.reverb || 0.3;

    // LFO MODS
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
      // LFO vibrato depth modulated by mod wheel (aftertouch)
      let modDepth = lfoAmt + (this.modWheelDepth || 0) * 9;
      lfoGain.gain.value = modDepth;

      if (lfoDest === "filter") {
        lfo.connect(lfoGain).connect(ladderNodes[0].frequency);
      } else if (lfoDest === "pan") {
        lfo.connect(lfoGain).connect(panNode.pan);
      } else if (lfoDest === "pitch") {
        // Attach to all VCOs below
      }
      lfo.start(startTime);
      lfo.stop(startTime + attack + decay + release + 4);
    }

    // FAAAAAT OSCILLATORS
    let oscillators = [];
    const baseFreq = params.freq;
    const detuneCents = params.detuneCents || [-6, 0, 6];
    const fatOscCount = params.fatOsc || detuneCents.length || 2;
    // Drift per note for analog feel
    for (let i = 0; i < fatOscCount; i++) {
      const drift = (Math.random() - 0.5) * 9; // up to ~9 cents drift
      const osc = this.audioCtx.createOscillator();
      osc.type = params.waveform;
      // Detune for fatness
      const detune = detuneCents[i % detuneCents.length] + drift;
      osc.detune.value = detune;
      let oscFreq = baseFreq * Math.pow(2, detune / 1200);
      osc.frequency.setValueAtTime(oscFreq, startTime);

      // LFO vibrato (pitch modulation)
      if (lfoAmt > 0 && lfoDest === "pitch" && lfo && lfoGain) {
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
      }

      osc.connect(gainNode);
      osc.start(startTime);
      osc.stop(startTime + attack + decay + release + 0.5);
      osc.onended = () => { try { osc.disconnect(); } catch {} };
      if (!forMIDI) this.polyNotes.push({osc: osc, endTime: startTime + attack + decay + release + 0.5});
      oscillators.push(osc);

      // Drift the pitch a little over time (analog feel)
      let driftAmount = (Math.random()-0.5)*2;
      osc.frequency.linearRampToValueAtTime(oscFreq + driftAmount, startTime + attack + decay + sustain + 0.5);
    }

    // Connect chain: gain -> pan -> ladder -> drive -> delay -> feedback -> reverb -> master
    gainNode.connect(panNode);
    panNode.connect(ladderNodes[0]);
    driveNode.connect(delayNode);
    delayNode.connect(feedbackNode);
    feedbackNode.connect(delayNode);
    delayNode.connect(reverbSend);
    reverbSend.connect(this.reverbNode);
    driveNode.connect(this.analyser);

    // Envelope release for sequencer notes
    let envTimeout;
    if (!forMIDI) {
      envTimeout = setTimeout(() => {
        gainNode.gain.linearRampToValueAtTime(0.0, this.audioCtx.currentTime + release);
      }, (attack + decay + 0.4) * 1000);
    }

    // Return all components for MIDI note-off logic
    if (forMIDI) {
      return {oscillators, gainNode, lfo, lfoGain, envTimeout};
    }
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
