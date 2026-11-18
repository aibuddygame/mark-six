import "./style.css";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { GameDefinition, installNodeHost } from "@threert/gameplay";
import { ThreeEngine } from "./threert/ThreeEngine";
import { createMarkSixGame, SimRuntimeHandles } from "./game";
import { BroadcastAudioEngine } from "./audio/BroadcastAudioEngine";
import { CameraDirector, CameraPresetId } from "./camera/CameraDirector";
import { BroadcastHUD } from "./ui/BroadcastHUD";
import type { StaticGiLayout } from "./gi/lightmapAtlas";
import { isMobileDevice, yieldToMain } from "./utils/device";

async function loadBakedStaticGI() {
  const loader = new THREE.TextureLoader();
  const baseUrl = import.meta.env.BASE_URL;
  const [layoutRes, aoTex, lightMapTex] = await Promise.all([
    fetch(`${baseUrl}gi/static-layout.json`),
    loader.loadAsync(`${baseUrl}gi/static-ao.png`),
    loader.loadAsync(`${baseUrl}gi/static-lightmap.png`),
  ]);
  if (!layoutRes.ok) {
    throw new Error(`Failed to fetch baked GI layout: ${layoutRes.status}`);
  }
  const layout = (await layoutRes.json()) as StaticGiLayout;
  return { layout, aoTex, lightMapTex };
}

function createMobileLoadingController(enabled: boolean) {
  const overlay = document.getElementById("mobile-loading-screen");
  const textEl = document.getElementById("mobile-loading-text");
  const pctEl = document.getElementById("mobile-loading-pct");
  const barEl = document.getElementById("mobile-loading-bar");

  if (!enabled || !overlay) {
    return {
      update: (_pct: number, _msg: string) => {},
      finish: () => {},
    };
  }

  overlay.classList.remove("hidden");

  return {
    update(pct: number, msg: string) {
      const clamped = Math.max(0, Math.min(100, Math.round(pct)));
      if (textEl) textEl.textContent = msg;
      if (pctEl) pctEl.textContent = `${clamped}%`;
      if (barEl) barEl.style.width = `${clamped}%`;
    },
    finish() {
      overlay.classList.add("fading");
      window.setTimeout(() => {
        overlay.classList.add("hidden");
        overlay.classList.remove("fading");
      }, 280);
    },
  };
}

