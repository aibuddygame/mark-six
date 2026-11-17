import type { BallColorKind } from "../balls/BallPhysicsSystem";

export interface DrawnBallItem {
  num: number;
  color: BallColorKind;
}

export interface DrawHistoryEntry {
  id: string;
  timestamp: string;
  balls: DrawnBallItem[];
  prizeSummary?: string;
}

export interface PrizeEvaluation {
  mainHits: number;
  specialHit: boolean;
  tier: number;
  label: string;
}

const HISTORY_STORAGE_KEY = "markSixHalogenHistory_v1";
const MAX_HISTORY_ENTRIES = 10;

/** Evaluates a 6-number Mark Six entry against drawn main numbers and optional special number. */
export function evaluateMarkSixPrize(
  picked: ReadonlySet<number>,
  mainDrawn: readonly number[],
  specialNum: number | null,
): PrizeEvaluation | null {
  if (picked.size !== 6 || mainDrawn.length === 0) return null;

  let mainHits = 0;
  for (const n of mainDrawn) {
    if (picked.has(n)) mainHits++;
  }
  const specialHit = specialNum !== null && picked.has(specialNum);

  if (mainHits === 6) {
    return { mainHits, specialHit, tier: 1, label: "頭獎（中 6 個正碼）" };
  }
  if (mainHits === 5 && specialHit) {
    return { mainHits, specialHit, tier: 2, label: "二獎（中 5 正碼＋特碼）" };
  }
  if (mainHits === 5) {
    return { mainHits, specialHit, tier: 3, label: "三獎（中 5 個正碼）" };
  }
  if (mainHits === 4 && specialHit) {
    return { mainHits, specialHit, tier: 4, label: "四獎（中 4 正碼＋特碼）" };
  }
  if (mainHits === 4) {
    return { mainHits, specialHit, tier: 5, label: "五獎（中 4 個正碼）" };
  }
  if (mainHits === 3 && specialHit) {
    return { mainHits, specialHit, tier: 6, label: "六獎（中 3 正碼＋特碼）" };
  }
  if (mainHits === 3) {
    return { mainHits, specialHit, tier: 7, label: "七獎（中 3 個正碼）" };
  }

  const extra = specialHit ? "＋特碼" : "";
  return {
    mainHits,
    specialHit,
    tier: 0,
    label:
      mainDrawn.length >= 6 && specialNum !== null
        ? `未中獎（中 ${mainHits} 正碼${extra}）`
        : `開獎中（暫中 ${mainHits} 正碼${extra}）`,
  };
}

/** Picks 6 distinct random numbers from 1..49 in ascending order. */
export function generateQuickPick(): number[] {
  const pool = Array.from({ length: 49 }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 6).sort((a, b) => a - b);
}

/** Safely reads recent draw history entries from localStorage. */
export function loadDrawHistory(): DrawHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY_ENTRIES) : [];
  } catch {
    return [];
  }
}

/** Safely persists recent draw history entries (capped at MAX_HISTORY_ENTRIES). */
export function saveDrawHistory(entries: readonly DrawHistoryEntry[]): void {
  try {
    window.localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_HISTORY_ENTRIES)),
    );
  } catch {
    // Ignore storage quota or private browsing errors cleanly
  }
}
