#requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][int]$IssueNumber,
  [Parameter(Mandatory=$true)][string]$BaseRef,
  [Parameter(Mandatory=$true)][string]$Manifest,
  [switch]$Execute,
  [switch]$AllowWrite,
  [switch]$AcceptLocalAgentRisk,
  [switch]$PublishDraft,
  [string]$Approval = '',
  [ValidateRange(120,3600)][int]$MaxDuration = 1200,
  [string]$CodexModel = ''
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$argsList = @(
  (Join-Path $PSScriptRoot 'multiagent-v2\supervisor.mjs'),
  '--root', $repo,
  '--issue', [string]$IssueNumber,
  '--base', $BaseRef,
  '--manifest', $Manifest,
  '--max-duration', [string]$MaxDuration
)
if ($Execute) { $argsList += '--execute' }
if ($AllowWrite) { $argsList += '--allow-write' }
if ($AcceptLocalAgentRisk) { $argsList += '--accept-local-agent-risk' }
if ($PublishDraft) { $argsList += '--publish-draft' }
if ($Approval) { $argsList += @('--approval',$Approval) }
if ($CodexModel) { $argsList += @('--codex-model',$CodexModel) }
& $node @argsList
exit $LASTEXITCODE
