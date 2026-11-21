# -*- mode: python ; coding: utf-8 -*-

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('ui/dist', 'ui/dist'),
        ('assets/stillmark.ico', 'assets'),
        ('docs/NOTICE.txt', 'notices'),
        ('docs/licenses', 'notices/licenses'),
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'unittest', 'pydoc'],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Stillmark',
    debug=False,
    strip=False,
    upx=False,
    console=False,
    icon='assets/stillmark.ico',
    version='assets/version.txt',
)
coll = COLLECT(
    exe, a.binaries, a.datas, strip=False, upx=False, name='Stillmark',
)
