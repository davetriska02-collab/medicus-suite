# Optional native-messaging host. Framing: 4-byte little-endian length + UTF-8 JSON.
# Does not copy Suite files. Does not reload the extension.

$ErrorActionPreference = 'Stop'
$local = if ($env:MEDICUS_SUITE_LOCAL) { $env:MEDICUS_SUITE_LOCAL } else { Join-Path $env:LOCALAPPDATA 'MedicusSuite\extension' }

function Read-NativeMessage {
  $lenBuf = New-Object byte[] 4
  $read = [Console]::OpenStandardInput().Read($lenBuf, 0, 4)
  if ($read -lt 4) { return $null }
  $len = [BitConverter]::ToInt32($lenBuf, 0)
  if ($len -le 0 -or $len -gt 1024 * 1024) { return $null }
  $buf = New-Object byte[] $len
  $got = 0
  $stdin = [Console]::OpenStandardInput()
  while ($got -lt $len) {
    $n = $stdin.Read($buf, $got, $len - $got)
    if ($n -le 0) { break }
    $got += $n
  }
  return [System.Text.Encoding]::UTF8.GetString($buf, 0, $got) | ConvertFrom-Json
}

function Write-NativeMessage($obj) {
  $json = ($obj | ConvertTo-Json -Compress)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $len = [BitConverter]::GetBytes([int]$bytes.Length)
  $stdout = [Console]::OpenStandardOutput()
  $stdout.Write($len, 0, 4)
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

$copied = $null
$statusPath = Join-Path $local 'sync-status.json'
if (Test-Path -LiteralPath $statusPath) {
  try {
    $st = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($st.ok -eq $true) { $copied = [string]$st.copiedVersion }
  } catch {}
}

$msg = Read-NativeMessage
Write-NativeMessage @{
  ok            = $true
  type          = 'localBits:copyComplete'
  copiedVersion = $copied
  echoType      = $(if ($msg) { [string]$msg.type } else { $null })
}
