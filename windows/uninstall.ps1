# Removes the Stagehand program and its shortcuts.
# Asks before deleting your library data, stems and backups.
param([switch]$KeepData, [switch]$Quiet)
$ErrorActionPreference = 'Stop'
$program = Join-Path $env:LOCALAPPDATA 'Programs\Stagehand'
try {
  if (Get-Process -Name 'Stagehand' -ErrorAction SilentlyContinue) { throw 'Close Stagehand first.' }
  foreach ($lnk in @(
      (Join-Path ([Environment]::GetFolderPath('Programs')) 'Stagehand.lnk'),
      (Join-Path ([Environment]::GetFolderPath('Programs')) 'Uninstall Stagehand.lnk'),
      (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Stagehand.lnk'))) {
    if (Test-Path $lnk) { Remove-Item $lnk -Force }
  }
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Stagehand'
  if (Test-Path $key) { Remove-Item $key -Recurse -Force }
  if (Test-Path $program) { Remove-Item $program -Recurse -Force }
  Write-Host 'Stagehand has been removed.' -ForegroundColor Green
  if (-not $KeepData -and -not $Quiet) {
    $answer = Read-Host 'Also delete your library, settings, stems, backups and the stem engine? (y/N)'
    if ($answer -match '^(y|yes)$') {
      foreach ($p in @((Join-Path $env:APPDATA 'Stagehand'), (Join-Path $env:LOCALAPPDATA 'Stagehand'))) {
        if (Test-Path $p) { Remove-Item $p -Recurse -Force }
      }
      Write-Host 'Your Stagehand data has been deleted. Your .psarc files were not touched.'
    }
  }
} catch {
  Write-Host "Could not finish: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
