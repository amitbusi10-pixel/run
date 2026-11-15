# Brings changes made in the cloud (GitHub, branch main) into this folder.
# Runs automatically (Windows Task Scheduler: at sign-in and every hour). Safe:
# - only fast-forward; never overwrites local work
# - the real data files are git-ignored, so git never touches them
$ErrorActionPreference = 'Continue'
$repo = $PSScriptRoot
$git = 'C:\Program Files\Git\cmd\git.exe'
$logDir = Join-Path $env:LOCALAPPDATA 'run-sync'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'sync.log'
function Log($m) { Add-Content -Path $log -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $m) -Encoding utf8 }

Set-Location $repo
& $git fetch -q origin 2>$null
if ($LASTEXITCODE -ne 0) { Log 'fetch failed (offline?)'; exit 0 }

$branch = (& $git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { Log "skipped: on branch $branch"; exit 0 }

$behind = [int](& $git rev-list --count HEAD..origin/main)
$ahead = [int](& $git rev-list --count origin/main..HEAD)
if ($behind -eq 0) {
  if ($ahead -gt 0) { & $git push -q origin main 2>$null; Log "pushed $ahead local commit(s)" }
  exit 0
}
if (& $git status --porcelain --untracked-files=no) { Log "skipped: $behind new from cloud, but local files changed (not committed)"; exit 0 }

if ($ahead -gt 0) { & $git pull -q --no-rebase --no-edit origin main } else { & $git merge -q --ff-only origin/main }
if ($LASTEXITCODE -eq 0) {
  Log "updated: $behind change(s) from cloud"
  if ($ahead -gt 0) { & $git push -q origin main 2>$null }
} else {
  & $git merge --abort 2>$null
  Log 'update failed (conflict) - ask Claude to sync'
}
