// AudioManager - Tone.js synth sounds for events
export class AudioManager {
  constructor() {
    this.enabled = false;
    this.initialized = false;
    this.synth = null;
    this.noiseSynth = null;
  }

  async init() {
    if (this.initialized) return;

    // Dynamically import Tone.js
    const Tone = await import('https://unpkg.com/tone@14.7.77/build/Tone.js');
    this.Tone = Tone.default || Tone;

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

    this.initialized = true;
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  async play(eventType) {
    if (!this.enabled) return;

    if (!this.initialized) {
      await this.init();
      // Start Tone.js context (requires user gesture)
      await this.Tone.start();
    }

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
