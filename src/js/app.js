// plantasia.js
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
    this.midiNotes = {};
    this.audioCtx = null;
    this.analyser = null;
    this.masterGain = null;
    this.reverbNode = null;
    this.bufferLength = null;
    this.dataArray = null;
    this.bpmTimer = null;
    this.animationFrameId = null;
    this.resizeTimeout = null;

    // Universal MIDI CC mapping
    this.ccToSliderOrder = [
      'filterSlider', 'delaySlider', 'echoSlider', 'volumeSlider',
      'lfoRateSlider', 'lfoAmtSlider', 'bpmSlider', 'freqSlider'
    ];
    this.ccToSliderMap = {};

    // UI events
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

    // Initial setup
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
    });
    this.toggleMidiInBtn.addEventListener('click', () => {
      this.midiInEnabled = !this.midiInEnabled;
      this.toggleMidiInBtn.textContent = "midi" + (this.midiInEnabled ? "" : " off");
    });

    // MIDI initialization
    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess({ sysex: false }).then(
        midiAccess => this.onMIDISuccess(midiAccess),
        () => this.onMIDIFailure()
      );
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
  }
  onMIDIFailure() {}
  handleMIDIMessage(event) {
    if (!this.midiInEnabled) return;
    const [statusByte, data1, data2] = event.data;
    const status = statusByte & 0xf0, channel = statusByte & 0x0f;
    if (status === 0xB0) {
      const cc = data1, value = data2;
      let sliderId = this.ccToSliderMap[cc];
      if (!sliderId) {
        for (let candidate of this.ccToSliderOrder) {
          if (!Object.values(this.ccToSliderMap).includes(candidate)) {
            this.ccToSliderMap[cc] = candidate;
            sliderId = candidate;
            break;
          }
        }
      }
      if (sliderId) {
        const slider = this.$(sliderId);
        const min = Number(slider.min), max = Number(slider.max);
        let newValue = min + (value/127)*(max-min);
        if (sliderId==='bpmSlider') newValue = Math.round(newValue);
        slider.value = newValue;
        slider.dispatchEvent(new Event('input'));
      }
      return;
    }
    if (this.midiChannel!==-1 && channel!==this.midiChannel) return;
    if (status===0x90 && data2>0) this.noteOnMIDI(data1,data2,channel);
    else if (status===0x80 || (status===0x90 && data2===0)) this.noteOffMIDI(data1,channel);
  }
  noteOnMIDI() { /* same as before */ }
  noteOffMIDI() { /* same as before */ }

  // --- Display & controls ---
  updateLfoDisplay() {
    this.lfoRateValue.textContent = this.lfoRateSlider.value;
    this.lfoAmtValue.textContent = this.lfoAmtSlider.value;
  }
  setVolume() {
    if (this.masterGain) this.masterGain.gain.value = parseFloat(this.volumeSlider.value)/100;
  }
  updateDisplay() { /* same as before */ }
  toggleDisplay() {
    this.infoDisplay.classList.toggle('hidden');
  }

  // --- Canvas resizing ---
  setCanvasSize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }
  debouncedResize() {
    clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(() => this.setCanvasSize(),160);
  }

  // --- Animation loop ---
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
    // Clear canvas each frame
    this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);

    this.animationFrameId = requestAnimationFrame(() => this.animate());
    const midiActive = Object.keys(this.midiNotes).length>0;
    if (!this.stopped || midiActive) {
      this.analyser.getByteTimeDomainData(this.dataArray);
      if (this.trailFrames.length>8) this.trailFrames.shift();
      this.trailFrames.push([...this.dataArray]);
    } else {
      if (this.trailFrames.length>0) this.trailFrames.shift();
    }
    // drawing code...
    if (this.stopped && this.trailFrames.length===0) this.stopAnimation();
  }

  initAudio() { /* same as before */ }
  start() {
    this.initAudio();
    this.stopped = false;
    this.infoDisplay.classList.remove('hidden');
    this.currentWaveColor = this.getColorFromPreset();
    this.scheduleNotes(this.getScaleFromPreset());
    this.startAnimation();
  }
  stop() {
    this.stopped = true;
    if (this.bpmTimer) clearInterval(this.bpmTimer);
    this.infoDisplay.classList.add('hidden');
  }
  onBpmChange() { /* same as before */ }
  onPresetChange() { /* same as before */ }
  scheduleNotes() { /* same as before */ }
  playTone() { /* same as before */ }
  playInstrument() { /* same as before */ }
  openDrawer() { /* same as before */ }
  closeDrawer() { /* same as before */ }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => new PlantasiaApp());
