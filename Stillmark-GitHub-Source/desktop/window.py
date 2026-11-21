"""Native Windows shell and the Qt WebChannel for the instrument face."""

import csv
import json
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

from PySide6.QtCore import QEvent, QFile, QIODevice, QLockFile, QObject, QRect, QStandardPaths, QTimer, Qt, QUrl, Signal, Slot
from PySide6.QtGui import QDesktopServices, QIcon
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import (
    QWebEnginePage, QWebEngineScript, QWebEngineSettings, QWebEngineUrlRequestJob,
    QWebEngineUrlScheme, QWebEngineUrlSchemeHandler,
)
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication, QFileDialog, QLabel, QMessageBox, QVBoxLayout, QWidget

from .engine import Journal, Timer
from .guard import Guard, execution_state, topmost

ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
PHASES = {"deep": "深度专注", "work": "番茄专注", "short": "短休息", "long": "长休息"}
STATUS_LABELS = {
    "complete": "已完成",
    "stopped": "提前结束",
    "released": "验证后结束",
    "emergency": "已熔断",
    "closed": "关闭程序",
    "interrupted": "意外中断",
}
MIME = {
    ".html": b"text/html",
    ".js": b"text/javascript",
    ".css": b"text/css",
    ".woff": b"font/woff",
    ".woff2": b"font/woff2",
    ".svg": b"image/svg+xml",
}


class AppAssets(QWebEngineUrlSchemeHandler):
    def requestStarted(self, job):
        directory = ROOT / "ui" / "dist"
        path = (directory / job.requestUrl().path().lstrip("/")).resolve()
        if not path.is_relative_to(directory) or path.suffix not in MIME:
            job.fail(QWebEngineUrlRequestJob.Error.RequestDenied)
            return
        stream = QFile(str(path), job)
        if stream.open(QIODevice.OpenModeFlag.ReadOnly):
            job.reply(MIME[path.suffix], stream)
        else:
            job.fail(QWebEngineUrlRequestJob.Error.UrlNotFound)


class LocalPage(QWebEnginePage):
    def __init__(self, url, parent):
        super().__init__(parent)
        self.entry = url

    def acceptNavigationRequest(self, url, kind, main_frame):
        return url == self.entry


class ScreenCover(QWidget):
    def __init__(self, screen, activate_main):
        super().__init__(
            None,
            Qt.WindowType.Tool | Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowStaysOnTopHint,
        )
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)
        self.activate_main = activate_main
        self.setStyleSheet(
            "QWidget {background: qradialgradient(cx:0.5, cy:0.45, radius:0.75, "
            "stop:0 #282924, stop:1 #1b1c19); color: #f1eee3;}"
        )
        layout = QVBoxLayout(self)
        layout.setSpacing(14)
        layout.addStretch()

        self.badge_label = QLabel("沉浸锁定 · 副屏同步", alignment=Qt.AlignmentFlag.AlignCenter)
        self.badge_label.setStyleSheet(
            "background: transparent; color: #8c897d; font-family: 'Microsoft YaHei UI'; "
            "font-size: 12px; letter-spacing: 2px;"
        )
        layout.addWidget(self.badge_label)

        self.time_label = QLabel(alignment=Qt.AlignmentFlag.AlignCenter)
        self.time_label.setStyleSheet(
            "background: transparent; color: #f4efe6; font-family: Bahnschrift, 'Segoe UI'; "
            "font-size: 86px; font-weight: 700;"
        )
        layout.addWidget(self.time_label)

        self.phase_label = QLabel(alignment=Qt.AlignmentFlag.AlignCenter)
        self.phase_label.setStyleSheet(
            "background: transparent; color: #c7c2b4; font-family: 'Microsoft YaHei UI'; "
            "font-size: 15px;"
        )
        layout.addWidget(self.phase_label)

        self.topic_label = QLabel(alignment=Qt.AlignmentFlag.AlignCenter)
        self.topic_label.setStyleSheet(
            "background: transparent; color: #8c897d; font-family: 'Microsoft YaHei UI'; "
            "font-size: 13px;"
        )
        layout.addWidget(self.topic_label)

        layout.addStretch()

        self.hint_label = QLabel("点击任意位置回到主屏 · 紧急熔断 Ctrl+Shift+Alt+F12 (2秒)",
                                  alignment=Qt.AlignmentFlag.AlignCenter)
        self.hint_label.setStyleSheet(
            "background: transparent; color: #67655b; font-family: 'Microsoft YaHei UI'; "
            "font-size: 11px; padding-bottom: 24px;"
        )
        layout.addWidget(self.hint_label)

        self.winId()
        self.windowHandle().setScreen(screen)
        self.setGeometry(screen.geometry())
        self.showFullScreen()
        topmost(int(self.winId()), True)

    def mousePressEvent(self, event):
        self.activate_main()

    def closeEvent(self, event):
        event.ignore()

    def update_clock(self, state):
        minutes, seconds = divmod(state["remaining"], 60)
        self.time_label.setText(f"{minutes:02d}:{seconds:02d}")
        phase_text = PHASES[state["phase"]]
        if state["config"]["mode"] == "pomo":
            phase_text += f"  ·  第 {state['round']} / {state['config']['rounds']} 轮"
        self.phase_label.setText(phase_text)
        topic = state["config"].get("topic", "").strip()
        self.topic_label.setText(topic)
        self.topic_label.setVisible(bool(topic))


