import type { Session } from './model';

export type SpanMode = 'month' | 'matrix';

export interface DayCell {
  date: Date;
  key: string;
  level: 0 | 1 | 2 | 3 | 4;
  seconds: number;
  future: boolean;
  isToday: boolean;
  goalMet: boolean;
  outsideMonth?: boolean;
  sessions: number;
  completedSessions: number;
}

export interface MatrixWeek {
  start: Date;
  isCurrentWeek: boolean;
  monthLabel: string;
  days: DayCell[];
}

export interface TodayStats {
  todayMin: number;
  todayCount: number;
  todayCompleted: number;
  streak: number;
  recentTopics: string[];
}

export interface HistorySummary {
  total: number;
  completed: number;
  lockedCount: number;
  streak: number;
  bestStreak: number;
  recent: Session[];
  monthCells: DayCell[];
  matrixWeeks: MatrixWeek[];
  viewYear: number;
  viewMonth: number;
  matrixLabel: string;
  hours: number[];
  activeDays: number;
  goalDays: number;
  bestDayKey: string;
  bestDaySeconds: number;
  peakHour: number;
  peakSec: number;
  topTopics: { name: string; seconds: number; pct: number }[];
  thisWeekSec: number;
  weekDeltaPct: number;
}

export const MATRIX_WEEK_COUNT = 24;

const fullDate = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
const shortDate = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function dayAt(base: Date, offset: number): Date {
  const day = new Date(base);
  day.setDate(day.getDate() + offset);
  return day;
}

export function formatSpan(totalSeconds: number): string {
  const mins = Math.round(totalSeconds / 60);
  if (mins < 60) return `${mins} 分钟`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

export function levelFor(seconds: number, goalSec: number): 0 | 1 | 2 | 3 | 4 {
  if (seconds <= 0) return 0;
  const ratio = seconds / Math.max(60, goalSec);
  if (ratio < 0.3) return 1;
  if (ratio < 0.6) return 2;
  if (ratio < 1.0) return 3;
  return 4;
}

export function computeTodayStats(records: Session[], nowDate: Date = new Date()): TodayStats {
  const today = new Date(nowDate);
  today.setHours(0, 0, 0, 0);
  const start = today.getTime() / 1000;
  let todaySec = 0;
  let todayCount = 0;
  let todayCompleted = 0;
  const dayHasFocus = new Set<string>();
  const recentTopics: string[] = [];
  const seenTopics = new Set<string>();

  for (const r of records) {
    if (r.seconds < 180) continue;
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
      }
    }
    let cursor = r.started;
    const finish = r.started + r.seconds;
    while (cursor < finish) {
      const d = new Date(cursor * 1000);
      dayHasFocus.add(dateKey(d));
      const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() / 1000;
      cursor = Math.min(nextMidnight, finish);
    }
  }

  let streak = 0;
  for (let offset = 0; offset < 366; offset++) {
    const key = dateKey(dayAt(today, -offset));
    if (dayHasFocus.has(key)) streak += 1;
    else if (offset === 0) continue;
    else break;
  }

  return {
    todayMin: Math.floor(todaySec / 60),
    todayCount,
    todayCompleted,
    streak,
    recentTopics,
  };
}

export function summarizeHistory(
  records: Session[],
  span: SpanMode,
  monthOffset: number,
  matrixOffset: number,
  dailyGoal: number,
  nowDate: Date = new Date(),
): HistorySummary {
  const today = new Date(nowDate);
  today.setHours(0, 0, 0, 0);
  const thisMonday = dayAt(today, -((today.getDay() + 6) % 7));
  const lastMonday = dayAt(thisMonday, -7);

  let rangeStart: Date;
  let rangeEnd: Date;
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();

  // Matrix always spans MATRIX_WEEK_COUNT full Monday-Sunday weeks
  const matrixEndMonday = dayAt(thisMonday, matrixOffset * 4 * 7);
  const matrixStart = dayAt(matrixEndMonday, -(MATRIX_WEEK_COUNT - 1) * 7);
  const matrixEnd = dayAt(matrixEndMonday, 7);

  if (span === 'month') {
    const target = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    viewYear = target.getFullYear();
    viewMonth = target.getMonth();
    rangeStart = target;
    rangeEnd = new Date(viewYear, viewMonth + 1, 1);
  } else {
    rangeStart = matrixStart;
    rangeEnd = matrixEnd;
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

  // Month calendar grid: always 6 rows (42 cells) so stage height never shifts
  const monthFirst = new Date(viewYear, viewMonth, 1);
  const leadDays = (monthFirst.getDay() + 6) % 7;
  const gridStart = dayAt(monthFirst, -leadDays);
  const monthCells: DayCell[] = Array.from({ length: 42 }, (_, i) => {
    const d = dayAt(gridStart, i);
    return makeCell(d, d.getMonth() !== viewMonth);
  });

  // 20-week macro heatmap matrix (20 columns x 7 days)
  let lastMonthLabeled = -1;
  const matrixWeeks: MatrixWeek[] = Array.from({ length: MATRIX_WEEK_COUNT }, (_, w) => {
    const weekStart = dayAt(matrixStart, w * 7);
    const days = Array.from({ length: 7 }, (_, d) => makeCell(dayAt(weekStart, d)));
    // Label month on first week or wherever the 1st of a month falls in this week
    let monthLabel = '';
    const firstOfMonth = days.find(cell => cell.date.getDate() === 1);
    if (w === 0) {
      monthLabel = `${weekStart.getMonth() + 1}月`;
      lastMonthLabeled = weekStart.getMonth();
    } else if (firstOfMonth && firstOfMonth.date.getMonth() !== lastMonthLabeled) {
      const m = firstOfMonth.date.getMonth();
      monthLabel = m === 0 ? `${firstOfMonth.date.getFullYear()}` : `${m + 1}月`;
      lastMonthLabeled = m;
    }
    return {
      start: weekStart,
      isCurrentWeek: weekStart.getTime() === thisMonday.getTime(),
      monthLabel,
      days,
    };
  });

  const matrixLastDay = dayAt(matrixEnd, -1);
  const matrixLabel = matrixOffset === 0
    ? `近 ${MATRIX_WEEK_COUNT} 周`
    : `${shortDate.format(matrixStart)} – ${shortDate.format(matrixLastDay)}`;

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
    monthCells, matrixWeeks, viewYear, viewMonth, matrixLabel,
    hours, activeDays, goalDays, bestDayKey, bestDaySeconds, peakHour, peakSec,
    topTopics, thisWeekSec, weekDeltaPct,
  };
}
