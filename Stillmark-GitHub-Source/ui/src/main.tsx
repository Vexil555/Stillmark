import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import {
  ChartNoAxesColumnIncreasing, Minus, Moon, Settings2, Square, SquaresIntersect, Sun, Timer as TimerIcon, X,
} from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { instrumentAudio as audio } from './audio';
import { History } from './history';
import {
  type Command, initialState, isRest, phaseLabel, readout, resolveTheme, type Session, type SetConfig, type State, type Theme,
} from './model';
import { createPreviewBridge, type StillmarkBridgeObject } from './previewBridge';
import { Settings } from './settings';
import { Immersion, TimerPanel } from './timer';
import './styles.css';

type Channel = {
  objects: {
    stillmark: StillmarkBridgeObject;
  };
};

declare global {
  interface Window {
    qt?: { webChannelTransport: unknown };
    QWebChannel?: new (transport: unknown, onReady: (channel: Channel) => void) => Channel;
  }
}

type View = 'timer' | 'history' | 'settings';
const tabs = [
  { id: 'timer', title: '计时台', icon: TimerIcon },
  { id: 'history', title: '专注记录', icon: ChartNoAxesColumnIncreasing },
  { id: 'settings', title: '设置', icon: Settings2 },
] as const;
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
});
const resizeEdges = [
  ['n', 1], ['w', 2], ['e', 4], ['s', 8], ['nw', 3], ['ne', 5], ['sw', 10], ['se', 12],
] as const;

function useDesktop() {
  const [state, update] = useState(initialState);
  const [records, setRecords] = useState<Session[]>([]);
  const [native, connect] = useState<StillmarkBridgeObject>();
  const [maximized, setMaximized] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  useEffect(() => {
    const wire = (stillmark: StillmarkBridgeObject) => {
      stillmark.initialize(payload => {
        const data = JSON.parse(payload) as { state: State; records: Session[]; maximized: boolean };
        update(data.state);
        setRecords(data.records);
        setMaximized(data.maximized);
        connect(stillmark);
      });
      stillmark.changed.connect(payload => update(JSON.parse(payload)));
      stillmark.recorded.connect(payload => setRecords(JSON.parse(payload)));
      stillmark.chime.connect(gesture => audio.play(gesture));
      stillmark.maximized.connect(setMaximized);
    };

    // Always prefer the real Qt WebChannel when running inside the Windows desktop host
    if (window.QWebChannel && window.qt) {
      new window.QWebChannel(window.qt.webChannelTransport, ({ objects: { stillmark } }) => {
        wire(stillmark);
      });
      return;
    }

    // Only activate the browser mock bridge during Vite dev preview;
    // production builds outside Qt stay in the native connection-waiting state.
    if (import.meta.env.DEV) {
      const mock = createPreviewBridge();
      setPreviewMode(true);
      wire(mock);
      return () => mock.dispose?.();
    }
  }, []);

  const send: Command = (name, value = '') => native?.dispatch(name, value);
  const set: SetConfig = (key, value) => send('set', JSON.stringify([key, value]));
  return { state, records, send, set, maximized, ready: Boolean(native), previewMode };
}

