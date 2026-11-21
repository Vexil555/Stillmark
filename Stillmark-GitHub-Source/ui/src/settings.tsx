import {
  Clock3, Database, FolderOpen, Moon, Play, RotateCcw, ShieldAlert, Sliders, Sun, Trash2, Volume2,
} from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { instrumentAudio as audio } from './audio';
import { Segmented, Stepper, Toggle } from './controls';
import {
  type AmbientStyle, ambientStyleLabel, bounds, type Command, resolveTheme, type SetConfig, type State, type Theme,
} from './model';

type CategoryId = 'appearance' | 'sound' | 'rhythm' | 'recovery' | 'local-data';

const categories: { id: CategoryId; label: string; desc: string; icon: React.ReactNode }[] = [
  { id: 'appearance', label: '外观与表盘', desc: '主题、刻度与走针', icon: <Sun size={15} /> },
  { id: 'sound', label: '声学与环境声', desc: '反馈音与三款声景', icon: <Volume2 size={15} /> },
  { id: 'rhythm', label: '计时节奏与目标', desc: '番茄轮次与每日目标', icon: <Clock3 size={15} /> },
  { id: 'recovery', label: '沉浸锁定与安全', desc: '校验码与熔断机制', icon: <ShieldAlert size={15} /> },
  { id: 'local-data', label: '本地数据与维护', desc: 'SQLite 存储与导出', icon: <Database size={15} /> },
];

const MINI_TICKS = Array.from({ length: 24 }, (_, i) => {
  const rad = ((i * 15) - 90) * (Math.PI / 180);
  const major = i % 6 === 0;
  return {
    i,
    major,
    x1: (32 + 27 * Math.cos(rad)).toFixed(2),
    y1: (32 + 27 * Math.sin(rad)).toFixed(2),
    x2: (32 + (major ? 22 : 24.5) * Math.cos(rad)).toFixed(2),
    y2: (32 + (major ? 22 : 24.5) * Math.sin(rad)).toFixed(2),
  };
});

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function SettingRow({
  title,
  description,
  control,
  disabled,
  note,
}: {
  title: string;
  description: string;
  control: React.ReactNode;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <div className={'preference-row' + (disabled ? ' is-disabled' : '')}>
      <div className="preference-copy">
        <div className="preference-title-line">
          <span className="preference-title">{title}</span>
          {note && <span className="preference-note">· {note}</span>}
        </div>
        <p className="preference-desc">{description}</p>
      </div>
      <div className="preference-control">{control}</div>
    </div>
  );
}

function RangeControl({
  id,
  label,
  value,
  onChange,
  onTest,
  testLabel,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  onTest: () => void;
  testLabel: string;
}) {
  return (
    <div className="volume-row">
      <div className="volume">
        <input
          id={id}
          aria-label={label}
          type="range"
          min="0"
          max="100"
          value={value}
          style={{ '--pct': `${value}%` } as CSSProperties}
          onChange={event => onChange(Number(event.currentTarget.value))}
          onPointerUp={onTest}
        />
        <output htmlFor={id}>{value}%</output>
      </div>
      <button type="button" className="button secondary mini-btn" onClick={onTest} title={testLabel}>
        <Play size={11} />试听
      </button>
    </div>
  );
}

