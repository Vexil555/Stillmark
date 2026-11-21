"""Timer, release protocol, and local SQLite journal."""

import math
import secrets
import sqlite3
import time
from pathlib import Path

DEFAULTS = {
    "theme": "light",
    "mode": "deep",
    "topic": "",
    "deep": 50,
    "work": 25,
    "short": 5,
    "long": 15,
    "rounds": 4,
    "lock": False,
    "ambient": False,
    "ambientStyle": "brown",
    "sound": True,
    "volume": 40,
    "motion": True,
    "dialTicks": True,
    "dialSecondSweep": True,
    "autoStartRest": True,
    "autoStartWork": False,
    "dailyGoal": 120,
    "releaseLength": 64,
    "cooldownSeconds": 180,
    "chimeVolume": 100,
}

RANGES = {
    "deep": (1, 180),
    "work": (1, 120),
    "short": (1, 45),
    "long": (1, 90),
    "rounds": (2, 8),
    "volume": (0, 100),
    "dailyGoal": (15, 720),
    "releaseLength": (16, 64),
    "cooldownSeconds": (0, 300),
    "chimeVolume": (0, 100),
}

ENUMS = {
    "theme": ("light", "dark"),
    "mode": ("deep", "pomo"),
    "ambientStyle": ("brown", "rain", "hearth"),
}

PHASE_DURATION = {"deep": "deep", "work": "work", "short": "short", "long": "long"}
ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
MIN_RECORD_SECONDS = 180