class Bridge(QObject):
    changed = Signal(str)
    recorded = Signal(str)
    chime = Signal(str)
    maximized = Signal(bool)

    def __init__(self, window, journal):
        super().__init__(window)
        self.window = window
        self.timer = Timer(journal)
        self.journal = journal
        self.previous = ""
        self.sync_system_theme()
        self.clock = QTimer(self)
        self.clock.setInterval(125)
        self.clock.timeout.connect(self.tick)
        self.clock.start()

    def sync_system_theme(self):
        app = QApplication.instance()
        hints = app.styleHints() if app else None
        if hints is not None and hasattr(hints, "colorScheme"):
            self.timer.system_dark = hints.colorScheme() == Qt.ColorScheme.Dark

    def history(self):
        return self.journal.history(int(time.time()) - 370 * 86400)

    @Slot(result=str)
    def initialize(self):
        self.sync_system_theme()
        return json.dumps(
            {
                "state": self.timer.snapshot(time.monotonic()),
                "records": self.history(),
                "maximized": self.window.isMaximized(),
            },
            ensure_ascii=False,
        )

    def update_window_title(self, state):
        if state["running"]:
            minutes, seconds = divmod(state["remaining"], 60)
            tag = "暂停" if state["paused"] else ("正计时" if state.get("countingUp") else PHASES[state["phase"]])
            self.window.setWindowTitle(f"{minutes:02d}:{seconds:02d} · {tag} — 刻度 STILLMARK")
        else:
            self.window.setWindowTitle("刻度 STILLMARK")

    def publish(self, now=None):
        now = time.monotonic() if now is None else now
        state = self.timer.snapshot(now)
        payload = json.dumps(state, ensure_ascii=False)
        if payload != self.previous:
            self.previous = payload
            self.changed.emit(payload)
            self.update_window_title(state)
            for cover in self.window.covers.values():
                cover.update_clock(state)

    def publish_history(self):
        self.recorded.emit(json.dumps(self.history(), ensure_ascii=False))

    def tick(self):
        timer = self.timer
        if not timer.running or timer.paused:
            return
        now = time.monotonic()
        if timer.locked and self.window.guard.pulse():
            self.end("emergency", "安全熔断已解除沉浸锁定")
            return
        before = (timer.phase, timer.running)
        try:
            timer.tick(now, self.window.exit_lock)
            if before != (timer.phase, timer.running):
                self.chime.emit("rest" if timer.resting else "finish")
                self.publish_history()
        except sqlite3.Error as error:
            self.window.exit_lock()
            timer.reset()
            timer.notice = f"写入专注记录失败。{error}"
        self.publish(now)

    def end(self, status, notice):
        self.window.exit_lock()
        recorded = False
        try:
            was_focus = self.timer.session is not None
            recorded = self.timer.stop(status)
            if was_focus and not recorded and notice:
                self.timer.notice = f"{notice}（不足 3 分钟，未计入记录）"
            else:
                self.timer.notice = notice
            self.publish_history()
        except sqlite3.Error as error:
            self.timer.notice = f"写入专注记录失败。{error}"
        self.publish()
        return recorded

    def begin(self):
        timer = self.timer
        if timer.running:
            return
        locked = timer.config["lock"] and not timer.resting
        try:
            if locked:
                self.window.enter_lock()
            timer.begin(locked)
        except (OSError, sqlite3.Error) as error:
            self.window.exit_lock()
            timer.notice = str(error)
        else:
            self.chime.emit("start")

    @Slot(str, str)
    def dispatch(self, command, raw):
        timer = self.timer
        if command == "begin":
            self.begin()
        elif command == "pause":
            timer.pause()
        elif command == "resume":
            timer.resume()
        elif command == "set":
            key, value = json.loads(raw)
            try:
                timer.set(key, value)
            except sqlite3.Error as error:
                timer.notice = f"保存设置失败。{error}"
        elif command == "resetSettings":
            try:
                timer.reset_settings()
            except sqlite3.Error as error:
                timer.notice = f"恢复默认设置失败。{error}"
        elif command == "clearHistory" and not timer.running:
            try:
                self.journal.clear_history()
                timer.notice = "已清空历史专注记录"
                self.publish_history()
            except sqlite3.Error as error:
                timer.notice = f"清空专注记录失败。{error}"
        elif command == "end" and timer.running and not timer.resting:
            if timer.locked:
                if timer.release is None:
                    timer.request_release()
                elif timer.release["until"] is not None and time.monotonic() >= timer.release["until"]:
                    self.end("released", "本次专注已提前结束")
            else:
                if timer.counting_up:
                    if self.end("complete", "本次正计时专注已完成"):
                        self.chime.emit("finish")
                else:
                    self.end("stopped", "本次专注已结束")
        elif command == "cancelRelease" and timer.release is not None:
            timer.release = None
        elif command == "releaseKey" and timer.release is not None:
            timer.release_key(raw.upper())
        elif command == "skip" and timer.resting and timer.running:
            previous = timer.phase
            timer.stop("skipped")
            timer.next_round(previous)
        elif not timer.locked:
            self.window.action(command, raw)
        self.publish()


