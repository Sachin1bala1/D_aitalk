param(
  [Parameter(Mandatory = $true)]
  [string]$Topic,
  [string]$BaseBranch = "main",
  [string]$Remote = "origin",
  [string]$MergeRef
)

$ErrorActionPreference = "Stop"

$status = git status --porcelain
if ($status) {
  Write-Error "Working tree is not clean. Commit or stash changes before starting an integration branch."
}

git fetch $Remote

$branchName = "integration/$Topic"

git checkout $BaseBranch
git pull --ff-only $Remote $BaseBranch

$existing = git branch --list $branchName
if ($existing) {
  Write-Error "Branch '$branchName' already exists. Choose a different topic or delete the old integration branch."
}

git checkout -b $branchName

if ($MergeRef) {
  git merge --no-ff $MergeRef
}

Write-Host "Created $branchName from $BaseBranch"
if ($MergeRef) {
  Write-Host "Merged $MergeRef into $branchName"
}
