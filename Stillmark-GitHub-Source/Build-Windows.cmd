@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stillmark.ps1" package
if errorlevel 1 pause