async function bootstrap() {
  const isMobile = isMobileDevice();
  if (isMobile) {
    document.body.classList.add("is-mobile");
  }
  const loader = createMobileLoadingController(true);

  loader.update(
    12,
    isMobile ? "正在載入物理引擎..." : "正在載入物理引擎與光照資料...",
  );
  await yieldToMain();

  let bakedGI: Awaited<ReturnType<typeof loadBakedStaticGI>> | null = null;
  if (isMobile) {
    await RAPIER.init();
  } else {
    const [, loadedGi] = await Promise.all([
      RAPIER.init(),
      loadBakedStaticGI().catch(() => null),
    ]);
    bakedGI = loadedGi;
  }

  loader.update(45, "正在初始化 WebGL 渲染引擎...");
  await yieldToMain();

  const container = document.getElementById("canvas-container");
  if (!container) {
    throw new Error("Missing #canvas-container mount element");
  }

  const engine = new ThreeEngine(container, { isMobile });
  if (bakedGI) {
    engine.setBakedStaticGI(bakedGI.layout, bakedGI.aoTex, bakedGI.lightMapTex);
  }
  loader.update(72, "正在建構攪珠機與 49 粒號碼球...");
  await yieldToMain();

  (window as unknown as Record<string, unknown>).__markSixDebug = () =>
    engine.getRenderStats();
  const audio = new BroadcastAudioEngine();

  let simHandles: SimRuntimeHandles | null = null;
  let director: CameraDirector | null = null;
  let hud: BroadcastHUD | null = null;

  const game = createMarkSixGame(
    {
      onClack: (strength, panX) => audio.playClack(strength, panX),
      onCapture: (_num, _color, isSpecial) => {
        audio.playCapture(isSpecial);
      },
      onTrackSettle: (_num, _color, _slot, isSpecial) => {
        audio.playTrackSettle(isSpecial);
      },
      onPhaseChange: (text) => {
        hud?.setPhaseText(text);
      },
      onCameraCue: (camName) => {
        director?.selectPreset(camName as CameraPresetId, true);
      },
      onBallHero: (num, color, drawIndex, visible) => {
        hud?.showHeroBall(num, color, drawIndex, visible);
      },
      onSlotReveal: (drawIndex, num, color) => {
        hud?.revealSlot(drawIndex, num, color);
      },
      onDrawComplete: (drawn) => {
        hud?.setRunningState(false);
        const winTier = hud?.recordCompletedDraw(drawn) ?? 0;
        if (winTier >= 1) {
          audio.playWinFanfare(winTier);
        } else {
          audio.playDrawFanfare();
        }
      },
    },
    (handles) => {
      simHandles = handles;
    },
    isMobile,
  );

  const node = installNodeHost(game as unknown as GameDefinition<unknown>, engine);
  node.setup("mark-six-studio");

  loader.update(92, "正在準備鏡頭與首次畫面渲染...");
  await yieldToMain();

  // Delegate camera ownership to Broadcast CameraDirector + OrbitControls after ThreeRT setup
  engine.setExternalCameraControl(true);

  director = new CameraDirector(
    engine.renderCamera,
    engine.domElement,
    (cam, chipText) => {
      hud?.setActiveCamera(cam, chipText);
    },
  );

  hud = new BroadcastHUD(
    {
      onStartDraw: () => {
        audio.unlock();
        hud?.resetSlots();
        hud?.setRunningState(true);
        node.event("start", "{}", Date.now());
      },
      onResetDraw: () => {
        audio.unlock();
        director?.trackLiftHeight(null);
        director?.selectPreset("main", false);
        hud?.resetSlots();
        node.event("reset", "{}", Date.now());
      },
      onToggleFastMode: (enabled) => {
        simHandles?.physics.setFastMode(enabled);
      },
      onToggleDirector: (enabled) => {
        director?.setAutoDirector(enabled);
      },
      onToggleAudio: (enabled) => {
        audio.setEnabled(enabled);
      },
      onSelectCamera: (cam) => {
        audio.unlock();
        director?.selectPreset(cam, false);
      },
      onPrizeWin: (tier) => {
        audio.unlock();
        audio.playWinFanfare(tier);
      },
    },
    isMobile,
  );

  window.addEventListener("resize", () => {
    engine.resize(window.innerWidth, window.innerHeight);
  });

  director.update(0);
  engine.render();
  loader.update(100, "準備就緒");
  await yieldToMain();
  loader.finish();

  let lastTime = performance.now();
  const animate = (now: number) => {
    requestAnimationFrame(animate);

    const dt = Math.min(0.05, Math.max(0.0001, (now - lastTime) / 1000));
    lastTime = now;

    node.frame(dt, now);

    if (simHandles) {
      audio.setMotorLevel(simHandles.physics.motorSpeedNormalized);
    }

    // Track pocket intake & lifting ball height dynamically during central close-up camera shot
    if (simHandles && simHandles.physics.phase === "lifting") {
      director?.trackLiftHeight(simHandles.machine.pusherGroup.position.y + 0.14);
    } else if (
      simHandles &&
      simHandles.physics.phase === "mixing" &&
      simHandles.physics.isCaptureWindowOpen
    ) {
      director?.trackLiftHeight(2.35);
    } else {
      director?.trackLiftHeight(null);
    }

    director?.update(dt);
    engine.render();
  };

  requestAnimationFrame(animate);
}

bootstrap();
