# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Installs xiao on top of Zen (Windows). Nothing in Zen itself is changed:
# xiao gets its own profile folder, prefs, extension and Start menu shortcut.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-Strict] [-Tor] [-Ubo] [-Zen C:\path\zen.exe]
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
param([switch]$Strict, [switch]$Tor, [switch]$Ubo, [switch]$Uninstall, [string]$Zen = '')
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
$TorVersion = '15.0.25'
$TorPort = 9160
$UboUrl = 'https://addons.mozilla.org/firefox/downloads/file/5034826/ublock_origin-1.75.0.xpi'
$Data = Join-Path $env:APPDATA 'xiao-kit'
$ProfileDir = Join-Path $Data 'profile'
$Shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'xiao.lnk'

function Say($m) { Write-Host "  $m" }

$running = Get-CimInstance Win32_Process -Filter "Name = 'zen.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*$ProfileDir*" }
if ($running) { throw 'xiao is running. Quit it first.' }

if ($Uninstall) {
  $pidFile = Join-Path $Data 'tor.pid'
  if (Test-Path $pidFile) { Stop-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue }
  Remove-Item -Recurse -Force $Data, $Shortcut -ErrorAction SilentlyContinue
  Write-Host 'xiao removed (profile, Tor and shortcut). Zen itself was not touched.'
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
foreach ($f in 'xiao.xpi', 'user.js', 'user-strict.js') {
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

Write-Host "Installing xiao for $Zen"
New-Item -ItemType Directory -Force (Join-Path $ProfileDir 'extensions') | Out-Null
if ($Strict) { Copy-Item (Join-Path $Here 'user-strict.js') (Join-Path $ProfileDir 'user.js'); Say 'Strict prefs' }
else { Copy-Item (Join-Path $Here 'user.js') (Join-Path $ProfileDir 'user.js'); Say 'Balanced prefs' }
Copy-Item (Join-Path $Here 'xiao.xpi') (Join-Path $ProfileDir 'extensions\xiao@gitguy268.github.io.xpi')
Say 'xiao extension: start page, ad and tracker blocking, Tor container'

if ($Ubo) {
  Fetch $UboUrl (Join-Path $ProfileDir 'extensions\uBlock0@raymondhill.net.xpi')
  Say 'uBlock Origin 1.75.0 from addons.mozilla.org (GPL-3.0, hash checked)'
}

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

# The launcher starts tor (if installed), runs Zen on the xiao profile, and stops tor when Zen quits.
$Launch = Join-Path $Data 'xiao-launch.ps1'
@"
`$tor = `$null
`$pidFile = '$(Join-Path $Data 'tor.pid')'
# If xiao is already open, its launcher owns tor: leave it alone (Zen just opens a new window there).
`$running = (Test-Path `$pidFile) -and (Get-Process -Id (Get-Content `$pidFile) -ErrorAction SilentlyContinue | Where-Object ProcessName -eq 'tor')
if ((Test-Path '$Torrc') -and -not `$running) {
  `$tor = Start-Process -FilePath '$(Join-Path $TorDir 'tor\tor.exe')' -ArgumentList '-f', '"$Torrc"', '--quiet' -WindowStyle Hidden -PassThru
}
try {
  Start-Process -FilePath '$Zen' -ArgumentList (@('-wait-for-browser', '-profile', '"$ProfileDir"') + `$args) -Wait
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
$lnk.Description = 'xiao: private browser with ad blocking and Tor tabs'
$lnk.Save()
Say 'Launcher: xiao in the Start menu'
Write-Host "Done. Start xiao from the Start menu, or run: powershell -File `"$Launch`""
