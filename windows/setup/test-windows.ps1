# Runs Stagehand Setup for real on Windows (CI): a first install that downloads from GitHub,
# a second run that must download nothing and be quick, an install whose downloads are cut
# off halfway (from a local stand-in, test-mirror.py) and must carry on, and an uninstall.
#   pwsh windows/setup/test-windows.ps1 <Stagehand-Setup-x.y.z.exe>
param([Parameter(Mandatory)] [string] $Setup)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$prog = Join-Path $env:LOCALAPPDATA 'Programs\Stagehand'
$local = Join-Path $env:LOCALAPPDATA 'Stagehand'
$dl = Join-Path $local 'Downloads'
$version = (Get-Content (Join-Path $here '..\..\package.json') -Raw | ConvertFrom-Json).version
$fails = 0
function Check($ok, $what) {
  if ($ok) { Write-Host "ok   $what" } else { Write-Host "FAIL $what"; $script:fails++ }
}
function Run-Setup([string[]] $setupArgs) {
  $t = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $Setup -ArgumentList $setupArgs -Wait -PassThru
  $t.Stop()
  return @{ code = $p.ExitCode; secs = [math]::Round($t.Elapsed.TotalSeconds, 1) }
}
function Installed-Ok {
  (Test-Path (Join-Path $prog 'Stagehand.exe')) -and
  ((Get-Content (Join-Path $prog 'resources\app\package.json') -Raw | ConvertFrom-Json).version -eq $version) -and
  (Test-Path (Join-Path $prog 'resources\app\native\bin\stagehand-audio.exe')) -and
  (Test-Path (Join-Path $prog 'Uninstall Stagehand.exe')) -and
  ((Get-Content (Join-Path $prog 'electron-version.txt') -Raw).Trim() -ne '')
}

Write-Host "Setup: $Setup ($([math]::Round((Get-Item $Setup).Length / 1MB, 1)) MB)"

# 1. first install: downloads the runtime and the decoder from GitHub
$r = Run-Setup @('/quiet')
Check ($r.code -eq 0) "first install finishes (exit $($r.code), $($r.secs) s)"
Check (Installed-Ok) 'Stagehand, its runtime and its uninstaller are in place'
Check (Test-Path (Join-Path $local 'Tools\vgmstream\vgmstream-cli.exe')) 'the song audio decoder is installed'
Check (-not (Test-Path (Join-Path $prog 'locales\fr.pak')) -and (Test-Path (Join-Path $prog 'locales\en-US.pak'))) 'only the English language file is kept'
Check (-not (Get-ChildItem $dl -Filter *.zip -ErrorAction SilentlyContinue)) 'downloads are cleared once installed'

# 2. run it again (an update): nothing to download, quick
$before = (Get-Item (Join-Path $prog 'Stagehand.exe')).LastWriteTimeUtc
$r = Run-Setup @('/quiet')
Check ($r.code -eq 0) "second run finishes (exit $($r.code))"
Check ($r.secs -lt 60) "second run is quick: $($r.secs) s"
Check ((Get-Item (Join-Path $prog 'Stagehand.exe')).LastWriteTimeUtc -eq $before) 'the runtime is kept, not downloaded again'
Check (Installed-Ok) 'still installed'

# 3. a fresh PC whose downloads keep getting cut off halfway: Setup must carry on
& (Join-Path $prog 'Uninstall Stagehand.exe') /quiet
for ($i = 0; $i -lt 60 -and (Test-Path (Join-Path $prog 'Stagehand.exe')); $i++) { Start-Sleep 1 }
Check (-not (Test-Path (Join-Path $prog 'Stagehand.exe'))) 'uninstall removes the program'
Check (-not (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Stagehand')) 'and its Settings › Apps entry'
Remove-Item -Recurse -Force $local, $prog -ErrorAction SilentlyContinue
$mirror = Join-Path $env:RUNNER_TEMP 'mirror\files'
New-Item -ItemType Directory -Force $mirror | Out-Null
$VGMSTREAM_VER = [regex]::Match((Get-Content (Join-Path $here 'components.sh') -Raw), 'VGMSTREAM_VER=(\S+)').Groups[1].Value
$elec = ((Get-Content (Join-Path $here '..\..\package.json') -Raw | ConvertFrom-Json).devDependencies.electron) -replace '[^0-9.]', ''
$files = @{
  "electron-v$elec-win32-x64.zip" = "https://github.com/electron/electron/releases/download/v$elec/electron-v$elec-win32-x64.zip"
  'vgmstream-win64.zip' = "https://github.com/vgmstream/vgmstream/releases/download/$VGMSTREAM_VER/vgmstream-win64.zip"
}
foreach ($f in $files.Keys) { Invoke-WebRequest $files[$f] -OutFile (Join-Path $mirror $f) }
$env:DROP = '30000000'
$srv = Start-Process python -ArgumentList @((Join-Path $here 'test-mirror.py'), $mirror, '8799') -PassThru -WindowStyle Hidden
Start-Sleep 2
$env:STAGEHAND_SETUP_MIRROR = 'http://127.0.0.1:8799'
$r = Run-Setup @('/quiet')
Remove-Item Env:STAGEHAND_SETUP_MIRROR
Stop-Process $srv -ErrorAction SilentlyContinue
$log = Get-Content (Join-Path (Split-Path $mirror) 'mirror.log') -ErrorAction SilentlyContinue
Write-Host ($log -join "`n")
Check ($r.code -eq 0) "install with cut-off downloads finishes (exit $($r.code), $($r.secs) s)"
Check (($log | Where-Object { $_ -match 'electron.*range=[1-9]' }).Count -ge 1) 'it carried on from where the download stopped (asked for the rest)'
Check (Installed-Ok) 'and Stagehand is installed'

# 4. uninstall
& (Join-Path $prog 'Uninstall Stagehand.exe') /quiet
for ($i = 0; $i -lt 60 -and (Test-Path $prog); $i++) { Start-Sleep 1 }
Check (-not (Test-Path (Join-Path $prog 'Stagehand.exe'))) 'uninstall removes it again'

if ($fails) { throw "$fails Setup check(s) failed." }
Write-Host 'all Setup checks passed'
