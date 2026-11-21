import {
  CalendarDays, ChevronLeft, ChevronRight, Download, RotateCcw, Search, X,
} from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';
import {
  dateKey, formatSpan, MATRIX_WEEK_COUNT, type SpanMode, summarizeHistory,
} from './analytics';
import type { Command, Mode, Session } from './model';

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const fullDate = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
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
  const [monthOffset, setMonthOffset] = useState(0);
  const [matrixOffset, setMatrixOffset] = useState(0);
  const [pickedKey, setPickedKey] = useState<string>('');
  const [hoveredKey, setHoveredKey] = useState<string>('');
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [limit, setLimit] = useState(12);
  const [statusFilter, setStatusFilter] = useState<'all' | Session['status']>('all');
  const [modeFilter, setModeFilter] = useState<'all' | Mode>('all');
  const [query, setQuery] = useState('');

  const summary = useMemo(
    () => summarizeHistory(records, span, monthOffset, matrixOffset, dailyGoal),
    [records, span, monthOffset, matrixOffset, dailyGoal, localDate],
  );

  const allVisibleCells = useMemo(() => {
    if (span === 'month') return summary.monthCells.filter(c => !c.outsideMonth);
    return summary.matrixWeeks.flatMap(w => w.days);
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

  const isAtPresent = span === 'month' ? monthOffset === 0 : matrixOffset === 0;
  const canPrev = span === 'month' ? monthOffset > -11 : matrixOffset > -8;
  const canNext = span === 'month' ? monthOffset < 0 : matrixOffset < 0;
  const navLabel = span === 'month'
    ? `${summary.viewYear}年${String(summary.viewMonth + 1).padStart(2, '0')}月`
    : summary.matrixLabel;

  function switchSpan(next: SpanMode) {
    if (next === span) return;
    setSpan(next);
    setPickedKey('');
    setHoveredKey('');
    setLimit(12);
  }

  function stepPage(delta: number) {
    setPickedKey('');
    setHoveredKey('');
    setLimit(12);
    if (span === 'month') {
      setMonthOffset(m => Math.min(0, Math.max(-11, m + delta)));
    } else {
      setMatrixOffset(w => Math.min(0, Math.max(-8, w + delta)));
    }
  }

  function resetToPresent() {
    setPickedKey('');
    setHoveredKey('');
    setLimit(12);
    if (span === 'month') setMonthOffset(0);
    else setMatrixOffset(0);
  }

  return <div className="history-layout">
    <section className="kpi-grid" aria-label="核心专注指标">
      <article className="panel kpi-card">
        <div className="kpi-head">累计专注</div>
        <div className="kpi-value"><strong>{formatCount.format(totalMinutes)}</strong><span>分钟</span></div>
        <div className="kpi-foot">约 {totalHours} 小时 · 活跃 {summary.activeDays} 天</div>
      </article>

      <article className="panel kpi-card">
        <div className="kpi-head">专注场次</div>
        <div className="kpi-value"><strong>{formatCount.format(summary.recent.length)}</strong><span>场</span></div>
        <div className="kpi-foot">场均 {avgMinutes} 分钟 · 锁定 {summary.lockedCount} 场</div>
      </article>

      <article className="panel kpi-card">
        <div className="kpi-head">完整达成率</div>
        <div className="kpi-value"><strong>{completionRate}</strong><span>%</span></div>
        <div className="kpi-foot">完整 {summary.completed} 场 · 达标 {summary.goalDays} 天</div>
      </article>

      <article className="panel kpi-card is-highlight">
        <div className="kpi-head">连续专注</div>
        <div className="kpi-value"><strong>{summary.streak}</strong><span>天</span></div>
        <div className="kpi-foot">历史最高 {summary.bestStreak} 天 · 本周 {Math.round(summary.thisWeekSec / 60)} 分</div>
      </article>
    </section>

    <div className="analytics-grid">
      <section className="panel heatmap-card" aria-label="专注节律脉络">
        <div className="card-header">
          <div className="card-title-group">
            <h2>专注节律脉络</h2>
            <p>
              {span === 'month'
                ? `单月明细日历 · 色阶按每日目标 ${dailyGoal} 分钟分级，点选日期可筛选下方档案`
                : `跨月长期热力矩阵（${MATRIX_WEEK_COUNT} 周）· 观察持续性、周内习惯与达标波峰`}
            </p>
          </div>
          <div className="history-actions">
            {!isAtPresent && (
              <button
                type="button"
                className="nav-today-chip"
                aria-label="回到当前"
                title="回到当前"
                onClick={resetToPresent}
              >
                <RotateCcw size={12} />
                <span>当前</span>
              </button>
            )}
            <div className="month-nav" role="group" aria-label={span === 'month' ? '切换月份' : '切换周期窗口'}>
              <button
                type="button"
                aria-label={span === 'month' ? '上个月' : '前 4 周'}
                disabled={!canPrev}
                onClick={() => stepPage(-1)}
              >
                <ChevronLeft size={14} />
              </button>
              <span className="nav-label-fixed">{navLabel}</span>
              <button
                type="button"
                aria-label={span === 'month' ? '下个月' : '后 4 周'}
                disabled={!canNext}
                onClick={() => stepPage(1)}
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="range-tabs" role="group" aria-label="统计视图">
              {([
                { id: 'month', label: '月度日历' },
                { id: 'matrix', label: '半年热力' },
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
            <button type="button" className="button secondary" onClick={() => send('export')}>
              <Download />导出 CSV
            </button>
          </div>
        </div>

        <div className="heatmap-body">
          <div className="heatmap-matrix-wrap">
            {/* Fixed-height stage prevents ANY layout jump or panel distortion when switching views */}
            <div className="heatmap-stage" data-testid="heatmap-stage">
              {span === 'month' ? (
                <div className="stage-pane month-board" key="month" role="grid" aria-label="月度专注日历">
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
              ) : (
                <div
                  className="stage-pane matrix-board"
                  key="matrix"
                  style={{ '--weeks': MATRIX_WEEK_COUNT } as CSSProperties}
                  role="grid"
                  aria-label="近 20 周专注热力矩阵"
                >
                  <div className="heatmap-months" aria-hidden="true">
                    <span />
                    {summary.matrixWeeks.map((week, idx) => (
                      <span key={idx} className="month-tick">{week.monthLabel}</span>
                    ))}
                  </div>
                  <div className="heatmap-grid-row">
                    <div className="weekday-axis" aria-hidden="true">
                      {weekdays.map((w, idx) => (
                        <span key={w}>{idx % 2 === 0 ? `周${w}` : ''}</span>
                      ))}
                    </div>
                    <div className="heatmap-columns">
                      {summary.matrixWeeks.map((week, wIdx) => (
                        <div
                          key={wIdx}
                          className={'heatmap-col' + (week.isCurrentWeek ? ' is-current-week' : '')}
                        >
                          {week.days.map(cell => {
                            const isSelected = pickedKey === cell.key;
                            const text = fullDate.format(cell.date) + ' · ' + formatSpan(cell.seconds);
                            return (
                              <button
                                key={cell.key}
                                type="button"
                                disabled={cell.future}
                                title={cell.future ? '' : text}
                                aria-label={text}
                                onMouseEnter={() => !cell.future && setHoveredKey(cell.key)}
                                onMouseLeave={() => setHoveredKey('')}
                                onClick={() => setPickedKey(prev => prev === cell.key ? '' : cell.key)}
                                className={
                                  'heat-tile level-' + cell.level +
                                  (cell.isToday ? ' is-today' : '') +
                                  (cell.goalMet && !cell.future ? ' is-goal' : '') +
                                  (isSelected ? ' is-picked' : '')
                                }
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
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
              <div className="legend" aria-label="热力图强弱色阶">
                <span>空</span>
                {[
                  { lvl: 0, tip: '0 分钟' },
                  { lvl: 1, tip: `< 30% 目标 (< ${Math.round(dailyGoal * 0.3)} 分)` },
                  { lvl: 2, tip: `30–59% 目标 (${Math.round(dailyGoal * 0.3)}–${Math.round(dailyGoal * 0.6)} 分)` },
                  { lvl: 3, tip: `60–99% 目标 (${Math.round(dailyGoal * 0.6)}–${dailyGoal - 1} 分)` },
                  { lvl: 4, tip: `达到每日目标 (≥ ${dailyGoal} 分)` },
                ].map(item => (
                  <i key={item.lvl} className={'level-' + item.lvl} title={item.tip} />
                ))}
                <span>达标</span>
              </div>
            </div>
          </div>

          <aside className="heatmap-insights" aria-label="周期洞察">
            <div className="insight-row">
              <span>峰值专注日</span>
              <strong>{summary.bestDaySeconds > 0 ? formatSpan(summary.bestDaySeconds) : '暂无'}</strong>
              <small>{summary.bestDayKey || '完成专注后自动统计'}</small>
            </div>
            <div className="insight-row">
              <span>本周较上周</span>
              <strong>{summary.weekDeltaPct > 0 ? `+${summary.weekDeltaPct}%` : `${summary.weekDeltaPct}%`}</strong>
              <small>本周已专注 {Math.round(summary.thisWeekSec / 60)} 分钟</small>
            </div>
            <div className="insight-row">
              <span>目标达成率</span>
              <strong>{summary.activeDays > 0 ? Math.round((summary.goalDays / summary.activeDays) * 100) : 0}%</strong>
              <small>活跃日中 {summary.goalDays} / {summary.activeDays} 天达标</small>
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
                  ? `${String(hoveredHour).padStart(2, '0')}:00 时段累计 ${Math.round(summary.hours[hoveredHour] / 60)} 分钟`
                  : summary.peakSec > 0
                    ? `高效峰值时段 · ${String(summary.peakHour).padStart(2, '0')}:00（${Math.round(summary.peakSec / 60)} 分）`
                    : '按本地小时统计的专注时长分布'}
              </p>
            </div>
            <span className="axis-unit">分钟 / 时段</span>
          </div>
          <div className="hours">
            <div className="hour-scale"><span>{maxHourMinutes}</span><span>{Math.round(maxHourMinutes / 2)}</span><span>0</span></div>
            <div className="hour-grid">
              {summary.hours.map((seconds, hour) => {
                const label = String(hour).padStart(2, '0');
                const mins = Math.round(seconds / 60);
                const isPeak = summary.peakSec > 0 && hour === summary.peakHour;
                return (
                  <div
                    className={'hour' + (isPeak ? ' is-peak' : '')}
                    key={hour}
                    onMouseEnter={() => setHoveredHour(hour)}
                    onMouseLeave={() => setHoveredHour(null)}
                  >
                    <div
                      className="hour-track"
                      title={`${label}:00 · ${mins} 分钟`}
                      tabIndex={0}
                      onFocus={() => setHoveredHour(hour)}
                      onBlur={() => setHoveredHour(null)}
                    >
                      <i style={{ '--bar': `${(seconds / (maxHourMinutes * 60)) * 100}%` } as CSSProperties} />
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
              <p>当前统计窗口内耗时最多的课题</p>
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
                className="date-filter-btn"
                onClick={() => setPickedKey('')}
                title="点击清除日期筛选"
              >
                <CalendarDays size={12} />
                <span>{fullDate.format(pickedCell.date)}</span>
                <X size={12} />
              </button>
            )}
          </div>
          <p>共 {filtered.length} 条记录{pickedCell ? ' · 已按所选日期过滤' : ''}（仅记录满 3 分钟的专注）</p>
        </div>
        <div className="recent-filters">
          <label className="search-box">
            <Search size={13} />
            <input
              type="search"
              placeholder="搜索主题..."
              value={query}
              onChange={e => { setQuery(e.target.value); setLimit(12); }}
            />
          </label>
          <select
            aria-label="按模式筛选"
            value={modeFilter}
            onChange={e => { setModeFilter(e.target.value as 'all' | Mode); setLimit(12); }}
          >
            <option value="all">全部模式</option>
            <option value="deep">深度专注</option>
            <option value="pomo">番茄钟</option>
          </select>
          <select
            aria-label="按状态筛选"
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value as 'all' | Session['status']); setLimit(12); }}
          >
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
          <ol className="ledger-list">
            {filtered.slice(0, limit).map(record => {
              const ratio = Math.min(100, Math.round((record.seconds / Math.max(1, record.planned)) * 100));
              return (
                <li key={record.id} className="ledger-row">
                  <time dateTime={new Date(record.started * 1000).toISOString()}>
                    {timestamp.format(record.started * 1000)}
                  </time>
                  <div className="ledger-main">
                    <span className="record-topic">{record.topic || (record.mode === 'deep' ? '深度专注' : '番茄专注')}</span>
                    <span className="record-meta">
                      {record.mode === 'deep' ? '深度' : '番茄'}
                      {record.locked ? ' · 锁定' : ''}
                    </span>
                  </div>
                  <div className="timeline-progress" title={`完成度 ${ratio}%`}>
                    <div className="timeline-bar"><i style={{ width: `${ratio}%` }} /></div>
                    <span>{ratio}%</span>
                  </div>
                  <span className={'record-status status-' + record.status}>{statuses[record.status]}</span>
                  <strong className="record-duration">
                    {Math.floor(record.seconds / 60)}<span> 分</span> {String(record.seconds % 60).padStart(2, '0')}<span> 秒</span>
                  </strong>
                </li>
              );
            })}
          </ol>
          {filtered.length > limit && (
            <button type="button" className="button secondary load-more" onClick={() => setLimit(limit + 12)}>
              展开更多档案（余 {filtered.length - limit} 条）
            </button>
          )}
        </>
      )}
    </section>
  </div>;
}
