import {
  Award, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, Download, Flame, Layers, RotateCcw, Search, Sparkles, TrendingUp, X,
} from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';
import type { Command, Mode, Session } from './model';

type SpanMode = 'week' | 'month';

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const fullDate = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
const shortDate = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
const timestamp = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
const formatCount = new Intl.NumberFormat('zh-CN');
const statuses: Record<Session['status'], string> = {
  complete: '已完成',
  stopped: '提前结束',
  released: '验证后结束',
  emergency: '已熔断',
  closed: '关闭程序',
  interrupted: '意外中断',
};

function dateKey(date: Date) {
  return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
}

function dayAt(base: Date, offset: number) {
  const day = new Date(base);
  day.setDate(day.getDate() + offset);
  return day;
}

function formatSpan(totalSeconds: number) {
  const mins = Math.round(totalSeconds / 60);
  if (mins < 60) return mins + ' 分钟';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

function levelFor(seconds: number, goalSec: number) {
  if (!seconds) return 0;
  const ratio = seconds / goalSec;
  return ratio < 0.25 ? 1 : ratio < 0.55 ? 2 : ratio < 0.95 ? 3 : 4;
}

interface DayCell {
  date: Date;
  key: string;
  level: number;
  seconds: number;
  future: boolean;
  isToday: boolean;
  goalMet: boolean;
  outsideMonth?: boolean;
  sessions: number;
  completedSessions: number;
}

function summarize(
  records: Session[],
  span: SpanMode,
  weekOffset: number,
  monthOffset: number,
  dailyGoal: number,
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisMonday = dayAt(today, -((today.getDay() + 6) % 7));
  const lastMonday = dayAt(thisMonday, -7);

  let rangeStart: Date;
  let rangeEnd: Date;
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();

  if (span === 'week') {
    rangeStart = dayAt(thisMonday, weekOffset * 7);
    rangeEnd = dayAt(rangeStart, 7);
  } else {
    const target = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    viewYear = target.getFullYear();
    viewMonth = target.getMonth();
    rangeStart = target;
    rangeEnd = new Date(viewYear, viewMonth + 1, 1);
  }

  const first = rangeStart.getTime() / 1000;
  const end = rangeEnd.getTime() / 1000;

  const allBuckets = new Map<string, number>();
  const daySessions = new Map<string, number>();
  const dayCompleted = new Map<string, number>();
  const hours = Array<number>(24).fill(0);
  const topicSeconds = new Map<string, number>();
  const recent: Session[] = [];
  let total = 0;
  let completed = 0;
  let lockedCount = 0;

  for (const record of records) {
    if (record.seconds < 180) continue;

    let cAll = record.started;
    const sAll = record.started + record.seconds;
    while (cAll < sAll) {
      const local = new Date(cAll * 1000);
      const nextMidnight = new Date(local.getFullYear(), local.getMonth(), local.getDate() + 1).getTime() / 1000;
      const elapsed = Math.min(nextMidnight, sAll) - cAll;
      const dk = dateKey(local);
      allBuckets.set(dk, (allBuckets.get(dk) ?? 0) + elapsed);
      cAll += elapsed;
    }

    const recDay = dateKey(new Date(record.started * 1000));
    daySessions.set(recDay, (daySessions.get(recDay) ?? 0) + 1);
    if (record.status === 'complete') {
      dayCompleted.set(recDay, (dayCompleted.get(recDay) ?? 0) + 1);
    }

    let cursor = Math.max(first, record.started);
    const stop = Math.min(end, record.started + record.seconds);
    if (cursor >= stop) continue;

    recent.push(record);
    if (record.status === 'complete') completed += 1;
    if (record.locked) lockedCount += 1;

    const topicName = record.topic.trim() || (record.mode === 'deep' ? '未命名深度专注' : '未命名番茄专注');
    topicSeconds.set(topicName, (topicSeconds.get(topicName) ?? 0) + (stop - cursor));

    while (cursor < stop) {
      const local = new Date(cursor * 1000);
      const boundary = cursor + 3600 - local.getMinutes() * 60 - local.getSeconds();
      const elapsed = Math.min(boundary, stop) - cursor;
      hours[local.getHours()] += elapsed;
      total += elapsed;
      cursor += elapsed;
    }
  }

  let streak = 0;
  for (let offset = 0; offset < 366; offset++) {
    const key = dateKey(dayAt(today, -offset));
    if ((allBuckets.get(key) ?? 0) >= 180) streak += 1;
    else if (offset === 0) continue;
    else break;
  }

  let bestStreak = 0;
  let run = 0;
  for (let offset = 365; offset >= 0; offset--) {
    const key = dateKey(dayAt(today, -offset));
    if ((allBuckets.get(key) ?? 0) >= 180) {
      run += 1;
      if (run > bestStreak) bestStreak = run;
    } else {
      run = 0;
    }
  }

  const goalSec = Math.max(60, dailyGoal * 60);
  const makeCell = (date: Date, outsideMonth = false): DayCell => {
    const key = dateKey(date);
    const seconds = allBuckets.get(key) ?? 0;
    const future = date > today;
    return {
      date,
      key,
      level: levelFor(seconds, goalSec),
      seconds,
      future,
      outsideMonth,
      isToday: date.getTime() === today.getTime(),
      goalMet: seconds >= goalSec,
      sessions: daySessions.get(key) ?? 0,
      completedSessions: dayCompleted.get(key) ?? 0,
    };
  };

  // Week cells (7 days)
  const weekCells: DayCell[] = Array.from({ length: 7 }, (_, i) => makeCell(dayAt(rangeStart, i)));
  const weekTitle = weekOffset === 0
    ? '本周'
    : `${shortDate.format(rangeStart)} – ${shortDate.format(dayAt(rangeStart, 6))}`;

  // Month calendar grid: always 6 rows (42 cells) so panel height never jumps when paging months!
  const monthFirst = new Date(viewYear, viewMonth, 1);
  const leadDays = (monthFirst.getDay() + 6) % 7;
  const gridStart = dayAt(monthFirst, -leadDays);
  const monthCells: DayCell[] = Array.from({ length: 42 }, (_, i) => {
    const d = dayAt(gridStart, i);
    return makeCell(d, d.getMonth() !== viewMonth);
  });

  // Window-scoped stats
  let activeDays = 0;
  let goalDays = 0;
  let bestDayKey = '';
  let bestDaySeconds = 0;
  const cursorDay = new Date(rangeStart);
  while (cursorDay < rangeEnd && cursorDay <= today) {
    const sec = allBuckets.get(dateKey(cursorDay)) ?? 0;
    if (sec > 0) activeDays += 1;
    if (sec >= goalSec) goalDays += 1;
    if (sec > bestDaySeconds) {
      bestDaySeconds = sec;
      bestDayKey = fullDate.format(cursorDay);
    }
    cursorDay.setDate(cursorDay.getDate() + 1);
  }

  let thisWeekSec = 0;
  let lastWeekSec = 0;
  for (let i = 0; i < 7; i++) {
    const d1 = dayAt(thisMonday, i);
    if (d1 <= today) thisWeekSec += allBuckets.get(dateKey(d1)) ?? 0;
    const d0 = dayAt(lastMonday, i);
    lastWeekSec += allBuckets.get(dateKey(d0)) ?? 0;
  }
  const weekDeltaPct = lastWeekSec > 0
    ? Math.round(((thisWeekSec - lastWeekSec) / lastWeekSec) * 100)
    : (thisWeekSec > 0 ? 100 : 0);

  let peakHour = 0;
  let peakSec = 0;
  hours.forEach((sec, h) => {
    if (sec > peakSec) { peakSec = sec; peakHour = h; }
  });

  const topTopics = [...topicSeconds.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, seconds]) => ({
      name,
      seconds,
      pct: total > 0 ? Math.max(4, Math.round((seconds / total) * 100)) : 0,
    }));

  return {
    total, completed, lockedCount, streak, bestStreak, recent,
    weekCells, weekTitle, monthCells, viewYear, viewMonth,
    hours, activeDays, goalDays, bestDayKey, bestDaySeconds, peakHour, peakSec,
    topTopics, thisWeekSec, weekDeltaPct,
  };
}

