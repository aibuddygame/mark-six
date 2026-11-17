interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  color: string;
  rot: number;
  vRot: number;
  tilt: number;
  vTilt: number;
  life: number;
  maxLife: number;
  shape: "ribbon" | "star";
}

const STANDARD_PALETTE = [
  "#ef4444",
  "#2563eb",
  "#16a34a",
  "#fbbf24",
  "#fde047",
];

const JACKPOT_PALETTE = [
  "#fbbf24",
  "#fef08a",
  "#f59e0b",
  "#fde68a",
  "#ef4444",
  "#38bdf8",
  "#10b981",
  "#ffffff",
];

/**
 * Lightweight rAF Canvas 2D confetti & golden starburst engine triggered only when winning
 * (zero overhead when idle). Wave count and particle energy scale sharply for Jackpot (tier 1).
 */
export class WinCelebrationFx {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly particles: ConfettiParticle[] = [];
  private readonly waveTimers: number[] = [];
  private rafId: number | null = null;
  private lastTs = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.syncSize();
    window.addEventListener("resize", this.syncSize);
  }

  /** Launches tier-scaled confetti & star sparkles (tier 1 = extra lavish gold jackpot burst). */
  trigger(tier: number): void {
    if (tier < 1 || tier > 7) return;
    this.syncSize();
    this.clearTimers();

    const w = window.innerWidth;
    const h = window.innerHeight;

    if (tier === 1) {
      // Jackpot wave 1: twin side cannons + center gold starburst
      this.spawnBurst(w * 0.14, h * 0.62, 65, JACKPOT_PALETTE, -0.58, 1.0, 0.24);
      this.spawnBurst(w * 0.86, h * 0.62, 65, JACKPOT_PALETTE, -2.56, 1.0, 0.24);
      this.spawnBurst(w * 0.5, h * 0.36, 42, JACKPOT_PALETTE, -Math.PI / 2, 1.15, 0.45);
      // Jackpot wave 2 & 3: high golden fountain cascade
      this.waveTimers.push(
        window.setTimeout(() => {
          this.spawnBurst(w * 0.34, h * 0.22, 48, JACKPOT_PALETTE, Math.PI / 2, 0.85, 0.4);
          this.spawnBurst(w * 0.66, h * 0.22, 48, JACKPOT_PALETTE, Math.PI / 2, 0.85, 0.4);
          this.ensureRunning();
        }, 320),
        window.setTimeout(() => {
          this.spawnBurst(w * 0.5, h * 0.42, 54, JACKPOT_PALETTE, -Math.PI / 2, 1.05, 0.35);
          this.ensureRunning();
        }, 680),
      );
    } else if (tier <= 3) {
      this.spawnBurst(w * 0.2, h * 0.64, 48, STANDARD_PALETTE, -0.78, 0.88, 0.14);
      this.spawnBurst(w * 0.8, h * 0.64, 48, STANDARD_PALETTE, -2.36, 0.88, 0.14);
      this.waveTimers.push(
        window.setTimeout(() => {
          this.spawnBurst(w * 0.5, h * 0.42, 32, STANDARD_PALETTE, -Math.PI / 2, 0.85, 0.18);
          this.ensureRunning();
        }, 280),
      );
    } else {
      this.spawnBurst(w * 0.28, h * 0.68, 32, STANDARD_PALETTE, -0.95, 0.78, 0.1);
      this.spawnBurst(w * 0.72, h * 0.68, 32, STANDARD_PALETTE, -2.19, 0.78, 0.1);
    }

    this.ensureRunning();
  }

  /** Stops active celebration particles immediately cleanly. */
  clear(): void {
    this.clearTimers();
    this.particles.length = 0;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  dispose(): void {
    this.clear();
    window.removeEventListener("resize", this.syncSize);
  }

  private readonly syncSize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  private clearTimers(): void {
    while (this.waveTimers.length > 0) {
      const id = this.waveTimers.pop();
      if (id !== undefined) window.clearTimeout(id);
    }
  }

  private spawnBurst(
    ox: number,
    oy: number,
    count: number,
    palette: readonly string[],
    baseAngle: number,
    powerScale: number,
    starRatio: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const angle = baseAngle + (Math.random() - 0.5) * 1.15;
      const speed = (360 + Math.random() * 480) * powerScale;
      const isStar = Math.random() < starRatio;
      this.particles.push({
        x: ox + (Math.random() - 0.5) * 28,
        y: oy + (Math.random() - 0.5) * 22,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: isStar ? 8 + Math.random() * 6 : 6 + Math.random() * 5,
        h: isStar ? 8 + Math.random() * 6 : 11 + Math.random() * 7,
        color: palette[Math.floor(Math.random() * palette.length)],
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 10,
        tilt: Math.random() * Math.PI * 2,
        vTilt: 3.5 + Math.random() * 5,
        life: 0,
        maxLife: 2.2 + Math.random() * 1.6,
        shape: isStar ? "star" : "ribbon",
      });
    }
  }

  private ensureRunning(): void {
    if (this.rafId !== null) return;
    this.lastTs = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    const dt = Math.min(0.04, Math.max(0.001, (now - this.lastTs) / 1000));
    this.lastTs = now;

    const w = window.innerWidth;
    const h = window.innerHeight;
    this.ctx.clearRect(0, 0, w, h);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife || p.y > h + 40) {
        this.particles.splice(i, 1);
        continue;
      }

      // Air drag + gentle flutter gravity
      p.vx *= Math.pow(0.28, dt);
      p.vy += 680 * dt;
      p.x += p.vx * dt + Math.sin(p.tilt * 0.7) * 26 * dt;
      p.y += p.vy * dt;
      p.rot += p.vRot * dt;
      p.tilt += p.vTilt * dt;

      const fade =
        p.life > p.maxLife * 0.72
          ? Math.max(0, 1 - (p.life - p.maxLife * 0.72) / (p.maxLife * 0.28))
          : 1;

      this.ctx.save();
      this.ctx.globalAlpha = fade * 0.94;
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate(p.rot);
      this.ctx.fillStyle = p.color;

      if (p.shape === "star") {
        const s = p.w * (0.65 + 0.35 * Math.sin(p.tilt * 2));
        this.ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const a0 = (k * Math.PI) / 2;
          const a1 = a0 + Math.PI / 4;
          if (k === 0) this.ctx.moveTo(Math.cos(a0) * s, Math.sin(a0) * s);
          else this.ctx.lineTo(Math.cos(a0) * s, Math.sin(a0) * s);
          this.ctx.lineTo(Math.cos(a1) * s * 0.34, Math.sin(a1) * s * 0.34);
        }
        this.ctx.closePath();
        this.ctx.fill();
      } else {
        const scaleY = 0.28 + 0.72 * Math.abs(Math.cos(p.tilt));
        this.ctx.fillRect(-p.w * 0.5, -p.h * scaleY * 0.5, p.w, p.h * scaleY);
      }
      this.ctx.restore();
    }

    if (this.particles.length > 0 || this.waveTimers.length > 0) {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      this.rafId = null;
    }
  };
}
