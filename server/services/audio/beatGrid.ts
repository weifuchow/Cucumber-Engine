// BPM-driven beat grid generator.
//
// Most 漫剧 cuts want to land on a musical beat, not on an arbitrary
// frame. Producers already pick BGM with a known BPM; we just compute
// the beat times from (bpm, offset, duration) and return them as a flat
// number[] for the segment editor / AI to snap events against.
//
// Real audio-onset detection would be more accurate but adds a
// significant native dep (audio decoder + DSP). BPM-based beats cover
// > 95% of usage without that footprint.

export interface BeatGrid {
  /** Beats per minute. */
  bpm: number;
  /** Seconds from audio start to the first beat (a.k.a. anacrusis). */
  offsetSec: number;
  /** Total duration we generated beats for. */
  durationSec: number;
  /** Sorted ascending — beat 1, beat 2, ... in seconds from audio start. */
  beats: number[];
  /**
   * Every Nth beat is a "downbeat" — the strong beat of each measure.
   * Typical signature is 4 (4/4 time). Useful for "land big cut on the
   * downbeat" rules.
   */
  downbeatEvery: number;
  /** Indices into `beats` that are downbeats. */
  downbeats: number[];
}

export interface BeatGridOptions {
  bpm: number;
  durationSec: number;
  offsetSec?: number;
  /** Downbeat grouping. 4 = 4/4 time (default). */
  downbeatEvery?: number;
  /** Stop generating beats past this point. */
  maxBeats?: number;
}

export function generateBeatGrid(opts: BeatGridOptions): BeatGrid {
  const bpm = Math.max(20, Math.min(300, opts.bpm));
  const durationSec = Math.max(0.1, opts.durationSec);
  const offsetSec = Math.max(0, opts.offsetSec ?? 0);
  const downbeatEvery = Math.max(1, Math.floor(opts.downbeatEvery ?? 4));
  const beatPeriod = 60 / bpm;

  const beats: number[] = [];
  const downbeats: number[] = [];
  let t = offsetSec;
  let i = 0;
  const cap = opts.maxBeats ?? 1024;
  while (t <= durationSec && beats.length < cap) {
    beats.push(round3(t));
    if (i % downbeatEvery === 0) downbeats.push(beats.length - 1);
    t += beatPeriod;
    i++;
  }

  return { bpm, offsetSec, durationSec, beats, downbeatEvery, downbeats };
}

/**
 * Snap a given event time to the nearest beat within `tolerance` seconds.
 * Returns the snapped time if a beat was found, otherwise the original.
 *
 * Use case: AI generator emits a cameraChange at t=8.7 with a target of
 * "near the chorus drop"; snap to the actual beat at 8.65 so the cut
 * lands musically. Tolerance defaults to half a beat period so we don't
 * jerk events across unrelated beats.
 */
export function snapToBeat(
  time: number,
  grid: BeatGrid,
  tolerance?: number,
): { time: number; snapped: boolean; beatIndex: number | null; isDownbeat: boolean } {
  if (!grid.beats.length) return { time, snapped: false, beatIndex: null, isDownbeat: false };
  const tol = tolerance ?? (60 / grid.bpm) / 2;
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < grid.beats.length; i++) {
    const d = Math.abs(grid.beats[i] - time);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
    if (grid.beats[i] > time + tol) break;
  }
  if (bestIdx < 0 || bestDist > tol) {
    return { time, snapped: false, beatIndex: null, isDownbeat: false };
  }
  return {
    time: grid.beats[bestIdx],
    snapped: true,
    beatIndex: bestIdx,
    isDownbeat: grid.downbeats.includes(bestIdx),
  };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
