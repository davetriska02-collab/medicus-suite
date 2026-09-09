# Registers a per-user logon task that runs Sync-MedicusSuite.ps1.
# Edge-first estate: the task runs at logon, before most people open Edge.
#
# Run once per PC (or push via GPO). Does not require admin if the task is
# for the current user only.

[CmdletBinding()]
param(
  [string]$ScriptPath = (Join-Path $PSScriptRoot 'Sync-MedicusSuite.ps1'),
  [string]$Reference = $(if ($env:MEDICUS_SUITE_REFERENCE) { $env:MEDICUS_SUITE_REFERENCE } else { '\\PracticeShare\MedicusSuite\current' }),
  [string]$TaskName = 'MedicusSuite-LocalSync'
)

if (-not (Test-Path -LiteralPath $ScriptPath)) {
  throw "Sync script not found: $ScriptPath"
}

$arg = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -Reference `"$Reference`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Registered task '$TaskName' at logon. Reference=$Reference"
Write-Host "Local default: %LOCALAPPDATA%\MedicusSuite\extension"
Write-Host "One-time after first copy: Edge → edge://extensions → Developer mode → Load unpacked → that local folder. Never change the folder."
