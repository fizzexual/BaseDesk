// A tiny notification chime for the customer portal, synthesized on the fly with
// the Web Audio API so there is no audio asset to ship and no dependency to add.
// Browsers keep an AudioContext suspended until the user interacts with the page;
// the customer's sign-in and clicks satisfy that gesture, and we resume the
// context on demand. Everything is wrapped in try/catch so a missing, blocked, or
// autoplay-restricted AudioContext simply no-ops instead of throwing.

let ctx: AudioContext | null = null;

/** Lazily create (once) and return the shared AudioContext, or null if unavailable. */
function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (ctx === null) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

/**
 * Play a short, gentle two-note chime (two ascending sine tones, ~180ms total,
 * with a soft attack/decay envelope so there is no click). Safe to call from
 * anywhere and never throws — if audio is unavailable it quietly does nothing.
 */
export function playNotification(): void {
  try {
    const ac = audio();
    if (ac === null) return;
    // Resume if the browser parked the context (e.g. after a period of silence).
    if (ac.state === 'suspended') void ac.resume();

    const now = ac.currentTime;
    // Two quick ascending notes (roughly A5 then E6). Each fades in over ~12ms and
    // decays exponentially, which keeps the chime smooth and free of pops.
    const notes = [
      { freq: 880, start: 0, dur: 0.1 },
      { freq: 1318.5, start: 0.07, dur: 0.11 },
    ];
    const peak = 0.08;
    for (const note of notes) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.freq;
      const t0 = now + note.start;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + note.dur + 0.02);
    }
  } catch {
    // Unsupported or blocked — ignore and stay silent.
  }
}
