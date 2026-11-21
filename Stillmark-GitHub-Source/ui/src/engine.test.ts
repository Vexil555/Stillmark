import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTodayStats, levelFor, MATRIX_WEEK_COUNT, summarizeHistory } from './analytics';
import { buildPreviewSeedSessions, PreviewTimerEngine } from './previewEngine';

test('PreviewTimerEngine clamps config bounds and locks non-live keys while running', () => {
  const engine = new PreviewTimerEngine({ seedRecords: [] });
  engine.set('deep', 999);
  assert.equal(engine.config.deep, 180);
  engine.set('deep', 0);
  assert.equal(engine.config.deep, 1);
  engine.set('deep', 25);

  engine.begin(false, 100, 1700000000);
  assert.equal(engine.running, true);

  // Duration cannot be mutated while running, but theme and dailyGoal are live keys
  assert.equal(engine.set('deep', 60), false);
  assert.equal(engine.config.deep, 25);
  assert.equal(engine.set('theme', 'dark'), true);
  assert.equal(engine.config.theme, 'dark');
  assert.equal(engine.set('dailyGoal', 180), true);
  assert.equal(engine.config.dailyGoal, 180);
});

test('PreviewTimerEngine deep focus pause, resume, and >=180s recording threshold', () => {
  const engine = new PreviewTimerEngine({ seedRecords: [], config: { deep: 5 } });
  engine.begin(false, 1000, 1700000000);
  assert.equal(engine.remainingSeconds(1060), 240);

  assert.equal(engine.pause(1060), true);
  assert.equal(engine.paused, true);
  assert.equal(engine.remainingSeconds(1200), 240);

  assert.equal(engine.resume(1200), true);
  assert.equal(engine.paused, false);
  // 240s remaining from t=1200 -> after 140s (t=1340), elapsed = 200s (>= 180s)
  const recorded = engine.endManual('stopped', '已结束', 1340);
  assert.equal(recorded, true);
  assert.equal(engine.records.length, 1);
  assert.equal(engine.records[0].seconds, 200);
  assert.equal(engine.records[0].status, 'stopped');

  // Short session (<180s) should be discarded
  engine.begin(false, 2000, 1700005000);
  const shortRecorded = engine.endManual('stopped', '已结束', 2060);
  assert.equal(shortRecorded, false);
  assert.equal(engine.records.length, 1);
});

test('PreviewTimerEngine pomodoro cycle transitions work -> short -> long -> round 1', () => {
  const engine = new PreviewTimerEngine({
    seedRecords: [],
    config: { mode: 'pomo', work: 5, short: 2, long: 10, rounds: 2, autoStartRest: true, autoStartWork: false },
  });
  assert.equal(engine.phase, 'work');
  assert.equal(engine.round, 1);

  engine.begin(false, 0, 1700000000);
  const tick1 = engine.tick(300, 1700000300);
  assert.equal(tick1.phaseChanged, true);
  assert.equal(tick1.chime, 'rest');
  assert.equal(engine.phase, 'short');
  assert.equal(engine.running, true); // autoStartRest

  engine.skipRest(310, 1700000310);
  assert.equal(engine.phase, 'work');
  assert.equal(engine.round, 2);
  assert.equal(engine.running, false); // autoStartWork is false

  engine.begin(false, 400, 1700000400);
  engine.tick(700, 1700000700);
  assert.equal(engine.phase, 'long'); // round 2 == rounds (2)

  engine.skipRest(710, 1700000710);
  assert.equal(engine.phase, 'work');
  assert.equal(engine.round, 1);
});

