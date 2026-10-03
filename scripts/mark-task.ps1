param(
  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
  [string[]]$TaskIds
)

# Marks tasks complete in tasks.md.
#
# Idempotent: an already-complete task stays complete.
#
# NOTE: PowerShell's -like treats "[ ]" as a character-class wildcard, so the
# task marker must be matched with a REGEX instead. Using -like silently
# matches nothing and reports completion while changing nothing.
$path = "specs/001-people-ops-portal/tasks.md"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$lines = [System.IO.File]::ReadAllLines($path)

# Repair only genuinely malformed lines (two or more leading markers).
$repaired = 0
for ($i = 0; $i -lt $lines.Length; $i++) {
  if ($lines[$i] -match '^(?:-\s*\[[xX ]\]\s*){2,}(T\d{3}\s)') {
    $lines[$i] = "- [ ] $($Matches[1])"
    $repaired++
  }
}

foreach ($id in $TaskIds) {
  $pattern = '^- \[ \] ' + [regex]::Escape($id) + '\s'
  for ($i = 0; $i -lt $lines.Length; $i++) {
    if ($lines[$i] -match $pattern) {
      $lines[$i] = $lines[$i] -replace '^- \[ \]', '- [X]'
    }
  }
}

[System.IO.File]::WriteAllLines($path, $lines, $utf8)

$final = [System.IO.File]::ReadAllLines($path)
$done = @($final | Where-Object { $_ -match '^- \[X\] T\d{3}' })
$open = @($final | Where-Object { $_ -match '^- \[ \] T\d{3}' })
$bad  = @($final | Where-Object { $_ -match '^-\s*\[[xX ]\].*\[ ' })

Write-Output "complete: $($done.Count) / 82"
Write-Output "remaining: $($open.Count)"
Write-Output "repaired: $repaired | malformed: $($bad.Count)"