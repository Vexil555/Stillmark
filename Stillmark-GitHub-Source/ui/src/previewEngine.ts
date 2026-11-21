import {
  bounds, type Check, type Config, defaultConfig, isRest, type Mode, type Phase, type Session, type State,
} from './model';

export const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const MIN_RECORD_SECONDS = 180;

const LIVE_KEYS = new Set<keyof Config>([
  'theme', 'volume', 'chimeVolume', 'sound', 'motion', 'ambient',
  'ambientStyle', 'dialTicks', 'dialSecondSweep', 'dailyGoal',
  'autoStartRest', 'autoStartWork',
]);

const ENUMS: Partial<Record<keyof Config, readonly string[]>> = {
  theme: ['light', 'dark'],
  mode: ['deep', 'pomo'],
  deepStyle: ['countdown', 'countup'],
  ambientStyle: ['brown', 'rain', 'hearth'],
};

const SEED_TOPICS = [
  '系统架构与内核阅读',
  '编译原理精读笔记',
  '线性代数与矩阵推导',
  '图形渲染管线实验',
  '论文结构精修与润色',
];

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Generates realistic, deterministic fictional focus records spanning ~150 days
 * for browser development preview (never touches real user SQLite data).
 */
export function buildPreviewSeedSessions(nowMs: number = Date.now()): Session[] {
  const rand = seededRandom(20261120);
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const sessions: Session[] = [];
  let nextId = 1;

  for (let offset = 174; offset >= 0; offset--) {
    const day = new Date(today);
    day.setDate(day.getDate() - offset);
    const weekday = day.getDay();

    // Ensure a realistic active streak over the last 6 days including today,
    // and varied intensities across levels 0-4 in the preceding months
    const recentStreak = offset <= 5;
    if (!recentStreak) {
      const skipChance = weekday === 0 ? 0.45 : weekday === 6 ? 0.3 : 0.2;
      if (rand() < skipChance) continue;
    }

    // Pick intensity bucket intentionally so the heatmap displays unmistakable 0..4 variation
    let targetSessions: number;
    if (offset === 0) {
      targetSessions = 2; // Today: ~95 min (79% of 120m goal)
    } else if (recentStreak) {
      targetSessions = offset % 2 === 0 ? 3 : 2;
    } else {
      const tier = rand();
      targetSessions = tier < 0.28 ? 1 : tier < 0.56 ? 2 : tier < 0.82 ? 3 : 4;
    }

    const hourSlots = [9, 10, 14, 15, 19, 20, 21];
    for (let s = 0; s < targetSessions; s++) {
      const hour = offset === 0
        ? (s === 0 ? 9 : 14)
        : hourSlots[Math.min(hourSlots.length - 1, Math.floor(rand() * 2) + s * 2)];
      const minute = Math.floor(rand() * 35);
      const startDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0);
      if (startDate.getTime() > nowMs - 3600_000 && offset === 0) {
        startDate.setHours(Math.max(8, new Date(nowMs).getHours() - (2 - s) * 2));
      }

      const mode: Mode = offset === 0 ? (s === 0 ? 'deep' : 'deep') : (rand() < 0.58 ? 'deep' : 'pomo');
      const plannedMin = offset === 0
        ? (s === 0 ? 50 : 45)
        : mode === 'deep'
          ? [30, 45, 50, 60][Math.floor(rand() * 4)]
          : 25;
      const planned = plannedMin * 60;

      const roll = rand();
      let status: Session['status'] = 'complete';
      let seconds = planned;
      if (offset > 0 && roll > 0.86) {
        status = roll > 0.95 ? 'released' : 'stopped';
        seconds = Math.max(MIN_RECORD_SECONDS, Math.round(planned * (0.45 + rand() * 0.4)));
      }

      const topic = SEED_TOPICS[(offset + s * 2) % SEED_TOPICS.length];
      const locked = mode === 'deep' && rand() < 0.45 ? 1 : 0;

      sessions.push({
        id: nextId++,
        started: Math.floor(startDate.getTime() / 1000),
        seconds,
        planned,
        mode,
        topic,
        status,
        locked,
      });
    }
  }

  return sessions.sort((a, b) => b.started - a.started || b.id - a.id);
}

