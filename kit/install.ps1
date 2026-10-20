# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Installs Xiao on top of Zen (Windows). Zen itself is not changed: Xiao gets
# its own copy of Zen with Xiao's browser code in it, its own profile, prefs
# and Start menu shortcut. The launcher rebuilds the copy whenever Zen updates.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-Strict] [-Tor] [-Zen C:\path\zen.exe]
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
param([switch]$Strict, [switch]$Tor, [switch]$Search, [switch]$Ubo, [switch]$Uninstall, [string]$Zen = '')
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
$TorVersion = '15.0.25'
$TorPort = if ($env:XIAO_TOR_PORT) { [int]$env:XIAO_TOR_PORT } else { 9160 }
$Data = Join-Path $env:APPDATA 'xiao-kit'
$ProfileDir = Join-Path $Data 'profile'
$App = Join-Path $env:LOCALAPPDATA 'xiao-kit\app'
$Shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Xiao.lnk'
$OldShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'xiao.lnk'

function Say($m) { Write-Host "  $m" }
if ($Ubo) { Write-Warning '-Ubo was removed in Xiao 0.2: Xiao''s own blocking is built in, and two blockers only block twice.' }
if ($Search) { Write-Warning '-Search is not available on Windows: SearXNG does not support it. Xiao uses DuckDuckGo unless you pick another search on the start page.' }

$running = Get-CimInstance Win32_Process -Filter "Name = 'zen.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*$ProfileDir*" }
if ($running) { throw 'Xiao is running. Quit it first.' }

if ($Uninstall) {
  $pidFile = Join-Path $Data 'tor.pid'
  if (Test-Path $pidFile) { Stop-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue }
  Remove-Item -Recurse -Force $Data, (Split-Path $App), $Shortcut, $OldShortcut -ErrorAction SilentlyContinue
  Write-Host 'Xiao removed (its copy of Zen, profile, Tor and shortcut). Zen itself was not touched.'
  exit 0
}

