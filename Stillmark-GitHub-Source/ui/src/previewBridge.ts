import type { Session } from './model';
import { PreviewTimerEngine } from './previewEngine';

export interface Signal<T> {
  connect: (handler: (value: T) => void) => void;
}

export interface StillmarkBridgeObject {
  initialize: (receive: (initial: string) => void) => void;
  dispatch: (command: string, value: string) => void;
  changed: Signal<string>;
  recorded: Signal<string>;
  chime: Signal<'start' | 'rest' | 'finish'>;
  maximized: Signal<boolean>;
  dispose?: () => void;
}

const STATUS_LABELS: Record<Session['status'], string> = {
  complete: '已完成',
  stopped: '提前结束',
  released: '验证后结束',
  emergency: '已熔断',
  closed: '关闭程序',
  interrupted: '意外中断',
};

function createSignal<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    signal: {
      connect(handler: (value: T) => void) {
        listeners.add(handler);
      },
    } as Signal<T>,
    emit(value: T) {
      for (const listener of listeners) listener(value);
    },
    clear() {
      listeners.clear();
    },
  };
}

function downloadCsv(records: Session[]) {
  const rows: string[] = ['开始时间,主题,模式,专注秒数,计划秒数,结束状态,沉浸锁定'];
  for (const row of records) {
    const dt = new Date(row.started * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
    let topic = row.topic;
    if (/^[=+\-@\t\r\n]/.test(topic)) topic = `'${topic}`;
    const safeTopic = `"${topic.replace(/"/g, '""')}"`;
    const mode = row.mode === 'deep' ? '深度专注' : '番茄钟';
    const status = STATUS_LABELS[row.status] ?? row.status;
    rows.push(`${start},${safeTopic},${mode},${row.seconds},${row.planned},${status},${row.locked ? '是' : '否'}`);
  }
  const blob = new Blob(['\ufeff' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Stillmark-preview.csv';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Browser-only development preview bridge.
 * Only ever activated when `import.meta.env.DEV` is true and Qt WebChannel is absent.
 * Uses fictional seed records and mirrors the exact QWebChannel protocol of desktop/window.py.
 */
export function createPreviewBridge(): StillmarkBridgeObject {
  const engine = new PreviewTimerEngine();
  const changed = createSignal<string>();
  const recorded = createSignal<string>();
  const chime = createSignal<'start' | 'rest' | 'finish'>();
  const maximizedSig = createSignal<boolean>();

  let isMaximized = true;
  let lastPayload = '';
  let fuseStart: number | null = null;

  const nowSec = () => performance.now() / 1000;

  function publish() {
    const state = engine.snapshot(nowSec());
    const payload = JSON.stringify(state);
    if (payload !== lastPayload) {
      lastPayload = payload;
      changed.emit(payload);
    }
  }

  function publishHistory() {
    recorded.emit(JSON.stringify(engine.records));
  }

  // Simulate Windows 2-second Ctrl+Shift+Alt+F12 emergency fuse while locked in preview
  const onKeyDown = (event: KeyboardEvent) => {
    if (!engine.locked) return;
    if (event.ctrlKey && event.shiftKey && event.altKey && event.code === 'F12') {
      if (fuseStart === null) fuseStart = performance.now();
      else if (performance.now() - fuseStart >= 1800) {
        fuseStart = null;
        engine.endManual('emergency', '安全熔断已解除沉浸锁定', nowSec());
        publishHistory();
        publish();
      }
    }
  };
  const onKeyUp = () => {
    fuseStart = null;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  const intervalId = window.setInterval(() => {
    if (!engine.running || engine.paused) return;
    const now = nowSec();
    const result = engine.tick(now);
    if (result.phaseChanged && result.chime) {
      chime.emit(result.chime);
    }
    if (result.historyChanged) {
      publishHistory();
    }
    publish();
  }, 125);

  return {
    changed: changed.signal,
    recorded: recorded.signal,
    chime: chime.signal,
    maximized: maximizedSig.signal,

    initialize(receive) {
      const initial = {
        state: engine.snapshot(nowSec()),
        records: engine.records,
        maximized: isMaximized,
      };
      lastPayload = JSON.stringify(initial.state);
      receive(JSON.stringify(initial));
    },

    dispatch(command, raw) {
      const now = nowSec();
      if (command === 'begin') {
        if (!engine.running) {
          const locked = engine.config.lock && !engine.resting;
          engine.begin(locked, now);
          chime.emit('start');
        }
      } else if (command === 'pause') {
        engine.pause(now);
      } else if (command === 'resume') {
        engine.resume(now);
      } else if (command === 'set') {
        const [key, value] = JSON.parse(raw) as [keyof typeof engine.config, unknown];
        engine.set(key, value);
      } else if (command === 'resetSettings') {
        engine.resetSettings();
      } else if (command === 'clearHistory' && !engine.running) {
        engine.clearHistory();
        publishHistory();
      } else if (command === 'end' && engine.running && !engine.resting) {
        if (engine.locked) {
          if (!engine.hasRelease()) {
            engine.requestRelease();
          } else if (engine.canCompleteRelease(now)) {
            engine.endManual('released', '本次专注已提前结束', now);
            publishHistory();
          }
        } else {
          engine.endManual('stopped', '本次专注已结束', now);
          publishHistory();
        }
      } else if (command === 'cancelRelease' && engine.hasRelease()) {
        engine.cancelRelease();
      } else if (command === 'releaseKey' && engine.hasRelease()) {
        engine.releaseKey(raw.toUpperCase(), now);
      } else if (command === 'skip' && engine.resting && engine.running) {
        engine.skipRest(now);
      } else if (command === 'export') {
        downloadCsv(engine.records);
        engine.notice = '已导出专注记录（预览模拟 CSV）';
      } else if (command === 'data') {
        engine.notice = '预览模式无本地目录；Windows 桌面版将打开 %LOCALAPPDATA%\\Stillmark';
      } else if (command === 'maximize') {
        isMaximized = !isMaximized;
        maximizedSig.emit(isMaximized);
      } else if (command === 'minimize' || command === 'close') {
        engine.notice = '窗口控制仅在 Windows 桌面端生效';
      }
      publish();
    },

    dispose() {
      window.clearInterval(intervalId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      changed.clear();
      recorded.clear();
      chime.clear();
      maximizedSig.clear();
    },
  };
}
