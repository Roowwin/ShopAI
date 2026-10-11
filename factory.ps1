param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$JobId,
  [string]$Title,
  [string]$Note
)
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false)
$root = (Get-Location).Path
$jobs = Join-Path $root 'factory\jobs'
$rounds = Join-Path $root 'factory\rounds'

function New-JobId { 'job-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + (Get-Random -Maximum 9999) }

function Get-CurrentRoundDir([string]$Id) {
  $r = 1
  $d = Join-Path $rounds ("$Id-round-" + $r)
  while (Test-Path (Join-Path $d 'decision.md')) {
    $r++
    $d = Join-Path $rounds ("$Id-round-" + $r)
  }
  return $d
}

function Get-LatestRound([string]$Id) {
  $r = 1
  while (Test-Path (Join-Path $rounds ("$Id-round-" + ($r + 1)))) { $r++ }
  return $r
}

switch ($Action) {

  'next' {
    if (-not $Title) { throw '-Title required' }
    $id = New-JobId
    $jd = Join-Path $jobs $id
    New-Item -ItemType Directory -Force -Path $jd | Out-Null
    $meta = '{ "job_id": "' + $id + '", "title": "' + $Title + '", "created": "' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '", "branch": null, "builder": null }'
    [IO.File]::WriteAllText((Join-Path $jd 'meta.json'), $meta, $utf8)
    $body = (Get-Content (Join-Path $root 'factory\jobs\_template-spec.md') -Raw) -replace '<one-line task summary>', $Title
    [IO.File]::WriteAllText((Join-Path $jd 'spec.md'), $body, $utf8)
    git worktree add (Join-Path $root "factory\worktrees\$id") -b "factory/$id" | Out-Null
    "JOB: $id"
    "BUILDER: from factory\worktrees\$id terminal: ollama launch claude --model deepseek-v4.1-flash:cloud (fallback gpt-oss:120b), then in session:"
    "  Read factory/jobs/$id/spec.md and implement it fully in this worktree. Follow Constraints. Run the acceptance tests and make them pass."
    "WHEN DONE: .\factory.ps1 -Action review -JobId $id"
  }

  'review' {
    if (-not $JobId) { throw '-JobId required' }
    $rd = Get-CurrentRoundDir $JobId
    New-Item -ItemType Directory -Force -Path $rd | Out-Null
    foreach ($role in @('architect', 'security', 'performance')) {
      $out = Join-Path $rd ($role + '.md')
      if (Test-Path $out) { "reviewer $role already wrote - skip"; continue }
      if (Get-Command claude -ErrorAction SilentlyContinue) {
        "reviewer $role running (claude -p)..."
        $prompt = "You are the $role reviewer for job $JobId. Read factory/jobs/$JobId/spec.md and inspect the diff: git diff phase11-ai...factory/$JobId. Evaluate only from your stated lens: architect = structure and patterns; security = authz, secrets, data exposure; performance = queries, N+1, latency. Then create the file $out whose first content line is exactly VERDICT: PASS or VERDICT: CHANGES, followed by short bullet findings."
        & claude -p $prompt --allowedTools "Read Write Bash(git diff*)" --permission-mode acceptEdits --model sonnet
      } else {
        "reviewer ${role}: claude not on PATH - MANUAL REVIEW: write $out, first content line VERDICT: PASS or VERDICT: CHANGES"
      }
    }
    "REVIEW SCAFFOLD: $rd - write verdicts, then: .\factory.ps1 -Action decision -JobId $JobId"
  }

  'decision' {
    if (-not $JobId) { throw '-JobId required' }
    $rd = Get-CurrentRoundDir $JobId
    $verdicts = @{}
    foreach ($role in @('architect', 'security', 'performance')) {
      $f = Join-Path $rd ($role + '.md')
      if (-not (Test-Path $f)) { throw "missing verdict: $f" }
      $m = Select-String -Path $f -Pattern 'VERDICT:\s*(PASS|CHANGES)'
      if (-not $m) { throw "no VERDICT line in $f" }
      $verdicts[$role] = $m.Matches[0].Groups[1].Value
    }
    $out = $verdicts.Values -join ' / '
    if ($verdicts.Values -contains 'CHANGES') {
      [IO.File]::WriteAllText((Join-Path $rd 'decision.md'), ("# decision $JobId`n`nVERDICTS: $out`nDECISION: ESCALATE"), $utf8)
      "DECISION: ESCALATE ($out) - builder reworks, then: .\factory.ps1 -Action review -JobId $JobId for the next round"
    } else {
      [IO.File]::WriteAllText((Join-Path $rd 'decision.md'), ("# decision $JobId`n`nVERDICTS: PASS / PASS / PASS`nDECISION: APPROVE"), $utf8)
      "DECISION: APPROVE - run: .\factory.ps1 -Action approve -JobId $JobId"
    }
  }

  'approve' {
    if (-not $JobId) { throw '-JobId required' }
    $round = Get-LatestRound $JobId
    $dec = Join-Path (Join-Path $rounds ("$JobId-round-" + $round)) 'decision.md'
    if (-not ((Test-Path $dec) -and ((Get-Content $dec -Raw) -match 'DECISION:\s*APPROVE'))) { throw 'latest round decision.md must say APPROVE - run -Action decision first' }
    git add -A | Out-Null
    git commit -m "factory: record $JobId rounds"
    git merge --no-ff "factory/$JobId" -m "merge factory/$JobId"
    git worktree remove (Join-Path $root "factory\worktrees\$JobId")
    "MERGED factory/$JobId"
    "GATES NOW: docker compose run --rm api pytest -q   (pytest is the real merge key)"
  }

  'rework' {
    if (-not $JobId) { throw '-JobId required' }
    $round = Get-LatestRound $JobId
    $rd = Join-Path $rounds ("$JobId-round-" + $round)
    [IO.File]::WriteAllText((Join-Path $rd 'feedback.md'), ("# feedback`n`n" + $Note), $utf8)
    "FEEDBACK: $rd\feedback.md - read it to the builder in its agent chat, then: .\factory.ps1 -Action review -JobId $JobId"
  }
}