function useLocalDate() {
  const readDate = () => dateFormat.format(new Date());
  const [date, setDate] = useState(readDate);
  useEffect(() => {
    const timer = window.setInterval(() => setDate(readDate()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  return date;
}

function ThemeSwitch({ theme, change }: { theme: Theme; change: (theme: Theme) => void }) {
  const resolved = resolveTheme(theme);
  return (
    <div className="theme-switch" role="group" aria-label="界面主题">
      <button
        type="button"
        className={resolved === 'light' ? 'is-active' : ''}
        aria-label="浅色主题"
        aria-pressed={resolved === 'light'}
        title="暖白宣纸主题"
        onClick={() => {
          if (resolved !== 'light') {
            audio.play('tick');
            change('light');
          }
        }}
      >
        <Sun />
      </button>
      <button
        type="button"
        className={resolved === 'dark' ? 'is-active' : ''}
        aria-label="深色主题"
        aria-pressed={resolved === 'dark'}
        title="炭黑夜间主题"
        onClick={() => {
          if (resolved !== 'dark') {
            audio.play('tick');
            change('dark');
          }
        }}
      >
        <Moon />
      </button>
    </div>
  );
}

function TitleBar({ maximized, send }: { maximized: boolean; send: Command }) {
  return <header className="titlebar">
    <div className="title-drag" onPointerDown={event => {
      if (event.button === 0) send('move');
    }} onDoubleClick={() => send('maximize')}>
      <span className="brand-mark" aria-hidden="true"><i /><i /></span>
      <span className="brand-name">刻度 <b>STILLMARK</b></span>
    </div>
    <div className="window-controls">
      <button type="button" aria-label="最小化" onClick={() => send('minimize')}><Minus /></button>
      <button type="button" aria-label={maximized ? '还原' : '最大化'} onClick={() => send('maximize')}>
        {maximized ? <SquaresIntersect /> : <Square />}
      </button>
      <button type="button" className="window-close" aria-label="关闭软件" onClick={() => send('close')}><X /></button>
    </div>
  </header>;
}

function App() {
  const { state, records, set, send, maximized, ready, previewMode } = useDesktop();
  const [view, go] = useState<View>('timer');
  const { config } = state;
  const date = useLocalDate();
  const resting = isRest(state.phase);

  useEffect(() => {
    const effective = state.locked ? 'night' : resolveTheme(config.theme);
    document.documentElement.dataset.theme = effective;
    document.documentElement.dataset.motion = config.motion ? 'on' : 'off';
  }, [state.locked, config.theme, config.motion]);

  const focusing = state.running && !state.paused && !resting;
  useEffect(() => {
    audio.configure(config.sound, config.volume, config.ambient, config.ambientStyle, config.chimeVolume);
    audio.ambient(focusing);
  }, [config.sound, config.volume, config.ambient, config.ambientStyle, config.chimeVolume, focusing]);

  if (state.locked) return <Immersion state={state} send={send} />;
  const statusText = state.notice || (
    state.running
      ? (state.paused ? '专注已暂停' : focusing ? '专注进行中' : '休息中')
      : (ready ? (previewMode ? '准备就绪 · 浏览器预览桥' : '准备就绪') : '正在连接本地计时器')
  );

  return <div className={'app-shell' + (maximized ? ' is-maximized' : '')}>
    <TitleBar maximized={maximized} send={send} />
    <div className="workspace">
      <aside className="rail">
        <nav aria-label="主导航">
          {tabs.map(({ id, title, icon: Icon }) => <button type="button" key={id}
            aria-current={view === id ? 'page' : undefined} onClick={() => go(id)}><Icon /><span>{title}</span></button>)}
        </nav>
        <div className="rail-foot">
          {state.running && view !== 'timer' && (
            <button
              type="button"
              className={'rail-live-card' + (resting ? ' is-rest' : '') + (state.paused ? ' is-paused' : '')}
              onClick={() => go('timer')}
              title="返回计时台"
            >
              <span className="rail-live-label">{state.paused ? '已暂停' : phaseLabel[state.phase]}</span>
              <strong className="rail-live-time">{readout(state.remaining)}</strong>
            </button>
          )}
          <div className="local-status">
            <i className={state.running && !state.paused ? (resting ? 'is-rest' : 'is-live') : ''} />
            <span>{state.running ? (state.paused ? '已暂停' : resting ? '休息中' : '运行中') : (previewMode ? '开发预览' : '本地运行')}</span>
          </div>
        </div>
      </aside>
      <main className="page" key={view}>
        <header className="page-header">
          <h1>{tabs.find(tab => tab.id === view)?.title}</h1>
          <div className="page-tools">
            <span className="date-stamp">{date}</span>
            <ThemeSwitch theme={config.theme} change={theme => set('theme', theme)} />
          </div>
        </header>
        {view === 'timer' && <TimerPanel state={state} records={records} set={set} send={send} ready={ready}
          localDate={date} openSettings={() => go('settings')} />}
        {view === 'history' && <History records={records} dailyGoal={config.dailyGoal} send={send} localDate={date} />}
        {view === 'settings' && <Settings state={state} set={set} send={send} />}
      </main>
    </div>
    <footer className="statusbar">
      <span role="status">
        <i className={'status-dot' + (state.running && !state.paused ? (resting ? ' rest' : ' active') : '')} />
        {statusText}
      </span>
      <span className="status-mode">
        {phaseLabel[state.phase]} · {Math.round(state.duration / 60)} 分钟
        {config.mode === 'pomo' ? ` · 第 ${state.round}/${config.rounds} 轮` : ''}
      </span>
    </footer>
    {!maximized && resizeEdges.map(([side, flags]) => <div key={side} className={'resize-handle ' + side}
      onPointerDown={event => { if (event.button === 0) send('resize', String(flags)); }} />)}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);