param(
  [string]$Owner = "laochendeai",
  [string]$Repo = "ai-adversarial-protocol",
  [string]$Token = $env:GITEE_TOKEN,
  [string]$BacklogPath = "docs/gitee_issue_backlog.md",
  [switch]$DryRun,
  [switch]$ApplyLabels
)

$ErrorActionPreference = "Stop"

if (-not $Token) {
  $Token = $env:GITEE_ACCESS_TOKEN
}
if (-not $Token) {
  $Token = [Environment]::GetEnvironmentVariable("GITEE_TOKEN", "User")
}
if (-not $Token) {
  $Token = [Environment]::GetEnvironmentVariable("GITEE_ACCESS_TOKEN", "User")
}
if (-not $Token) {
  $Token = [Environment]::GetEnvironmentVariable("GITEE_TOKEN", "Machine")
}
if (-not $Token) {
  $Token = [Environment]::GetEnvironmentVariable("GITEE_ACCESS_TOKEN", "Machine")
}

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
  throw "Missing Gitee token. Set `$env:GITEE_TOKEN or `$env:GITEE_ACCESS_TOKEN, or pass -Token. Use -DryRun to preview without creating issues."
}

# Gitee creates repository issues via /repos/{owner}/issues and requires
# the target repository path in the form body as `repo`.
$uri = "https://gitee.com/api/v5/repos/$Owner/issues"
$existingUri = "https://gitee.com/api/v5/repos/$Owner/$Repo/issues?access_token=$Token&state=open&per_page=100"
$existing = Invoke-RestMethod -Method Get -Uri $existingUri -TimeoutSec 30
$existingTitles = @{}
foreach ($item in $existing) {
  if ($item.title) {
    $existingTitles[$item.title] = $true
  }
}

foreach ($issue in $issues) {
  if ($existingTitles.ContainsKey($issue.Title)) {
    Write-Output ("skip existing: " + $issue.Title)
    continue
  }

  $body = @{
    access_token = $Token
    repo = $Repo
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
