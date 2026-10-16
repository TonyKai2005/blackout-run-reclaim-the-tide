import type { UISettings } from '../ui';

const SFX = new Set([
  'checkpoint', 'drone_scan', 'extract', 'foot_metal_1', 'foot_metal_2',
  'foot_metal_3', 'foot_metal_4', 'grab', 'hurt', 'land', 'metal_impact',
  'pod_burst', 'power_on', 'release', 'robot_alert', 'seed_repeater',
  'sorter_start', 'trash_hit', 'water_pump', 'wind_restart'
]);

const CHORDS = [
  [220, 261.63, 329.63, 392],
  [174.61, 220, 261.63, 349.23],
  [196, 246.94, 293.66, 392],
  [196, 246.94, 329.63, 392]
];

/** A light, original Web Audio score. All samples are bundled local game assets. */
export class GameAudio {
  private context: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();
  private timer: number | null = null;
  private nextBeat = 0;
  private beat = 0;
  private mood = 1;
  private settings: UISettings;
  private footstep = 0;

  constructor(settings: UISettings) {
    this.settings = settings;
  }

  setSettings(settings: UISettings): void {
    this.settings = settings;
    const now = this.context?.currentTime ?? 0;
    this.musicBus?.gain.setTargetAtTime(settings.musicVolume * 0.32, now, 0.12);
    this.effectsBus?.gain.setTargetAtTime(settings.effectsVolume * 0.86, now, 0.08);
  }

  setMood(phase: number): void {
    this.mood = phase;
  }

  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.musicBus = this.context.createGain();
      this.effectsBus = this.context.createGain();
      this.musicBus.gain.value = this.settings.musicVolume * 0.32;
      this.effectsBus.gain.value = this.settings.effectsVolume * 0.86;
      this.musicBus.connect(this.context.destination);
      this.effectsBus.connect(this.context.destination);
    }
    await this.context.resume();
    this.musicBus?.gain.setTargetAtTime(this.settings.musicVolume * 0.32, this.context.currentTime, 0.12);
    if (this.timer === null) {
      this.nextBeat = this.context.currentTime + 0.12;
      this.beat = 0;
      this.timer = window.setInterval(() => this.schedule(), 120);
    }
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.musicBus && this.context) this.musicBus.gain.setTargetAtTime(0, this.context.currentTime, 0.15);
  }

  private schedule(): void {
    const context = this.context;
    if (!context || !this.musicBus) return;
    const beatLength = 60 / 84;
    while (this.nextBeat < context.currentTime + 0.45) {
      const chord = CHORDS[Math.floor(this.beat / 4) % CHORDS.length];
      if (this.beat % 4 === 0) {
        chord.forEach((frequency, index) => this.note(frequency / (index === 0 ? 2 : 1), this.nextBeat, beatLength * 3.85, 0.026, 'sine'));
      }
      const melody = [chord[1], chord[2], chord[3], chord[2]][this.beat % 4];
      this.note(melody * (this.mood >= 3 ? 2 : 1), this.nextBeat + 0.02, beatLength * 0.54, 0.051, 'triangle');
      if (this.mood >= 2 && this.beat % 2 === 1) this.note(chord[0], this.nextBeat + 0.04, beatLength * 0.36, 0.018, 'sine');
      this.nextBeat += beatLength;
      this.beat++;
    }
  }

  private note(frequency: number, at: number, duration: number, level: number, wave: OscillatorType): void {
    if (!this.context || !this.musicBus) return;
    const osc = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    osc.type = wave;
    osc.frequency.value = frequency;
    filter.type = 'lowpass';
    filter.frequency.value = wave === 'triangle' ? 1900 : 790;
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(level, at + 0.035);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(filter).connect(envelope).connect(this.musicBus);
    osc.start(at);
    osc.stop(at + duration + 0.03);
  }

  private getBuffer(name: string): Promise<AudioBuffer> {
    if (!this.context) return Promise.reject(new Error('Audio is locked.'));
    let cached = this.buffers.get(name);
    if (!cached) {
      cached = fetch(`assets/audio/${name}.wav`)
        .then(response => { if (!response.ok) throw new Error(`Missing sound ${name}`); return response.arrayBuffer(); })
        .then(buffer => this.context!.decodeAudioData(buffer));
      this.buffers.set(name, cached);
    }
    return cached;
  }

  async play(name: string, volume = 1): Promise<void> {
    if (!SFX.has(name) || !this.context || !this.effectsBus) return;
    try {
      const buffer = await this.getBuffer(name);
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      gain.gain.value = Math.max(0, Math.min(1.5, volume));
      source.buffer = buffer;
      source.connect(gain).connect(this.effectsBus);
      source.start();
    } catch {
      // The game stays playable if a browser blocks or cannot decode a sound.
    }
  }

  foot(): void {
    this.footstep = (this.footstep + 1) % 4;
    void this.play(`foot_metal_${this.footstep + 1}`, 0.18);
  }
}