class Window(QWidget):
    def __init__(self, directory, journal):
        super().__init__(None, Qt.WindowType.Window | Qt.WindowType.FramelessWindowHint)
        self.setWindowTitle("刻度 STILLMARK")
        self.setWindowIcon(QIcon(str(ROOT / "assets" / "stillmark.ico")))
        self.setMinimumSize(660, 430)
        screen = QApplication.primaryScreen().availableGeometry()
        size = QRect(0, 0, min(1240, screen.width()), min(790, max(430, screen.height() - 34)))
        size.moveCenter(screen.center())
        self.setGeometry(size)
        self.directory = directory
        self.guard = Guard()
        self.covers = {}
        self.lock_screen = None
        self.return_geometry = None
        self.return_maximized = False
        self.bridge = Bridge(self, journal)
        self.view = QWebEngineView(self)
        self.view.setContextMenuPolicy(Qt.ContextMenuPolicy.NoContextMenu)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self.view)

        url = QUrl("stillmark://app/index.html")
        self.page = LocalPage(url, self.view)
        self.view.setPage(self.page)
        self.assets = AppAssets(self.page.profile())
        self.page.profile().installUrlSchemeHandler(b"stillmark", self.assets)
        self.page.setBackgroundColor(Qt.GlobalColor.transparent)
        self.page.settings().setAttribute(QWebEngineSettings.WebAttribute.PlaybackRequiresUserGesture, False)
        self.page.settings().setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, False)
        self.channel = QWebChannel(self.page)
        self.channel.registerObject("stillmark", self.bridge)
        self.page.setWebChannel(self.channel)
        library = QFile(":/qtwebchannel/qwebchannel.js")
        if library.open(QFile.OpenModeFlag.ReadOnly):
            script = QWebEngineScript()
            script.setName("qt-webchannel")
            script.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
            script.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentCreation)
            script.setSourceCode(bytes(library.readAll()).decode("utf-8"))
            self.page.scripts().insert(script)
        self.view.load(url)
        app = QApplication.instance()
        app.screenAdded.connect(self.refresh_covers)
        app.screenRemoved.connect(self.refresh_covers)
        hints = app.styleHints()
        if hints is not None and hasattr(hints, "colorSchemeChanged"):
            hints.colorSchemeChanged.connect(self.on_color_scheme_changed)
        self.page.renderProcessTerminated.connect(self.renderer_ended)
        app.aboutToQuit.connect(self.guard.dispose)

    def on_color_scheme_changed(self, *_):
        self.bridge.sync_system_theme()
        self.bridge.publish()

    def refresh_covers(self, *_):
        if self.return_geometry is None:
            return
        screens = QApplication.screens()
        if self.lock_screen not in screens:
            self.lock_screen = QApplication.primaryScreen()
            self.windowHandle().setScreen(self.lock_screen)
            self.setGeometry(self.lock_screen.geometry())
            self.showFullScreen()
            topmost(int(self.winId()), True)
        target = set(screens) - {self.lock_screen}
        for screen in self.covers.keys() - target:
            cover = self.covers.pop(screen)
            cover.hide()
            cover.deleteLater()
        for screen in target - self.covers.keys():
            cover = ScreenCover(screen, self.activateWindow)
            cover.update_clock(self.bridge.timer.snapshot(time.monotonic()))
            self.covers[screen] = cover

    def enter_lock(self):
        self.guard.arm()
        execution_state(0x80000003)
        self.return_maximized = self.isMaximized()
        self.return_geometry = self.normalGeometry() if self.return_maximized else self.geometry()
        self.lock_screen = self.windowHandle().screen()
        self.showFullScreen()
        topmost(int(self.winId()), True)
        self.refresh_covers()
        self.raise_()
        self.activateWindow()

    def exit_lock(self):
        if self.return_geometry is None:
            return
        self.guard.disarm()
        execution_state(0x80000000)
        for cover in self.covers.values():
            cover.hide()
            cover.deleteLater()
        self.covers.clear()
        topmost(int(self.winId()), False)
        self.showNormal()
        geometry = self.return_geometry
        if not any(screen.availableGeometry().contains(geometry.center()) for screen in QApplication.screens()):
            geometry.moveCenter(QApplication.primaryScreen().availableGeometry().center())
        self.setGeometry(geometry)
        if self.return_maximized:
            self.showMaximized()
        self.return_geometry = None
        self.lock_screen = None
        self.guard.acknowledge()

    def action(self, command, raw):
        if command == "move":
            self.windowHandle().startSystemMove()
        elif command == "resize":
            self.windowHandle().startSystemResize(Qt.Edge(int(raw)))
        elif command == "minimize":
            self.showMinimized()
        elif command == "maximize":
            if self.isMaximized():
                self.showNormal()
            else:
                self.showMaximized()
        elif command == "close":
            self.close()
        elif command == "data":
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(self.directory)))
        elif command == "export":
            self.export_history()

    def export_history(self):
        name, _ = QFileDialog.getSaveFileName(
            self, "导出专注记录", str(Path.home() / "Documents" / "Stillmark.csv"), "CSV (*.csv)",
        )
        if not name:
            return
        try:
            with open(name, "w", newline="", encoding="utf-8-sig") as stream:
                writer = csv.writer(stream)
                writer.writerow(("开始时间", "主题", "模式", "专注秒数", "计划秒数", "结束状态", "沉浸锁定"))
                for row in self.bridge.journal.history():
                    start = datetime.fromtimestamp(row["started"]).isoformat(sep=" ")
                    topic = row["topic"]
                    if topic.startswith(("=", "+", "-", "@", "\t", "\r", "\n")):
                        topic = "'" + topic
                    status = STATUS_LABELS.get(row["status"], row["status"])
                    writer.writerow((
                        start,
                        topic,
                        "深度专注" if row["mode"] == "deep" else "番茄钟",
                        row["seconds"],
                        row["planned"],
                        status,
                        "是" if row["locked"] else "否",
                    ))
            self.bridge.timer.notice = "已导出专注记录"
        except OSError as error:
            QMessageBox.warning(self, "导出失败", str(error))

    def renderer_ended(self, *_):
        if self.bridge.timer.locked:
            self.bridge.end("interrupted", "界面已重新加载，沉浸锁定已解除")
        self.view.reload()

    def changeEvent(self, event):
        super().changeEvent(event)
        if event.type() == QEvent.Type.WindowStateChange:
            self.bridge.maximized.emit(self.isMaximized())

    def closeEvent(self, event):
        if self.bridge.timer.locked:
            event.ignore()
            return
        self.bridge.end("closed", "")
        event.accept()


def run():
    scheme = QWebEngineUrlScheme(b"stillmark")
    scheme.setSyntax(QWebEngineUrlScheme.Syntax.Host)
    scheme.setFlags(
        QWebEngineUrlScheme.Flag.SecureScheme
        | QWebEngineUrlScheme.Flag.LocalScheme
        | QWebEngineUrlScheme.Flag.CorsEnabled
    )
    QWebEngineUrlScheme.registerScheme(scheme)
    app = QApplication(sys.argv)
    app.setApplicationName("Stillmark")
    app.setApplicationDisplayName("刻度 STILLMARK")
    directory = Path(QStandardPaths.writableLocation(QStandardPaths.StandardLocation.AppLocalDataLocation))
    directory.mkdir(parents=True, exist_ok=True)
    single = QLockFile(str(directory / "instance.lock"))
    single.setStaleLockTime(0)
    if not single.tryLock(0):
        QMessageBox.information(None, "刻度 STILLMARK", "刻度已经在运行。")
        return 0
    journal = Journal(directory)
    window = Window(directory, journal)
    window.show()
    code = app.exec()
    journal.db.close()
    return code
