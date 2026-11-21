import {
  ArrowLeft, AudioWaveform, ChevronRight, LockKeyhole, Pause, Play, ShieldAlert, SkipForward, Volume2, VolumeX, X,
} from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { computeTodayStats } from './analytics';
import { instrumentAudio as audio } from './audio';
import { Segmented, Stepper, Toggle } from './controls';
import {
  type AmbientStyle, ambientStyleLabel, bounds, type Check, type Command, isRest, phaseLabel, readout,
  type Session, type SetConfig, type State,
} from './model';

const DIAL_CENTER = 160;
const PROGRESS_R = 148;
const PROGRESS_CIRC = 2 * Math.PI * PROGRESS_R;

const SVG_TICKS = Array.from({ length: 60 }, (_, index) => {
  const angleRad = ((index * 6) - 90) * (Math.PI / 180);
  const isCardinal = index % 15 === 0;
  const isMajor = index % 5 === 0;
  const outer = 142;
  const inner = isCardinal ? 128 : isMajor ? 131 : 136;
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

const CARDINALS = [
  { label: '60', x: 160, y: 57 },
  { label: '15', x: 264, y: 163.5 },
  { label: '30', x: 160, y: 270 },
  { label: '45', x: 56, y: 163.5 },
] as const;

function formatEndTime(secondsLeft: number) {
  const eta = new Date(Date.now() + secondsLeft * 1000);
  return `${String(eta.getHours()).padStart(2, '0')}:${String(eta.getMinutes()).padStart(2, '0')}`;
}

export function Dial({
  state,
  showTicks,
  smoothSweep,
  immersion = false,
}: {
  state: State;
  showTicks: boolean;
  smoothSweep: boolean;
  immersion?: boolean;
}) {
  const [minutes, seconds] = readout(state.remaining).split(':');
  const rested = isRest(state.phase);
  const dur = Math.max(1, state.duration);
  const rem = smoothSweep ? state.remainingExact : state.remaining;
  const progress = state.running ? Math.min(1, Math.max(0, 1 - rem / dur)) : 0;
  const angle = progress * 360;
  const sweepDeg = angle.toFixed(2);
  const dashOffset = PROGRESS_CIRC * (1 - progress);
  const etaText = state.paused ? '已暂停' : formatEndTime(state.remaining);

  return (
    <div
      className={
        `dial ${state.running ? 'moving' : ''} ${state.paused ? 'paused' : ''} ${rested ? 'resting' : ''}` +
        (immersion ? ' is-immersion' : '')
      }
    >
      <svg className="dial-svg" viewBox="0 0 320 320" aria-hidden="true">
        {/* Recessed architectural chapter rings */}
        <circle className="dial-chapter-outer" cx={DIAL_CENTER} cy={DIAL_CENTER} r={PROGRESS_R} />
        <circle className="dial-chapter-inner" cx={DIAL_CENTER} cy={DIAL_CENTER} r="121" />

        {/* Subtle progress track + crisp active progress arc */}
        <circle
          className="dial-arc-fill"
          cx={DIAL_CENTER}
          cy={DIAL_CENTER}
          r={PROGRESS_R}
          strokeDasharray={PROGRESS_CIRC}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${DIAL_CENTER} ${DIAL_CENTER})`}
        />

        {/* 60 Precision Horological Graduations */}
        {showTicks && (
          <g className="dial-ticks-group">
            {SVG_TICKS.map(t => (
              <line
                key={t.index}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                className={t.isCardinal ? 'tick-cardinal' : t.isMajor ? 'tick-major' : 'tick-minor'}
              />
            ))}
            {CARDINALS.map(mark => (
              <text key={mark.label} x={mark.x} y={mark.y} className="dial-cardinal-num" textAnchor="middle">
                {mark.label}
              </text>
            ))}
          </g>
        )}

        {/* Sculpted sweeping baton index pointer cleanly confined to outer graduation track */}
        <g
          className="dial-hand-group"
          style={{ transform: `rotate(${sweepDeg}deg)`, transformOrigin: '160px 160px' }}
        >
          <rect x="157.8" y="10" width="4.4" height="24" rx="2.2" className="dial-hand-baton" />
        </g>
      </svg>

      <div className="dial-body">
        <div className="dial-kicker">
          {state.config.mode === 'pomo'
            ? `第 ${state.round} / ${state.config.rounds} 轮`
            : `${Math.round(dur / 60)} MIN`}
        </div>
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
          <span>{state.paused ? '已暂停' : phaseLabel[state.phase]}</span>
          <i />
        </div>
        <div className="dial-register">
          {state.config.mode === 'pomo' ? (
            <span className="round-mark" aria-label={`第 ${state.round} 轮，共 ${state.config.rounds} 轮`}>
              {Array.from({ length: state.config.rounds }, (_, i) => (
                <b
                  key={i}
                  className={
                    i < state.round - 1 || (rested && i === state.round - 1)
                      ? 'done'
                      : i === state.round - 1
                        ? 'current'
                        : ''
                  }
                />
              ))}
            </span>
          ) : (
            <span className="dial-eta-mark">
              {state.running ? (state.paused ? '等待恢复' : `预计 ${etaText} 结束`) : `预计 ${etaText} 完成`}
            </span>
          )}
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
  const totalPomoMin = config.rounds * config.work + (config.rounds - 1) * config.short + config.long;

  return <div className="console">
    <section className={'instrument panel' + (resting ? ' is-resting' : '')} aria-label="倒计时仪表">
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
                if (mode !== config.mode) audio.play('tick');
                set('mode', mode);
              }}
            >
              {mode === 'deep' ? '深度专注' : '番茄钟'}
            </button>
          ))}
        </div>
        <div className="instrument-meta">
          {config.topic.trim()
            ? <span className="instrument-topic" title={config.topic}>{config.topic}</span>
            : <span>{resting ? '休息阶段 · 放松片刻' : (config.lock ? '沉浸锁定已就绪' : '按空格键快速启停')}</span>}
        </div>
      </div>

      <div className="dial-area">
        <Dial state={state} showTicks={config.dialTicks} smoothSweep={config.dialSecondSweep} />
      </div>

      <div className="instrument-foot">
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
                className={'button start ' + (resting ? 'rest-action' : 'secondary')}
                onClick={() => send(resting ? 'skip' : 'end')}
              >
                {resting ? <SkipForward /> : <X />}
                {resting ? '跳过休息' : '结束专注'}
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
                : phase === 'work' && state.round > 1
                  ? `开始第 ${state.round} 轮`
                  : config.lock
                    ? '锁定并开始'
                    : '开始专注'}
            </button>
          )}
        </div>
      </div>
    </section>

    <aside className="session panel" aria-label="本次设定">
      <div className="session-head">
        <div>
          <h2>本次设定</h2>
          <span className="session-eta">
            {running ? `预计 ${etaText} 结束` : `若现在开始 · 预计 ${etaText} 结束`}
          </span>
        </div>
        <button type="button" className="text-action-link" onClick={openSettings}>
          完整设置 <ChevronRight size={13} />
        </button>
      </div>

      <div className="deck-section">
        <label className="setting-line" htmlFor="study-topic">
          <span>主题</span>
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
                  title="移出快捷记录"
                  onClick={() => {
                    audio.play('tick');
                    setHiddenTopics(prev => [...prev, t]);
                    if (config.topic === t) set('topic', '');
                  }}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="setting-line">
          <span>{resting ? '休息' : '时长'}</span>
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
      </div>

      {/* Pomodoro Cadence ONLY in Pomo Mode — Deep Mode stays serene and uncluttered */}
      {config.mode === 'pomo' && (
        <div className="deck-section pomo-cadence">
          <div className="deck-subhead">
            <span>番茄节拍</span>
            <span>全组 {totalPomoMin} 分 · {config.rounds} 轮</span>
          </div>
          <div className="cycle-pipeline" aria-label="番茄周期进度">
            {Array.from({ length: config.rounds }, (_, i) => {
              const done = i < state.round - 1 || (resting && i === state.round - 1);
              const active = !resting && i === state.round - 1;
              const restActive = resting && i === state.round - 1;
              return (
                <div className="cycle-node" key={i}>
                  <span
                    className={'cycle-work' + (done ? ' is-done' : active ? ' is-active' : '')}
                    title={`第 ${i + 1} 轮专注 ${config.work} 分`}
                  >
                    {config.work}
                  </span>
                  <span
                    className={'cycle-rest' + (i === config.rounds - 1 ? ' is-long' : '') + (restActive ? ' is-active' : '')}
                    title={i === config.rounds - 1 ? `长休 ${config.long} 分` : `短休 ${config.short} 分`}
                  >
                    {i === config.rounds - 1 ? config.long : config.short}
                  </span>
                </div>
              );
            })}
          </div>
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
              <span>结束自动休息</span>
              <b>{config.autoStartRest ? '开' : '关'}</b>
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
              <span>休完自动续轮</span>
              <b>{config.autoStartWork ? '开' : '关'}</b>
            </button>
          </div>
        </div>
      )}

      <div className="deck-section deck-switches">
        <div className="deck-switch-row">
          <div className="deck-switch-copy">
            <strong>
              <LockKeyhole size={13.5} />
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

        <div className="deck-switch-row is-ambient">
          <div className="deck-switch-head">
            <div className="deck-switch-copy">
              <strong>
                <AudioWaveform size={13.5} />
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

      <div className="deck-today" aria-label="今日专注刻度">
        <div className="deck-today-top">
          <span className="deck-today-label">今日刻度</span>
          <span className="deck-today-meta">
            {stats.todayCount} 场 · 连续 {stats.streak} 天
          </span>
        </div>
        <div className="deck-today-row">
          <div className="deck-today-num">
            <strong>{stats.todayMin}</strong>
            <span>/ {config.dailyGoal} 分钟</span>
          </div>
          <span className="deck-today-pct">{goalPct}%</span>
        </div>
        <div className="deck-today-bar" aria-hidden="true">
          <i style={{ width: `${goalPct}%` }} />
        </div>
        <div className="deck-today-foot">
          <span>{remainToGoal > 0 ? `距今日目标还差 ${remainToGoal} 分钟` : '今日专注目标已达成'}</span>
          <span>满 3 分钟计入档案</span>
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
  return <main className="immersion">
    <header>
      <LockKeyhole size={15} />
      <span>沉浸锁定中</span>
      {config.mode === 'pomo' && <span className="immersion-round">· 第 {state.round}/{config.rounds} 轮</span>}
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
