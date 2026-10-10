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
    "BUILDER: run this command from the worktree terminal:"
    "  cd factory\worktrees\$id"
    "  claude --bg -n builder-$id --permission-mode acceptEdits --allowedTools `"Read Edit Bash(git *) Bash(npm *) Bash(python*) Glob`" `"Read factory/jobs/$id/spec.md and implement it fully in this worktree. Follow Constraints. Run the acceptance tests and make them pass.`""
    "WHEN DONE: .\scripts\factory.ps1 -Action review -JobId $id"
  }

  'review' {
    if (-not $JobId) { throw '-JobId required' }
    $round = 1
    $rd = Join-Path $rounds "$JobId-round-$round"
    while (Test-Path (Join-Path $rd 'decision.md')) { $round++; $rd = Join-Path $rounds "$JobId-round-$round" }
    New-Item -ItemType Directory -Force -Path $rd | Out-Null
    foreach ($role in @('architect', 'security', 'performance')) {
      $out = Join-Path $rd "$role.md"
      if (Test-Path $out) { "reviewer $role already wrote $role.md - skip"; continue }
      "reviewer $role running (claude -p)..."
      $prompt = "You are the $role reviewer for job $JobId. Read factory/jobs/$JobId/spec.md and inspect the diff by running: git diff main...factory/$JobId . Evaluate only from your stated lens: architect = structure and patterns; security = authz, secrets, data exposure; performance = queries, N+1, latency. Then using the Write tool create the file $out whose FIRST LINE is exactly 'VERDICT: PASS' or 'VERDICT: CHANGES', followed by short bullet findings."
      & claude -p $prompt --allowedTools "Read Write Bash(git diff*)" --permission-mode acceptEdits --model sonnet
    }
    "ALL REVIEWERS DISPATCHED - after each finishes, verify files in $rd , then: .\scripts\factory.ps1 -Action decision -JobId $JobId"
  }

  'decision' {
    if (-not $JobId) { throw '-JobId required' }
    $rd = Join-Path $rounds "$JobId-round-1"
    while (Test-Path (Join-Path $rd 'decision.md')) { throw 'round already decided - rework first, then run review for the next round' }
    $verdicts = @{}
    foreach ($role in @('architect', 'security', 'performance')) {
      $f = Join-Path $rd "$role.md"
      if (-not (Test-Path $f)) { throw "missing verdict: $f" }
      $m = Select-String -Path $f -Pattern 'VERDICT:\s*(PASS|CHANGES)'
      if (-not $m) { throw "no VERDICT line in $f" }
      $verdicts[$role] = $m.Matches[0].Groups[1].Value
    }
    $out = $verdicts.Values -join ' / '
    if ($verdicts.Values -contains 'CHANGES') {
      [IO.File]::WriteAllText((Join-Path $rd 'decision.md'), ("# decision $JobId`n`nVERDICTS: $out`nDECISION: ESCALATE"), $utf8)
      "DECISION: ESCALATE ($out) - rework: .\scripts\factory.ps1 -Action rework -JobId $JobId -Note `"...`""
    } else {
      [IO.File]::WriteAllText((Join-Path $rd 'decision.md'), ("# decision $JobId`n`nVERDICTS: PASS / PASS / PASS`nDECISION: APPROVE"), $utf8)
      "DECISION: APPROVE - run: .\scripts\factory.ps1 -Action approve -JobId $JobId"
    }
  }

  'approve' {
    if (-not $JobId) { throw '-JobId required' }
    $dec = Join-Path $rounds "$JobId-round-1\decision.md"
    if (-not ((Test-Path $dec) -and ((Get-Content $dec -Raw) -match 'DECISION:\s*APPROVE'))) { throw 'decision.md must say APPROVE - run -Action decision first' }
    git add -A | Out-Null
    git commit -m "factory: record $JobId rounds" | Out-Null
    git merge --no-ff "factory/$JobId" -m "merge factory/$JobId"
    git worktree remove (Join-Path $root "factory\worktrees\$JobId") | Out-Null
    "MERGED factory/$JobId"
    "GATES NOW: docker compose run --rm api pytest -q   (pytest is the real merge key)"
  }

  'rework' {
    if (-not $JobId) { throw '-JobId required' }
    if (-not $Note) { throw '-Note required' }
    $rd = Join-Path $rounds "$JobId-round-1"
    [IO.File]::WriteAllText((Join-Path $rd 'feedback.md'), ("# feedback round 2`n`n$Note"), $utf8)
    "REWORK: claude attach builder-$JobId  -> give it the feedback -> then .\scripts\factory.ps1 -Action review -JobId $JobId (writes round-2 files beside the old ones)"
  }
}
