# Medicus Suite — copy the gold folder onto this PC's local disk.
#
# Chrome and Edge drop an unpacked extension after a restart when it is loaded
# from a network / mapped / Y: drive (the share is often not mounted yet when
# the browser starts). Load unpacked from the local copy this script makes.
#
# Usage:
#   .\copy-to-this-pc.ps1
#   .\copy-to-this-pc.ps1 -Source "Y:\Medicus Suite\extension"
#   .\copy-to-this-pc.ps1 -Quiet
#
# The .cmd wrapper next to this file is the double-click entry point.

[CmdletBinding()]
param(
    [string]$Source = '',
    [string]$Dest = '',
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

function Write-Info([string]$msg) {
    if (-not $Quiet) { Write-Host $msg }
}

if (-not $Source) {
    $Source = $PSScriptRoot
}
if (-not $Dest) {
    $Dest = Join-Path $env:LOCALAPPDATA 'MedicusSuite'
}

$Source = [System.IO.Path]::GetFullPath($Source)
$Dest = [System.IO.Path]::GetFullPath($Dest)

if (-not (Test-Path -LiteralPath (Join-Path $Source 'manifest.json'))) {
    throw "No manifest.json in '$Source'. Point -Source at the Medicus Suite folder (the one that contains manifest.json)."
}

if ($Source.TrimEnd('\') -ieq $Dest.TrimEnd('\')) {
    Write-Info "Already running from the local copy: $Dest"
    Write-Info "Nothing to copy. Load unpacked from this folder if the extension is not already loaded from here."
    exit 0
}

$excludeDirs = @(
    '.git',
    '.github',
    '.claude',
    '.githooks',
    'node_modules',
    '_build'
)

Write-Info "Source : $Source"
Write-Info "Dest   : $Dest"

New-Item -ItemType Directory -Force -Path $Dest | Out-Null

$xdArgs = @()
foreach ($d in $excludeDirs) {
    $xdArgs += '/XD'
    $xdArgs += $d
}

# /E copy subdirs; /NFL /NDL quiet file listing; /NJH /NJS no job header/summary;
# /R:2 /W:2 short retry so a locked file does not hang a login script.
$roboArgs = @(
    $Source, $Dest, '/E',
    '/NFL', '/NDL', '/NJH', '/NJS',
    '/R:2', '/W:2'
) + $xdArgs

& robocopy @roboArgs | Out-Null
$code = $LASTEXITCODE

# robocopy: 0–7 are success (extra files, copies, mismatches). 8+ is failure.
if ($code -ge 8) {
    throw "robocopy failed with exit code $code (source='$Source', dest='$Dest')."
}

Write-Info ""
Write-Info "Copied to $Dest"
Write-Info ""
Write-Info "NEXT — do these on this PC:"
Write-Info "  1. If the suite is already loaded from a network drive, open Suite Options"
Write-Info "     and use Backup & Restore → Export entire suite FIRST (a new Load unpacked"
Write-Info "     path is a new install and does not keep the old settings)."
Write-Info "  2. Edge:  edge://extensions     Chrome:  chrome://extensions"
Write-Info "  3. Turn Developer mode ON (top right)."
Write-Info "  4. Load unpacked → pick:"
Write-Info "       $Dest"
Write-Info "  5. If you exported in step 1, Import the backup."
Write-Info "  6. Remove the old network-drive install from the extensions list."
Write-Info ""
Write-Info "Then, once: Options → Backup & Restore → Choose gold folder (the share)"
Write-Info "and Choose this PC's folder (the path above). After that, updates copy"
Write-Info "themselves — you do not Load unpacked again. Re-run this script only"
Write-Info "if auto-sync is not connected, or as a login-script backstop."
Write-Info ""

exit 0
