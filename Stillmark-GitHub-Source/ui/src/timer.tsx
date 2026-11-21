import {
  ArrowLeft, ArrowLeftRight, AudioWaveform, Award, Check, ChevronRight, Clock3, Coffee, Flame,
  Hourglass, LockKeyhole, Pause, Play, RotateCw, ShieldAlert, SkipForward, Sparkles, Tag,
  Timer as TimerIcon, Volume2, VolumeX, X,
} from 'lucide-react';
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { computeTodayStats } from './analytics';
import { instrumentAudio as audio } from './audio';
import { Segmented, Stepper, Toggle } from './controls';
import {
  type AmbientStyle, ambientStyleLabel, bounds, type Check as ReleaseCheck, type Command, type DeepStyle,
  isRest, phaseLabel, readout, type Session, type SetConfig, type State,
} from './model';

const DIAL_CENTER = 160;
const DEEP_ARC_R = 150;
const DEEP_ARC_CIRC = 2 * Math.PI * DEEP_ARC_R;
const POMO_ORBIT_R = 149;
const HIDDEN_TOPICS_KEY = 'stillmark_hidden_topics_v1';

// Clean 60 radial ticks (no 15/30/45/60 numerals, no dashed inner chapter ring)
const DEEP_TICKS = Array.from({ length: 60 }, (_, index) => {
  const angleRad = ((index * 6) - 90) * (Math.PI / 180);
  const isCardinal = index % 15 === 0;
  const isMajor = index % 5 === 0;
  const outer = 143;
  const inner = isCardinal ? 127 : isMajor ? 131 : 137;
  return {
    index,
    isCardinal,
    isMajor,
    x1: (DIAL_CENTER + outer * Math.cos(angleRad)).toFixed(2),
    y1: (DIAL_CENTER + outer * Math.sin(angleRad)).toFixed(2),
    x2: (DIAL_CENTER + inner * Math.cos(angleRad)).toFixed(2),
    y2: (DIAL_CENTER + inner * Math.sin(angleRad)).toFixed(2),
  };
});

// Refined inner 60 ticks for Pomodoro dial (sits calmly inside the segmented cadence orbit)
const POMO_TICKS = Array.from({ length: 60 }, (_, index) => {
  const angleRad = ((index * 6) - 90) * (Math.PI / 180);
  const isMajor = index % 5 === 0;
  const outer = 138;
  const inner = isMajor ? 129 : 133.5;
  return {
    index,
    isMajor,
    x1: (DIAL_CENTER + outer * Math.cos(angleRad)).toFixed(2),
    y1: (DIAL_CENTER + outer * Math.sin(angleRad)).toFixed(2),
    x2: (DIAL_CENTER + inner * Math.cos(angleRad)).toFixed(2),
    y2: (DIAL_CENTER + inner * Math.sin(angleRad)).toFixed(2),
  };
});

// 24 radial celebration burst rays (pure SVG, animates only transform/opacity)
const BURST_RAYS = Array.from({ length: 24 }, (_, i) => {
  const deg = i * 15;
  const rad = (deg - 90) * (Math.PI / 180);
  const r1 = 152;
  const r2 = i % 2 === 0 ? 166 : 161;
  return {
    i,
    x1: (DIAL_CENTER + r1 * Math.cos(rad)).toFixed(2),
    y1: (DIAL_CENTER + r1 * Math.sin(rad)).toFixed(2),
    x2: (DIAL_CENTER + r2 * Math.cos(rad)).toFixed(2),
    y2: (DIAL_CENTER + r2 * Math.sin(rad)).toFixed(2),
    isMajor: i % 2 === 0,
  };
});

/** Crisp geometric tomato line icon matching lucide-react stroke weight */
function TomatoIcon({ size = 14, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d="M12 7.5c-4.7 0-8 2.9-8 7.2C4 18.6 7.4 21 12 21s8-2.4 8-6.3c0-4.3-3.3-7.2-8-7.2Z"
        fill={filled ? 'currentColor' : 'none'}
        fillOpacity={filled ? 0.92 : 0}
      />
      <path d="M12 7.5V3.5" />
      <path d="M12 7.5c-1.4-2-3.5-2.6-4.8-2" />
      <path d="M12 7.5c1.4-2 3.5-2.6 4.8-2" />
    </svg>
  );
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const span = Math.max(0.5, endDeg - startDeg);
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, startDeg + span);
  const largeArc = span > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function formatEndTime(secondsLeft: number) {
  const eta = new Date(Date.now() + secondsLeft * 1000);
  return `${String(eta.getHours()).padStart(2, '0')}:${String(eta.getMinutes()).padStart(2, '0')}`;
}

