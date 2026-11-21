"""Windows keyboard filter with an independent recovery process."""

import ctypes as ct
import os
import subprocess
import sys
import time
import uuid
from ctypes import wintypes as wt

kernel = ct.WinDLL("kernel32", use_last_error=True)
user = ct.WinDLL("user32", use_last_error=True)
LRESULT = ct.c_ssize_t
HOOK_PROC = ct.WINFUNCTYPE(LRESULT, ct.c_int, wt.WPARAM, wt.LPARAM)


class KeyEvent(ct.Structure):
    _fields_ = [("vk", wt.DWORD), ("scan", wt.DWORD), ("flags", wt.DWORD),
                ("time", wt.DWORD), ("extra", ct.c_size_t)]


def bind(library, name, result, *arguments):
    function = getattr(library, name)
    function.restype = result
    function.argtypes = arguments
    return function


create_event = bind(kernel, "CreateEventW", wt.HANDLE, ct.c_void_p, wt.BOOL, wt.BOOL, wt.LPCWSTR)
set_event = bind(kernel, "SetEvent", wt.BOOL, wt.HANDLE)
reset_event = bind(kernel, "ResetEvent", wt.BOOL, wt.HANDLE)
wait = bind(kernel, "WaitForSingleObject", wt.DWORD, wt.HANDLE, wt.DWORD)
close = bind(kernel, "CloseHandle", wt.BOOL, wt.HANDLE)
open_process = bind(kernel, "OpenProcess", wt.HANDLE, wt.DWORD, wt.BOOL, wt.DWORD)
terminate = bind(kernel, "TerminateProcess", wt.BOOL, wt.HANDLE, wt.UINT)
module_handle = bind(kernel, "GetModuleHandleW", wt.HMODULE, wt.LPCWSTR)
execution_state = bind(kernel, "SetThreadExecutionState", wt.DWORD, wt.DWORD)
install_hook = bind(user, "SetWindowsHookExW", wt.HHOOK, ct.c_int, HOOK_PROC, wt.HINSTANCE, wt.DWORD)
remove_hook = bind(user, "UnhookWindowsHookEx", wt.BOOL, wt.HHOOK)
chain_hook = bind(user, "CallNextHookEx", LRESULT, wt.HHOOK, ct.c_int, wt.WPARAM, wt.LPARAM)
key_state = bind(user, "GetAsyncKeyState", ct.c_short, ct.c_int)
wait_messages = bind(user, "MsgWaitForMultipleObjects", wt.DWORD, wt.DWORD, ct.POINTER(wt.HANDLE),
                     wt.BOOL, wt.DWORD, wt.DWORD)
peek_message = bind(user, "PeekMessageW", wt.BOOL, ct.POINTER(wt.MSG), wt.HWND,
                   wt.UINT, wt.UINT, wt.UINT)
dispatch_message = bind(user, "DispatchMessageW", LRESULT, ct.POINTER(wt.MSG))
place_window = bind(user, "SetWindowPos", wt.BOOL, wt.HWND, wt.HWND, ct.c_int, ct.c_int,
                    ct.c_int, ct.c_int, wt.UINT)

CTRL = {0x11, 0xA2, 0xA3}
SHIFT = {0x10, 0xA0, 0xA1}
ALT = {0x12, 0xA4, 0xA5}
MODIFIERS = CTRL | SHIFT | ALT
F12 = 0x7B
WIN = {0x5B, 0x5C}
ALT_SWITCH = {0x09, 0x1B, 0x20, 0x73}


def topmost(hwnd, enabled):
    place_window(hwnd, -1 if enabled else -2, 0, 0, 0, 0, 0x0013)


def make_events(token):
    return {
        name: create_event(None, name != "pulse", False, f"Local\\Stillmark.{token}.{name}")
        for name in ("arm", "ready", "pulse", "emergency", "failed")
    }


