#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('agy','codex')][string]$Engine,
  [Parameter(Mandatory=$true)][string]$Workspace,
  [Parameter(Mandatory=$true)][string]$PromptPath,
  [ValidateSet('read','write')][string]$Mode = 'read',
  [string]$Model = ''
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $Workspace
$prompt = Get-Content -LiteralPath $PromptPath -Raw -Encoding UTF8
if ($Engine -eq 'agy') {
  $arguments = @('--print', $prompt, '--output-format', 'json', '--print-timeout', '12m')
  if ($Mode -eq 'read') { $arguments += '--sandbox' }
  & agy @arguments
} else {
  if ($Mode -ne 'read') { throw 'Codex writer is not permitted in V2' }
  $arguments = @('exec', '--json', '--ephemeral', '--sandbox', 'read-only', '-C', $Workspace)
  if (-not [string]::IsNullOrWhiteSpace($Model)) { $arguments += @('-m', $Model) }
  $arguments += $prompt
  & codex @arguments
}
exit $LASTEXITCODE
