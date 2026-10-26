@echo off
title Install Stagehand
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
timeout /t 4 >nul