function loadHiddenTopics(): string[] {
  try {
    const raw = window.localStorage.getItem(HIDDEN_TOPICS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function saveHiddenTopics(list: string[]) {
  try {
    window.localStorage.setItem(HIDDEN_TOPICS_KEY, JSON.stringify(list));
  } catch {
    // ignore storage errors in restricted environments
  }
}

interface OrbitSegment {
  id: string;
  kind: 'work' | 'short' | 'long';
  round: number;
  minutes: number;
  startDeg: number;
  endDeg: number;
  status: 'done' | 'active' | 'upcoming';
  label: string;
}

function buildPomoOrbit(state: State): OrbitSegment[] {
  const { rounds, work, short, long } = state.config;
  const rested = isRest(state.phase);
  const items: { kind: 'work' | 'short' | 'long'; round: number; minutes: number }[] = [];
  for (let r = 1; r <= rounds; r++) {
    items.push({ kind: 'work', round: r, minutes: work });
    items.push({ kind: r === rounds ? 'long' : 'short', round: r, minutes: r === rounds ? long : short });
  }

  // Balanced visual weights so short rests remain cleanly visible on the perimeter
  const weights = items.map(item =>
    item.kind === 'work' ? Math.max(22, item.minutes) : Math.max(9, item.minutes * 1.15),
  );
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const gapDeg = rounds >= 6 ? 2.6 : 3.6;
  const availableDeg = Math.max(180, 360 - gapDeg * items.length);

  let cursor = gapDeg / 2;
  return items.map((item, idx) => {
    const sweep = (weights[idx] / totalWeight) * availableDeg;
    const startDeg = cursor;
    const endDeg = cursor + sweep;
    cursor = endDeg + gapDeg;

    let status: OrbitSegment['status'] = 'upcoming';
    if (item.round < state.round) {
      status = 'done';
    } else if (item.round === state.round) {
      if (item.kind === 'work') {
        status = rested ? 'done' : 'active';
      } else {
        status = rested ? 'active' : 'upcoming';
      }
    }

    const label = item.kind === 'work'
      ? `第 ${item.round} 轮番茄 · ${item.minutes} 分钟`
      : item.kind === 'long'
        ? `长休息 · ${item.minutes} 分钟`
        : `第 ${item.round} 轮短休 · ${item.minutes} 分钟`;

    return {
      id: `${item.kind}-${item.round}`,
      ...item,
      startDeg,
      endDeg,
      status,
      label,
    };
  });
}

export interface CelebrationInfo {
  id: number;
  minutes: number;
  seconds: number;
  mode: 'deep' | 'pomo';
  countingUp: boolean;
  round: number;
  rounds: number;
  topic: string;
  archived: boolean;
  goalJustMet: boolean;
  autoRestStarted: boolean;
  nextPhaseLabel: string;
  title: string;
  encouragement: string;
}

export function buildCelebrationCopy(params: {
  minutes: number;
  mode: 'deep' | 'pomo';
  countingUp: boolean;
  round: number;
  rounds: number;
  streak: number;
  goalJustMet: boolean;
  todayMinAfter: number;
  dailyGoal: number;
}): { title: string; encouragement: string } {
  if (params.goalJustMet) {
    return {
      title: '今日专注目标已达成！',
      encouragement: `今日已累计 ${params.todayMinAfter} 分钟，连续保持 ${Math.max(1, params.streak)} 天。这份自律非常扎实，起身喝杯水放松一下吧。`,
    };
  }
  if (params.mode === 'pomo' && params.round >= params.rounds) {
    return {
      title: `整组 ${params.rounds} 轮番茄圆满完成`,
      encouragement: '完整走完一组深度节拍，进入长休息舒展肩颈与双眼，让思路自然沉淀。',
    };
  }
  if (params.mode === 'pomo') {
    return {
      title: `第 ${params.round} 轮番茄专注达成`,
      encouragement: '节奏稳健！利用这几分钟离开屏幕远眺片刻，为下一轮保持清澈专注力。',
    };
  }
  if (params.countingUp) {
    if (params.minutes >= 45) {
      return {
        title: '深度心流圆满收官',
        encouragement: `连续沉浸 ${params.minutes} 分钟，已跨过高效心流区间。建议稍作走动，记录下刚才最关键的一个灵感。`,
      };
    }
    return {
      title: '正向专注已顺利记录',
      encouragement: '每一次从 00:00 开启的投入都在积累复利。稍微喘息后，随时开启下一段心流。',
    };
  }
  if (params.minutes >= 45) {
    return {
      title: '圆满完成深度专注',
      encouragement: `整整 ${params.minutes} 分钟心无旁骛，定力难得。现在起身活动肩颈、远眺窗外两分钟吧。`,
    };
  }
  return {
    title: '本次专注已圆满完成',
    encouragement: `今日距目标还差 ${Math.max(0, params.dailyGoal - params.todayMinAfter)} 分钟，保持这个节奏，一切都在稳步推进。`,
  };
}

export function Dial({
  state,
  showTicks,
  smoothSweep,
  immersion = false,
  celebrating = false,
  onAdjustDeepMinutes,
  onToggleDeepStyle,
}: {
  state: State;
  showTicks: boolean;
  smoothSweep: boolean;
  immersion?: boolean;
  celebrating?: boolean;
  onAdjustDeepMinutes?: (minutes: number) => void;
  onToggleDeepStyle?: () => void;
}) {
  const [hoveredSeg, setHoveredSeg] = useState<string>('');
  const [hoveringHand, setHoveringHand] = useState(false);
  const [dragVisualMin, setDragVisualMin] = useState<number | null>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  const dragSessionRef = useRef<{
    prevAngle: number;
    accumMin: number;
    lastCommitted: number;
    lastTickBucket: number;
  } | null>(null);

  const isPomo = state.config.mode === 'pomo';
  const rested = isRest(state.phase);
  const isLongRest = state.phase === 'long';
  const countingUp = Boolean(
    !isPomo && (state.countingUp || state.config.deepStyle === 'countup'),
  );
  const canDragPointer = Boolean(!immersion && !isPomo && !countingUp && !state.running && onAdjustDeepMinutes);
  const dragging = dragVisualMin !== null;

  // Clean up window drag listeners if component unmounts mid-drag
  useEffect(() => {
    if (!dragging) return;
    document.body.style.cursor = 'grabbing';

    function onWindowMove(event: PointerEvent) {
      const session = dragSessionRef.current;
      const el = dialRef.current;
      if (!session || !el || !onAdjustDeepMinutes) return;
      const rect = el.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      // Ignore jitter right at the geometric center
      if (Math.hypot(dx, dy) < 12) return;

      let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      if (angle < 0) angle += 360;

      // Continuous unwrapped multi-turn delta so winding across 12 o'clock is butter-smooth (1..180 min)
      const delta = ((angle - session.prevAngle + 540) % 360) - 180;
      session.prevAngle = angle;

      const nextAccum = Math.max(bounds.deep[0], Math.min(bounds.deep[1], session.accumMin + delta / 6));
      session.accumMin = nextAccum;
      setDragVisualMin(nextAccum);

      const rounded = Math.round(nextAccum);
      if (rounded !== session.lastCommitted) {
        session.lastCommitted = rounded;
        const tickBucket = Math.floor(rounded / 5);
        if (tickBucket !== session.lastTickBucket || rounded === bounds.deep[0] || rounded === bounds.deep[1]) {
          session.lastTickBucket = tickBucket;
          audio.play('tick');
        }
        onAdjustDeepMinutes(rounded);
      }
    }

    function onWindowUp() {
      dragSessionRef.current = null;
      setDragVisualMin(null);
      document.body.style.cursor = '';
    }

    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowUp);
    return () => {
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowUp);
    };
  }, [dragging, onAdjustDeepMinutes]);

  function handlePointerHandleDown(event: ReactPointerEvent<SVGGElement>) {
    if (!canDragPointer || event.button !== 0 || !dialRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = dialRef.current.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (angle < 0) angle += 360;
    dragSessionRef.current = {
      prevAngle: angle,
      accumMin: state.config.deep,
      lastCommitted: state.config.deep,
      lastTickBucket: Math.floor(state.config.deep / 5),
    };
    setDragVisualMin(state.config.deep);
  }

  const shownDeepMin = dragVisualMin !== null ? Math.round(dragVisualMin) : state.config.deep;
  const displaySeconds = countingUp
    ? (state.running ? state.remaining : 0)
    : (!isPomo && !state.running ? shownDeepMin * 60 : state.remaining);
  const [minutes, seconds] = readout(displaySeconds).split(':');

  const dur = Math.max(1, state.duration);
  const remExact = smoothSweep ? state.remainingExact : state.remaining;

  // Deep countdown progress (0..1) or Deep countup (60s sweep hand + 60m horizon arc)
  const countdownProgress = state.running ? Math.min(1, Math.max(0, 1 - remExact / dur)) : 0;
  const countupSecondsMod = countingUp && state.running ? (remExact % 60) / 60 : 0;
  const countupHourArc = countingUp && state.running ? Math.min(1, (remExact % 3600) / 3600) : 0;
  const countupCompletedHours = countingUp && state.running ? Math.floor(state.remaining / 3600) : 0;

  // Idle Deep Countdown pointer rests smoothly at current duration position on the 60m face
  const effectiveIdleMin = dragVisualMin !== null ? dragVisualMin : state.config.deep;
  const idleModMin = effectiveIdleMin % 60;
  const idlePointerDeg = idleModMin === 0 ? 0 : (idleModMin / 60) * 360;
  const idlePreviewFraction = effectiveIdleMin >= 60 ? 1 : effectiveIdleMin / 60;

  const deepHandDeg = countingUp
    ? countupSecondsMod * 360
    : state.running
      ? countdownProgress * 360
      : idlePointerDeg;

  const deepArcOffset = countingUp
    ? DEEP_ARC_CIRC * (1 - countupHourArc)
    : state.running
      ? DEEP_ARC_CIRC * (1 - countdownProgress)
      : DEEP_ARC_CIRC * (1 - idlePreviewFraction);

  const pomoSegments = useMemo(() => (isPomo ? buildPomoOrbit(state) : []), [
    isPomo,
    state.config.rounds,
    state.config.work,
    state.config.short,
    state.config.long,
    state.round,
    state.phase,
  ]);

  const activeSeg = pomoSegments.find(s => s.status === 'active');
  const pomoHandDeg = activeSeg
    ? activeSeg.startDeg + (activeSeg.endDeg - activeSeg.startDeg) * countdownProgress
    : 0;

  const etaText = state.paused ? '已暂停' : formatEndTime(state.remaining);

  const dialClass = [
    'dial',
    isPomo ? 'is-pomo' : countingUp ? 'is-countup' : 'is-deep',
    state.running ? 'moving' : '',
    state.paused ? 'paused' : '',
    rested ? 'resting' : '',
    isLongRest ? 'is-long-rest' : '',
    immersion ? 'is-immersion' : '',
    hoveringHand ? 'is-hand-hover' : '',
    dragging ? 'is-dragging' : '',
    celebrating ? 'is-celebrating' : '',
  ].filter(Boolean).join(' ');

  return (
    <div ref={dialRef} className={dialClass}>
      {/* Serene breathing halo during Pomodoro breaks */}
      {rested && state.running && !state.paused && (
        <span className="dial-breathe-halo" aria-hidden="true" />
      )}

      {/* Celebratory ripple & ray burst on completion */}
      {celebrating && (
        <span className="dial-celebrate-ring" aria-hidden="true" />
      )}

      <svg className="dial-svg" viewBox="0 0 320 320" aria-hidden="true">
        {celebrating && (
          <g className="dial-burst-rays">
            {BURST_RAYS.map(ray => (
              <line
                key={ray.i}
                x1={ray.x1}
                y1={ray.y1}
                x2={ray.x2}
                y2={ray.y2}
                className={ray.isMajor ? 'burst-ray is-major' : 'burst-ray'}
              />
            ))}
          </g>
        )}

        {isPomo ? (
          <>
            {/* Pomodoro Segmented Cadence Orbit */}
            <g className="pomo-orbit-group">
              {pomoSegments.map(seg => {
                const trackD = describeArc(DIAL_CENTER, DIAL_CENTER, POMO_ORBIT_R, seg.startDeg, seg.endDeg);
                const activeSpan = seg.status === 'active'
                  ? (seg.endDeg - seg.startDeg) * (state.running ? countdownProgress : 0.08)
                  : 0;
                const fillD = seg.status === 'active'
                  ? describeArc(DIAL_CENTER, DIAL_CENTER, POMO_ORBIT_R, seg.startDeg, seg.startDeg + activeSpan)
                  : '';
                return (
                  <g
                    key={seg.id}
                    className={`pomo-seg kind-${seg.kind} status-${seg.status}`}
                    onMouseEnter={() => setHoveredSeg(seg.label)}
                    onMouseLeave={() => setHoveredSeg('')}
                  >
                    <path d={trackD} className="pomo-seg-track" />
                    {seg.status === 'active' && (
                      <path d={fillD} className="pomo-seg-fill" />
                    )}
                    {!immersion && <path d={trackD} className="pomo-seg-hit" />}
                  </g>
                );
              })}
            </g>

            {/* Clean inner 60 ticks without numerals */}
            {showTicks && (
              <g className="dial-ticks-group">
                {POMO_TICKS.map(t => (
                  <line
                    key={t.index}
                    x1={t.x1}
                    y1={t.y1}
                    x2={t.x2}
                    y2={t.y2}
                    className={t.isMajor ? 'tick-major' : 'tick-minor'}
                  />
                ))}
              </g>
            )}

            {/* Sculpted baton pointer aligned to active Pomodoro segment */}
            <g
              className="dial-hand-group"
              style={{ transform: `rotate(${pomoHandDeg.toFixed(2)}deg)`, transformOrigin: '160px 160px' }}
            >
              <rect x="157.8" y="19" width="4.4" height="19" rx="2.2" className="dial-hand-baton" />
            </g>
          </>
        ) : (
          <>
            {/* Deep Focus Minimalist Sculptural Dial */}
            <circle className="dial-chapter-outer" cx={DIAL_CENTER} cy={DIAL_CENTER} r={DEEP_ARC_R} />
            <circle
              className={'dial-arc-fill' + (!state.running && !countingUp ? ' is-idle-preview' : '')}
              cx={DIAL_CENTER}
              cy={DIAL_CENTER}
              r={DEEP_ARC_R}
              strokeDasharray={DEEP_ARC_CIRC}
              strokeDashoffset={deepArcOffset}
              transform={`rotate(-90 ${DIAL_CENTER} ${DIAL_CENTER})`}
            />

            {showTicks && (
              <g className="dial-ticks-group">
                {DEEP_TICKS.map(t => (
                  <line
                    key={t.index}
                    x1={t.x1}
                    y1={t.y1}
                    x2={t.x2}
                    y2={t.y2}
                    className={t.isCardinal ? 'tick-cardinal' : t.isMajor ? 'tick-major' : 'tick-minor'}
                  />
                ))}
              </g>
            )}

            {/* Interactive Pointer Handle: cursor ONLY changes when hovering the pointer itself */}
            <g
              className={'dial-hand-group' + (canDragPointer ? ' is-draggable-hand' : '')}
              style={{ transform: `rotate(${deepHandDeg.toFixed(2)}deg)`, transformOrigin: '160px 160px' }}
              onPointerDown={handlePointerHandleDown}
              onPointerEnter={() => canDragPointer && setHoveringHand(true)}
              onPointerLeave={() => setHoveringHand(false)}
            >
              {canDragPointer && (
                <>
                  <circle cx="160" cy="23" r="11" className="dial-hand-halo" />
                  <circle cx="160" cy="23" r="18" className="dial-hand-hit" />
                </>
              )}
              <rect x="157.5" y="11" width="5" height="24" rx="2.5" className="dial-hand-baton" />
            </g>
          </>
        )}
      </svg>

      <div className="dial-body">
        {isPomo ? (
          <div className="dial-kicker is-pomo-kicker">
            <TomatoIcon size={13} filled={!rested} />
            <span>第 {state.round} / {state.config.rounds} 轮</span>
          </div>
        ) : (
          <div className="dial-kicker-slot">
            {!immersion && !state.running && onToggleDeepStyle ? (
              <button
                type="button"
                className={'dial-direction-btn' + (countingUp ? ' is-countup' : '')}
                aria-label={countingUp ? '当前为正计时，点击一键切换为倒计时' : '当前为倒计时，点击一键切换为正计时'}
                title={countingUp ? '点击切换为倒计时' : '点击切换为正计时'}
                onClick={() => {
                  audio.play('tick');
                  onToggleDeepStyle();
                }}
              >
                {countingUp ? <TimerIcon size={11.5} /> : <Hourglass size={11.5} />}
                <span>{countingUp ? '正计时' : '倒计时'}</span>
                <ArrowLeftRight size={10} className="dir-swap-icon" />
              </button>
            ) : (
              <span className="dial-kicker">
                {countingUp
                  ? `${countupCompletedHours > 0 ? `+${countupCompletedHours}H · ` : ''}${state.paused ? '已暂停' : '正向计秒'}`
                  : (state.paused ? '已暂停' : '倒计时中')}
              </span>
            )}
          </div>
        )}

        <div
          className={`digits ${minutes.length > 2 ? 'wide' : ''}`}
          role="timer"
          aria-label={`${minutes} 分 ${seconds} 秒`}
        >
          <span>{minutes}</span>
          <b className={state.running && !state.paused ? 'colon-live' : ''}>:</b>
          <span>{seconds}</span>
        </div>

        <div className="dial-caption">
          <i />
          <span>
            {state.paused
              ? '已暂停'
              : countingUp
                ? '正向专注'
                : phaseLabel[state.phase]}
          </span>
          <i />
        </div>

        <div className="dial-register">
          {isPomo ? (
            <span className="dial-stage-hint">
              {hoveredSeg
                ? hoveredSeg
                : rested
                  ? (isLongRest ? '整组达成 · 深度恢复中' : '呼吸放松 · 舒展片刻')
                  : state.running
                    ? `预计 ${etaText} 进入${state.round === state.config.rounds ? '长休' : '短休'}`
                    : `本轮 ${state.config.work} 分 · 随后${state.round === state.config.rounds ? '长休' : '短休'}`}
            </span>
          ) : countingUp ? (
            <span className="dial-eta-mark">
              {state.running
                ? (state.paused ? '等待恢复正计时' : '满 3 分钟将自动写入专注记录')
                : '从 00:00 累计 · 满 3 分钟计入记录'}
            </span>
          ) : (
            <span className="dial-eta-mark">
              {dragging
                ? `松开确认 · ${shownDeepMin} 分钟`
                : hoveringHand
                  ? '按住红针旋转即可微调时长'
                  : state.running
                    ? (state.paused ? '等待恢复计时' : `预计 ${etaText} 完成`)
                    : `预计 ${etaText} 完成`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function CompletionOverlay({
  info,
  todayMin,
  dailyGoal,
  streak,
  onRestart,
  onOpenHistory,
  onDismiss,
}: {
  info: CelebrationInfo;
  todayMin: number;
  dailyGoal: number;
  streak: number;
  onRestart: () => void;
  onOpenHistory: () => void;
  onDismiss: () => void;
}) {
  const pct = Math.min(100, Math.round((todayMin / Math.max(1, dailyGoal)) * 100));
  return (
    <div className="celebration-backdrop" role="status" aria-live="polite" data-testid="completion-celebration">
      <div className="celebration-card panel">
        <button
          type="button"
          className="celebration-close"
          aria-label="收起完成鼓励卡片"
          onClick={onDismiss}
        >
          <X size={14} />
        </button>

        <div className="celebration-seal">
          <span className="celebration-emblem">
            {info.goalJustMet ? <Sparkles size={20} /> : <Award size={20} />}
          </span>
          <div className="celebration-titles">
            <h3 className="celebration-title">{info.title}</h3>
            <p className="celebration-earned">
              <strong>+{Math.max(1, info.minutes)} 分钟</strong>
              <span>· {info.countingUp ? '正向深度专注' : info.mode === 'deep' ? '深度专注' : `第 ${info.round} 轮番茄`}</span>
              {info.topic && <span>· {info.topic}</span>}
            </p>
          </div>
        </div>

        <p className="celebration-message">{info.encouragement}</p>

        <div className="celebration-progress">
          <div className="celebration-progress-meta">
            <span>{info.archived ? '已铭刻至本地专注档案' : '短时冲刺完成（满 3 分钟计入长期档案）'}</span>
            <strong>今日 {todayMin} / {dailyGoal} 分 · 连续 {streak} 天</strong>
          </div>
          <div className="celebration-bar"><i style={{ width: `${pct}%` }} /></div>
        </div>

        <div className="celebration-actions">
          {info.autoRestStarted ? (
            <button type="button" className="button rest-primary" onClick={onDismiss}>
              <Coffee size={14} />进入{info.nextPhaseLabel}
            </button>
          ) : (
            <button type="button" className="button primary" onClick={onRestart}>
              <Play size={13} fill="currentColor" />
              {info.mode === 'pomo' ? `开始${info.nextPhaseLabel}` : '再来一轮'}
            </button>
          )}
          <button type="button" className="button secondary" onClick={onOpenHistory}>
            查看专注记录
          </button>
        </div>
      </div>
    </div>
  );
}

function LockConfirmDialog({
  open,
  releaseLength,
  cooldownSeconds,
  durationMin,
  countingUp,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  releaseLength: number;
  cooldownSeconds: number;
  durationMin: number;
  countingUp: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      confirmBtn.current?.focus();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      className="lock-confirm panel"
      aria-labelledby="lock-confirm-title"
      onCancel={event => { event.preventDefault(); onCancel(); }}
    >
      <div className="lock-confirm-head">
        <div className="lock-confirm-icon"><LockKeyhole size={18} /></div>
        <div>
          <h2 id="lock-confirm-title">即将进入沉浸锁定专注</h2>
          <p>
            {countingUp
              ? '本次为开放式正向专注，锁定期间将接管全屏并拦截系统切屏键，完成时需通过校验解除。'
              : <>本次将持续 <strong>{durationMin} 分钟</strong>，锁定期间会接管全屏并拦截系统切屏键。</>}
          </p>
        </div>
      </div>
      <ul className="lock-confirm-list">
        <li>全屏置顶覆盖所有显示器，屏蔽 <code>Win</code> / <code>Alt+Tab</code> / <code>Alt+F4</code>。</li>
        <li>若需提前结束，必须逐字输入 <strong>{releaseLength} 位</strong> 随机校验码并等待 <strong>{cooldownSeconds} 秒</strong> 冷静期。</li>
        <li>紧急熔断：同时按住 <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Alt</kbd> + <kbd>F12</kbd> 满 2 秒可强制解锁。</li>
      </ul>
      <div className="dialog-actions">
        <button type="button" className="button secondary" onClick={onCancel}>暂不锁定</button>
        <button type="button" ref={confirmBtn} className="button primary" onClick={onConfirm}>
          <LockKeyhole size={14} />确认锁定并开始
        </button>
      </div>
    </dialog>
  );
}

export function TimerPanel({ state, records, set, send, ready, localDate, openSettings, openHistory }: {
  state: State; records: Session[]; set: SetConfig; send: Command; ready: boolean; localDate: string;
  openSettings: () => void; openHistory: () => void;
}) {
  const { config, phase, running, paused } = state;
  const resting = isRest(phase);
  const isPomo = config.mode === 'pomo';
  const countingUp = Boolean(!isPomo && (state.countingUp || config.deepStyle === 'countup'));

  const [lockPrompt, setLockPrompt] = useState(false);
  const [hiddenTopics, setHiddenTopics] = useState<string[]>(() => loadHiddenTopics());
  const [celebration, setCelebration] = useState<CelebrationInfo | null>(null);
  const [burstActive, setBurstActive] = useState(false);

  const stats = useMemo(() => computeTodayStats(records), [records, localDate]);
  const lastVolumeRef = useRef(config.volume > 0 ? config.volume : 40);
  if (config.volume > 0) lastVolumeRef.current = config.volume;

  // Track previous state to detect genuine focus completions and trigger celebration magic
  const prevRef = useRef({
    running,
    phase,
    round: state.round,
    duration: state.duration,
    remaining: state.remaining,
    countingUp,
    todayMin: stats.todayMin,
  });

  useEffect(() => {
    const prev = prevRef.current;
    const wasFocusing = prev.running && !isRest(prev.phase);

    // Case 1: Countdown focus completed naturally (deep reached 0 -> idle, or pomo work -> short/long)
    const deepCompleted = wasFocusing && prev.phase === 'deep' && !prev.countingUp && !running && state.notice.includes('本次');
    const pomoCompleted = wasFocusing && prev.phase === 'work' && isRest(phase);
    // Case 2: Count-up session voluntarily finished AND reached the 3-minute recording threshold (>= 180s)
    const countupCompleted = wasFocusing && prev.countingUp && !running && prev.remaining >= 180 && state.notice.includes('正计时');

    if (deepCompleted || pomoCompleted || countupCompleted) {
      const earnedSeconds = prev.countingUp ? Math.max(1, prev.remaining) : Math.max(1, prev.duration);
      const earnedMinutes = Math.max(1, Math.round(earnedSeconds / 60));
      const archived = earnedSeconds >= 180;
      const todayAfter = stats.todayMin + (archived && stats.todayMin === prev.todayMin ? earnedMinutes : 0);
      const goalJustMet = archived && prev.todayMin < config.dailyGoal && todayAfter >= config.dailyGoal;
      const copy = buildCelebrationCopy({
        minutes: earnedMinutes,
        mode: prev.phase === 'work' ? 'pomo' : 'deep',
        countingUp: prev.countingUp,
        round: prev.round,
        rounds: config.rounds,
        streak: stats.streak,
        goalJustMet,
        todayMinAfter: todayAfter,
        dailyGoal: config.dailyGoal,
      });
      setCelebration({
        id: Date.now(),
        minutes: earnedMinutes,
        seconds: earnedSeconds,
        mode: prev.phase === 'work' ? 'pomo' : 'deep',
        countingUp: prev.countingUp,
        round: prev.round,
        rounds: config.rounds,
        topic: config.topic.trim(),
        archived,
        goalJustMet,
        autoRestStarted: pomoCompleted && running && isRest(phase),
        nextPhaseLabel: isRest(phase) ? phaseLabel[phase] : '深度专注',
        title: copy.title,
        encouragement: copy.encouragement,
      });
      setBurstActive(true);
      const timer = window.setTimeout(() => setBurstActive(false), 1600);
      prevRef.current = {
        running,
        phase,
        round: state.round,
        duration: state.duration,
        remaining: state.remaining,
        countingUp,
        todayMin: stats.todayMin,
      };
      return () => window.clearTimeout(timer);
    }

    prevRef.current = {
      running,
      phase,
      round: state.round,
      duration: state.duration,
      remaining: state.remaining,
      countingUp,
      todayMin: stats.todayMin,
    };
  }, [running, phase, state.round, state.duration, state.remaining, state.notice, countingUp, config.rounds, config.topic, config.dailyGoal, stats.todayMin, stats.streak]);

  const visibleTopicChips = useMemo(
    () => stats.recentTopics.filter(t => !hiddenTopics.includes(t)),
    [stats.recentTopics, hiddenTopics],
  );

  function removeTopicChip(topic: string) {
    audio.play('tick');
    setHiddenTopics(prev => {
      if (prev.includes(topic)) return prev;
      const next = [...prev, topic];
      saveHiddenTopics(next);
      return next;
    });
    if (config.topic === topic) set('topic', '');
  }

  function handleBeginRequest() {
    if (!ready || running) return;
    setCelebration(null);
    if (config.lock && !resting) {
      audio.play('tick');
      setLockPrompt(true);
      return;
    }
    send('begin');
  }

  function toggleDeepStyle() {
    if (running) return;
    setCelebration(null);
    const next: DeepStyle = (config.deepStyle ?? 'countdown') === 'countdown' ? 'countup' : 'countdown';
    set('deepStyle', next);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== 'Space' || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      if (state.locked || lockPrompt) return;
      event.preventDefault();
      if (!running && ready) {
        handleBeginRequest();
      } else if (running && !resting) {
        audio.play(paused ? 'resume' : 'pause');
        send(paused ? 'resume' : 'pause');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [running, paused, resting, ready, state.locked, lockPrompt, config.lock, send]);

  const goalPct = Math.min(100, Math.round((stats.todayMin / Math.max(1, config.dailyGoal)) * 100));
  const goalMet = stats.todayMin >= config.dailyGoal;
  const remainToGoal = Math.max(0, config.dailyGoal - stats.todayMin);
  const etaText = paused ? '暂停中' : formatEndTime(state.remaining);
  const countupElapsedMin = countingUp && running ? Math.floor(state.remaining / 60) : 0;

  return <div className="console">
    <section
      className={
        'instrument panel' +
        (resting ? ' is-resting' : '') +
        (phase === 'long' ? ' is-long-rest' : '') +
        (countingUp ? ' is-countup-mode' : '')
      }
      aria-label="倒计时仪表"
    >
      <div className="instrument-top">
        <div className="modes" role="group" aria-label="计时模式">
          {(['deep', 'pomo'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              className={config.mode === mode ? 'selected' : ''}
              aria-pressed={config.mode === mode}
              disabled={running}
              onClick={() => {
                if (mode !== config.mode) {
                  audio.play('tick');
                  setCelebration(null);
                }
                set('mode', mode);
              }}
            >
              {mode === 'deep' ? <TimerIcon size={13.5} /> : <TomatoIcon size={13.5} />}
              {mode === 'deep' ? '深度专注' : '番茄钟'}
            </button>
          ))}
        </div>

        <div className="instrument-meta">
          {config.topic.trim()
            ? <span className="instrument-topic" title={config.topic}><Tag size={12} />{config.topic}</span>
            : <span>
                {resting
                  ? (phase === 'long' ? '完整跑完一组 · 享受长休息' : '休息阶段 · 离开屏幕远眺片刻')
                  : isPomo
                    ? '按空格键快速启停 · 悬停外环可查看各轮节拍'
                    : countingUp
                      ? '点击表盘内按钮可切换方向 · 满 3 分钟入档'
                      : (config.lock ? '沉浸锁定已就绪 · 按空格键开始' : '按空格键快速启停 · 拖动红针微调时长')}
              </span>}
        </div>
      </div>

      <div className="dial-area">
        <Dial
          state={state}
          showTicks={config.dialTicks}
          smoothSweep={config.dialSecondSweep}
          celebrating={burstActive}
          onAdjustDeepMinutes={val => set('deep', val)}
          onToggleDeepStyle={toggleDeepStyle}
        />
      </div>

      <div className="instrument-foot">
        {/* Consistent fixed-height companion rail across all modes so the dial never jumps */}
        <div className="instrument-companion">
          {isPomo ? (
            <div className="dial-cadence-strip" aria-label="番茄周期节拍">
              {Array.from({ length: config.rounds }, (_, i) => {
                const r = i + 1;
                const workDone = r < state.round || (resting && r === state.round);
                const workActive = !resting && r === state.round;
                const restActive = resting && r === state.round;
                const isLast = r === config.rounds;
                return (
                  <div className="cadence-pair" key={r}>
                    <span
                      className={'cadence-tomato' + (workDone ? ' is-done' : workActive ? ' is-active' : '')}
                      title={`第 ${r} 轮番茄 · ${config.work} 分`}
                    >
                      <TomatoIcon size={13} filled={workDone || workActive} />
                      <span>{config.work}m</span>
                    </span>
                    <span
                      className={'cadence-rest' + (isLast ? ' is-long' : '') + (restActive ? ' is-active' : '') + (r < state.round ? ' is-done' : '')}
                      title={isLast ? `长休 ${config.long} 分` : `短休 ${config.short} 分`}
                    >
                      {isLast ? config.long : config.short}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : countingUp ? (
            <div className="flow-milestones-rail" aria-label="心流里程碑">
              {([
                { min: 15, label: '15m 心流' },
                { min: 30, label: '30m 沉浸' },
                { min: 60, label: '60m 巅峰' },
              ] as const).map(m => (
                <span key={m.min} className={'flow-step' + (countupElapsedMin >= m.min ? ' is-reached' : '')}>
                  <i />
                  {m.label}
                </span>
              ))}
            </div>
          ) : (
            <div className="deep-companion-rail" aria-label="深度专注刻度概览">
              <span>单程深度 · {config.deep} 分钟</span>
              <i />
              <span>{config.lock ? `沉浸锁定 (${config.releaseLength}位校验)` : '满 3 分钟自动写入档案'}</span>
            </div>
          )}
        </div>

        <div className="instrument-actions">
          {running ? (
            <>
              {!resting && !state.locked && (
                <button
                  type="button"
                  className="button secondary action-pill"
                  onClick={() => {
                    audio.play(paused ? 'resume' : 'pause');
                    send(paused ? 'resume' : 'pause');
                  }}
                >
                  {paused ? <Play fill="currentColor" /> : <Pause />}
                  {paused ? '继续' : '暂停'}
                </button>
              )}
              <button
                type="button"
                className={
                  'button start ' +
                  (resting ? 'rest-action' : countingUp ? 'primary' : 'secondary')
                }
                onClick={() => send(resting ? 'skip' : 'end')}
              >
                {resting ? <SkipForward /> : countingUp ? <Check /> : <X />}
                {resting ? '跳过休息' : countingUp ? '完成并记录' : '结束专注'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={'button start ' + (resting ? 'rest-primary' : 'primary')}
              disabled={!ready}
              onClick={handleBeginRequest}
            >
              {config.lock && !resting ? <LockKeyhole size={15} /> : <Play fill="currentColor" />}
              {resting
                ? `开始${phaseLabel[phase]}`
                : countingUp
                  ? (config.lock ? '锁定并正计时' : '开始正计时')
                  : phase === 'work' && state.round > 1
                    ? `开始第 ${state.round} 轮`
                    : config.lock
                      ? '锁定并开始'
                      : '开始专注'}
            </button>
          )}
        </div>
      </div>

      {celebration && (
        <CompletionOverlay
          info={celebration}
          todayMin={stats.todayMin}
          dailyGoal={config.dailyGoal}
          streak={stats.streak}
          onRestart={() => {
            setCelebration(null);
            handleBeginRequest();
          }}
          onOpenHistory={() => {
            setCelebration(null);
            openHistory();
          }}
          onDismiss={() => setCelebration(null)}
        />
      )}
    </section>

    {/* Right Control Console: Consistent 3-Block Geometry Across All Modes */}
    <aside className="session panel" aria-label="本次设定">
      <div className="session-head">
        <div>
          <h2>本次设定</h2>
          <span className="session-eta">
            <Clock3 size={12} />
            {countingUp
              ? (running ? '正向累计中 · 满 3 分钟计入档案' : '自由正计时 · 满 3 分钟计入档案')
              : (running ? `预计 ${etaText} 结束` : `若现在开始 · 预计 ${etaText} 结束`)}
          </span>
        </div>
        <button type="button" className="text-action-link" onClick={openSettings}>
          完整设置 <ChevronRight size={13} />
        </button>
      </div>

      {/* Block 1: Topic, Duration / Mode & Rhythm (Unified consistent card height) */}
      <div className="console-card session-primary-card">
        <label className="setting-line" htmlFor="study-topic">
          <span className="setting-label"><Tag size={12.5} />主题</span>
          <Topic key={config.topic} value={config.topic} disabled={running} set={set} />
        </label>

        {visibleTopicChips.length > 0 && (
          <div className="topic-history-row" aria-label="最近主题">
            {visibleTopicChips.map(t => (
              <span key={t} className={'topic-quick' + (config.topic === t ? ' is-current' : '')}>
                <button
                  type="button"
                  className="topic-quick-pick"
                  disabled={running}
                  title={`填入主题：${t}`}
                  onClick={() => {
                    audio.play('tick');
                    set('topic', t);
                  }}
                >
                  {t}
                </button>
                <button
                  type="button"
                  className="topic-quick-del"
                  disabled={running}
                  aria-label={`移除快捷主题 ${t}`}
                  title="永久移出快捷标签"
                  onClick={() => removeTopicChip(t)}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {countingUp ? (
          <>
            <div className="setting-line">
              <span className="setting-label"><TimerIcon size={12.5} />计时</span>
              <div className="countup-readonly-field">
                <strong>开放正计时</strong>
                <span>不设上限 · 满 3 分钟入档</span>
              </div>
            </div>
            <div className="presets is-milestone-row" aria-label="正计时心流参考">
              <span>15 分 · 心流</span>
              <span>30 分 · 沉浸</span>
              <span>60 分 · 巅峰</span>
            </div>
          </>
        ) : (
          <>
            <div className="setting-line">
              <span className="setting-label"><TimerIcon size={12.5} />{resting ? '休息' : '时长'}</span>
              <Stepper
                label={phaseLabel[phase] + '时长'}
                value={config[phase]}
                range={bounds[phase]}
                disabled={running}
                onChange={value => set(phase, value)}
              />
            </div>

            {!resting && (
              <div className="presets" aria-label="快速设置时长">
                {(phase === 'deep' ? [25, 50, 90] : [15, 25, 45]).map(value => (
                  <button
                    type="button"
                    key={value}
                    disabled={running}
                    aria-pressed={config[phase] === value}
                    className={config[phase] === value ? 'selected' : ''}
                    onClick={() => {
                      if (config[phase] !== value) audio.play('tick');
                      set(phase, value);
                    }}
                  >
                    {value} 分
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Unified Bottom Foot Slot inside Block 1 so Card 2 & Card 3 never jump vertically */}
        <div className="console-card-slot">
          {isPomo ? (
            <div className="pomo-flow-row" role="group" aria-label="番茄自动流转设置">
              <button
                type="button"
                className={'flow-toggle' + (config.autoStartRest ? ' is-on' : '')}
                aria-pressed={config.autoStartRest}
                onClick={() => {
                  audio.play('tick');
                  set('autoStartRest', !config.autoStartRest);
                }}
              >
                <Coffee size={13} />
                <span>结束自动休息</span>
              </button>
              <button
                type="button"
                className={'flow-toggle' + (config.autoStartWork ? ' is-on' : '')}
                aria-pressed={config.autoStartWork}
                onClick={() => {
                  audio.play('tick');
                  set('autoStartWork', !config.autoStartWork);
                }}
              >
                <RotateCw size={13} />
                <span>休完自动续轮</span>
              </button>
            </div>
          ) : (
            <div className="deep-slot-meta">
              <span className="deep-slot-label">
                {countingUp ? '正向累计规则' : '深度计时提示'}
              </span>
              <span className="deep-slot-value">
                {countingUp ? '3 分钟内结束不记入专注档案' : '满 3 分钟自动记录 · 支持表针直调'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Block 2: Dedicated Tactile Switch Modules */}
      <div className="switch-stack">
        <div className={'switch-card' + (config.lock ? ' is-active' : '')}>
          <div className="deck-switch-head">
            <div className="deck-switch-copy">
              <strong>
                <span className="switch-icon-box"><LockKeyhole size={13} /></span>
                沉浸锁定
              </strong>
              <span>
                {config.lock
                  ? `${config.releaseLength} 位校验 · ${config.cooldownSeconds} 秒冷静期`
                  : '全屏置顶并拦截系统切屏热键'}
              </span>
            </div>
            <Toggle label="沉浸锁定" checked={config.lock} disabled={running} onChange={value => set('lock', value)} />
          </div>
        </div>

        <div className={'switch-card is-ambient' + (config.ambient ? ' is-active' : '')}>
          <div className="deck-switch-head">
            <div className="deck-switch-copy">
              <strong>
                <span className="switch-icon-box"><AudioWaveform size={13} /></span>
                环境声景
              </strong>
              <span>
                {config.ambient
                  ? `专注时淡入 · ${ambientStyleLabel[config.ambientStyle].name}`
                  : '仅在专注计时期间平滑播放'}
              </span>
            </div>
            <Toggle label="环境声" checked={config.ambient} onChange={value => set('ambient', value)} />
          </div>
          {config.ambient && (
            <div className="deck-ambient-body">
              <Segmented<AmbientStyle>
                label="环境声景选择"
                value={config.ambientStyle}
                onChange={value => set('ambientStyle', value)}
                options={[
                  { value: 'brown', label: ambientStyleLabel.brown.name },
                  { value: 'rain', label: ambientStyleLabel.rain.name },
                  { value: 'hearth', label: ambientStyleLabel.hearth.name },
                ]}
              />
              <div className="cockpit-volume">
                <button
                  type="button"
                  className="mute-icon-btn"
                  aria-label={config.volume === 0 ? '取消静音' : '一键静音'}
                  title={config.volume === 0 ? '点击恢复音量' : '点击静音'}
                  onClick={() => set('volume', config.volume === 0 ? lastVolumeRef.current : 0)}
                >
                  {config.volume === 0 ? <VolumeX size={13} /> : <Volume2 size={13} />}
                </button>
                <input
                  aria-label="主音量"
                  type="range"
                  min="0"
                  max="100"
                  value={config.volume}
                  style={{ '--pct': `${config.volume}%` } as CSSProperties}
                  onChange={event => set('volume', Number(event.currentTarget.value))}
                  onPointerUp={() => audio.play('tick')}
                />
                <span>{config.volume}%</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Block 3: Restored Original "今日累计专注" Design with Simple Understated Metric Summary */}
      <div className={'today-summary' + (goalMet ? ' is-goal-met' : '')} aria-label="今日累计专注">
        <div className="today-summary-head">
          <span className="today-summary-title">今日累计专注</span>
          <span className="today-streak-badge">
            <Flame size={12} />
            连续 {stats.streak} 天
          </span>
        </div>

        <div className="today-summary-figure">
          <div className="today-big-readout">
            <strong>{stats.todayMin}</strong>
            <span>分钟</span>
          </div>
          <div className="today-goal-meta">
            <span>目标 {config.dailyGoal} 分钟</span>
            <strong>{goalPct}%</strong>
          </div>
        </div>

        <div className="today-progress-track" aria-hidden="true">
          <i style={{ width: `${goalPct}%` }} />
        </div>

        <div className="today-simple-foot" aria-label="今日简洁统计">
          <span>已完成 <b>{stats.todayCount}</b> 场</span>
          <i aria-hidden="true" />
          <span>单场均值 <b>{stats.todayAvgMin > 0 ? `${stats.todayAvgMin} 分` : '—'}</b></span>
          <i aria-hidden="true" />
          <span className={goalMet ? 'is-met' : ''}>
            {goalMet ? '今日目标已达成' : <>距目标 <b>{remainToGoal} 分</b></>}
          </span>
        </div>
      </div>
    </aside>

    <LockConfirmDialog
      open={lockPrompt}
      releaseLength={config.releaseLength}
      cooldownSeconds={config.cooldownSeconds}
      durationMin={config[phase]}
      countingUp={countingUp}
      onCancel={() => setLockPrompt(false)}
      onConfirm={() => {
        setLockPrompt(false);
        send('begin');
      }}
    />
  </div>;
}

function Topic({ value, disabled, set }: {
  value: string; disabled: boolean; set: SetConfig;
}) {
  const [draft, update] = useState(value);
  return <div className="topic-wrap">
    <input
      id="study-topic"
      className="topic"
      type="text"
      maxLength={60}
      disabled={disabled}
      placeholder="例如 · 精读第 3 章或核心架构设计"
      value={draft}
      onChange={event => update(event.currentTarget.value)}
      onBlur={() => {
        const trimmed = draft.trim();
        update(trimmed);
        set('topic', trimmed);
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
    {draft && !disabled && (
      <button
        type="button"
        className="topic-clear"
        aria-label="清空输入"
        title="清空当前输入"
        onMouseDown={event => event.preventDefault()}
        onClick={() => { update(''); set('topic', ''); }}
      >
        <X size={12} />
      </button>
    )}
  </div>;
}

export function Immersion({ state, send }: { state: State; send: Command }) {
  const { config } = state;
  const countingUp = Boolean(state.countingUp || (config.mode === 'deep' && config.deepStyle === 'countup'));
  return <main className="immersion">
    <header>
      <LockKeyhole size={15} />
      <span>沉浸锁定中</span>
      {config.mode === 'pomo' && <span className="immersion-round">· 第 {state.round}/{config.rounds} 轮</span>}
      {countingUp && <span className="immersion-round">· 正向计时</span>}
    </header>
    <div className="immersion-middle">
      <Dial state={state} showTicks={config.dialTicks} smoothSweep={config.dialSecondSweep} immersion />
      {config.topic && <p className="focus-topic">{config.topic}</p>}
    </div>
    <footer className="immersion-foot">
      <button type="button" className="button secondary end-lock" onClick={() => send('end')}>提前结束</button>
      <span className="immersion-hint"><ShieldAlert size={13} />紧急熔断：按住 Ctrl + Shift + Alt + F12 两秒</span>
    </footer>
    {state.release && <Release check={state.release} send={send} />}
  </main>;
}

function Release({ check, send }: { check: ReleaseCheck; send: Command }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const entry = useRef<HTMLInputElement>(null);
  const releaseButton = useRef<HTMLButtonElement>(null);
  const entering = check.wait === null;
  const totalLen = check.length || check.code.length;
  const totalCooldown = Math.max(1, check.cooldown);

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (entering) entry.current?.focus();
    else releaseButton.current?.focus();
  }, [entering, check.code]);

  return <dialog ref={dialog} className="release panel" aria-labelledby="release-title"
    onCancel={event => { event.preventDefault(); send('cancelRelease'); }}>
    <h2 id="release-title">提前结束沉浸锁定</h2>
    {entering ? <>
      <p id="code-help">按顺序键入 {totalLen} 个字符（空格不用输入），输错将立即重置并更换新校验码。</p>
      <div className="challenge-code" aria-label={check.code.match(/.{8}/g)?.join(' ')}>
        {check.code.match(/.{8}/g)?.map((part, group) => <span key={group}>
          {[...part].map((char, index) => {
            const idx = group * 8 + index;
            return <b key={index}
              className={idx < check.count ? 'typed' : idx === check.count ? 'next' : ''}
            >{char}</b>;
          })}</span>)}
      </div>
      <input
        ref={entry}
        className="blind-entry"
        aria-label="逐字符键入校验码"
        aria-describedby="code-help"
        autoComplete="off"
        spellCheck={false}
        placeholder="点击此处并连续键入上方字符..."
        value={'•'.repeat(check.count)}
        onChange={() => {}}
        onPaste={event => event.preventDefault()}
        onDrop={event => event.preventDefault()}
        onKeyDown={event => {
          if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.repeat) return;
          if (event.key.length === 1 || ['Backspace', 'Delete'].includes(event.key)) {
            event.preventDefault();
            send('releaseKey', event.key);
          }
        }}
      />
      <div className="entry-status" role="status">
        <span>{check.error ? '输入有误，已重新生成校验码' : '仅接收单字符键入，禁止粘贴'}</span>
        <span>{check.count} / {totalLen}</span>
      </div>
    </> : <div className="cooldown">
      <p>{check.wait === 0 ? '冷静等待已结束，现在可以确认结束本次专注。' : '校验通过，请等待冷静时间结束。'}</p>
      <div className="digits" role="timer">{readout(check.wait!)}</div>
      <progress value={totalCooldown - check.wait!} max={totalCooldown} aria-label="冷静等待进度" />
    </div>}
    <div className="dialog-actions">
      <button type="button" className="button secondary" onClick={() => send('cancelRelease')}><ArrowLeft />返回专注</button>
      {!entering && <button type="button" ref={releaseButton} className="button primary" disabled={check.wait !== 0}
        onClick={() => send('end')}>确认结束</button>}
    </div>
  </dialog>;
}
