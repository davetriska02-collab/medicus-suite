# Medicus Suite — copy Pete's reference share onto this PC's LOCAL Load unpacked folder.
# The extension never copies files. This script is the updater. Edge-first.
#
# Typical paths (override with parameters or env):
#   Reference:  \\PracticeShare\MedicusSuite\current
#   Local:      %LOCALAPPDATA%\MedicusSuite\extension
#   Staging:    %LOCALAPPDATA%\MedicusSuite\staging
#
# Promote only when:
#   - suite-release.json exists, format is correct, ready is true
#   - version is newer than the local manifest (unless -AllowDowngrade / stamp allowDowngrade)
#   - Edge and Chrome are NOT locking the live folder (unless -Force)
#
# After a successful promote, writes sync-status.json into the local extension folder
# so the running Suite can show "Suite files updated — Reload".

[CmdletBinding()]
param(
  [string]$Reference = $(if ($env:MEDICUS_SUITE_REFERENCE) { $env:MEDICUS_SUITE_REFERENCE } else { '\\PracticeShare\MedicusSuite\current' }),
  [string]$Local = $(if ($env:MEDICUS_SUITE_LOCAL) { $env:MEDICUS_SUITE_LOCAL } else { Join-Path $env:LOCALAPPDATA 'MedicusSuite\extension' }),
  [string]$Staging = $(if ($env:MEDICUS_SUITE_STAGING) { $env:MEDICUS_SUITE_STAGING } else { Join-Path $env:LOCALAPPDATA 'MedicusSuite\staging' }),
  [switch]$Force,
  [switch]$AllowDowngrade
)

$ErrorActionPreference = 'Stop'

function Write-Log([string]$Message) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $Message
  Write-Host $line
}

function Read-JsonFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try {
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-SemverParts([string]$Version) {
  $v = $Version.Trim().TrimStart('v', 'V')
  if ($v -notmatch '^\d+\.\d+\.\d+$') { return $null }
  return @($v.Split('.') | ForEach-Object { [int]$_ })
}

function Compare-Semver([string]$A, [string]$B) {
  $pa = Get-SemverParts $A
  $pb = Get-SemverParts $B
  if (-not $pa -or -not $pb) { return $null }
  for ($i = 0; $i -lt 3; $i++) {
    if ($pa[$i] -gt $pb[$i]) { return 1 }
    if ($pa[$i] -lt $pb[$i]) { return -1 }
  }
  return 0
}

function Test-BrowserLocking {
  $names = @('msedge', 'chrome')
  foreach ($n in $names) {
    if (Get-Process -Name $n -ErrorAction SilentlyContinue) { return $true }
  }
  return $false
}

Write-Log "Reference=$Reference"
Write-Log "Local=$Local"

if (-not (Test-Path -LiteralPath $Reference)) {
  Write-Log "Share offline or path missing — keeping last local tree. Exit 0."
  exit 0
}

$releasePath = Join-Path $Reference 'suite-release.json'
$release = Read-JsonFile $releasePath
if (-not $release -or $release.format -ne 'medicus-suite-release') {
  Write-Log "No valid suite-release.json in reference — refusing to copy a half-published tree. Exit 2."
  exit 2
}
if ($release.ready -ne $true) {
  Write-Log "suite-release.json ready is not true — Pete is still publishing. Exit 0."
  exit 0
}

$refVersion = [string]$release.version
if (-not (Get-SemverParts $refVersion)) {
  Write-Log "suite-release.json version is not X.Y.Z — Exit 2."
  exit 2
}

$localManifest = Read-JsonFile (Join-Path $Local 'manifest.json')
$localVersion = if ($localManifest) { [string]$localManifest.version } else { '' }

if ($localVersion) {
  $cmp = Compare-Semver $refVersion $localVersion
  if ($cmp -eq 0) {
    Write-Log "Already on $localVersion — nothing to do."
    exit 0
  }
  $mayDowngrade = $AllowDowngrade -or ($release.allowDowngrade -eq $true)
  if ($cmp -lt 0 -and -not $mayDowngrade) {
    Write-Log "Reference $refVersion is older than local $localVersion — no silent downgrade. Exit 0."
    exit 0
  }
}

if (-not $Force -and (Test-Path -LiteralPath $Local) -and (Test-BrowserLocking)) {
  Write-Log "Edge or Chrome is running — leaving live folder alone (copy would risk a mixed tree). Re-run at logon or close the browser. Exit 0."
  exit 0
}

if (Test-Path -LiteralPath $Staging) {
  Remove-Item -LiteralPath $Staging -Recurse -Force
}
New-Item -ItemType Directory -Path $Staging -Force | Out-Null

Write-Log "Robocopy reference → staging"
$rc = Start-Process -FilePath 'robocopy.exe' -ArgumentList @(
  $Reference, $Staging, '/MIR', '/R:2', '/W:5', '/NFL', '/NDL', '/NJH', '/NJS'
) -Wait -PassThru -NoNewWindow
# robocopy: 0-7 are success-ish; 8+ is failure
if ($rc.ExitCode -ge 8) {
  Write-Log "Robocopy to staging failed (exit $($rc.ExitCode)). Live tree untouched. Exit 3."
  exit 3
}

$stagedRelease = Read-JsonFile (Join-Path $Staging 'suite-release.json')
$stagedManifest = Read-JsonFile (Join-Path $Staging 'manifest.json')
if (-not $stagedRelease -or $stagedRelease.ready -ne $true -or -not $stagedManifest) {
  Write-Log "Staging failed the ready/manifest check — not promoting. Exit 3."
  exit 3
}
if ((Compare-Semver ([string]$stagedManifest.version) $refVersion) -ne 0) {
  Write-Log "Staging manifest $($stagedManifest.version) != stamp $refVersion — not promoting. Exit 3."
  exit 3
}

$parent = Split-Path -Parent $Local
if (-not (Test-Path -LiteralPath $parent)) {
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
}
# Rename-swap so a crash mid-promote is "old tree still named .bak" rather than
# an empty Source. Load unpacked path must stay $Local forever (ID = path).
$backup = "$Local.bak"
if (Test-Path -LiteralPath $backup) {
  Remove-Item -LiteralPath $backup -Recurse -Force
}
if (Test-Path -LiteralPath $Local) {
  Rename-Item -LiteralPath $Local -NewName (Split-Path -Leaf $backup)
}
Move-Item -LiteralPath $Staging -Destination $Local
if (Test-Path -LiteralPath $backup) {
  Remove-Item -LiteralPath $backup -Recurse -Force
}

$status = [ordered]@{
  format        = 'medicus-suite-sync-status'
  copiedVersion = $refVersion
  ok            = $true
  copiedAt      = (Get-Date).ToUniversalTime().ToString('o')
}
$status | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Local 'sync-status.json') -Encoding UTF8
Write-Log "Promoted $refVersion to $Local. Open Edge → Suite Options → Reload if the browser is already running."
exit 0
