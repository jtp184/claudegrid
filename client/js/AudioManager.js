// AudioManager - Tone.js synth sounds for events
export class AudioManager {
  // Sound modes: 'off', 'response' (SessionStart, PermissionRequest, Stop), 'on' (all sounds)
  static MODES = ['off', 'response', 'on'];
  static RESPONSE_EVENTS = ['SessionStart', 'PermissionRequest', 'Stop'];

  constructor() {
    this.mode = 'response';
    this.initialized = false;
    this.synth = null;
    this.noiseSynth = null;
    this.volume = 0.7; // 0-1 range
  }

  async init() {
    if (this.initialized) return;

    try {
      // Dynamically import Tone.js (uses import map)
      const ToneModule = await import('tone');
      // esm.sh may export as default or named exports
      this.Tone = ToneModule.default || ToneModule;
      console.log('Tone.js loaded:', Object.keys(this.Tone));

      // Create synths
      this.synth = new this.Tone.PolySynth(this.Tone.Synth, {
        oscillator: { type: 'square' },
        envelope: {
          attack: 0.01,
          decay: 0.2,
          sustain: 0.1,
          release: 0.3
        }
      }).toDestination();

      this.synth.volume.value = -12;

      // Noise synth for error/blocked sounds
      this.noiseSynth = new this.Tone.NoiseSynth({
        noise: { type: 'brown' },
        envelope: {
          attack: 0.01,
          decay: 0.1,
          sustain: 0.05,
          release: 0.1
        }
      }).toDestination();

      this.noiseSynth.volume.value = -18;

      // Start audio context (requires user gesture)
      await this.Tone.start();
      console.log('Tone.js audio context started');

      this.initialized = true;

      // Apply initial volume
      this.setVolume(this.volume);
    } catch (err) {
      console.error('AudioManager init failed:', err);
    }
  }

  toggle() {
    const modes = AudioManager.MODES;
    const currentIndex = modes.indexOf(this.mode);
    this.mode = modes[(currentIndex + 1) % modes.length];
    return this.mode;
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.initialized) {
      // Convert 0-1 to decibels (-60 to 0 range, with base offsets)
      const db = this.volume === 0 ? -Infinity : -40 * (1 - this.volume);
      this.synth.volume.value = db - 12;
      this.noiseSynth.volume.value = db - 18;
    }
  }

  async play(eventType) {
    if (this.mode === 'off') return;
    // 'response' mode only plays specific response events
    if (this.mode === 'response' && !AudioManager.RESPONSE_EVENTS.includes(eventType)) return;

    if (!this.initialized) {
      console.log('AudioManager: initializing from play()');
      await this.init();
      if (!this.initialized) {
        console.warn('AudioManager: init failed, cannot play');
        return;
      }
    }

    console.log('AudioManager: playing', eventType);
    const now = this.Tone.now();

    switch (eventType) {
      case 'SessionStart':
        // Ascending arpeggio C4 -> E4 -> G4 -> C5
        this.synth.triggerAttackRelease('C4', '16n', now);
        this.synth.triggerAttackRelease('E4', '16n', now + 0.1);
        this.synth.triggerAttackRelease('G4', '16n', now + 0.2);
        this.synth.triggerAttackRelease('C5', '8n', now + 0.3);
        break;

      case 'UserPromptSubmit':
        // Short rising G4 -> C5
        this.synth.triggerAttackRelease('G4', '32n', now);
        this.synth.triggerAttackRelease('C5', '16n', now + 0.08);
        break;

      case 'PreToolUse':
        // High blip C6
        this.synth.triggerAttackRelease('C6', '64n', now);
        break;

      case 'PostToolUse_success':
        // Major chord C5-E5-G5
        this.synth.triggerAttackRelease(['C5', 'E5', 'G5'], '8n', now);
        break;

      case 'PostToolUse_failure':
        // Brown noise burst
        this.noiseSynth.triggerAttackRelease('16n', now);
        break;

      case 'PermissionRequest':
        // Attention-getting descending tone for permission prompt
        this.synth.triggerAttackRelease('E5', '32n', now);
        this.synth.triggerAttackRelease('C5', '16n', now + 0.1);
        break;

      case 'SessionEnd':
        // Descending C5 -> G4 -> E4 -> C4
        this.synth.triggerAttackRelease('C5', '16n', now);
        this.synth.triggerAttackRelease('G4', '16n', now + 0.15);
        this.synth.triggerAttackRelease('E4', '16n', now + 0.3);
        this.synth.triggerAttackRelease('C4', '8n', now + 0.45);
        break;

      case 'Stop':
      case 'SubagentStop':
        // Soft low tone
        this.synth.triggerAttackRelease('G3', '16n', now);
        break;

      default:
        // Generic blip
        this.synth.triggerAttackRelease('A4', '64n', now);
    }
  }
}
