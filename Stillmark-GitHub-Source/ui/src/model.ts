export type Phase = 'deep' | 'work' | 'short' | 'long';
export type Mode = 'deep' | 'pomo';
export type DeepStyle = 'countdown' | 'countup';
export type Theme = 'light' | 'dark';
export type AmbientStyle = 'brown' | 'rain' | 'hearth';

export interface Config {
  theme: Theme;
  mode: Mode;
  deepStyle: DeepStyle;
  topic: string;
  deep: number;
  work: number;
  short: number;
  long: number;
  rounds: number;
  lock: boolean;
  ambient: boolean;
  ambientStyle: AmbientStyle;
  sound: boolean;
  volume: number;
  chimeVolume: number;
  motion: boolean;
  dialTicks: boolean;
  dialSecondSweep: boolean;
  autoStartRest: boolean;
  autoStartWork: boolean;
  dailyGoal: number;
  releaseLength: number;
  cooldownSeconds: number;
}

export interface Check {
  code: string;
  length: number;
  count: number;
  wait: number | null;
  cooldown: number;
  error: boolean;
}

export interface Session {
  id: number;
  started: number;
  seconds: number;
  planned: number;
  mode: Mode;
  topic: string;
  status: 'complete' | 'closed' | 'stopped' | 'released' | 'emergency' | 'interrupted';
  locked: number;
}

export interface DbStats {
  count: number;
  bytes: number;
}

export interface State {
  config: Config;
  phase: Phase;
  round: number;
  remaining: number;
  remainingExact: number;
  duration: number;
  running: boolean;
  paused: boolean;
  locked: boolean;
  countingUp?: boolean;
  release: Check | null;
  notice: string;
  systemDark: boolean;
  dbStats: DbStats;
}

export type SetConfig = <K extends keyof Config>(key: K, value: Config[K]) => void;
export type Command = (name: string, value?: string) => void;

export const phaseLabel: Record<Phase, string> = {
  deep: '深度专注',
  work: '番茄专注',
  short: '短休息',
  long: '长休息',
};

export const ambientStyleLabel: Record<AmbientStyle, { name: string; desc: string }> = {
  brown: { name: '低频暖噪', desc: '深沉稳态棕噪叠加极低谐振，适合长时间阅读与编码' },
  rain: { name: '细雨书房', desc: '柔和带通滤噪模拟窗外绵雨声，掩蔽突发环境杂音' },
  hearth: { name: '壁炉微澜', desc: '温润低通底噪配以轻缓脉冲起伏，带来安静陪伴感' },
};

export const bounds: Record<
  Phase | 'rounds' | 'dailyGoal' | 'releaseLength' | 'cooldownSeconds' | 'volume' | 'chimeVolume',
  [number, number]
> = {
  deep: [1, 180],
  work: [1, 120],
  short: [1, 45],
  long: [1, 90],
  rounds: [2, 8],
  dailyGoal: [15, 720],
  releaseLength: [16, 64],
  cooldownSeconds: [0, 300],
  volume: [0, 100],
  chimeVolume: [0, 100],
};

export const isRest = (phase: Phase) => phase === 'short' || phase === 'long';
export const clamp = (value: number, range: [number, number]) => Math.min(range[1], Math.max(range[0], value));
export const readout = (seconds: number) =>
  [Math.floor(seconds / 60), seconds % 60].map(value => String(value).padStart(2, '0')).join(':');

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'dark' ? 'dark' : 'light';
}

export const defaultConfig: Config = {
  theme: 'light',
  mode: 'deep',
  deepStyle: 'countdown',
  topic: '',
  deep: 50,
  work: 25,
  short: 5,
  long: 15,
  rounds: 4,
  lock: false,
  ambient: false,
  ambientStyle: 'brown',
  sound: true,
  volume: 40,
  chimeVolume: 100,
  motion: true,
  dialTicks: true,
  dialSecondSweep: true,
  autoStartRest: true,
  autoStartWork: false,
  dailyGoal: 120,
  releaseLength: 64,
  cooldownSeconds: 180,
};

export const initialState: State = {
  config: defaultConfig,
  phase: 'deep',
  round: 1,
  remaining: 3000,
  remainingExact: 3000,
  duration: 3000,
  running: false,
  paused: false,
  locked: false,
  countingUp: false,
  release: null,
  notice: '',
  systemDark: false,
  dbStats: { count: 0, bytes: 0 },
};