export function Settings({ state, set, send }: { state: State; set: SetConfig; send: Command }) {
  const { config, running, dbStats } = state;
  const [activeCat, setActiveCat] = useState<CategoryId>('appearance');
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const sectionRefs = useRef<Partial<Record<CategoryId, HTMLElement | null>>>({});

  const resolvedTheme = resolveTheme(config.theme);

  useEffect(() => {
    const scrollRoot = document.querySelector('.page') as HTMLElement | null;
    if (!scrollRoot) return;
    let raf = 0;

    const updateActive = () => {
      raf = 0;
      const rootRect = scrollRoot.getBoundingClientRect();
      const atBottom = scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - 10;
      if (atBottom) {
        setActiveCat('local-data');
        return;
      }
      const threshold = rootRect.top + 110;
      let current: CategoryId = 'appearance';
      for (const cat of categories) {
        const el = sectionRefs.current[cat.id];
        if (!el) continue;
        if (el.getBoundingClientRect().top <= threshold) {
          current = cat.id;
        }
      }
      setActiveCat(current);
    };

    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(updateActive);
    };

    scrollRoot.addEventListener('scroll', onScroll, { passive: true });
    updateActive();
    return () => {
      scrollRoot.removeEventListener('scroll', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  function jumpTo(id: CategoryId) {
    setActiveCat(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return <div className="settings-studio">
    <aside className="settings-nav panel" aria-label="设置分类导航">
      <div className="studio-preview" data-preview-theme={resolvedTheme}>
        <div className="preview-dial-mini">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="29" className="mini-rim" />
            {config.dialTicks && MINI_TICKS.map(t => (
              <line
                key={t.i}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                className={t.major ? 'mini-tick-major' : 'mini-tick'}
              />
            ))}
            <rect x="30.8" y="3.5" width="2.4" height="7" rx="1.2" className="mini-hand" />
          </svg>
          <strong>{String(config.mode === 'deep' ? config.deep : config.work).padStart(2, '0')}:00</strong>
        </div>
        <div className="preview-meta">
          <span>实时仪表摘要</span>
          <strong>{resolvedTheme === 'dark' ? '炭黑夜间' : '暖白宣纸'} · {config.dialSecondSweep ? '连续扫秒' : '机械跳秒'}</strong>
          <small>{config.ambient ? `声景：${ambientStyleLabel[config.ambientStyle].name}` : '声景：已关闭'} · 目标 {config.dailyGoal}m</small>
        </div>
      </div>

      <div className="cat-list">
        {categories.map(cat => (
          <button
            key={cat.id}
            type="button"
            className={'cat-btn' + (activeCat === cat.id ? ' is-active' : '')}
            onClick={() => jumpTo(cat.id)}
          >
            <span className="cat-icon">{cat.icon}</span>
            <span className="cat-copy">
              <strong>{cat.label}</strong>
              <small>{cat.desc}</small>
            </span>
          </button>
        ))}
      </div>
    </aside>

    <div className="settings-main">
      {running && (
        <div className="settings-banner" role="status">
          <Sliders size={14} />
          <span>计时进行中：时长、轮次与锁定策略已锁定；外观、声景与每日目标仍可实时微调。</span>
        </div>
      )}

      <section
        ref={el => { sectionRefs.current.appearance = el; }}
        data-cat="appearance"
        className="panel settings-card"
        aria-labelledby="appearance"
      >
        <div className="settings-card-head">
          <div className="section-badge"><Sun size={15} /></div>
          <div>
            <h2 id="appearance">外观与表盘</h2>
            <p>定制宣纸 / 炭黑材质、精密刻度环、指针走动曲线与物理缓动反馈。</p>
          </div>
        </div>
        <div className="settings-fields">
          <SettingRow
            title="界面主题"
            description="浅色采用暖白宣纸与朱红刻线；深色采用炭黑与暖橙高对比，亦可点击页面右上角快速切换。"
            control={
              <Segmented<Theme>
                label="界面主题"
                value={resolvedTheme}
                onChange={value => set('theme', value)}
                options={[
                  { value: 'light', label: '浅色', icon: <Sun /> },
                  { value: 'dark', label: '深色', icon: <Moon /> },
                ]}
              />
            }
          />
          <SettingRow
            title="表盘 60 道刻线"
            description="在表盘外环绘制 60 枚分度刻线与四向方位数字，关闭后呈现极简进度光环。"
            control={
              <Toggle label="表盘 60 道刻线" checked={config.dialTicks} onChange={value => set('dialTicks', value)} />
            }
          />
          <SettingRow
            title="指针连续扫动"
            description="开启后按 125ms 精度丝滑推移；关闭则每秒咔嗒步进一格，还原传统机械秒表走针感。"
            control={
              <Toggle label="指针连续扫动" checked={config.dialSecondSweep} onChange={value => set('dialSecondSweep', value)} />
            }
          />
          <SettingRow
            title="界面动效"
            description="控制开关拨动、视图切换与微回弹手感；若系统已开启“减少动态效果”会自动顺从屏蔽。"
            control={
              <Toggle label="界面动效" checked={config.motion} onChange={value => set('motion', value)} />
            }
          />
        </div>
      </section>

      <section
        ref={el => { sectionRefs.current.sound = el; }}
        data-cat="sound"
        className="panel settings-card"
        aria-labelledby="sound"
      >
        <div className="settings-card-head">
          <div className="section-badge"><Volume2 size={15} /></div>
          <div>
            <h2 id="sound">声学与环境声</h2>
            <p>全部提示音与白噪音均由内置 Web Audio DSP 实时合成，零外部音频依赖。</p>
          </div>
        </div>
        <div className="settings-fields">
          <SettingRow
            title="机械反馈与阶段提示"
            description="操作拨片开关、调节参数时触发机械卡榫音效，专注开始 / 暂停 / 休息切换时播报和弦提示。"
            control={
              <Toggle label="机械反馈与阶段提示" checked={config.sound} onChange={value => set('sound', value)} />
            }
          />
          <SettingRow
            title="主音量"
            description="全局控制所有机械反馈音、阶段提示音与专注环境声的母线输出电平。"
            control={
              <RangeControl
                id="volume"
                label="主音量"
                value={config.volume}
                onChange={v => set('volume', v)}
                onTest={() => audio.play('tick', true)}
                testLabel="试听校音"
              />
            }
          />
          <SettingRow
            title="阶段提示音量"
            description="在主音量基础上单独微调开始、暂停、休息和结束提示音的响度比例。"
            control={
              <RangeControl
                id="chime-volume"
                label="阶段提示音量"
                value={config.chimeVolume}
                onChange={v => set('chimeVolume', v)}
                onTest={() => audio.play('start', true)}
                testLabel="试听开始提示音"
              />
            }
          />
          <SettingRow
            title="专注环境声"
            description="仅在专注计时运行期间平滑淡入底噪，暂停、进入休息或结束时自动淡出静音。"
            control={
              <Toggle label="专注环境声" checked={config.ambient} onChange={value => set('ambient', value)} />
            }
          />
          <SettingRow
            title="环境声景类型"
            description={ambientStyleLabel[config.ambientStyle].desc}
            control={
              <div className="ambient-select-wrap">
                <Segmented<AmbientStyle>
                  label="环境声景类型"
                  value={config.ambientStyle}
                  onChange={value => set('ambientStyle', value)}
                  options={[
                    { value: 'brown', label: ambientStyleLabel.brown.name },
                    { value: 'rain', label: ambientStyleLabel.rain.name },
                    { value: 'hearth', label: ambientStyleLabel.hearth.name },
                  ]}
                />
                <button
                  type="button"
                  className="button secondary mini-btn"
                  onClick={() => audio.previewAmbient(config.ambientStyle)}
                >
                  <Play size={11} />试听 3 秒
                </button>
              </div>
            }
          />
        </div>
      </section>

      <section
        ref={el => { sectionRefs.current.rhythm = el; }}
        data-cat="rhythm"
        className="panel settings-card"
        aria-labelledby="rhythm"
      >
        <div className="settings-card-head">
          <div className="section-badge"><Clock3 size={15} /></div>
          <div>
            <h2 id="rhythm">计时节奏与目标</h2>
            <p>调节深度专注时长、番茄四段节拍、自动化流转与每日专注目标基线。</p>
          </div>
        </div>
        <div className="settings-fields">
          <SettingRow
            title="深度专注默认时长"
            note={running ? '计时中锁定' : undefined}
            description="深度专注的默认计时长度（1–180 分钟），计时台亦支持 25 / 50 / 90 分钟一键切换。"
            disabled={running}
            control={
              <Stepper label="深度专注时长" value={config.deep} range={bounds.deep} disabled={running}
                onChange={value => set('deep', value)} />
            }
          />
          <SettingRow
            title="番茄专注时长"
            note={running ? '计时中锁定' : undefined}
            description="每轮番茄工作阶段时长（1–120 分钟），完成后自动计入专注流水档案。"
            disabled={running}
            control={
              <Stepper label="番茄专注时长" value={config.work} range={bounds.work} disabled={running}
                onChange={value => set('work', value)} />
            }
          />
          <SettingRow
            title="短休时长"
            note={running ? '计时中锁定' : undefined}
            description="每轮番茄工作结束后触发的短休恢复时间（1–45 分钟），休息期不强制锁屏。"
            disabled={running}
            control={
              <Stepper label="短休时长" value={config.short} range={bounds.short} disabled={running}
                onChange={value => set('short', value)} />
            }
          />
          <SettingRow
            title="长休时长"
            note={running ? '计时中锁定' : undefined}
            description="跑完一整组番茄轮次后进入的大段休息时间（1–90 分钟）。"
            disabled={running}
            control={
              <Stepper label="长休时长" value={config.long} range={bounds.long} disabled={running}
                onChange={value => set('long', value)} />
            }
          />
          <SettingRow
            title="每组番茄轮数"
            note={running ? '计时中锁定' : undefined}
            description="每连续完成多少轮番茄专注后切换为长休息（2–8 轮），计时台番茄节拍同步展示全部节点。"
            disabled={running}
            control={
              <Stepper label="每组轮数" value={config.rounds} range={bounds.rounds} disabled={running}
                unit="轮" onChange={value => set('rounds', value)} />
            }
          />
          <SettingRow
            title="专注结束自动开始休息"
            description="开启后番茄工作归零即刻流转至短休 / 长休；关闭则停留在待命状态等你手动点击。"
            control={
              <Toggle label="专注结束自动开始休息" checked={config.autoStartRest}
                onChange={value => set('autoStartRest', value)} />
            }
          />
          <SettingRow
            title="休息结束自动开始下一轮"
            description="开启后休息归零立即开启下一轮工作；默认关闭以免打断你的自由喘息时间。"
            control={
              <Toggle label="休息结束自动开始下一轮" checked={config.autoStartWork}
                onChange={value => set('autoStartWork', value)} />
            }
          />
          <SettingRow
            title="每日专注目标"
            description="同时驱动计时台今日刻度与专注记录热力图的色阶基准（15–720 分钟，步进 15 分）。"
            control={
              <Stepper label="每日专注目标" value={config.dailyGoal} range={bounds.dailyGoal} step={15}
                onChange={value => set('dailyGoal', value)} />
            }
          />
        </div>
      </section>

      <section
        ref={el => { sectionRefs.current.recovery = el; }}
        data-cat="recovery"
        className="panel settings-card"
        aria-labelledby="recovery"
      >
        <div className="settings-card-head">
          <div className="section-badge"><ShieldAlert size={15} /></div>
          <div>
            <h2 id="recovery">沉浸锁定与安全恢复</h2>
            <p>开启沉浸锁定时，全屏置顶遮罩所有显示器并由独立 Windows 守护进程屏蔽系统切换键。</p>
          </div>
        </div>
        <div className="settings-fields recovery">
          <SettingRow
            title="提前退出校验码长度"
            note={running ? '计时中锁定' : undefined}
            description="锁定时申请提前结束须逐字符键入随机防粘贴校验码长度（16–64 位），输入错一字立即重抽。"
            disabled={running}
            control={
              <Stepper label="校验码长度" value={config.releaseLength} range={bounds.releaseLength} step={8}
                disabled={running} unit="位" onChange={value => set('releaseLength', value)} />
            }
          />
          <SettingRow
            title="校验通过后冷静等待"
            note={running ? '计时中锁定' : undefined}
            description="校验码全对后需静待的缓冲秒数（0–300 秒，步进 30 秒），设为 0 秒则验证完毕立即解锁。"
            disabled={running}
            control={
              <Stepper label="冷静等待" value={config.cooldownSeconds} range={bounds.cooldownSeconds} step={30}
                disabled={running} unit="秒" onChange={value => set('cooldownSeconds', value)} />
            }
          />
          <div className="recovery-box">
            <div className="recovery-line">
              <strong>锁定期间拦截按键</strong>
              <span><code>Win</code> <code>Alt+Tab</code> <code>Alt+Esc</code> <code>Alt+F4</code> <code>Alt+Space</code> <code>Ctrl+Esc</code></span>
            </div>
            <div className="recovery-line">
              <strong>紧急物理熔断热键</strong>
              <span>同时按住 <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Alt</kbd> <kbd>F12</kbd> 满 2 秒强制解除所有钩子与置顶</span>
            </div>
            <div className="recovery-line">
              <strong>Windows 安全注意键</strong>
              <span>系统保留 <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>Delete</kbd> 永不被拦截，守护心跳失效时自动释放键盘</span>
            </div>
          </div>
        </div>
      </section>

      <section
        ref={el => { sectionRefs.current['local-data'] = el; }}
        data-cat="local-data"
        className="panel settings-card"
        aria-labelledby="local-data"
      >
        <div className="settings-card-head">
          <div className="section-badge"><Database size={15} /></div>
          <div>
            <h2 id="local-data">本地数据与维护</h2>
            <p>所有偏好参数与专注历史均存储在本地离线 SQLite 数据库，绝不联网或上传遥测。</p>
          </div>
        </div>
        <div className="settings-fields data-fields">
          <div className="data-summary">
            <div><span>已存档专注</span><strong>{dbStats.count} 条</strong></div>
            <div><span>数据库体积</span><strong>{formatBytes(dbStats.bytes)}</strong></div>
            <div><span>事务模式</span><strong>SQLite WAL</strong></div>
          </div>
          <div className="data-actions">
            <button type="button" className="button secondary" onClick={() => send('data')}>
              <FolderOpen />打开数据目录
            </button>
            <button type="button" className="button secondary" onClick={() => send('export')}>
              导出全部 CSV
            </button>
            {!confirmReset ? (
              <button type="button" className="button secondary" disabled={running}
                onClick={() => setConfirmReset(true)}>
                <RotateCcw />恢复默认设置
              </button>
            ) : (
              <div className="inline-confirm">
                <span>还原所有偏好至初始状态？</span>
                <button type="button" className="button primary" disabled={running} onClick={() => {
                  send('resetSettings');
                  setConfirmReset(false);
                }}>确认还原</button>
                <button type="button" className="button secondary" onClick={() => setConfirmReset(false)}>取消</button>
              </div>
            )}
            {!confirmClear ? (
              <button type="button" className="button danger-ghost" disabled={running || dbStats.count === 0}
                onClick={() => setConfirmClear(true)}>
                <Trash2 />清空历史记录
              </button>
            ) : (
              <div className="inline-confirm">
                <span>确认永久删除全部 {dbStats.count} 条记录？</span>
                <button type="button" className="button primary" disabled={running} onClick={() => {
                  send('clearHistory');
                  setConfirmClear(false);
                }}>确认清空</button>
                <button type="button" className="button secondary" onClick={() => setConfirmClear(false)}>取消</button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  </div>;
}