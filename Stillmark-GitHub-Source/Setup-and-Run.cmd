@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stillmark.ps1" launch
if errorlevel 1 pause
