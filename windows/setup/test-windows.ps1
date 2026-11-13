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

# 4.14: pictures of the Setup window (uploaded by CI), so its look can be checked without a PC
$shots = Join-Path ($env:RUNNER_TEMP ?? $env:TEMP) 'setup-shots'
New-Item -ItemType Directory -Force -Path $shots | Out-Null
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
function Shot-Setup([string] $name, [string[]] $setupArgs = @()) {
  try {
    $p = if ($setupArgs.Count) { Start-Process -FilePath $Setup -ArgumentList $setupArgs -PassThru } else { Start-Process -FilePath $Setup -PassThru }
    Start-Sleep 7
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save((Join-Path $shots "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    # the window's part of the screen, also written into the log (artifacts aren't always reachable)
    $p.Refresh()
    Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, out RECT r); public struct RECT { public int L, T, R, B; }' -ErrorAction SilentlyContinue
    $rc = New-Object W.U+RECT
    if ($p.MainWindowHandle -ne 0 -and [W.U]::GetWindowRect($p.MainWindowHandle, [ref] $rc)) {
      $cw = [math]::Min($rc.R, $b.Width) - [math]::Max($rc.L, 0); $chh = [math]::Min($rc.B, $b.Height) - [math]::Max($rc.T, 0)
      $crop = $bmp.Clone((New-Object System.Drawing.Rectangle ([math]::Max($rc.L, 0)), ([math]::Max($rc.T, 0)), $cw, $chh), $bmp.PixelFormat)
      $ms = New-Object System.IO.MemoryStream
      $crop.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $b64 = [Convert]::ToBase64String($ms.ToArray())
      for ($i = 0; $i -lt $b64.Length; $i += 3000) { Write-Host "SHOTB64 $name $($b64.Substring($i, [math]::Min(3000, $b64.Length - $i)))" }
      $crop.Dispose()
    }
    $g.Dispose(); $bmp.Dispose()
    if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep 1
    Write-Host "shot $name.png"
  } catch { Write-Host "no picture of $name`: $($_.Exception.Message)" }
}
Shot-Setup 'setup-fresh'

# 1. first install: downloads the runtime and the decoder from GitHub
$r = Run-Setup @('/quiet')
Check ($r.code -eq 0) "first install finishes (exit $($r.code), $($r.secs) s)"
Check (Installed-Ok) 'Stagehand, its runtime and its uninstaller are in place'
Check (Test-Path (Join-Path $local 'Tools\vgmstream\vgmstream-cli.exe')) 'the song audio decoder is installed'
Check (-not (Test-Path (Join-Path $prog 'locales\fr.pak')) -and (Test-Path (Join-Path $prog 'locales\en-US.pak'))) 'only the English language file is kept'
Check (-not (Get-ChildItem $dl -Filter *.zip -ErrorAction SilentlyContinue)) 'downloads are cleared once installed'

Shot-Setup 'setup-installed'

# 2. run it again (an update): nothing to download, quick
$before = (Get-Item (Join-Path $prog 'Stagehand.exe')).LastWriteTimeUtc
$r = Run-Setup @('/quiet')
Check ($r.code -eq 0) "second run finishes (exit $($r.code))"
Check ($r.secs -lt 60) "second run is quick: $($r.secs) s"
Check ((Get-Item (Join-Path $prog 'Stagehand.exe')).LastWriteTimeUtc -eq $before) 'the runtime is kept, not downloaded again'
Check (Installed-Ok) 'still installed'

# 2b. the update Stagehand starts by itself (4.1.4): Stagehand is open; Setup /update closes it,
#     updates, and opens it again, with no clicks
$app = Start-Process -FilePath (Join-Path $prog 'Stagehand.exe') -PassThru
Start-Sleep 8
Check (-not $app.HasExited) 'Stagehand is open before the update'
$t = [Diagnostics.Stopwatch]::StartNew()
$up = Start-Process -FilePath $Setup -ArgumentList @('/update') -PassThru
if (-not $up.WaitForExit(180000)) { Stop-Process -Id $up.Id -Force; Write-Host 'Setup /update did not finish in 3 minutes' }
$t.Stop()
Check ($app.HasExited) "Setup closed the open Stagehand ($([math]::Round($t.Elapsed.TotalSeconds, 1)) s for the whole update)"
Check (Installed-Ok) 'still installed after the update'
$again = $null
for ($i = 0; $i -lt 30 -and -not $again; $i++) {
  $again = Get-Process -Name Stagehand -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($prog, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
  if (-not $again) { Start-Sleep 1 }
}
Check ($null -ne $again) 'Stagehand opened again by itself after the update'
Get-Process -Name Stagehand, stagehand-audio -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2

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
