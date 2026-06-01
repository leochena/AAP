param(
  [string]$Owner = "laochendeai",
  [string]$Repo = "ai-adversarial-protocol",
  [string]$Token = $env:GITEE_TOKEN,
  [string]$BacklogPath = "docs/gitee_issue_backlog.md",
  [switch]$DryRun,
  [switch]$ApplyLabels
)

$ErrorActionPreference = "Stop"

function Read-BacklogIssues {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Backlog file not found: $Path"
  }

  $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  $matches = [regex]::Matches(
    $raw,
    "(?ms)^##\s+\d+\.\s+(?<title>.+?)\r?\n\r?\nLabels:\s+(?<labels>.+?)\r?\n\r?\n(?<body>.*?)(?=^##\s+\d+\.|\z)"
  )

  $issues = @()
  foreach ($match in $matches) {
    $issues += [pscustomobject]@{
      Title = $match.Groups["title"].Value.Trim()
      Labels = ($match.Groups["labels"].Value -replace [char]96, "").Trim()
      Body = $match.Groups["body"].Value.Trim()
    }
  }

  if ($issues.Count -eq 0) {
    throw "No issues parsed from backlog file: $Path"
  }
  return $issues
}

$issues = Read-BacklogIssues -Path $BacklogPath

if ($DryRun) {
  foreach ($issue in $issues) {
    Write-Output ("DRY-RUN: " + $issue.Title + " [" + $issue.Labels + "]")
  }
  exit 0
}

if (-not $Token) {
  throw "Missing Gitee token. Set `$env:GITEE_TOKEN or pass -Token. Use -DryRun to preview without creating issues."
}

$uri = "https://gitee.com/api/v5/repos/$Owner/$Repo/issues"
foreach ($issue in $issues) {
  $body = @{
    access_token = $Token
    title = $issue.Title
    body = "Labels: $($issue.Labels)`n`n$($issue.Body)"
  }
  if ($ApplyLabels) {
    $body.labels = $issue.Labels
  }

  $created = Invoke-RestMethod -Method Post -Uri $uri -Body $body -TimeoutSec 30
  Write-Output ("created #" + $created.number + " " + $created.html_url)
  Start-Sleep -Seconds 2
}