if (-not $Zen) {
  $candidates = @(
    (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\zen.exe' -ErrorAction SilentlyContinue).'(default)',
    (Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\zen.exe' -ErrorAction SilentlyContinue).'(default)',
    (Join-Path $env:ProgramFiles 'Zen Browser\zen.exe'),
    (Join-Path $env:LOCALAPPDATA 'Zen Browser\zen.exe')
  )
  $Zen = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if (-not $Zen) { throw 'Zen not found. Install it from https://zen-browser.app or pass -Zen C:\path\to\zen.exe' }
$ZenHome = Split-Path $Zen
foreach ($f in 'user.js', 'user-strict.js', 'xiao\XiaoCore.sys.mjs', 'loader\xiao.cfg') {
  if (-not (Test-Path (Join-Path $Here $f))) { throw "$f is missing next to install.ps1. Run 'npm run build' and use dist\kit\." }
}

$Pins = @{}
Get-Content (Join-Path $Here 'downloads.sha256') | Where-Object { $_ -match '^[0-9a-f]{64}  ' } | ForEach-Object {
  $hash, $name = $_ -split '  ', 2
  $Pins[$name] = $hash
}
function Fetch($url, $file) {
  $name = Split-Path $url -Leaf
  if (-not $Pins.ContainsKey($name)) { throw "no pinned hash for $name" }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing
  $got = (Get-FileHash -Algorithm SHA256 $file).Hash.ToLower()
  if ($got -ne $Pins[$name]) { Remove-Item $file; throw "$name does not match its pinned hash (got $got)" }
}

Write-Host "Installing Xiao for $ZenHome"
New-Item -ItemType Directory -Force $ProfileDir | Out-Null
$UserJs = Join-Path $ProfileDir 'user.js'
if ($Strict) { Copy-Item (Join-Path $Here 'user-strict.js') $UserJs; Say 'Strict prefs' }
else { Copy-Item (Join-Path $Here 'user.js') $UserJs; Say 'Balanced prefs' }
# Xiao 0.1 was an extension (and could add uBlock Origin). Both go: blocking is built in now.
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $ProfileDir 'extensions\xiao@gitguy268.github.io.xpi'), (Join-Path $ProfileDir 'extensions\uBlock0@raymondhill.net.xpi')
Remove-Item -Force $OldShortcut -ErrorAction SilentlyContinue

$TorDir = Join-Path $Data 'tor'
$Torrc = Join-Path $Data 'torrc'
if ($Tor) {
  $bundle = "tor-expert-bundle-windows-x86_64-$TorVersion.tar.gz"
  $tmp = Join-Path ([IO.Path]::GetTempPath()) $bundle
  Fetch "https://dist.torproject.org/torbrowser/$TorVersion/$bundle" $tmp
  Remove-Item -Recurse -Force $TorDir -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $TorDir, (Join-Path $Data 'tor-data') | Out-Null
  tar -xzf $tmp -C $TorDir
  Remove-Item $tmp
  # torrc reads backslashes in quoted values as escapes, so use forward slashes.
  function TorPath($p, $prefix = '') { '"' + $prefix + ($p -replace '\\', '/') + '"' }
  @(
    "SocksPort 127.0.0.1:$TorPort IsolateSOCKSAuth",
    "DataDirectory $(TorPath (Join-Path $Data 'tor-data'))",
    "PidFile $(TorPath (Join-Path $Data 'tor.pid'))",
    "Log $(TorPath (Join-Path $Data 'tor.log') 'notice file ')",
    "GeoIPFile $(TorPath (Join-Path $TorDir 'data\geoip'))",
    "GeoIPv6File $(TorPath (Join-Path $TorDir 'data\geoip6'))"
  ) | Set-Content -Encoding ascii $Torrc
  Say "Tor $TorVersion expert bundle (hash checked)"
} else {
  Remove-Item -Recurse -Force $TorDir, $Torrc -ErrorAction SilentlyContinue
}

# Settings Xiao's browser code reads, applied again at every start.
@(
  '',
  '// Set by install.ps1 for this install.',
  "user_pref(`"xiao.tor.port`", $TorPort);",
  "user_pref(`"xiao.tor.installed`", $(if ($Tor) { 'true' } else { 'false' }));",
  'user_pref("xiao.search.url", "");'
) | Add-Content -Encoding utf8 $UserJs

# Xiao's copy of Zen, with the loader (AutoConfig) and Xiao's code in it. The
# assets stay in DATA so the launcher can rebuild the copy when Zen updates.
$Assets = Join-Path $Data 'app-assets'
Remove-Item -Recurse -Force $Assets -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $Assets | Out-Null
Copy-Item -Recurse (Join-Path $Here 'xiao'), (Join-Path $Here 'loader') $Assets
$MakeApp = Join-Path $Data 'make-app.ps1'
@'
param([string]$ZenHome, [string]$Data, [string]$App)
$ErrorActionPreference = 'Stop'
$Assets = Join-Path $Data 'app-assets'
$New = "$App.new"
Remove-Item -Recurse -Force $New -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Split-Path $App) | Out-Null
robocopy $ZenHome $New /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "could not copy $ZenHome" }
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $New 'updater.exe'), (Join-Path $New 'updater.ini'), (Join-Path $New 'update-settings.ini')
New-Item -ItemType Directory -Force (Join-Path $New 'distribution'), (Join-Path $New 'defaults\pref') | Out-Null
'{ "policies": { "DisableAppUpdate": true } }' | Set-Content -Encoding ascii (Join-Path $New 'distribution\policies.json')
Copy-Item (Join-Path $Assets 'loader\autoconfig.js') (Join-Path $New 'defaults\pref\autoconfig.js')
Copy-Item (Join-Path $Assets 'loader\xiao.cfg') (Join-Path $New 'xiao.cfg')
Copy-Item -Recurse (Join-Path $Assets 'xiao') (Join-Path $New 'xiao')
Remove-Item -Recurse -Force "$App.old" -ErrorAction SilentlyContinue
if (Test-Path $App) { Rename-Item $App "$App.old" }
Rename-Item $New $App
Remove-Item -Recurse -Force "$App.old", (Join-Path $Data 'profile\startupCache'), (Join-Path $Data 'profile\compatibility.ini') -ErrorAction SilentlyContinue
$ini = Get-Content (Join-Path $ZenHome 'application.ini') | Where-Object { $_ -like 'BuildID=*' }
($ini -replace '^BuildID=', '') | Set-Content -Encoding ascii (Join-Path $Data 'zen-build')
$ZenHome | Set-Content -Encoding utf8 (Join-Path $Data 'zen-app')
'@ | Set-Content -Encoding utf8 $MakeApp
& powershell -NoProfile -ExecutionPolicy Bypass -File $MakeApp $ZenHome $Data $App
if ($LASTEXITCODE) { throw "could not build Xiao's copy of Zen" }
Say "App: $App (a copy of $ZenHome, rebuilt when Zen updates)"