export function History({
  records,
  dailyGoal,
  send,
  localDate,
}: {
  records: Session[];
  dailyGoal: number;
  send: Command;
  localDate: string;
}) {
  const [span, setSpan] = useState<SpanMode>('month');
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [pickedKey, setPickedKey] = useState<string>('');
  const [hoveredKey, setHoveredKey] = useState<string>('');
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [limit, setLimit] = useState(12);
  const [statusFilter, setStatusFilter] = useState<'all' | Session['status']>('all');
  const [modeFilter, setModeFilter] = useState<'all' | Mode>('all');
  const [query, setQuery] = useState('');

  const summary = useMemo(
    () => summarize(records, span, weekOffset, monthOffset, dailyGoal),
    [records, span, weekOffset, monthOffset, dailyGoal, localDate],
  );

  const allVisibleCells = useMemo(() => {
    if (span === 'week') return summary.weekCells;
    return summary.monthCells.filter(c => !c.outsideMonth);
  }, [span, summary]);

  const activeCell = useMemo(() => {
    const key = hoveredKey || pickedKey;
    if (key) return allVisibleCells.find(c => c.key === key && !c.future) ?? null;
    return allVisibleCells.find(c => c.isToday) ?? allVisibleCells.find(c => !c.future) ?? null;
  }, [allVisibleCells, hoveredKey, pickedKey]);

  const pickedCell = useMemo(
    () => (pickedKey ? allVisibleCells.find(c => c.key === pickedKey && !c.future) ?? null : null),
    [allVisibleCells, pickedKey],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return summary.recent.filter(r => {
      if (pickedKey && dateKey(new Date(r.started * 1000)) !== pickedKey) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (modeFilter !== 'all' && r.mode !== modeFilter) return false;
      if (q) {
        const title = (r.topic || (r.mode === 'deep' ? '深度专注' : '番茄专注')).toLowerCase();
        if (!title.includes(q)) return false;
      }
      return true;
    });
  }, [summary.recent, pickedKey, statusFilter, modeFilter, query]);

  const maxHourMinutes = Math.max(15, Math.ceil(Math.max(...summary.hours) / 900) * 15);
  const completionRate = summary.recent.length ? Math.round((summary.completed / summary.recent.length) * 100) : 0;
  const avgMinutes = summary.recent.length ? Math.round(summary.total / summary.recent.length / 60) : 0;
  const totalMinutes = Math.round(summary.total / 60);
  const totalHours = (totalMinutes / 60).toFixed(1);
  const goalSec = Math.max(60, dailyGoal * 60);

  const isAtPresent = span === 'week' ? weekOffset === 0 : monthOffset === 0;
  const canPrev = span === 'week' ? weekOffset > -51 : monthOffset > -11;
  const canNext = span === 'week' ? weekOffset < 0 : monthOffset < 0;
  const navLabel = span === 'week'
    ? summary.weekTitle
    : `${summary.viewYear}年${summary.viewMonth + 1}月`;

  function switchSpan(next: SpanMode) {
    setSpan(next);
    setPickedKey('');
    setHoveredKey('');
    setLimit(12);
  }

  function stepPage(delta: number) {
    setPickedKey('');
    setHoveredKey('');
    setLimit(12);
    if (span === 'week') {
      setWeekOffset(w => Math.min(0, Math.max(-51, w + delta)));
    } else {
      setMonthOffset(m => Math.min(0, Math.max(-11, m + delta)));
    }
  }

  function resetToPresent() {
    setPickedKey('');
    setHoveredKey('');
    setLimit(12);
    if (span === 'week') setWeekOffset(0);
    else setMonthOffset(0);
  }

  return <div className="history-layout">
    <section className="kpi-grid" aria-label="核心专注指标">
      <article className="panel kpi-card">
        <div className="kpi-head">
          <span>累计专注</span>
          <Clock size={14} />
        </div>
        <div className="kpi-value"><strong>{formatCount.format(totalMinutes)}</strong><span>分钟</span></div>
        <div className="kpi-foot">约 {totalHours} 小时 · 活跃 {summary.activeDays} 天</div>
      </article>

      <article className="panel kpi-card">
        <div className="kpi-head">
          <span>专注场次</span>
          <Layers size={14} />
        </div>
        <div className="kpi-value"><strong>{formatCount.format(summary.recent.length)}</strong><span>场</span></div>
        <div className="kpi-foot">场均 {avgMinutes} 分钟 · 锁定 {summary.lockedCount} 场</div>
      </article>

      <article className="panel kpi-card">
        <div className="kpi-head">
          <span>完整达成率</span>
          <CheckCircle2 size={14} />
        </div>
        <div className="kpi-value"><strong>{completionRate}</strong><span>%</span></div>
        <div className="kpi-foot">完整 {summary.completed} 场 · 达标 {summary.goalDays} 天</div>
      </article>

      <article className="panel kpi-card is-accent">
        <div className="kpi-head">
          <span>连续专注</span>
          <Flame size={14} />
        </div>
        <div className="kpi-value"><strong>{summary.streak}</strong><span>天</span></div>
        <div className="kpi-foot">历史最高 {summary.bestStreak} 天 · 本周 {Math.round(summary.thisWeekSec / 60)} 分</div>
      </article>
    </section>

    <div className="analytics-grid">
      <section className="panel heatmap-card" aria-label="每日专注脉络">
        <div className="card-header">
          <div className="card-title-group">
            <h2>每日专注脉络</h2>
            <p>保留最近 12 个月历史 · 支持按周/月翻页回溯，色阶按每日目标 {dailyGoal} 分钟映射</p>
          </div>
          <div className="history-actions">
            <div className="month-nav" role="group" aria-label={span === 'week' ? '切换周次' : '切换月份'}>
              <button type="button" aria-label={span === 'week' ? '上一周' : '上个月'} disabled={!canPrev}
                onClick={() => stepPage(-1)}>
                <ChevronLeft size={14} />
              </button>
              <span>{navLabel}</span>
              <button type="button" aria-label={span === 'week' ? '下一周' : '下个月'} disabled={!canNext}
                onClick={() => stepPage(1)}>
                <ChevronRight size={14} />
              </button>
              {!isAtPresent && (
                <button type="button" className="nav-today-btn" title="回到当前" onClick={resetToPresent}>
                  <RotateCcw size={12} />
                </button>
              )}
            </div>
            <div className="range-pills" role="group" aria-label="时间跨度">
              {([
                { id: 'week', label: '每周' },
                { id: 'month', label: '每月' },
              ] as const).map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={span === item.id ? 'is-selected' : ''}
                  aria-pressed={span === item.id}
                  onClick={() => switchSpan(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button type="button" className="button secondary" onClick={() => send('export')}><Download />导出 CSV</button>
          </div>
        </div>

        <div className="heatmap-body">
          <div className="heatmap-matrix-wrap">
            <div className="heatmap-stage">
              {span === 'week' ? (
                <div className="week-board" role="grid" aria-label="每周专注热力卡">
                  {summary.weekCells.map((cell, idx) => {
                    const mins = Math.round(cell.seconds / 60);
                    const pct = Math.min(100, Math.round((cell.seconds / goalSec) * 100));
                    const isSelected = pickedKey === cell.key;
                    return (
                      <button
                        key={cell.key}
                        type="button"
                        disabled={cell.future}
                        onMouseEnter={() => !cell.future && setHoveredKey(cell.key)}
                        onMouseLeave={() => setHoveredKey('')}
                        onClick={() => setPickedKey(prev => prev === cell.key ? '' : cell.key)}
                        className={
                          'week-day-card level-' + cell.level +
                          (cell.isToday ? ' is-today' : '') +
                          (cell.goalMet && !cell.future ? ' is-goal' : '') +
                          (isSelected ? ' is-picked' : '')
                        }
                      >
                        <div className="week-day-top">
                          <span>周{weekdays[idx]}</span>
                          <small>{cell.date.getMonth() + 1}/{cell.date.getDate()}</small>
                        </div>
                        <div className="week-day-center">
                          <strong className="week-day-mins">{mins}<em>m</em></strong>
                          <span className="week-day-sessions">
                            {cell.sessions > 0 ? `${cell.sessions} 场` : '暂无'}
                          </span>
                        </div>
                        <div className="week-day-meter">
                          <div className="week-day-bar"><i style={{ width: `${pct}%` }} /></div>
                          <small>{pct}%</small>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="month-board" role="grid" aria-label="月度专注日历">
                  <div className="month-weekdays" aria-hidden="true">
                    {weekdays.map(d => <span key={d}>周{d}</span>)}
                  </div>
                  <div className="month-grid">
                    {summary.monthCells.map(cell => {
                      const mins = Math.round(cell.seconds / 60);
                      const isSelected = pickedKey === cell.key;
                      const text = fullDate.format(cell.date) + ' · ' + formatSpan(cell.seconds);
                      return (
                        <button
                          key={cell.key}
                          type="button"
                          disabled={cell.future || cell.outsideMonth}
                          title={cell.future || cell.outsideMonth ? '' : text}
                          aria-label={text}
                          onMouseEnter={() => !cell.future && !cell.outsideMonth && setHoveredKey(cell.key)}
                          onMouseLeave={() => setHoveredKey('')}
                          onClick={() => setPickedKey(prev => prev === cell.key ? '' : cell.key)}
                          className={
                            'month-cell level-' + (cell.outsideMonth ? 0 : cell.level) +
                            (cell.outsideMonth ? ' is-outside' : '') +
                            (cell.isToday ? ' is-today' : '') +
                            (cell.goalMet && !cell.future && !cell.outsideMonth ? ' is-goal' : '') +
                            (isSelected ? ' is-picked' : '')
                          }
                        >
                          <span className="month-cell-day">{cell.date.getDate()}</span>
                          {!cell.outsideMonth && mins > 0 && <em className="month-cell-min">{mins}m</em>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="heatmap-footer">
              <div className="heatmap-inspector" role="status">
                <CalendarDays size={14} />
                {activeCell ? (
                  <span>
                    <strong>{fullDate.format(activeCell.date)}{activeCell.isToday ? '（今天）' : ''}</strong>
                    <em>{activeCell.seconds > 0 ? formatSpan(activeCell.seconds) : '暂无专注记录'}</em>
                    {activeCell.sessions > 0 && ` · ${activeCell.sessions} 场（完成 ${activeCell.completedSessions}）`}
                  </span>
                ) : <span>悬停或点选任意日期查看明细</span>}
              </div>
              <div className="legend" aria-label="热力图等级">
                <span>浅</span>
                {[0, 1, 2, 3, 4].map(lvl => <i key={lvl} className={'level-' + lvl} />)}
                <span>深</span>
              </div>
            </div>
          </div>

          <aside className="heatmap-insights" aria-label="周期洞察">
            <div className="insight-tile">
              <span><Award size={13} />峰值专注日</span>
              <strong>{summary.bestDaySeconds > 0 ? formatSpan(summary.bestDaySeconds) : '暂无'}</strong>
              <small>{summary.bestDayKey || '完成专注后自动统计'}</small>
            </div>
            <div className="insight-tile">
              <span><TrendingUp size={13} />本周较上周</span>
              <strong>{summary.weekDeltaPct > 0 ? `+${summary.weekDeltaPct}%` : `${summary.weekDeltaPct}%`}</strong>
              <small>本周已专注 {Math.round(summary.thisWeekSec / 60)} 分钟</small>
            </div>
            <div className="insight-tile">
              <span><Sparkles size={13} />目标达成率</span>
              <strong>{summary.activeDays > 0 ? Math.round((summary.goalDays / summary.activeDays) * 100) : 0}%</strong>
              <small>活跃日中 {summary.goalDays}/{summary.activeDays} 天达标</small>
            </div>
          </aside>
        </div>
      </section>

      <div className="sub-analytics">
        <section className="panel hours-card" aria-label="24 小时节律">
          <div className="card-header">
            <div className="card-title-group">
              <h2>24 小时专注节律</h2>
              <p>
                {hoveredHour !== null
                  ? `${String(hoveredHour).padStart(2, '0')}:00 累计 ${Math.round(summary.hours[hoveredHour] / 60)} 分钟`
                  : summary.peakSec > 0
                    ? `最常集中时段：${String(summary.peakHour).padStart(2, '0')}:00（${Math.round(summary.peakSec / 60)} 分）`
                    : '按本地小时统计的专注时长分布'}
              </p>
            </div>
            <span className="mono-badge">分钟 / 时段</span>
          </div>
          <div className="hours">
            <div className="hour-scale"><span>{maxHourMinutes}</span><span>{Math.round(maxHourMinutes / 2)}</span><span>0</span></div>
            <div className="hour-grid">
              {summary.hours.map((seconds, hour) => {
                const label = String(hour).padStart(2, '0');
                const mins = Math.round(seconds / 60);
                const isPeak = summary.peakSec > 0 && hour === summary.peakHour;
                return (
                  <div className={'hour' + (isPeak ? ' is-peak' : '')} key={hour}
                    onMouseEnter={() => setHoveredHour(hour)}
                    onMouseLeave={() => setHoveredHour(null)}>
                    <div className="hour-track" title={`${label}:00 · ${mins} 分钟`} tabIndex={0}
                      onFocus={() => setHoveredHour(hour)} onBlur={() => setHoveredHour(null)}>
                      <i style={{ '--bar': (seconds / (maxHourMinutes * 60) * 100) + '%' } as CSSProperties} />
                    </div>
                    <span>{hour % 3 === 0 ? label : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="panel topics-card" aria-label="主题时长排行">
          <div className="card-header">
            <div className="card-title-group">
              <h2>专注主题分布</h2>
              <p>当前统计窗口内占比最高的专注课题</p>
            </div>
          </div>
          {summary.topTopics.length === 0 ? (
            <p className="empty">开始一次带主题的专注（满 3 分钟）后，这里会自动汇总各课题耗时。</p>
          ) : (
            <ul className="topic-bars">
              {summary.topTopics.map(item => (
                <li key={item.name}>
                  <div className="topic-bar-meta">
                    <span>{item.name}</span>
                    <span>{formatSpan(item.seconds)} · {item.pct}%</span>
                  </div>
                  <div className="topic-bar-track"><i style={{ width: `${item.pct}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>

    <section className="history-panel panel recent" aria-label="最近专注流水">
      <div className="recent-head">
        <div className="card-title-group">
          <div className="archive-title-row">
            <h2>专注流水档案</h2>
            {pickedCell && (
              <button
                type="button"
                className="date-filter-chip"
                onClick={() => setPickedKey('')}
                title="点击清除日期筛选"
              >
                <CalendarDays size={12} />
                <span>{fullDate.format(pickedCell.date)}</span>
                <X size={12} />
              </button>
            )}
          </div>
          <p>共筛选出 {filtered.length} 条记录{pickedCell ? ' · 已按所选日期过滤' : ''}（仅记录满 3 分钟的专注）</p>
        </div>
        <div className="recent-filters">
          <label className="search-box">
            <Search size={13} />
            <input type="search" placeholder="搜索主题..." value={query}
              onChange={e => { setQuery(e.target.value); setLimit(12); }} />
          </label>
          <select aria-label="按模式筛选" value={modeFilter} onChange={e => {
            setModeFilter(e.target.value as 'all' | Mode); setLimit(12);
          }}>
            <option value="all">全部模式</option>
            <option value="deep">深度专注</option>
            <option value="pomo">番茄钟</option>
          </select>
          <select aria-label="按状态筛选" value={statusFilter} onChange={e => {
            setStatusFilter(e.target.value as 'all' | Session['status']); setLimit(12);
          }}>
            <option value="all">全部状态</option>
            <option value="complete">已完成</option>
            <option value="stopped">提前结束</option>
            <option value="released">验证后结束</option>
            <option value="emergency">已熔断</option>
            <option value="interrupted">意外中断</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="empty">当前筛选条件下暂无专注记录，点击计时台开始你的下一段沉浸时光。</p>
      ) : (
        <>
          <ol className="timeline-list">
            {filtered.slice(0, limit).map(record => {
              const ratio = Math.min(100, Math.round((record.seconds / Math.max(1, record.planned)) * 100));
              return (
                <li key={record.id} className={'timeline-item status-bar-' + record.status}>
                  <time dateTime={new Date(record.started * 1000).toISOString()}>
                    {timestamp.format(record.started * 1000)}
                  </time>
                  <div className="timeline-main">
                    <span className="record-topic">{record.topic || (record.mode === 'deep' ? '深度专注' : '番茄专注')}</span>
                    <div className="record-tags">
                      <em className="record-pill">{record.mode === 'deep' ? '深度' : '番茄'}</em>
                      {record.locked ? <em className="record-pill is-lock">锁定</em> : null}
                    </div>
                  </div>
                  <div className="timeline-progress" title={`完成度 ${ratio}%`}>
                    <div className="timeline-bar"><i style={{ width: `${ratio}%` }} /></div>
                    <span>{ratio}%</span>
                  </div>
                  <span className={'record-status status-' + record.status}>{statuses[record.status]}</span>
                  <strong className="record-duration">
                    {Math.floor(record.seconds / 60)}<span> 分</span> {record.seconds % 60}<span> 秒</span>
                  </strong>
                </li>
              );
            })}
          </ol>
          {filtered.length > limit && (
            <button type="button" className="button secondary load-more" onClick={() => setLimit(limit + 12)}>
              展开更多档案 ({filtered.length - limit} 条)
            </button>
          )}
        </>
      )}
    </section>
  </div>;
}
