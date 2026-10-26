@echo off
title Uninstall Stagehand
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\Programs\Stagehand\uninstall.ps1"
pause
