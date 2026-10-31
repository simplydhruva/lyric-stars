// Frame statistics for the diagnostics panel: how often the sky is painted and
// how long each paint takes, over the last few seconds.
const WINDOW = 240;

export class FrameStats {
  constructor() {
    this.draws = []; // [time, drawMs]
  }

  add(now, drawMs) {
    this.draws.push([now, drawMs]);
    if (this.draws.length > WINDOW) this.draws.shift();
  }

  summary(now) {
    const recent = this.draws.filter(([t]) => now - t < 2000);
    if (recent.length < 2) return { fps: recent.length / 2, meanMs: recent[0]?.[1] ?? 0, p95Ms: recent[0]?.[1] ?? 0, longFrames: 0 };
    const ms = recent.map(([, d]) => d).sort((a, b) => a - b);
    const span = recent.at(-1)[0] - recent[0][0];
    const fps = span > 0 ? ((recent.length - 1) * 1000) / span : 0;
    let longFrames = 0;
    // Idle painting is throttled on purpose, so gaps only count while painting every frame.
    if (fps >= 40) for (let i = 1; i < recent.length; i++) if (recent[i][0] - recent[i - 1][0] > 25) longFrames++;
    return {
      fps,
      meanMs: ms.reduce((a, b) => a + b, 0) / ms.length,
      p95Ms: ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))],
      longFrames, // gaps over 25 ms between paints
    };
  }
}
