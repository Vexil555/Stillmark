import {
  ArrowLeft, AudioWaveform, ChevronRight, Clock, Flame, LockKeyhole, Pause, Play, ShieldAlert, SkipForward, Volume2, VolumeX, X,
} from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { instrumentAudio as audio } from './audio';
import { Stepper, Toggle } from './controls';
import {
  type AmbientStyle, ambientStyleLabel, bounds, type Check, type Command, isRest, phaseLabel, readout,
  type Session, type SetConfig, type State,
} from './model';

const ticks = Array.from({ length: 60 }, (_, index) => (
  <span className={index % 5 === 0 ? 'graduation major' : 'graduation'}
    key={index} style={{ '--angle': `${index * 6}deg` } as CSSProperties}><i /></span>
));

const TIME_BANDS = [
  { label: '00–06', title: '深夜 (00:00–05:59)' },
  { label: '06–12', title: '上午 (06:00–11:59)' },
  { label: '12–18', title: '下午 (12:00–17:59)' },
  { label: '18–24', title: '夜间 (18:00–23:59)' },
] as const;

function computeTodayStats(records: Session[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = today.getTime() / 1000;
  let todaySec = 0;
  let todayCount = 0;
  let todayCompleted = 0;
  const dayHasFocus = new Set<string>();
  const bands = [0, 0, 0, 0];
  const recentTopics: string[] = [];
  const seenTopics = new Set<string>();

  for (const r of records) {
    const t = r.topic?.trim();
    if (t && !seenTopics.has(t) && recentTopics.length < 4) {
      seenTopics.add(t);
      recentTopics.push(t);
    }
    const overlap = Math.max(0, r.started + r.seconds - Math.max(start, r.started));
    if (overlap > 0) {
      todaySec += overlap;
      if (r.started >= start) {
        todayCount += 1;
        if (r.status === 'complete') todayCompleted += 1;
        const b = Math.min(3, Math.floor(new Date(r.started * 1000).getHours() / 6));
        bands[b] += overlap;
      }
    }
    if (r.seconds >= 180) {
      const d = new Date(r.started * 1000);
      dayHasFocus.add(d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate());
    }
  }

  let streak = 0;
  for (let offset = 0; offset < 365; offset++) {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    const key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    if (dayHasFocus.has(key)) streak += 1;
    else if (offset === 0) continue;
    else break;
  }

  return {
    todayMin: Math.floor(todaySec / 60),
    todayCount,
    todayCompleted,
    streak,
    bands,
    recentTopics,
  };
}

function formatEndTime(secondsLeft: number) {
  const eta = new Date(Date.now() + secondsLeft * 1000);
  return String(eta.getHours()).padStart(2, '0') + ':' + String(eta.getMinutes()).padStart(2, '0');
}

function Dial({ state, showTicks, smoothSweep }: { state: State; showTicks: boolean; smoothSweep: boolean }) {
  const [minutes, seconds] = readout(state.remaining).split(':');
  const rested = isRest(state.phase);
  const dur = Math.max(1, state.duration);
  const rem = smoothSweep ? state.remainingExact : state.remaining;
  const progress = state.running ? Math.min(1, Math.max(0, 1 - rem / dur)) : 0;
  const angle = progress * 360;
  const sweepDeg = angle.toFixed(2);

  return <div className={`dial ${state.running ? 'moving' : ''} ${state.paused ? 'paused' : ''} ${rested ? 'resting' : ''}`}
    style={{ '--sweep': `${sweepDeg}deg` } as CSSProperties}>
    <div className="dial-ring" aria-hidden="true" />
    {showTicks && <div className="dial-track" aria-hidden="true">{ticks}</div>}
    <div className="dial-pointer" aria-hidden="true" style={{ '--angle': `${sweepDeg}deg` } as CSSProperties}><i /></div>
    <div className="dial-body">
      <div className={`digits ${minutes.length > 2 ? 'wide' : ''}`}
        role="timer" aria-label={`${minutes} 分 ${seconds} 秒`}>
        <span>{minutes}</span><b className={state.running && !state.paused ? 'colon-live' : ''}>:</b><span>{seconds}</span>
      </div>
      <div className="dial-caption"><i />{state.paused ? '已暂停' : phaseLabel[state.phase]}<i /></div>
      {state.config.mode === 'pomo' && <span className="round-mark" aria-label={`第 ${state.round} 轮`}>
        {Array.from({ length: state.config.rounds }, (_, i) => (
          <b key={i} className={i < state.round - 1 || (rested && i === state.round - 1) ? 'done'
            : i === state.round - 1 ? 'current' : ''} />
        ))}
      </span>}
    </div>
  </div>;
}

function LockConfirmDialog({
  open,
  releaseLength,
  cooldownSeconds,
  durationMin,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  releaseLength: number;
  cooldownSeconds: number;
  durationMin: number;
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
          <p>本次将持续 <strong>{durationMin} 分钟</strong>，锁定期间会接管全屏并拦截系统切屏键。</p>
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

export function TimerPanel({ state, records, set, send, ready, localDate, openSettings }: {
  state: State; records: Session[]; set: SetConfig; send: Command; ready: boolean; localDate: string; openSettings: () => void;
}) {
  const { config, phase, running, paused } = state;
  const resting = isRest(phase);
  const [lockPrompt, setLockPrompt] = useState(false);
  const [hiddenTopics, setHiddenTopics] = useState<string[]>([]);
  const stats = useMemo(() => computeTodayStats(records), [records, localDate]);
  const lastVolumeRef = useRef(config.volume > 0 ? config.volume : 40);
  if (config.volume > 0) lastVolumeRef.current = config.volume;

  const visibleTopicChips = useMemo(
    () => stats.recentTopics.filter(t => !hiddenTopics.includes(t)),
    [stats.recentTopics, hiddenTopics],
  );

  function handleBeginRequest() {
    if (!ready || running) return;
    if (config.lock && !resting) {
      audio.play('tick');
      setLockPrompt(true);
      return;
    }
    send('begin');
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
  const remainToGoal = Math.max(0, config.dailyGoal - stats.todayMin);
  const etaText = paused ? '暂停中' : formatEndTime(state.remaining);
  const ringRadius = 26;
  const ringCirc = 2 * Math.PI * ringRadius;
  const ringOffset = ringCirc * (1 - goalPct / 100);
  const totalPomoMin = config.rounds * config.work + (config.rounds - 1) * config.short + config.long;
  const runElapsedPct = running ? Math.min(100, Math.round(((state.duration - state.remaining) / Math.max(1, state.duration)) * 100)) : 0;
  const maxBand = Math.max(60, ...stats.bands);
  const currentBandIdx = Math.min(3, Math.floor(new Date().getHours() / 6));

  return <div className="console">
    <section className="instrument panel" aria-label="倒计时">
      <div className="instrument-top">
        <div className="modes" role="group" aria-label="计时模式">
          {(['deep', 'pomo'] as const).map(mode => (
            <button key={mode} type="button" className={config.mode === mode ? 'selected' : ''}
              aria-pressed={config.mode === mode} disabled={running} onClick={() => {
                if (mode !== config.mode) audio.play('tick');
                set('mode', mode);
              }}>{mode === 'deep' ? '深度专注' : '番茄钟'}</button>
          ))}
        </div>
        <span className="phase-pill">
          {config.mode === 'pomo' ? `第 ${state.round} / ${config.rounds} 轮` : `单程 ${config.deep} 分钟`}
        </span>
      </div>

      <div className="dial-area">
        <Dial state={state} showTicks={config.dialTicks} smoothSweep={config.dialSecondSweep} />
      </div>

      <div className="instrument-actions">
        {running ? (
          <>
            {!resting && !state.locked && (
              <button type="button" className="button secondary action-pill"
                onClick={() => {
                  audio.play(paused ? 'resume' : 'pause');
                  send(paused ? 'resume' : 'pause');
                }}>
                {paused ? <Play fill="currentColor" /> : <Pause />}
                {paused ? '继续' : '暂停'}
              </button>
            )}
            <button type="button" className="button secondary start"
              onClick={() => send(resting ? 'skip' : 'end')}>
              {resting ? <SkipForward /> : <X />}{resting ? '跳过休息' : '结束专注'}
            </button>
          </>
        ) : (
          <button type="button" className="button primary start" disabled={!ready} onClick={handleBeginRequest}>
            {config.lock && !resting ? <LockKeyhole size={15} /> : <Play fill="currentColor" />}
            {phase === 'work' && state.round > 1 ? '开始下一轮' : (config.lock && !resting ? '锁定并开始' : '开始专注')}
          </button>
        )}
      </div>
    </section>

    <aside className="session panel">
      <div className="session-head">
        <div>
          <h2>专注控制台</h2>
          <span className="session-eta"><Clock size={12} />{running ? `预计 ${etaText} 结束` : `若现在开始 · ${etaText} 结束`}</span>
        </div>
        <button type="button" className="cockpit-link" onClick={openSettings} title="前往完整设置">
          完整设置 <ChevronRight size={13} />
        </button>
      </div>

      {/* 1. Today Focus Dashboard moved to TOP */}
      <div className="today-dashboard">
        <div className="today-dash-top">
          <div className="today-ring-box">
            <svg className="goal-ring-lg" viewBox="0 0 64 64" aria-hidden="true">
              <circle className="goal-ring-track" cx="32" cy="32" r={ringRadius} />
              <circle className="goal-ring-fill" cx="32" cy="32" r={ringRadius}
                strokeDasharray={ringCirc} strokeDashoffset={ringOffset} />
              <text x="32" y="36" textAnchor="middle">{goalPct}%</text>
            </svg>
          </div>
          <div className="today-hero">
            <div className="today-hero-head">
              <span>今日累计专注</span>
              <span className="today-streak-badge"><Flame size={11} />连续 {stats.streak} 天</span>
            </div>
            <div className="today-hero-num">
              <strong>{stats.todayMin}</strong>
              <span>/ {config.dailyGoal} 分钟</span>
            </div>
            <div className="today-hero-sub">
              <span>{remainToGoal > 0 ? `距目标还差 ${remainToGoal} 分` : '今日目标已达成'}</span>
              <span>完成 {stats.todayCompleted}/{stats.todayCount} 场</span>
            </div>
          </div>
        </div>
        <div className="today-bands-grid" aria-label="今日四大时间段分布">
          {TIME_BANDS.map((band, idx) => {
            const bMin = Math.round(stats.bands[idx] / 60);
            const hPct = stats.bands[idx] > 0 ? Math.max(18, Math.round((stats.bands[idx] / maxBand) * 100)) : 0;
            const isNow = idx === currentBandIdx;
            return (
              <div key={band.label} className={'band-cell' + (isNow ? ' is-now' : '')} title={`${band.title}：${bMin} 分钟`}>
                <div className="band-spark">
                  <i style={{ height: `${hPct}%` }} />
                </div>
                <div className="band-meta">
                  <b>{bMin}m</b>
                  <span>{band.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Topic + Duration + Presets (Identical top structure for both Deep and Pomo) */}
      <div className="cockpit-card">
        <label className="setting-line topic-line" htmlFor="study-topic">
          <span>主题</span>
          <Topic key={config.topic} value={config.topic} disabled={running} set={set} />
        </label>

        {visibleTopicChips.length > 0 && (
          <div className="topic-chips-row" aria-label="最近主题">
            {visibleTopicChips.map(t => (
              <div key={t} className={'topic-chip' + (config.topic === t ? ' is-current' : '')}>
                <button
                  type="button"
                  className="topic-chip-pick"
                  disabled={running}
                  title={`切换主题：${t}`}
                  onClick={() => {
                    audio.play('tick');
                    set('topic', t);
                  }}
                >
                  {t}
                </button>
                <button
                  type="button"
                  className="topic-chip-del"
                  disabled={running}
                  aria-label={`移除常用主题 ${t}`}
                  title="移出快捷标签"
                  onClick={() => {
                    audio.play('tick');
                    setHiddenTopics(prev => [...prev, t]);
                    if (config.topic === t) set('topic', '');
                  }}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="setting-line time-line">
          <span>{resting ? '休息时长' : '时长'}</span>
          <Stepper label={phaseLabel[phase] + '时长'} value={config[phase]} range={bounds[phase]}
            disabled={running} onChange={value => set(phase, value)} />
        </div>

        {!resting && <div className="presets" aria-label="快速设置时长">
          {(phase === 'deep' ? [25, 50, 90] : [15, 25, 45]).map(value => (
            <button type="button" key={value} disabled={running} aria-pressed={config[phase] === value}
              className={config[phase] === value ? 'selected' : ''} onClick={() => {
                if (config[phase] !== value) audio.play('tick');
                set(phase, value);
              }}>{value} 分</button>
          ))}
        </div>}
      </div>

      {/* 3. Cycle Blueprint + Pomo Auto-Flow Toggles */}
      <div className="blueprint-card">
        {config.mode === 'pomo' ? (
          <>
            <div className="blueprint-head">
              <span>番茄周期蓝图 · 全组 {totalPomoMin} 分钟</span>
              <span>{config.rounds} 轮 · {config.short}m/{config.long}m</span>
            </div>
            <div className="cycle-pipeline" aria-label="番茄周期进度">
              {Array.from({ length: config.rounds }, (_, i) => {
                const done = i < state.round - 1 || (resting && i === state.round - 1);
                const active = !resting && i === state.round - 1;
                const restActive = resting && i === state.round - 1;
                return (
                  <div className="cycle-node" key={i}>
                    <span className={'cycle-work' + (done ? ' is-done' : active ? ' is-active' : '')} title={`第 ${i + 1} 轮专注 ${config.work} 分`}>
                      {config.work}
                    </span>
                    <span className={'cycle-rest' + (i === config.rounds - 1 ? ' is-long' : '') + (restActive ? ' is-active' : '')}
                      title={i === config.rounds - 1 ? `长休 ${config.long} 分` : `短休 ${config.short} 分`}>
                      {i === config.rounds - 1 ? config.long : config.short}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="pomo-flow-bar" role="group" aria-label="番茄自动流转设置">
              <button
                type="button"
                className={'flow-pill' + (config.autoStartRest ? ' is-on' : '')}
                aria-pressed={config.autoStartRest}
                onClick={() => {
                  audio.play('tick');
                  set('autoStartRest', !config.autoStartRest);
                }}
              >
                <i /><span>结束自动休息</span>
              </button>
              <button
                type="button"
                className={'flow-pill' + (config.autoStartWork ? ' is-on' : '')}
                aria-pressed={config.autoStartWork}
                onClick={() => {
                  audio.play('tick');
                  set('autoStartWork', !config.autoStartWork);
                }}
              >
                <i /><span>休完自动下一轮</span>
              </button>
            </div>
          </>
        ) : (
          <div className="deep-blueprint">
            <div className="blueprint-head">
              <span>单程深度专注 · {config.deep} 分钟</span>
              <span>{running ? `已完成 ${runElapsedPct}%` : (config.lock ? '强锁防切屏' : '空格可暂停恢复')}</span>
            </div>
            <div className="deep-ruler" aria-hidden="true">
              <div className="deep-ruler-fill" style={{ width: `${running ? runElapsedPct : 0}%` }} />
              <span /><span /><span /><span />
            </div>
            <div className="deep-meta-line">
              <span>记录门槛：≥ 3 分钟自动写入本地档案</span>
              <span>{config.lock ? '支持 F12 紧急熔断' : '支持随时暂停'}</span>
            </div>
          </div>
        )}
      </div>

      {/* 4. Guard & Acoustic Matrix */}
      <div className="cockpit-rules">
        <div className={'rule-tile' + (config.lock ? ' is-armed' : '')}>
          <div className="rule-tile-top">
            <div className="rule-label">
              <LockKeyhole size={14} />
              <div>
                <strong>沉浸锁定</strong>
                <span>{config.lock ? `${config.releaseLength} 位校验 · ${config.cooldownSeconds}s 冷静` : '允许窗口切换与暂停'}</span>
              </div>
            </div>
            <Toggle label="沉浸锁定" checked={config.lock} disabled={running} onChange={value => set('lock', value)} />
          </div>
        </div>

        <div className={'rule-tile' + (config.ambient ? ' is-armed' : '')}>
          <div className="rule-tile-top">
            <div className="rule-label">
              <AudioWaveform size={14} />
              <div>
                <strong>环境声景</strong>
                <span>{config.ambient ? ambientStyleLabel[config.ambientStyle].name : '开启后仅在专注计时期间播放'}</span>
              </div>
            </div>
            <Toggle label="环境声" checked={config.ambient} onChange={value => set('ambient', value)} />
          </div>
          {config.ambient && (
            <>
              <div className="ambient-pills" role="group" aria-label="快速切换声景">
                {(['brown', 'rain', 'hearth'] as AmbientStyle[]).map(style => (
                  <button key={style} type="button" className={config.ambientStyle === style ? 'is-selected' : ''}
                    onClick={() => {
                      if (config.ambientStyle !== style) audio.play('tick');
                      set('ambientStyle', style);
                    }}>{ambientStyleLabel[style].name}</button>
                ))}
              </div>
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
                <input aria-label="主音量" type="range" min="0" max="100" value={config.volume}
                  style={{ '--pct': `${config.volume}%` } as CSSProperties}
                  onChange={event => set('volume', Number(event.currentTarget.value))}
                  onPointerUp={() => audio.play('tick')} />
                <span>{config.volume}%</span>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>

    <LockConfirmDialog
      open={lockPrompt}
      releaseLength={config.releaseLength}
      cooldownSeconds={config.cooldownSeconds}
      durationMin={config[phase]}
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
    <input id="study-topic" className="topic" type="text" maxLength={60} disabled={disabled}
      placeholder="例如 · 精读第 3 章或核心架构设计" value={draft} onChange={event => update(event.currentTarget.value)}
      onBlur={() => {
        const trimmed = draft.trim();
        update(trimmed);
        set('topic', trimmed);
      }} onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }} />
    {draft && !disabled && (
      <button type="button" className="topic-clear" aria-label="清空输入" title="清空当前输入"
        onMouseDown={event => event.preventDefault()}
        onClick={() => { update(''); set('topic', ''); }}>
        <X size={12} />
      </button>
    )}
  </div>;
}

export function Immersion({ state, send }: { state: State; send: Command }) {
  const { config } = state;
  return <main className="immersion">
    <header>
      <LockKeyhole size={15} />
      <span>沉浸锁定中</span>
      {config.mode === 'pomo' && <span className="immersion-round">· 第 {state.round}/{config.rounds} 轮</span>}
    </header>
    <div className="immersion-middle">
      <Dial state={state} showTicks={config.dialTicks} smoothSweep={config.dialSecondSweep} />
      {config.topic && <p className="focus-topic">{config.topic}</p>}
    </div>
    <footer className="immersion-foot">
      <button type="button" className="button secondary end-lock" onClick={() => send('end')}>提前结束</button>
      <span className="immersion-hint"><ShieldAlert size={13} />紧急熔断：按住 Ctrl + Shift + Alt + F12 两秒</span>
    </footer>
    {state.release && <Release check={state.release} send={send} />}
  </main>;
}

function Release({ check, send }: { check: Check; send: Command }) {
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
      <input ref={entry} className="blind-entry" aria-label="逐字符键入校验码"
        aria-describedby="code-help" autoComplete="off" spellCheck={false}
        placeholder="点击此处并连续键入上方字符..."
        value={'•'.repeat(check.count)} onChange={() => {}}
        onPaste={event => event.preventDefault()} onDrop={event => event.preventDefault()}
        onKeyDown={event => {
          if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.repeat) return;
          if (event.key.length === 1 || ['Backspace', 'Delete'].includes(event.key)) {
            event.preventDefault();
            send('releaseKey', event.key);
          }
        }} />
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