# The launcher rebuilds the copy when Zen has updated, starts tor (if
# installed), runs the copy on Xiao's profile, and stops tor when Xiao quits.
$Launch = Join-Path $Data 'xiao-launch.ps1'
@"
`$zenHome = Get-Content '$(Join-Path $Data 'zen-app')' -ErrorAction SilentlyContinue
`$build = Get-Content '$(Join-Path $Data 'zen-build')' -ErrorAction SilentlyContinue
`$xiaoOpen = Get-CimInstance Win32_Process -Filter "Name = 'zen.exe'" -ErrorAction SilentlyContinue | Where-Object { `$_.CommandLine -like '*$ProfileDir*' }
if (`$zenHome -and -not `$xiaoOpen -and (Test-Path (Join-Path `$zenHome 'application.ini'))) {
  `$now = (Get-Content (Join-Path `$zenHome 'application.ini') | Where-Object { `$_ -like 'BuildID=*' }) -replace '^BuildID=', ''
  if (`$now -ne `$build) { & powershell -NoProfile -ExecutionPolicy Bypass -File '$MakeApp' `$zenHome '$Data' '$App' }
}
`$tor = `$null
`$pidFile = '$(Join-Path $Data 'tor.pid')'
# If Xiao is already open, its launcher owns tor: leave it alone (Zen just opens a new window there).
`$torUp = (Test-Path `$pidFile) -and (Get-Process -Id (Get-Content `$pidFile) -ErrorAction SilentlyContinue | Where-Object ProcessName -eq 'tor')
if ((Test-Path '$Torrc') -and -not `$torUp) {
  `$tor = Start-Process -FilePath '$(Join-Path $TorDir 'tor\tor.exe')' -ArgumentList '-f', '"$Torrc"', '--quiet' -WindowStyle Hidden -PassThru
}
try {
  Start-Process -FilePath '$(Join-Path $App 'zen.exe')' -ArgumentList (@('-wait-for-browser', '-profile', '"$ProfileDir"') + `$args) -Wait
} finally {
  if (`$tor) { Stop-Process -Id `$tor.Id -ErrorAction SilentlyContinue }
}
"@ | Set-Content -Encoding utf8 $Launch

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($Shortcut)
$lnk.TargetPath = Join-Path $PSHOME 'powershell.exe'
$lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Launch`""
$Icon = Join-Path $Data 'xiao.ico'
Copy-Item (Join-Path $Here 'xiao.ico') $Icon
$lnk.IconLocation = "$Icon,0"
$lnk.Description = 'Xiao: private browser with ad blocking and Tor tabs'
$lnk.Save()
Say 'Launcher: Xiao in the Start menu'
Write-Host "Done. Start Xiao from the Start menu, or run: powershell -File `"$Launch`""