test('PreviewTimerEngine lock release protocol resets on wrong key and enforces cooldown', () => {
  let seq = 0;
  const deterministic = () => {
    seq = (seq + 1) % 32;
    return seq / 32;
  };
  const engine = new PreviewTimerEngine({
    seedRecords: [],
    config: { deep: 10, lock: true, releaseLength: 16, cooldownSeconds: 30 },
    random: deterministic,
  });
  engine.begin(true, 100, 1700000000);
  assert.equal(engine.locked, true);
  assert.equal(engine.pause(110), false); // locked sessions cannot pause

  engine.requestRelease();
  const snap1 = engine.snapshot(110);
  assert.ok(snap1.release);
  const firstCode = snap1.release.code;
  assert.equal(firstCode.length, 16);

  // Wrong character resets code and flags error
  const wrongChar = firstCode[0] === 'A' ? 'B' : 'A';
  engine.releaseKey(wrongChar, 111);
  const snap2 = engine.snapshot(111);
  assert.equal(snap2.release?.error, true);
  assert.equal(snap2.release?.count, 0);

  // Typing all characters enters cooldown
  const code = snap2.release!.code;
  for (const ch of code) {
    engine.releaseKey(ch, 120);
  }
  const snap3 = engine.snapshot(125);
  assert.equal(snap3.release?.wait, 25);
  assert.equal(engine.canCompleteRelease(125), false);
  assert.equal(engine.canCompleteRelease(150), true);
});

test('Analytics produces 42 month cells, 20 matrix weeks, distinct heat levels, and accurate streaks', () => {
  const fixedNow = new Date(2026, 10, 20, 15, 0, 0); // 2026-11-20 15:00 local
  const records = buildPreviewSeedSessions(fixedNow.getTime());

  assert.equal(levelFor(0, 7200), 0);
  assert.equal(levelFor(1500, 7200), 1);
  assert.equal(levelFor(3000, 7200), 2);
  assert.equal(levelFor(5400, 7200), 3);
  assert.equal(levelFor(7200, 7200), 4);

  const today = computeTodayStats(records, fixedNow);
  assert.ok(today.todayMin >= 60);
  assert.ok(today.todayCount >= 1);
  assert.equal(today.todayAvgMin, Math.round(today.todayMin / today.todayCount));
  assert.ok(today.todayBestMin >= today.todayAvgMin);
  assert.ok(today.streak >= 6);

  const monthSummary = summarizeHistory(records, 'month', 0, 0, 120, fixedNow);
  assert.equal(monthSummary.monthCells.length, 42);
  assert.equal(monthSummary.matrixWeeks.length, MATRIX_WEEK_COUNT);
  assert.ok(monthSummary.total > 0);

  const matrixSummary = summarizeHistory(records, 'matrix', 0, 0, 120, fixedNow);
  assert.equal(matrixSummary.matrixWeeks.length, MATRIX_WEEK_COUNT);
  assert.equal(matrixSummary.matrixWeeks.reduce((acc, w) => acc + w.days.length, 0), MATRIX_WEEK_COUNT * 7);
  // Seed data should span multiple distinct heat levels (at least 0, 1, 2, 3, 4)
  const levels = new Set(matrixSummary.matrixWeeks.flatMap(w => w.days.filter(d => !d.future).map(d => d.level)));
  assert.ok(levels.size >= 4, `Expected >=4 distinct heat levels, got ${[...levels].join(',')}`);
});

test('PreviewTimerEngine deep focus count-up stopwatch mode tracks elapsed time and completes cleanly', () => {
  const engine = new PreviewTimerEngine({ seedRecords: [], config: { mode: 'deep', deepStyle: 'countup' } });
  assert.equal(engine.snapshot(0).countingUp, true);
  assert.equal(engine.snapshot(0).remaining, 0);

  engine.begin(false, 1000, 1700000000);
  assert.equal(engine.running, true);
  assert.equal(engine.snapshot(1065).remaining, 65);
  assert.equal(engine.snapshot(1065).countingUp, true);

  // Pause freezes elapsed time
  assert.equal(engine.pause(1100), true);
  assert.equal(engine.snapshot(1250).remaining, 100);

  // Resume continues accumulating from 100s
  assert.equal(engine.resume(1250), true);
  assert.equal(engine.snapshot(1450).remaining, 300); // 5 minutes (>= 180s)

  // Finishing count-up session manually records as complete with planned === elapsed
  const recorded = engine.endManual('complete', '已完成正计时', 1450);
  assert.equal(recorded, true);
  assert.equal(engine.records.length, 1);
  assert.equal(engine.records[0].status, 'complete');
  assert.equal(engine.records[0].seconds, 300);
  assert.equal(engine.records[0].planned, 300);

  // Short count-up session (<180s) should be discarded
  engine.begin(false, 2000, 1700005000);
  const shortRecorded = engine.endManual('complete', '已完成正计时', 2120);
  assert.equal(shortRecorded, false);
  assert.equal(engine.records.length, 1);
});

