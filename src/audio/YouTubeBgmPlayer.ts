interface YTPlayerInstance {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void;
  getPlayerState(): number;
  destroy(): void;
}

interface YTGlobal {
  Player: new (
    element: HTMLElement | string,
    options: {
      height?: string | number;
      width?: string | number;
      videoId: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (ev: { target: YTPlayerInstance }) => void;
        onStateChange?: (ev: { data: number; target: YTPlayerInstance }) => void;
        onError?: (ev: { data: number }) => void;
      };
    },
  ) => YTPlayerInstance;
}

declare global {
  interface Window {
    YT?: YTGlobal;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const DEFAULT_YT_VOLUME = 42;
const DUCKED_YT_VOLUME = 18;
const YT_STATE_ENDED = 0;

/**
 * Lightweight hidden YouTube IFrame API audio driver with automatic loop, volume ducking,
 * and immediate fallback signal when network/adblock/embed restrictions block YouTube playback.
 */
export class YouTubeBgmPlayer {
  private readonly videoId: string;
  private readonly onUnavailable: () => void;
  private hostEl: HTMLDivElement | null = null;
  private player: YTPlayerInstance | null = null;
  private ready = false;
  private unavailable = false;
  private loadingStarted = false;
  private wantPlay = false;
  private duckTimer: number | null = null;

  constructor(videoId: string, onUnavailable: () => void) {
    this.videoId = videoId;
    this.onUnavailable = onUnavailable;
  }

  get isAvailableAndReady(): boolean {
    return !this.unavailable && this.ready && this.player !== null;
  }

  get isUnavailable(): boolean {
    return this.unavailable;
  }

  play(): void {
    this.wantPlay = true;
    if (this.unavailable) {
      this.onUnavailable();
      return;
    }
    this.ensureApiLoaded();
    if (this.ready && this.player) {
      this.player.unMute();
      this.player.setVolume(DEFAULT_YT_VOLUME);
      this.player.playVideo();
    }
  }

  pause(): void {
    this.wantPlay = false;
    this.clearDuckTimer();
    if (this.ready && this.player) {
      this.player.pauseVideo();
      this.player.mute();
    }
  }

  duck(durationSec = 0.65): void {
    if (!this.ready || !this.player || !this.wantPlay || this.unavailable) return;
    this.player.setVolume(DUCKED_YT_VOLUME);
    this.clearDuckTimer();
    this.duckTimer = window.setTimeout(() => {
      if (this.ready && this.player && this.wantPlay && !this.unavailable) {
        this.player.setVolume(DEFAULT_YT_VOLUME);
      }
    }, Math.round(durationSec * 1000));
  }

  private clearDuckTimer(): void {
    if (this.duckTimer !== null) {
      window.clearTimeout(this.duckTimer);
      this.duckTimer = null;
    }
  }

  private ensureApiLoaded(): void {
    if (this.loadingStarted || this.unavailable) return;
    this.loadingStarted = true;

    this.hostEl = document.createElement("div");
    this.hostEl.id = "yt-bgm-host";
    // Off-screen non-zero box so Chrome allows YouTube media playback without showing video over 3D scene
    Object.assign(this.hostEl.style, {
      position: "fixed",
      left: "-9999px",
      top: "-9999px",
      width: "200px",
      height: "200px",
      opacity: "0.001",
      pointerEvents: "none",
    });
    const mountTarget = document.createElement("div");
    this.hostEl.appendChild(mountTarget);
    document.body.appendChild(this.hostEl);

    if (window.YT?.Player) {
      this.initPlayer(mountTarget);
      return;
    }

    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevReady?.();
      this.initPlayer(mountTarget);
    };

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => this.markUnavailable();
    document.head.appendChild(script);
  }

  private initPlayer(target: HTMLElement): void {
    if (this.player || this.unavailable || !window.YT?.Player) return;
    this.player = new window.YT.Player(target, {
      width: 200,
      height: 200,
      videoId: this.videoId,
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        loop: 1,
        playlist: this.videoId,
        playsinline: 1,
        rel: 0,
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          this.ready = true;
          if (this.wantPlay && !this.unavailable) {
            this.player?.unMute();
            this.player?.setVolume(DEFAULT_YT_VOLUME);
            this.player?.playVideo();
          }
        },
        onStateChange: (ev) => {
          if (ev.data === YT_STATE_ENDED && this.wantPlay && !this.unavailable) {
            ev.target.playVideo();
          }
        },
        onError: () => {
          this.markUnavailable();
        },
      },
    });
  }

  private markUnavailable(): void {
    if (this.unavailable) return;
    this.unavailable = true;
    this.ready = false;
    this.clearDuckTimer();
    try {
      this.player?.destroy();
    } catch {
      // Ignore cleanup errors on blocked player iframe
    }
    this.player = null;
    this.hostEl?.remove();
    this.hostEl = null;
    if (this.wantPlay) {
      this.onUnavailable();
    }
  }
}
