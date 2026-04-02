/**
 * FlipFlap audio — synthesized mechanical flip sounds via Web Audio API.
 *
 * Real split-flap displays produce a distinctive "clack" as each flap falls
 * into place. We synthesize this with filtered white noise bursts rather than
 * shipping audio files. Each flip gets slight random pitch and volume
 * variation to avoid the robotic feel of identical samples.
 *
 * The module is split into:
 * - Pure parameter generation (testable without AudioContext)
 * - AudioContext playback (requires browser runtime)
 */

/** Configuration for flip sound synthesis. */
export interface FlipAudioConfig {
  /** Base volume 0-1. */
  masterVolume: number;
  /** Center frequency (Hz) for the bandpass filter. */
  pitchCenter: number;
  /** +/- Hz random variation around pitchCenter. */
  pitchVariation: number;
  /** +/- random variation around masterVolume. */
  volumeVariation: number;
  /** Duration of each flip sound in milliseconds. */
  durationMs: number;
}

/** Parameters for a single flip sound after randomization. */
export interface FlipSoundParams {
  pitch: number;
  volume: number;
  durationMs: number;
}

/**
 * Defaults tuned to sound like a Solari split-flap mechanism.
 *
 * The short duration (15ms) and high-pass filtering produce a sharp "clack"
 * rather than a sustained tone. Variation ranges are kept small so the
 * overall texture sounds consistent but not monotonous.
 */
export const DEFAULT_AUDIO_CONFIG: FlipAudioConfig = {
  masterVolume: 0.3,
  pitchCenter: 1800,
  pitchVariation: 400,
  volumeVariation: 0.1,
  durationMs: 15,
};

/**
 * Generate randomized parameters for a single flip sound.
 *
 * Pure function (aside from Math.random) — testable by checking output ranges.
 */
export function randomizeFlipParams(config: FlipAudioConfig): FlipSoundParams {
  const pitchOffset = (Math.random() * 2 - 1) * config.pitchVariation;
  const volumeOffset = (Math.random() * 2 - 1) * config.volumeVariation;

  return {
    pitch: config.pitchCenter + pitchOffset,
    volume: Math.max(0, Math.min(1, config.masterVolume + volumeOffset)),
    durationMs: config.durationMs,
  };
}

/**
 * Manages Web Audio playback of flip sounds.
 *
 * Creates a single AudioContext (lazily, to comply with browser autoplay
 * policies) and reuses it for all flip sounds. Each flip is a short burst
 * of filtered white noise, scheduled precisely via the Web Audio clock.
 *
 * Usage:
 *   const player = new FlipSoundPlayer();
 *   player.playFlip(); // on each flap animation tick
 *
 * The player batches multiple flips scheduled within the same animation
 * frame to avoid creating excessive AudioNodes. When many flaps flip
 * simultaneously, only a subset are audible anyway — we cap concurrent
 * sounds to keep CPU usage low.
 */
export class FlipSoundPlayer {
  private ctx: AudioContext | null = null;
  private config: FlipAudioConfig;

  /** Max concurrent flip sounds per frame to avoid audio overload. */
  private static readonly MAX_CONCURRENT = 8;

  /** Tracks sounds scheduled in the current time window. */
  private scheduledThisFrame = 0;
  private lastScheduleTime = 0;

  constructor(config: FlipAudioConfig = DEFAULT_AUDIO_CONFIG) {
    this.config = config;
  }

  /** Update audio configuration (e.g. from settings). */
  setConfig(config: FlipAudioConfig): void {
    this.config = config;
  }

  /**
   * Play a single flip sound.
   *
   * Silently skipped if too many sounds are already scheduled this frame,
   * or if the AudioContext can't be created (e.g. in tests).
   */
  playFlip(): void {
    const ctx = this.getOrCreateContext();
    if (!ctx) return;

    // Reset frame counter every 10ms to allow sounds in the next batch
    const now = ctx.currentTime;
    if (now - this.lastScheduleTime > 0.01) {
      this.scheduledThisFrame = 0;
      this.lastScheduleTime = now;
    }

    if (this.scheduledThisFrame >= FlipSoundPlayer.MAX_CONCURRENT) return;
    this.scheduledThisFrame++;

    const params = randomizeFlipParams(this.config);
    this.scheduleFlipSound(ctx, params, now);
  }

  /** Release the AudioContext. Call on screensaver deactivation. */
  dispose(): void {
    if (this.ctx) {
      this.ctx.close().catch(() => {
        // Ignore close errors during teardown
      });
      this.ctx = null;
    }
  }

  private getOrCreateContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
      return this.ctx;
    } catch {
      // AudioContext unavailable (headless, tests, policy restrictions)
      return null;
    }
  }

  /**
   * Schedule a flip sound using filtered noise.
   *
   * The sound chain: white noise buffer → bandpass filter → gain envelope → output.
   * The bandpass filter shapes the noise into a click at the target frequency.
   * The gain envelope provides a sharp attack and fast decay.
   */
  private scheduleFlipSound(ctx: AudioContext, params: FlipSoundParams, startTime: number): void {
    const durationSec = params.durationMs / 1000;

    // Create a short buffer of white noise
    const sampleRate = ctx.sampleRate;
    const bufferLength = Math.ceil(sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, bufferLength, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferLength; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter to shape the click frequency
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = params.pitch;
    filter.Q.value = 2;

    // Gain envelope: sharp attack, fast exponential decay
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(params.volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + durationSec);

    // Connect: source → filter → gain → output
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    source.start(startTime);
    source.stop(startTime + durationSec);
  }
}