class Guard:
    def __init__(self):
        self.child = None
        self.token = uuid.uuid4().hex
        self.events = make_events(self.token)

    def arm(self):
        self.disarm()
        if self.child is None or self.child.poll() is not None:
            entry = [sys.executable] if getattr(sys, "frozen", False) else [sys.executable, sys.argv[0]]
            self.child = subprocess.Popen(
                [*entry, "--guard", str(os.getpid()), self.token],
                creationflags=subprocess.CREATE_NO_WINDOW, stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        set_event(self.events["pulse"])
        reset_event(self.events["failed"])
        set_event(self.events["arm"])
        deadline = time.monotonic() + 2.5
        while time.monotonic() < deadline:
            if wait(self.events["ready"], 25) == 0:
                return
            if wait(self.events["failed"], 0) == 0 or self.child.poll() is not None:
                break
        self.disarm()
        raise OSError("Windows 热键拦截未能启用。")

    def disarm(self):
        reset_event(self.events["arm"])
        deadline = time.monotonic() + 0.15
        while wait(self.events["ready"], 0) == 0 and time.monotonic() < deadline:
            time.sleep(0.01)
        if wait(self.events["ready"], 0) == 0:
            if self.child is not None and self.child.poll() is None:
                self.child.kill()
                self.child.wait()
            reset_event(self.events["ready"])

    def pulse(self):
        set_event(self.events["pulse"])
        return wait(self.events["emergency"], 0) == 0 or (
            self.child is not None and self.child.poll() is not None
        )

    def acknowledge(self):
        reset_event(self.events["emergency"])

    def dispose(self):
        self.disarm()
        for handle in self.events.values():
            close(handle)


class KeyboardFilter:
    def __init__(self):
        self.down = set()
        self.blocked = set()
        self.hold_since = None
        self.handle = None
        self.callback = HOOK_PROC(self.on_message)

    def start(self):
        self.down = {key for key in MODIFIERS - {0x10, 0x11, 0x12} if key_state(key) & 0x8000}
        self.blocked.clear()
        self.hold_since = None
        self.handle = install_hook(13, self.callback, module_handle(None), 0)
        return bool(self.handle)

    def stop(self):
        if self.handle:
            remove_hook(self.handle)
            self.handle = None

    def on_message(self, code, message, address):
        if code < 0:
            return chain_hook(None, code, message, address)
        event = ct.cast(address, ct.POINTER(KeyEvent)).contents
        key = event.vk
        released = bool(event.flags & 0x80)
        if key in MODIFIERS or key == F12:
            if released:
                self.down.discard(key)
            else:
                self.down.add(key)
        ctrl = bool(self.down & CTRL)
        shift = bool(self.down & SHIFT)
        alt = bool(event.flags & 0x20 or self.down & ALT)
        if F12 in self.down and ctrl and shift and alt:
            if self.hold_since is None:
                self.hold_since = time.monotonic()
        else:
            self.hold_since = None
        if released:
            if key in self.blocked:
                self.blocked.discard(key)
                return 1
        elif (key in self.blocked or key in WIN or
              (alt and key in ALT_SWITCH) or
              (ctrl and key == 0x1B) or
              (key == F12 and self.hold_since is not None)):
            self.blocked.add(key)
            return 1
        return chain_hook(None, code, message, address)


def supervise(owner_pid, token):
    owner = open_process(0x00100001, False, owner_pid)
    if not owner:
        return
    events = make_events(token)
    keyboard = KeyboardFilter()
    owner_list = (wt.HANDLE * 1)(owner)
    message = wt.MSG()
    last_pulse = time.monotonic()
    pending = None

    def release_keyboard():
        keyboard.stop()
        reset_event(events["ready"])

    try:
        while wait_messages(1, owner_list, False, 35, 0x04FF) != 0:
            while peek_message(ct.byref(message), None, 0, 0, 1):
                dispatch_message(ct.byref(message))
            now = time.monotonic()
            if wait(events["pulse"], 0) == 0:
                last_pulse = now
            if pending is not None:
                if wait(events["emergency"], 0) != 0:
                    pending = None
                elif now >= pending:
                    terminate(owner, 70)
                    break
            elif wait(events["arm"], 0) != 0:
                release_keyboard()
            elif not keyboard.handle:
                if keyboard.start():
                    last_pulse = now
                    set_event(events["ready"])
                else:
                    reset_event(events["arm"])
                    set_event(events["failed"])
            elif (now - last_pulse > 5 or
                  (keyboard.hold_since is not None and now - keyboard.hold_since >= 2)):
                reset_event(events["arm"])
                release_keyboard()
                set_event(events["emergency"])
                pending = now + 2
    finally:
        release_keyboard()
        for handle in [owner, *events.values()]:
            close(handle)