interface InternalRelease {
  code: string;
  length: number;
  count: number;
  until: number | null;
  cooldown: number;
  error: boolean;
}

export class PreviewTimerEngine {
  config: Config;
  records: Session[];
  phase: Phase;
  round = 1;
  deadline: number | null = null;
  pausedRemaining: number | null = null;
  startedMono: number | null = null;
  pausedElapsed: number | null = null;
  duration = 0;
  locked = false;
  notice = '';
  systemDark = false;
  private activeSession: Session | null = null;
  private release: InternalRelease | null = null;
  private nextSessionId: number;
  private randomSource: () => number;

  constructor(options?: {
    seedRecords?: Session[];
    config?: Partial<Config>;
    random?: () => number;
  }) {
    this.config = { ...defaultConfig, ...(options?.config ?? {}) };
    this.records = options?.seedRecords ? [...options.seedRecords] : buildPreviewSeedSessions();
    this.nextSessionId = this.records.reduce((max, r) => Math.max(max, r.id), 0) + 1;
    this.phase = this.startingPhase;
    this.randomSource = options?.random ?? Math.random;
  }

  get startingPhase(): Phase {
    return this.config.mode === 'deep' ? 'deep' : 'work';
  }

  get countingUp(): boolean {
    return this.phase === 'deep' && this.config.deepStyle === 'countup';
  }

  get running(): boolean {
    return (
      this.deadline !== null ||
      this.pausedRemaining !== null ||
      this.startedMono !== null ||
      this.pausedElapsed !== null
    );
  }

  get paused(): boolean {
    return this.pausedRemaining !== null || this.pausedElapsed !== null;
  }

  get resting(): boolean {
    return isRest(this.phase);
  }

  set<K extends keyof Config>(key: K, rawValue: unknown): boolean {
    if (!(key in defaultConfig)) return false;
    if (this.running && !LIVE_KEYS.has(key)) return false;

    let value: unknown = rawValue;
    if (key in bounds) {
      const [min, max] = bounds[key as keyof typeof bounds];
      const num = Math.trunc(Number(value));
      if (!Number.isFinite(num)) return false;
      value = Math.max(min, Math.min(max, num));
    } else if (key === 'topic') {
      value = String(value ?? '').trim().slice(0, 60);
    } else if (typeof defaultConfig[key] === 'boolean') {
      value = Boolean(value);
    } else if (key in ENUMS) {
      const allowed = ENUMS[key]!;
      if (typeof value !== 'string' || !allowed.includes(value)) return false;
    }

    if (this.config[key] === value) return false;
    this.config = { ...this.config, [key]: value as Config[K] };
    if ((key === 'mode' || key === 'rounds') && !this.running) {
      this.phase = this.startingPhase;
      this.round = 1;
    }
    return true;
  }

  resetSettings(): boolean {
    if (this.running) return false;
    this.config = { ...defaultConfig };
    this.phase = this.startingPhase;
    this.round = 1;
    this.notice = '已恢复默认设置';
    return true;
  }

  clearHistory(): boolean {
    if (this.running) return false;
    this.records = [];
    this.notice = '已清空历史专注记录';
    return true;
  }

  begin(locked = false, nowSec: number = performance.now() / 1000, wallNowSec: number = Math.floor(Date.now() / 1000)): boolean {
    if (this.running) return false;
    this.notice = '';
    this.pausedRemaining = null;
    this.pausedElapsed = null;
    if (this.countingUp) {
      this.duration = 0;
      this.deadline = null;
      this.startedMono = nowSec;
      this.activeSession = {
        id: this.nextSessionId++,
        started: wallNowSec,
        seconds: 0,
        planned: 0,
        mode: this.config.mode,
        topic: this.config.topic,
        status: 'complete',
        locked: locked ? 1 : 0,
      };
      this.locked = locked;
      return true;
    }
    this.startedMono = null;
    this.duration = this.config[this.phase] * 60;
    if (!this.resting) {
      this.activeSession = {
        id: this.nextSessionId++,
        started: wallNowSec,
        seconds: 0,
        planned: this.duration,
        mode: this.config.mode,
        topic: this.config.topic,
        status: 'complete',
        locked: locked ? 1 : 0,
      };
    } else {
      this.activeSession = null;
    }
    this.deadline = nowSec + this.duration;
    this.locked = locked;
    return true;
  }

