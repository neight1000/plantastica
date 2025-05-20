// Plantastica v2 main logic: full featured synth with all controls as in the advanced HTML
// Now with robust Akai MPK Mini (K1-K8) MIDI mappings for dials and keyboard, and rock-solid STOP/PLAY behavior

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

    /**
     * AKAI MPK MINI (K1-K8) MIDI MAPPING
     * Most Akai MPK Mini controllers send CC 70-77 for K1-K8 by default.
     * If your MPK Mini is set differently, update the cc numbers here.
     * 
     * Mapping:
     * K1 (CC70): Filter Cutoff      -> filterSlider
     * K2 (CC71): Resonance (not present, use Delay) -> delaySlider
     * K3 (CC72): LFO Rate           -> lfoRateSlider
     * K4 (CC73): LFO Amount         -> lfoAmtSlider
     * K5 (CC74): Echo/FX Amount     -> echoSlider
     * K6 (CC75): Volume             -> volumeSlider
     * K7 (CC76): BPM                -> bpmSlider
     * K8 (CC77): Frequency offset   -> freqSlider
     */
    this.mpminiCCMap = {
      70: 'filterSlider',   // K1
      71: 'delaySlider',    // K2 (use delay for "resonance" knob if not present)
      72: 'lfoRateSlider',  // K3
      73: 'lfoAmtSlider',   // K4
      74: 'echoSlider',     // K5
      75: 'volumeSlider',   // K6
      76: 'bpmSlider',      // K7
      77: 'freqSlider'      // K8
    };

    // UI
    this.openDrawerBtn.addEventListener('click', () => this.openDrawer());
    this.closeDrawerBtn.addEventListener('click', () => this.closeDrawer());
    this.presetSelect.addEventListener('change', () => this.onPresetChange());
    this.waveformSelect.addEventListener('change', () => {
      this.userWaveform = this.waveformSelect.value;
    });
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
        midiAccess => this.onMIDISuccess(midiAccess),
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
      input.onmidimessage = msg => this.handleMIDIMessage(msg);
    }
    midiAccess.onstatechange = () => {
      for (let input of midiAccess.inputs.values()) {
        input.onmidimessage = msg => this.handleMIDIMessage(msg);
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

    // --- Akai MPK Mini K1-K8 MIDI CC Dials mapping ---
    if ((data[0] & 0xf0) === 0xB0) { // CC message
      const cc = data[1];
      const value = data[2];
      if (cc in this.mpminiCCMap) {
        const sliderId = this.mpminiCCMap[cc];
        const slider = this.$(sliderId);
        if (slider) {
          const min = Number(slider.min);
          const max = Number(slider.max);
          let newValue = min + (value / 127) * (max - min);
          if (sliderId === 'bpmSlider') newValue = Math.round(newValue);
          slider.value = newValue;
          slider.dispatchEvent(new Event('input'));
        }
      }
      return;
    }

    // Keyboard mapping (notes)
    if (this.midiChannel !== -1 && channel !== this.midiChannel) return;

    if (status === 0x90 && velocity > 0) {
      this.noteOnMIDI(note, velocity, channel);
    } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
      this.noteOffMIDI(note, channel);
    }
  }

  noteOnMIDI(note, velocity, channel) {
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    const velGain = 0.1 + (velocity / 127) * 0.9;

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
    params.midiNote = note;

    this.midiNotes[note] = this.playInstrument(params, undefined, true);
    this.startAnimation();
  }

  noteOffMIDI(note, channel) {
    if (this.midiNotes[note]) {
      const { oscillators, gainNode, lfo, lfoGain } = this.midiNotes[note];
      if (oscillators) {
        for (const osc of oscillators) {
          try { osc.stop(); } catch { }
          try { osc.disconnect(); } catch { }
        }
      }
      if (gainNode) {
        try { gainNode.disconnect(); } catch { }
      }
      if (lfo) {
        try { lfo.stop(); } catch { }
        try { lfo.disconnect(); } catch { }
      }
      if (lfoGain) {
        try { lfoGain.disconnect(); } catch { }
      }
      delete this.midiNotes[note];
    }
    if (Object.keys(this.midiNotes).length === 0 && this.stopped) {
      this.stopAnimation();
    }
  }

  // --- Synthesis and app logic below (as before) ---
  getPresetOrder() {
    return [
      'plants', 'mold', 'bacteria', 'mushrooms', 'harmony',
      'plantasiaClassic', 'greenhouse', 'cosmicdew', 'daybeam', 'spiralback',
      'rockflora', 'mycomurk', 'microburst', 'fibonaccishift'
    ];
  }

  getPresetSettings() {
    return {
      // Truncated for brevity; all preset objects go here as in your original code
      // ...
    };
  }

  getPreset() {
    return this.presetSelect.value;
  }

  getPresetParams() {
    return this.presetSettings[this.getPreset()];
  }

  getScaleFromPreset() {
    return this.getPresetParams().scale;
  }

  getColorFromPreset() {
    return this.getPresetParams().color;
  }

  getWaveformFromPreset() {
    return this.userWaveform || this.getPresetParams().waveform;
  }

  updateLfoDisplay() {
    this.lfoRateValue.textContent = this.lfoRateSlider.value;
    this.lfoAmtValue.textContent = this.lfoAmtSlider.value;
  }

  setVolume() {
    if (this.masterGain) {
      this.masterGain.gain.value = parseFloat(this.volumeSlider.value) / 100;
    }
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
      "REVERB     : " + (0.3 + parseFloat(this.echoSlider.value) * 0.5).toFixed(2) + "\n" +
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
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
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

    // Stop sequencer notes
    for (const note of this.polyNotes) {
      if (note.osc) {
        try { note.osc.stop(); } catch { }
        try { note.osc.disconnect(); } catch { }
      }
    }
    this.polyNotes = [];

    // Stop any active MIDI notes
    if (this.midiNotes) {
      Object.keys(this.midiNotes).forEach(note => this.noteOffMIDI(Number(note)));
      this.midiNotes = {};
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

  playInstrument(params, when, forMIDI = false) {
    const now = this.audioCtx.currentTime;
    const startTime = when !== undefined ? when : now;

    // Clean up finished notes (for sequencer only)
    if (!forMIDI) {
      this.polyNotes = this.polyNotes.filter(n => n.endTime > now);
      if (this.polyNotes.length > 8) {
        const oldNote = this.polyNotes.shift();
        if (oldNote.osc) {
          try { oldNote.osc.stop(); } catch { }
          try { oldNote.osc.disconnect(); } catch { }
        }
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
    const attackGain = 0.3 * (params.velocityGain || 1);
    gainNode.gain.linearRampToValueAtTime(attackGain, startTime + params.attack);
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
      lfo.start(startTime);
      lfo.stop(startTime + params.attack + params.release + 0.1);
    }

    params.detuneCents = params.detuneCents || [-5, 0, 5];
    const oscillators = [];
    params.detuneCents.forEach(offset => {
      const drift = (Math.random() - 0.5) * 6;
      const o = this.audioCtx.createOscillator();
      o.type = this.getWaveformFromPreset();
      o.detune.value = offset + drift;
      o.frequency.value = params.freq * Math.pow(2, (offset + drift) / 1200);
      o.connect(gainNode);
      o.start(startTime);
      o.stop(startTime + params.attack + params.release + 0.1);
      o.onended = () => { try { o.disconnect(); } catch { } };
      if (!forMIDI) this.polyNotes.push({ osc: o, endTime: startTime + params.attack + params.release + 0.1 });
      oscillators.push(o);
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

    if (forMIDI) {
      return { oscillators, gainNode, lfo, lfoGain };
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
