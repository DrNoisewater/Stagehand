# Backup installer (the main one is Stagehand-Setup.exe). Installs Stagehand for the current user (no admin rights needed).
#   - downloads the Electron runtime the app runs on (about 150 MB, once;
#     updates reuse the runtime that's already installed)
#   - puts the app in %LOCALAPPDATA%\Programs\Stagehand
#   - adds Start menu and desktop shortcuts, then opens Stagehand
# Your library, settings, stems and backups live in %APPDATA% / %LOCALAPPDATA%\Stagehand
# and are kept when you reinstall or update.
param(
  [string]$Destination = '',
  [string]$ElectronZip = '',
  [switch]$NoShortcuts,
  [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ElectronVersion = '44.1.0'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
# Works from the download package (app\ next to this script) and from the
# source folder (this script in windows\, the app files one level up).
$appSource = $null
foreach ($candidate in @((Join-Path $here 'app'), (Split-Path -Parent $here))) {
  if ((Test-Path (Join-Path $candidate 'package.json')) -and (Test-Path (Join-Path $candidate 'src\main\main.js'))) {
    $appSource = $candidate
    break
  }
}
if (-not $Destination) { $Destination = Join-Path $env:LOCALAPPDATA 'Programs\Stagehand' }

function Step([string]$text) { Write-Host "  $text" }

try {
  Write-Host ''
  Write-Host 'Installing Stagehand' -ForegroundColor Yellow

  if (-not $appSource) {
    throw "Could not find the Stagehand app files. Unzip the whole download first, then run the installer from inside the unzipped folder."
  }
  Step "Using app files from $appSource"

  $running = Get-Process -Name 'Stagehand' -ErrorAction SilentlyContinue
  if ($running) { throw 'Stagehand is running. Close it, then run the installer again.' }
  # A sound engine left behind by a crash would keep its files locked.
  Get-Process -Name 'stagehand-audio' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

  # Already installed with the same runtime? Then an update only swaps the
  # app files: nothing to download, nothing to unpack.
  $exe = Join-Path $Destination 'Stagehand.exe'
  $marker = Join-Path $Destination 'electron-version.txt'
  $installed = $null
  if (Test-Path $marker) { $installed = (Get-Content $marker -Raw).Trim() }
  elseif (Test-Path $exe) { $installed = (Get-Item $exe).VersionInfo.ProductVersion }
  $reuse = ($installed -eq $ElectronVersion) -and (Test-Path $exe) -and (-not $ElectronZip)

  if ($reuse) {
    Step "Updating the app files in $Destination (the app runtime is already installed)"
    $appTarget = Join-Path $Destination 'resources\app'
    $appNew = "$appTarget.new"
    if (Test-Path $appNew) { Remove-Item $appNew -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $appNew | Out-Null
    foreach ($item in @('package.json', 'src', 'engine', 'build', 'native')) {
      $from = Join-Path $appSource $item
      if (Test-Path $from) { Copy-Item $from $appNew -Recurse -Force }
    }
    if (Test-Path $appTarget) { Remove-Item $appTarget -Recurse -Force }
    Move-Item $appNew $appTarget
    Copy-Item (Join-Path $here 'uninstall.ps1') $Destination -Force
    Set-Content -Path $marker -Value $ElectronVersion
  } else {
  # 1. App runtime (Electron). Kept in Stagehand's own folder, not Temp,
  # so Windows' clean-ups don't throw it away.
  if (-not $ElectronZip) {
    $cacheDir = Join-Path $env:LOCALAPPDATA 'Stagehand\runtime'
    New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
    $ElectronZip = Join-Path $cacheDir "electron-v$ElectronVersion-win32-x64.zip"
    $oldTemp = Join-Path ([IO.Path]::GetTempPath()) "electron-v$ElectronVersion-win32-x64.zip"
    if (-not (Test-Path $ElectronZip) -and (Test-Path $oldTemp) -and ((Get-Item $oldTemp).Length -gt 50MB)) { Move-Item $oldTemp $ElectronZip }
    $haveZip = (Test-Path $ElectronZip) -and ((Get-Item $ElectronZip).Length -gt 50MB)
    if (-not $haveZip) {
      Step "Downloading the app runtime (Electron $ElectronVersion, about 150 MB). This happens once."
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $url = "https://github.com/electron/electron/releases/download/v$ElectronVersion/electron-v$ElectronVersion-win32-x64.zip"
      # curl.exe (built into Windows 10 and 11) is fast and shows progress;
      # Invoke-WebRequest is very slow on Windows PowerShell and looks frozen.
      $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
      if (Test-Path $curl) {
        & $curl -L --fail --retry 3 --connect-timeout 20 -C - -o "$ElectronZip.part" $url
        if ($LASTEXITCODE -ne 0) { throw "Download failed (curl $LASTEXITCODE). Check your internet connection and run the installer again; it resumes where it stopped." }
      } else {
        $ProgressPreference = 'Continue'
        Invoke-WebRequest -Uri $url -OutFile "$ElectronZip.part" -UseBasicParsing
      }
      Move-Item -Force "$ElectronZip.part" $ElectronZip
    }
  }
  # 2. Build the program folder next to the target, then swap it in.
  Step "Installing to $Destination"
  $staging = "$Destination.new"
  if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $staging | Out-Null

  $tar = $null
  if ($env:SystemRoot) {
    $candidate = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (Test-Path $candidate) { $tar = $candidate }
  }
  if ($tar) {
    & $tar -xf $ElectronZip -C $staging
    if ($LASTEXITCODE -ne 0) { throw 'Could not unpack the app runtime.' }
  } else {
    Expand-Archive -Path $ElectronZip -DestinationPath $staging -Force
  }

  Rename-Item (Join-Path $staging 'electron.exe') 'Stagehand.exe'
  $defaultApp = Join-Path $staging 'resources\default_app.asar'
  if (Test-Path $defaultApp) { Remove-Item $defaultApp -Force }
  # Copy only what the app needs (never node_modules, tests or build output).
  $appTarget = Join-Path $staging 'resources\app'
  New-Item -ItemType Directory -Force -Path $appTarget | Out-Null
  foreach ($item in @('package.json', 'src', 'engine', 'build', 'native')) {
    $from = Join-Path $appSource $item
    if (Test-Path $from) { Copy-Item $from $appTarget -Recurse -Force }
  }
  Copy-Item (Join-Path $here 'uninstall.ps1') $staging -Force

  Set-Content -Path (Join-Path $staging 'electron-version.txt') -Value $ElectronVersion
  if (Test-Path $Destination) { Remove-Item $Destination -Recurse -Force }
  Move-Item $staging $Destination
  }

  # 3. Shortcuts
  if (-not $NoShortcuts) {
    $shell = New-Object -ComObject WScript.Shell
    $links = @(
      (Join-Path ([Environment]::GetFolderPath('Programs')) 'Stagehand.lnk'),
      (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Stagehand.lnk')
    )
    foreach ($lnk in $links) {
      $s = $shell.CreateShortcut($lnk)
      $s.TargetPath = Join-Path $Destination 'Stagehand.exe'
      $s.WorkingDirectory = $Destination
      $s.IconLocation = (Join-Path $Destination 'resources\app\build\icon.ico') + ',0'
      $s.Description = 'Rocksmith library, player and stem mixer'
      $s.Save()
    }
    $un = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'Uninstall Stagehand.lnk'))
    $un.TargetPath = 'powershell.exe'
    $un.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $Destination 'uninstall.ps1')`""
    $un.Save()

    # List it under Settings > Apps so it can be removed like any other app.
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Stagehand'
    New-Item -Path $key -Force | Out-Null
    $version = (Get-Content (Join-Path $appSource 'package.json') -Raw | ConvertFrom-Json).version
    Set-ItemProperty -Path $key -Name DisplayName -Value 'Stagehand'
    Set-ItemProperty -Path $key -Name DisplayVersion -Value $version
    Set-ItemProperty -Path $key -Name Publisher -Value 'Stagehand'
    Set-ItemProperty -Path $key -Name DisplayIcon -Value (Join-Path $Destination 'resources\app\build\icon.ico')
    Set-ItemProperty -Path $key -Name InstallLocation -Value $Destination
    Set-ItemProperty -Path $key -Name UninstallString -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $Destination 'uninstall.ps1')`""
    Set-ItemProperty -Path $key -Name NoModify -Value 1 -Type DWord
    Set-ItemProperty -Path $key -Name NoRepair -Value 1 -Type DWord
    Step 'Added Start menu and desktop shortcuts.'
  }

  Write-Host ''
  Write-Host 'Stagehand is installed.' -ForegroundColor Green
  if (-not $NoLaunch) { Start-Process (Join-Path $Destination 'Stagehand.exe') }
  exit 0
} catch {
  Write-Host ''
  Write-Host "Installation stopped: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