  pause(nowSec: number = performance.now() / 1000): boolean {
    if (!this.running || this.paused || this.locked || this.resting) return false;
    if (this.countingUp) {
      this.pausedElapsed = this.elapsed(nowSec);
      this.startedMono = null;
    } else {
      this.pausedRemaining = this.remaining(nowSec);
      this.deadline = null;
    }
    this.notice = '已暂停计时';
    return true;
  }

  resume(nowSec: number = performance.now() / 1000): boolean {
    if (!this.paused) return false;
    if (this.pausedElapsed !== null) {
      this.startedMono = nowSec - this.pausedElapsed;
      this.pausedElapsed = null;
    } else if (this.pausedRemaining !== null) {
      this.deadline = nowSec + this.pausedRemaining;
      this.pausedRemaining = null;
    }
    this.notice = '';
    return true;
  }

  elapsed(nowSec: number = performance.now() / 1000): number {
    if (this.pausedElapsed !== null) return this.pausedElapsed;
    if (this.startedMono !== null) return Math.max(0, nowSec - this.startedMono);
    return 0;
  }

  remaining(nowSec: number = performance.now() / 1000): number {
    if (this.countingUp) return this.elapsed(nowSec);
    if (this.pausedRemaining !== null) return this.pausedRemaining;
    if (this.deadline === null) return this.config[this.phase] * 60;
    return Math.max(0, this.deadline - nowSec);
  }

  remainingSeconds(nowSec: number = performance.now() / 1000): number {
    if (this.countingUp) return Math.max(0, Math.floor(this.elapsed(nowSec)));
    return Math.max(0, Math.ceil(this.remaining(nowSec)));
  }

  stop(status: Session['status'] | 'skipped', nowSec: number = performance.now() / 1000): boolean {
    if (!this.running) return false;
    let recorded = false;
    if (this.activeSession && status !== 'skipped') {
      if (this.countingUp) {
        const elapsed = Math.max(0, Math.floor(this.elapsed(nowSec)));
        const finalStatus: Session['status'] = status === 'stopped' ? 'complete' : status;
        if (elapsed >= MIN_RECORD_SECONDS) {
          const finalized: Session = {
            ...this.activeSession,
            seconds: elapsed,
            planned: elapsed,
            status: finalStatus,
          };
          this.records = [finalized, ...this.records];
          recorded = true;
        }
      } else {
        const elapsed = status === 'complete'
          ? this.duration
          : Math.max(0, this.duration - this.remainingSeconds(nowSec));
        if (elapsed >= MIN_RECORD_SECONDS) {
          const finalized: Session = {
            ...this.activeSession,
            seconds: elapsed,
            status,
          };
          this.records = [finalized, ...this.records];
          recorded = true;
        }
      }
    }
    this.activeSession = null;
    this.deadline = null;
    this.pausedRemaining = null;
    this.startedMono = null;
    this.pausedElapsed = null;
    this.release = null;
    this.locked = false;
    return recorded;
  }

  endManual(status: Session['status'], notice: string, nowSec: number = performance.now() / 1000): boolean {
    const wasFocus = this.activeSession !== null;
    const recorded = this.stop(status, nowSec);
    if (wasFocus && !recorded && notice) {
      this.notice = `${notice}（不足 3 分钟，未计入记录）`;
    } else {
      this.notice = notice;
    }
    return recorded;
  }