class Journal:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.directory = directory
        self.db_path = directory / "journal.sqlite3"
        self.db = sqlite3.connect(self.db_path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY, started INTEGER NOT NULL, seconds INTEGER NOT NULL,
                planned INTEGER NOT NULL, mode TEXT NOT NULL, topic TEXT NOT NULL,
                status TEXT NOT NULL, locked INTEGER NOT NULL
            );
            DELETE FROM sessions WHERE status = 'active' AND seconds < 180;
            UPDATE sessions SET status = 'interrupted' WHERE status = 'active';
        """)

    def preferences(self):
        state = DEFAULTS.copy()
        for key, value in self.db.execute("SELECT key, value FROM settings"):
            if key not in state:
                continue
            try:
                if key in RANGES:
                    minimum, maximum = RANGES[key]
                    state[key] = max(minimum, min(maximum, int(value)))
                elif isinstance(DEFAULTS.get(key), bool):
                    state[key] = value == "True"
                elif key in ENUMS:
                    if value in ENUMS[key]:
                        state[key] = value
                else:
                    state[key] = str(value)
            except (TypeError, ValueError):
                pass
        return state

    def set_preference(self, key, value):
        with self.db:
            self.db.execute(
                "INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, str(value)),
            )

    def reset_preferences(self):
        with self.db:
            self.db.execute("DELETE FROM settings")

    def clear_history(self):
        with self.db:
            self.db.execute("DELETE FROM sessions WHERE status != 'active'")

    def begin(self, planned, mode, topic, locked):
        with self.db:
            cursor = self.db.execute(
                "INSERT INTO sessions (started,seconds,planned,mode,topic,status,locked) "
                "VALUES (?,0,?,?,?,'active',?)", (int(time.time()), planned, mode, topic, int(bool(locked))),
            )
        return cursor.lastrowid

    def update(self, session, seconds, status):
        with self.db:
            self.db.execute(
                "UPDATE sessions SET seconds = ?, status = ? WHERE id = ?",
                (seconds, status, session),
            )

    def discard(self, session):
        with self.db:
            self.db.execute("DELETE FROM sessions WHERE id = ?", (session,))

    def history(self, since=0):
        return [dict(row) for row in self.db.execute(
            "SELECT * FROM sessions WHERE status != 'active' AND seconds >= ? "
            "AND started + seconds >= ? ORDER BY started DESC, id DESC",
            (MIN_RECORD_SECONDS, since),
        )]

    def stats(self):
        total_rows = self.db.execute(
            "SELECT COUNT(*) FROM sessions WHERE status != 'active' AND seconds >= ?",
            (MIN_RECORD_SECONDS,),
        ).fetchone()[0]
        size = self.db_path.stat().st_size if self.db_path.exists() else 0
        return {"count": int(total_rows), "bytes": int(size)}


class Timer:
    def __init__(self, journal):
        self.journal = journal
        self.config = journal.preferences()
        self.phase = self.starting_phase
        self.round = 1
        self.deadline = None
        self.paused_remaining = None
        self.duration = 0
        self.locked = False
        self.session = None
        self.checkpoint = 0
        self.release = None
        self.notice = ""
        self.system_dark = False

    @property
    def starting_phase(self):
        return "deep" if self.config["mode"] == "deep" else "work"

    @property
    def running(self):
        return self.deadline is not None or self.paused_remaining is not None

    @property
    def paused(self):
        return self.paused_remaining is not None

    @property
    def resting(self):
        return self.phase in ("short", "long")

    def set(self, key, value):
        if key not in DEFAULTS:
            return
        live_keys = ("theme", "volume", "chimeVolume", "sound", "motion", "ambient",
                     "ambientStyle", "dialTicks", "dialSecondSweep", "dailyGoal",
                     "autoStartRest", "autoStartWork")
        if self.running and key not in live_keys:
            return
        if key in RANGES:
            minimum, maximum = RANGES[key]
            value = max(minimum, min(maximum, int(value)))
        elif key == "topic":
            value = str(value).strip()[:60]
        elif isinstance(DEFAULTS[key], bool):
            value = bool(value)
        elif key in ENUMS:
            if value not in ENUMS[key]:
                return
        if self.config[key] == value:
            return
        self.journal.set_preference(key, value)
        self.config[key] = value
        if key in ("mode", "rounds") and not self.running:
            self.phase = self.starting_phase
            self.round = 1

    def reset_settings(self):
        if self.running:
            return False
        self.journal.reset_preferences()
        self.config = self.journal.preferences()
        self.phase = self.starting_phase
        self.round = 1
        self.notice = "已恢复默认设置"
        return True

    def begin(self, locked=False, now=None):
        now = time.monotonic() if now is None else now
        self.duration = self.config[PHASE_DURATION[self.phase]] * 60
        self.checkpoint = 0
        self.notice = ""
        self.paused_remaining = None
        if not self.resting:
            self.session = self.journal.begin(
                self.duration, self.config["mode"], self.config["topic"], locked,
            )
        self.deadline = now + self.duration
        self.locked = locked

    def pause(self, now=None):
        if not self.running or self.paused or self.locked or self.resting:
            return False
        now = time.monotonic() if now is None else now
        self.paused_remaining = self.remaining(now)
        self.deadline = None
        self.notice = "已暂停计时"
        return True

    def resume(self, now=None):
        if not self.paused:
            return False
        now = time.monotonic() if now is None else now
        self.deadline = now + self.paused_remaining
        self.paused_remaining = None
        self.notice = ""
        return True

    def remaining(self, now):
        if self.paused_remaining is not None:
            return self.paused_remaining
        if self.deadline is None:
            return self.config[PHASE_DURATION[self.phase]] * 60
        return max(0.0, self.deadline - now)

    def remaining_seconds(self, now):
        return max(0, math.ceil(self.remaining(now)))

    def stop(self, status, now=None):
        if not self.running:
            return False
        now = time.monotonic() if now is None else now
        recorded = False
        try:
            if self.session is not None:
                elapsed = self.duration if status == "complete" else max(0, self.duration - self.remaining_seconds(now))
                if elapsed >= MIN_RECORD_SECONDS:
                    self.journal.update(self.session, elapsed, status)
                    recorded = True
                else:
                    self.journal.discard(self.session)
        finally:
            self.reset()
        return recorded

    def reset(self):
        self.session = None
        self.deadline = None
        self.paused_remaining = None
        self.release = None
        self.locked = False

    def tick(self, now, unlock):
        if not self.running or self.paused:
            return
        remaining_float = self.remaining(now)
        remaining = max(0, math.ceil(remaining_float))
        if not remaining:
            previous = self.phase
            recorded = self.stop("complete", now)
            unlock()
            if previous == "work":
                self.phase = "long" if self.round == self.config["rounds"] else "short"
                if self.config["autoStartRest"]:
                    self.begin(False, now)
                else:
                    self.notice = "专注完成，点击开始休息" if recorded else "本轮完成（不足 3 分钟未计入记录），点击开始休息"
            elif previous in ("short", "long"):
                self.next_round(previous, now)
            else:
                self.notice = "本次专注已计入记录" if recorded else "本次不足 3 分钟，未计入专注记录"
        elif self.session is not None and self.duration - remaining >= self.checkpoint + 5:
            self.checkpoint = self.duration - remaining
            self.journal.update(self.session, self.checkpoint, "active")

    def next_round(self, previous, now=None):
        self.phase = "work"
        self.round = 1 if previous == "long" else self.round + 1
        if self.config["autoStartWork"]:
            self.begin(False, now)
        else:
            self.notice = "休息结束，准备好后开始下一轮"

    def request_release(self, now=None):
        now = time.monotonic() if now is None else now
        length = self.config["releaseLength"]
        self.release = {
            "code": "".join(secrets.choice(ALPHABET) for _ in range(length)),
            "length": length,
            "count": 0,
            "until": None,
            "cooldown": self.config["cooldownSeconds"],
            "error": False,
        }

    def release_key(self, key, now=None):
        check = self.release
        if check is None or check["until"] is not None:
            return
        now = time.monotonic() if now is None else now
        if key == check["code"][check["count"]]:
            check["count"] += 1
            check["error"] = False
            if check["count"] == check["length"]:
                check["until"] = now + check["cooldown"]
        else:
            self.request_release(now)
            self.release["error"] = True

    def snapshot(self, now):
        release = None
        if self.release is not None:
            check = self.release
            wait = None if check["until"] is None else max(0, math.ceil(check["until"] - now))
            release = {
                "code": check["code"],
                "length": check["length"],
                "count": check["count"],
                "wait": wait,
                "cooldown": check["cooldown"],
                "error": check["error"],
            }
        rem_float = self.remaining(now)
        rem_sec = max(0, math.ceil(rem_float))
        dur = self.duration if self.running else rem_sec
        return {
            "config": self.config,
            "phase": self.phase,
            "round": self.round,
            "running": self.running,
            "paused": self.paused,
            "locked": self.locked,
            "notice": self.notice,
            "remaining": rem_sec,
            "remainingExact": round(rem_float, 3),
            "duration": dur,
            "release": release,
            "systemDark": self.system_dark,
            "dbStats": self.journal.stats(),
        }
