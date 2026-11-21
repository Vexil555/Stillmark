import type { AmbientStyle } from './model';

function normalizeBuffer(samples: Float32Array, peakTarget = 0.86) {
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > max) max = a;
  }
  if (max > 0.0001) {
    const scale = peakTarget / max;
    for (let i = 0; i < samples.length; i++) {
      samples[i] *= scale;
    }
  }
}

class InstrumentAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private chimeGain?: GainNode;
  private ambientBus?: DynamicsCompressorNode;
  private previewTimer?: number;
  private room?: {
    style: AmbientStyle;
    envelope: GainNode;
    sources: AudioScheduledSourceNode[];
    intervals: number[];
  };
  private config = {
    sound: true,
    volume: 40,
    chimeVolume: 100,
    ambient: false,
    ambientStyle: 'brown' as AmbientStyle,
  };

  private open() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.config.volume / 100;
      this.master.connect(this.context.destination);

      this.chimeGain = this.context.createGain();
      this.chimeGain.gain.value = this.config.chimeVolume / 100;
      this.chimeGain.connect(this.master);

      // Gentle compressor on ambientBus makes subtle soundscape details clear at 30-50% volume without clipping at 100%
      this.ambientBus = this.context.createDynamicsCompressor();
      this.ambientBus.threshold.value = -20;
      this.ambientBus.knee.value = 18;
      this.ambientBus.ratio.value = 3.5;
      this.ambientBus.attack.value = 0.015;
      this.ambientBus.release.value = 0.25;
      this.ambientBus.connect(this.master);
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    return this.context;
  }

  configure(sound: boolean, volume: number, ambient: boolean, ambientStyle: AmbientStyle, chimeVolume: number) {
    const styleChanged = this.config.ambientStyle !== ambientStyle;
    this.config = { sound, volume, ambient, ambientStyle, chimeVolume };
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(volume / 100, this.context.currentTime, 0.05);
    }
    if (this.context && this.chimeGain) {
      this.chimeGain.gain.setTargetAtTime(chimeVolume / 100, this.context.currentTime, 0.05);
    }
    if (styleChanged && this.room && !this.previewTimer) {
      this.stopRoom();
      this.ambient(true);
    }
  }

  private voice(
    context: AudioContext,
    frequency: number,
    endFrequency: number,
    delay: number,
    duration: number,
    level: number,
    wave: OscillatorType = 'sine',
    targetGain?: GainNode,
  ) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const start = context.currentTime + delay;
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration * 0.78);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(level, start + Math.min(duration * 0.15, 0.026));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(targetGain ?? this.master!);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
    oscillator.onended = () => envelope.disconnect();
  }

  play(gesture: 'tick' | 'start' | 'rest' | 'finish' | 'pause' | 'resume', force = false) {
    if ((!this.config.sound && !force) || !this.config.volume) return;
    const context = this.open();
    if (gesture === 'tick') {
      this.voice(context, 1180, 310, 0, 0.035, 0.12, 'triangle', this.master);
      this.voice(context, 237, 106, 0.006, 0.051, 0.085, 'sine', this.master);
    } else if (gesture === 'pause') {
      this.voice(context, 420, 290, 0, 0.14, 0.14, 'triangle', this.chimeGain);
    } else if (gesture === 'resume') {
      this.voice(context, 290, 440, 0, 0.16, 0.15, 'triangle', this.chimeGain);
    } else if (gesture === 'start') {
      this.voice(context, 186, 140, 0, 0.25, 0.24, 'triangle', this.chimeGain);
      this.voice(context, 373, 330, 0.062, 0.32, 0.12, 'sine', this.chimeGain);
    } else {
      this.voice(context, 392, 391, 0, 0.5, 0.16, 'sine', this.chimeGain);
      this.voice(
        context,
        gesture === 'rest' ? 330 : 522,
        gesture === 'rest' ? 329 : 521,
        0.19,
        0.7,
        0.14,
        'sine',
        this.chimeGain,
      );
    }
  }

  private spawnRaindrop(context: AudioContext, target: GainNode) {
    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    const f = 1100 + Math.random() * 1900;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.exponentialRampToValueAtTime(f * 0.55, now + 0.048);
    const peak = 0.16 + Math.random() * 0.2;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
    osc.connect(gain).connect(target);
    osc.start(now);
    osc.stop(now + 0.07);
    osc.onended = () => gain.disconnect();
  }

  private spawnCrackle(context: AudioContext, target: GainNode) {
    const now = context.currentTime;
    const sharp = Math.random() < 0.45;
    const dur = sharp ? 0.018 : 0.042;
    const len = Math.floor(context.sampleRate * dur);
    const buf = context.createBuffer(1, len, context.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, sharp ? 4.5 : 2.6);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = context.createBufferSource();
    src.buffer = buf;
    const bp = context.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = sharp ? 2600 + Math.random() * 2400 : 1200 + Math.random() * 1400;
    bp.Q.value = sharp ? 1.8 : 1.1;
    const gain = context.createGain();
    gain.gain.value = sharp ? 0.68 + Math.random() * 0.4 : 0.45 + Math.random() * 0.35;
    src.connect(bp).connect(gain).connect(target);
    src.start(now);
    src.onended = () => gain.disconnect();
  }

  private buildRoom(style: AmbientStyle, fadeSeconds: number) {
    const context = this.open();
    const envelope = context.createGain();
    envelope.gain.value = 0;
    const targetLevel = style === 'rain' ? 0.72 : style === 'hearth' ? 0.76 : 0.7;
    envelope.gain.setTargetAtTime(targetLevel, context.currentTime, fadeSeconds);
    envelope.connect(this.ambientBus!);

    const bufferSeconds = 6;
    const texture = context.createBuffer(1, context.sampleRate * bufferSeconds, context.sampleRate);
    const samples = texture.getChannelData(0);
    const intervals: number[] = [];

    if (style === 'rain') {
      // Bright airy rain patter in 600Hz–5200Hz band + prominent raindrop splashes
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < samples.length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.029;
        b1 = 0.985 * b1 + white * 0.032;
        b2 = 0.950 * b2 + white * 0.048;
        const edge = Math.min(1, i / 11025, (samples.length - i) / 11025);
        samples[i] = (b0 + b1 + b2 + white * 0.22) * edge;
      }
      normalizeBuffer(samples, 0.82);

      const noise = context.createBufferSource();
      noise.buffer = texture;
      noise.loop = true;

      const hp = context.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 620;

      const lp = context.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 4800;
      lp.Q.value = 0.5;

      const bodyGain = context.createGain();
      bodyGain.gain.value = 0.52;

      noise.connect(hp).connect(lp).connect(bodyGain).connect(envelope);
      noise.start();

      const dropTimer = window.setInterval(() => {
        if (Math.random() < 0.85) this.spawnRaindrop(context, envelope);
        if (Math.random() < 0.38) {
          window.setTimeout(() => this.spawnRaindrop(context, envelope), 55);
        }
      }, 130);
      intervals.push(dropTimer);

      this.room = { style, envelope, sources: [noise], intervals };
    } else if (style === 'hearth') {
      // Warm roaring hearth (180Hz-950Hz) with slow flame swell + distinct wood crackles
      let brown = 0;
      for (let i = 0; i < samples.length; i++) {
        brown = (brown + 0.035 * (Math.random() * 2 - 1)) / 1.035;
        const edge = Math.min(1, i / 11025, (samples.length - i) / 11025);
        samples[i] = brown * edge;
      }
      normalizeBuffer(samples, 0.88);

      const noise = context.createBufferSource();
      noise.buffer = texture;
      noise.loop = true;

      const hp = context.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 140;

      const lowpass = context.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 880;
      lowpass.Q.value = 0.8;

      const bodyGain = context.createGain();
      bodyGain.gain.value = 0.58;

      const lfo = context.createOscillator();
      lfo.frequency.value = 0.24;
      const lfoGain = context.createGain();
      lfoGain.gain.value = 180;
      lfo.connect(lfoGain).connect(lowpass.frequency);

      noise.connect(hp).connect(lowpass).connect(bodyGain).connect(envelope);
      noise.start();
      lfo.start();

      const crackleTimer = window.setInterval(() => {
        if (Math.random() < 0.82) this.spawnCrackle(context, envelope);
        if (Math.random() < 0.35) {
          window.setTimeout(() => this.spawnCrackle(context, envelope), 70);
        }
      }, 180);
      intervals.push(crackleTimer);

      this.room = { style, envelope, sources: [noise, lfo], intervals };
    } else {
      // Deep studio warm room tone: rich 160Hz-650Hz wind-filtered brown noise + gentle 146.8Hz / 220Hz warm fifth pad
      let brown = 0;
      for (let index = 0; index < samples.length; index++) {
        brown = (brown + 0.025 * (Math.random() * 2 - 1)) / 1.025;
        const edge = Math.min(1, index / 11025, (samples.length - index) / 11025);
        samples[index] = brown * edge;
      }
      normalizeBuffer(samples, 0.88);

      const noise = context.createBufferSource();
      noise.buffer = texture;
      noise.loop = true;

      const hp = context.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 150;

      const lowpass = context.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 640;
      lowpass.Q.value = 0.7;

      const noiseGain = context.createGain();
      noiseGain.gain.value = 0.65;

      const swell = context.createOscillator();
      swell.frequency.value = 0.11;
      const swellGain = context.createGain();
      swellGain.gain.value = 140;
      swell.connect(swellGain).connect(lowpass.frequency);

      noise.connect(hp).connect(lowpass).connect(noiseGain).connect(envelope);
      noise.start();
      swell.start();

      const oscillators = [146.83, 220.0].map((pitch, index) => {
        const oscillator = context.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = pitch;
        const level = context.createGain();
        level.gain.value = index === 0 ? 0.085 : 0.045;
        oscillator.connect(level).connect(envelope);
        oscillator.start();
        return oscillator;
      });
      this.room = { style, envelope, sources: [noise, swell, ...oscillators], intervals };
    }
  }

  private stopRoom() {
    if (!this.room || !this.context) return;
    for (const id of this.room.intervals) window.clearInterval(id);
    const now = this.context.currentTime;
    this.room.envelope.gain.setTargetAtTime(0, now, 0.14);
    this.room.sources.forEach(source => {
      try {
        source.stop(now + 0.7);
      } catch {
        // ignore stopped source
      }
    });
    const old = this.room;
    old.sources[0].onended = () => old.envelope.disconnect();
    this.room = undefined;
  }

  previewAmbient(style: AmbientStyle) {
    if (!this.config.volume) return;
    if (this.previewTimer) window.clearTimeout(this.previewTimer);
    this.stopRoom();
    this.buildRoom(style, 0.18);
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = undefined;
      if (!this.config.ambient) this.stopRoom();
    }, 3400);
  }

  ambient(focusing: boolean) {
    const enabled = focusing && this.config.ambient;
    if (!enabled) {
      if (!this.previewTimer) this.stopRoom();
      return;
    }
    if (this.previewTimer) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = undefined;
    }
    if (this.room && this.room.style === this.config.ambientStyle) return;
    if (this.room) this.stopRoom();
    this.buildRoom(this.config.ambientStyle, 0.8);
  }
}

export const instrumentAudio = new InstrumentAudio();