  tick(nowSec: number = performance.now() / 1000, wallNowSec: number = Math.floor(Date.now() / 1000)): {
    phaseChanged: boolean;
    chime?: 'rest' | 'finish';
    historyChanged: boolean;
  } {
    if (!this.running || this.paused) {
      return { phaseChanged: false, historyChanged: false };
    }
    if (this.countingUp) {
      return { phaseChanged: false, historyChanged: false };
    }
    const rem = this.remainingSeconds(nowSec);
    if (rem > 0) {
      return { phaseChanged: false, historyChanged: false };
    }
    const previous = this.phase;
    const recorded = this.stop('complete', nowSec);
    if (previous === 'work') {
      this.phase = this.round === this.config.rounds ? 'long' : 'short';
      if (this.config.autoStartRest) {
        this.begin(false, nowSec, wallNowSec);
      } else {
        this.notice = recorded
          ? '专注完成，点击开始休息'
          : '本轮完成（不足 3 分钟未计入记录），点击开始休息';
      }
    } else if (previous === 'short' || previous === 'long') {
      this.nextRound(previous, nowSec, wallNowSec);
    } else {
      this.notice = recorded ? '本次专注已计入记录' : '本次不足 3 分钟，未计入专注记录';
    }
    return {
      phaseChanged: true,
      chime: this.resting ? 'rest' : 'finish',
      historyChanged: recorded,
    };
  }

  nextRound(previous: Phase, nowSec: number = performance.now() / 1000, wallNowSec: number = Math.floor(Date.now() / 1000)) {
    this.phase = 'work';
    this.round = previous === 'long' ? 1 : this.round + 1;
    if (this.config.autoStartWork) {
      this.begin(false, nowSec, wallNowSec);
    } else {
      this.notice = '休息结束，准备好后开始下一轮';
    }
  }

  skipRest(nowSec: number = performance.now() / 1000, wallNowSec: number = Math.floor(Date.now() / 1000)): boolean {
    if (!this.resting || !this.running) return false;
    const previous = this.phase;
    this.stop('skipped', nowSec);
    this.nextRound(previous, nowSec, wallNowSec);
    return true;
  }

  requestRelease(): void {
    const length = this.config.releaseLength;
    let code = '';
    for (let i = 0; i < length; i++) {
      code += ALPHABET[Math.floor(this.randomSource() * ALPHABET.length)];
    }
    this.release = {
      code,
      length,
      count: 0,
      until: null,
      cooldown: this.config.cooldownSeconds,
      error: false,
    };
  }

  cancelRelease(): void {
    this.release = null;
  }

  releaseKey(key: string, nowSec: number = performance.now() / 1000): void {
    const check = this.release;
    if (!check || check.until !== null) return;
    if (key === check.code[check.count]) {
      check.count += 1;
      check.error = false;
      if (check.count === check.length) {
        check.until = nowSec + check.cooldown;
      }
    } else {
      this.requestRelease();
      if (this.release) this.release.error = true;
    }
  }

  canCompleteRelease(nowSec: number = performance.now() / 1000): boolean {
    return Boolean(this.release && this.release.until !== null && nowSec >= this.release.until);
  }

  hasRelease(): boolean {
    return this.release !== null;
  }

  snapshot(nowSec: number = performance.now() / 1000): State {
    let release: Check | null = null;
    if (this.release) {
      const check = this.release;
      const wait = check.until === null ? null : Math.max(0, Math.ceil(check.until - nowSec));
      release = {
        code: check.code,
        length: check.length,
        count: check.count,
        wait,
        cooldown: check.cooldown,
        error: check.error,
      };
    }
    const isUp = this.countingUp;
    const remFloat = isUp ? this.elapsed(nowSec) : this.remaining(nowSec);
    const remSec = isUp ? Math.max(0, Math.floor(remFloat)) : Math.max(0, Math.ceil(remFloat));
    const dur = isUp ? remSec : (this.running ? this.duration : remSec);
    const estimatedBytes = 12288 + this.records.length * 168;
    return {
      config: { ...this.config },
      phase: this.phase,
      round: this.round,
      running: this.running,
      paused: this.paused,
      locked: this.locked,
      countingUp: isUp,
      notice: this.notice,
      remaining: remSec,
      remainingExact: Math.round(remFloat * 1000) / 1000,
      duration: dur,
      release,
      systemDark: this.systemDark,
      dbStats: { count: this.records.length, bytes: estimatedBytes },
    };
  }
}
