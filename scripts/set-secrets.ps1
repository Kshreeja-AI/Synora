#Requires -Version 5.1
<#
.SYNOPSIS
  Securely enter Synora's secrets on Windows. Nothing is ever displayed.

.DESCRIPTION
  A secret typed into a chat window, a command-line argument, or a shell
  history file has already leaked -- the channel keeps a record whether or
  not anyone meant it to. This script is the alternative: it takes hidden
  console input and writes it straight into the git-ignored environment
  file, so the value exists in exactly two places (your clipboard and that
  file) and nowhere else.

  What it deliberately does NOT do:
    * print, echo, or log any value -- not even masked or truncated
    * accept a secret as a command-line parameter (those land in history
      and in the process table, readable by other processes)
    * write a plaintext temporary file, even briefly
    * transmit anything anywhere -- there is no network call in this file
    * leave the decoded value sitting in a PowerShell variable afterwards

  It reports only: CONFIGURED / MISSING / INVALID / UNCHANGED.

.EXAMPLE
  pwsh -File scripts/set-secrets.ps1
  # or, on Windows PowerShell:
  powershell -ExecutionPolicy Bypass -File scripts\set-secrets.ps1
#>

[CmdletBinding()]
param(
    # Deliberately NOT a secret parameter. Only selects which file to write.
    [string] $EnvFile = "apps/backend/.env.local"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# --- Resolve paths relative to the repo, not the caller's cwd --------------
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Target   = Join-Path $RepoRoot $EnvFile

Write-Host ""
Write-Host "  SYNORA SECURE SECRET ENTRY" -ForegroundColor Cyan
Write-Host "  Nothing you type will be displayed, logged, or transmitted."
Write-Host ""

# --- Locate git -------------------------------------------------------------
# Git ships with Git Bash but its install directory is frequently absent from
# the PowerShell PATH, so `& git` throws CommandNotFoundException. An earlier
# version of this script caught that exception and reported "NOT git-ignored" --
# announcing a security failure when the truth was only that it could not ask.
# The two conditions demand opposite responses (fix .gitignore vs install git),
# so they must never again collapse into one message.
function Resolve-GitExecutable {
    $onPath = Get-Command git -CommandType Application -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }

    $candidates = @(
        (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Git\cmd\git.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe')
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) { return $c }
    }
    return $null
}

$GitExe = Resolve-GitExecutable
if (-not $GitExe) {
    Write-Host "  ABORTED: git could not be found." -ForegroundColor Red
    Write-Host "  This is NOT a .gitignore problem -- the script simply cannot verify"
    Write-Host "  whether the target is protected, and it will not write a secret it"
    Write-Host "  cannot vouch for. Install Git, or add its cmd\ directory to PATH."
    exit 1
}

# Runs git and returns its stdout plus exit code, without letting anything git
# writes to stderr become a PowerShell error.
#
# Under $ErrorActionPreference = 'Stop', Windows PowerShell 5.1 promotes ANY
# stderr output from a native executable into a terminating NativeCommandError,
# even when the process exits 0. Git uses stderr for ordinary remarks, so the
# calling convention has to be: stderr is data, the exit code is the contract.
function Invoke-GitCapture {
    param([Parameter(Mandatory)][string[]] $Arguments)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $stdout = & $GitExe @Arguments
        $code   = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }

    [pscustomobject]@{ Lines = @($stdout); ExitCode = $code }
}

# Returns $true / $false for "is this path ignored", and throws only if git
# itself fails -- so an inconclusive answer can never read as a clean one.
function Test-PathIgnored {
    param([Parameter(Mandatory)][string] $RelativePath)
    $r = Invoke-GitCapture -Arguments @('check-ignore', '-q', '--', $RelativePath)
    switch ($r.ExitCode) {
        0       { return $true }            # ignored
        1       { return $false }           # not ignored
        default { throw "git check-ignore failed with exit code $($r.ExitCode)" }
    }
}

# Returns $true / $false for "is this path tracked", and throws if git fails.
#
# Deliberately NOT `ls-files --error-unmatch`: that flag makes git report
# "pathspec ... did not match any file(s) known to git" on stderr and exit 1
# for an untracked path. But untracked is the ANSWER to this question, not a
# fault -- and under 'Stop' that stderr line became a terminating error that
# aborted the script precisely when the file was safe. Plain `ls-files` exits 0
# either way and simply prints nothing when the path is not tracked.
#
# The empty-output case must never be reached by way of a git failure, so a
# non-zero exit throws rather than falling through to "not tracked".
function Test-PathTracked {
    param([Parameter(Mandatory)][string] $RelativePath)

    $r = Invoke-GitCapture -Arguments @('ls-files', '--', $RelativePath)
    if ($r.ExitCode -ne 0) {
        throw "git ls-files failed with exit code $($r.ExitCode); tracking state is unknown"
    }

    # git reports paths repo-relative with forward slashes regardless of the
    # separator used in the query, so normalise before comparing.
    $wanted = ($RelativePath -replace '\\', '/').Trim()
    foreach ($line in $r.Lines) {
        if ($null -eq $line) { continue }
        if ($line.ToString().Trim() -eq $wanted) { return $true }
    }
    return $false
}

# --- Refuse to run if the target is not protected by .gitignore ------------
# A secret written into a tracked file is a secret on its way to GitHub.
$stateError = $null
$ignored    = $false
$tracked    = $false

Push-Location $RepoRoot
try {
    $ignored = Test-PathIgnored -RelativePath $EnvFile

    # Tracking is a separate question from ignoring, and a worse failure: an
    # already-tracked env file goes into the next commit no matter what
    # .gitignore says, because ignore rules do not apply to paths git already
    # tracks.
    $tracked = Test-PathTracked -RelativePath $EnvFile
} catch {
    # Inconclusive is not the same as safe. Record and abort below rather than
    # letting an unanswered question default to "fine".
    $stateError = $_.Exception.Message
} finally {
    Pop-Location
}

if ($stateError) {
    Write-Host "  ABORTED: could not determine the git state of $EnvFile." -ForegroundColor Red
    Write-Host "  $stateError"
    Write-Host "  Refusing to write a secret to a file whose protection is unverified."
    exit 1
}

if ($tracked) {
    Write-Host "  ABORTED: $EnvFile is already TRACKED by git." -ForegroundColor Red
    Write-Host "  .gitignore does not apply to tracked files, so a secret written here"
    Write-Host "  would be committed. Untrack it deliberately before continuing."
    exit 1
}

if (-not $ignored) {
    Write-Host "  ABORTED: $EnvFile is NOT git-ignored." -ForegroundColor Red
    Write-Host "  Writing a secret there would risk committing it. Fix .gitignore first."
    exit 1
}
Write-Host "  Target file is git-ignored and untracked. Safe to write." -ForegroundColor Green

# A backup of a configured env file holds the same credentials as the original.
# Editors, rescue copies, and `cp` habits all produce these, and `.env.*` does
# not match `.env.local.bak` -- so verify the backup shapes are covered too,
# and warn rather than abort, since a missing pattern is not a reason to block
# a rotation that is already overdue.
$unprotected  = @()
$probeSkipped = $false

Push-Location $RepoRoot
try {
    foreach ($probe in @("$EnvFile.bak", "$EnvFile.backup", "$EnvFile~")) {
        if (-not (Test-PathIgnored -RelativePath $probe)) { $unprotected += $probe }
    }
} catch {
    # Advisory check only. The target itself is already confirmed protected, so
    # a hiccup here degrades to "could not check" rather than blocking a
    # rotation -- but it must not silently read as "all clear" either.
    $probeSkipped = $true
} finally {
    Pop-Location
}

if ($probeSkipped) {
    Write-Host "  NOTE: could not verify backup-shape ignore rules (non-fatal)." -ForegroundColor DarkGray
} elseif ($unprotected.Count -gt 0) {
    Write-Host "  WARNING: these backup shapes are NOT git-ignored:" -ForegroundColor Yellow
    foreach ($p in $unprotected) { Write-Host "    $p" -ForegroundColor Yellow }
    Write-Host "  A rescue copy of this file would be committable. Add the patterns to .gitignore." -ForegroundColor Yellow
} else {
    Write-Host "  Backup shapes of the target are git-ignored too." -ForegroundColor Green
}
Write-Host ""

# --- The secrets this script knows how to set ------------------------------
# `Validate` checks SHAPE ONLY (length / character class). It never compares
# against a known value and never reveals what it saw.
$Definitions = @(
    @{
        Name        = 'HOSTINGER_API_TOKEN'
        Secret      = $true
        MinLength   = 20
        Pattern     = '^[A-Za-z0-9_\-\.]+$'
        Description = 'Provisions the VPS and manages DNS for trysynora.com.'
    },
    @{
        # Vendor-neutral NAME on purpose. The application reads this generic
        # OpenAI-compatible slot, so swapping routers later is configuration,
        # never a code change. See SYNORA_INTELLIGENCE_ARCHITECTURE.md.
        #
        # This is deliberately NOT called NEXOS_AI_API_KEY. configLoader.ts
        # reads SELF_HOSTED_TEXT_API_KEY and nothing reads a Nexos-named
        # variable, so a vendor-named key would be written and then silently
        # ignored at boot -- the failure mode being a production deploy that
        # authenticates against no one.
        Name        = 'SELF_HOSTED_TEXT_API_KEY'
        Secret      = $true
        MinLength   = 20
        Pattern     = '^[A-Za-z0-9_\-\.]+$'
        Description = 'Authenticates model inference through the configured gateway.'
    },
    # The two below are NOT secrets -- they are endpoint coordinates, and they
    # are shown as you type. They live here anyway because the key above is
    # inert without them: selfHostedText.provider.ts refuses to construct a
    # provider unless BASE_URL and MODEL are both set, so entering the key
    # alone produces a deployment with AI silently unavailable.
    @{
        Name        = 'SELF_HOSTED_TEXT_BASE_URL'
        Secret      = $false
        MinLength   = 8
        Pattern     = '^https?://[^\s]+$'
        Description = 'OpenAI-compatible base URL for the router (not secret).'
    },
    @{
        Name        = 'SELF_HOSTED_TEXT_MODEL'
        Secret      = $false
        MinLength   = 1
        Pattern     = '^[^\s]+$'
        Description = 'Default model identifier served by the router (not secret).'
    }
)

# --- Read the existing file (preserving every unrelated line) --------------
if (Test-Path $Target) {
    $lines = [System.Collections.ArrayList]@(Get-Content -LiteralPath $Target -Encoding UTF8)
} else {
    $lines = [System.Collections.ArrayList]@()
}

$results = @{}

foreach ($def in $Definitions) {
    $name = $def.Name
    Write-Host "  $name" -ForegroundColor Yellow
    Write-Host "    $($def.Description)"
    Write-Host "    Press ENTER alone to leave it unchanged."

    if ($def.Secret) {
        # Hidden input. -AsSecureString keeps the characters out of the console
        # buffer, out of the screen, and out of PSReadLine history.
        $secure = Read-Host "    Value (hidden)" -AsSecureString

        # Decode in memory only, for the shortest possible window.
        $bstr  = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try {
            $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        } finally {
            # Zero the unmanaged buffer whether or not decoding threw.
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
        $secure.Dispose()
    } else {
        # Endpoint coordinates, not credentials. Shown as typed so a typo in a
        # URL is caught here rather than at boot -- hiding a non-secret buys no
        # security and costs the one check that matters for it.
        $plain = Read-Host "    Value"
    }

    if ([string]::IsNullOrWhiteSpace($plain)) {
        $existing = $lines | Where-Object { $_ -match "^$name=(.+)$" }
        $results[$name] = if ($existing) { 'UNCHANGED' } else { 'MISSING' }
        $plain = $null
        Write-Host "    -> $($results[$name])" -ForegroundColor DarkGray
        Write-Host ""
        continue
    }

    $plain = $plain.Trim()

    # Shape validation only. The message never quotes the input.
    if ($plain.Length -lt $def.MinLength -or $plain -notmatch $def.Pattern) {
        $results[$name] = 'INVALID'
        Write-Host "    -> INVALID (length $($plain.Length); expected >= $($def.MinLength) and no spaces/quotes). Not written." -ForegroundColor Red
        $plain = $null
        [System.GC]::Collect()
        Write-Host ""
        continue
    }

    # Write in place if present, otherwise append.
    $idx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^$name=") { $idx = $i; break }
    }
    if ($idx -ge 0) {
        $lines[$idx] = "$name=$plain"
    } else {
        [void]$lines.Add("$name=$plain")
    }

    $results[$name] = 'CONFIGURED'
    Write-Host "    -> CONFIGURED (length $($plain.Length))" -ForegroundColor Green
    Write-Host ""

    # Drop the decoded value immediately.
    $plain = $null
    [System.GC]::Collect()
}

# --- Persist, with restrictive ACLs ----------------------------------------
# UTF8 without BOM: a BOM becomes part of the first variable's name and
# produces a maddening "variable is set but undefined" failure at boot.
$dir = Split-Path -Parent $Target
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
[System.IO.File]::WriteAllLines($Target, $lines, (New-Object System.Text.UTF8Encoding($false)))

try {
    # Owner + SYSTEM only. Other local accounts should not be able to read it.
    $acl = Get-Acl -LiteralPath $Target
    $acl.SetAccessRuleProtection($true, $false)
    # Snapshot with @() before removing. Piping $acl.Access directly enumerates
    # the live collection while RemoveAccessRule mutates it, which silently
    # skips entries -- leaving a rule behind on the file this script exists to
    # lock down.
    @($acl.Access) | ForEach-Object { [void]$acl.RemoveAccessRule($_) }
    foreach ($who in @([System.Security.Principal.WindowsIdentity]::GetCurrent().Name, 'NT AUTHORITY\SYSTEM')) {
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
            $who, 'FullControl', 'None', 'None', 'Allow')))
    }
    Set-Acl -LiteralPath $Target -AclObject $acl
    $aclNote = 'restricted to your account + SYSTEM'
} catch {
    $aclNote = 'could not be tightened (non-fatal)'
}

Write-Host "  ------------------------------------------------------------"
Write-Host "  RESULT" -ForegroundColor Cyan
foreach ($k in $results.Keys | Sort-Object) {
    $colour = switch ($results[$k]) {
        'CONFIGURED' { 'Green' }
        'UNCHANGED'  { 'DarkGray' }
        'MISSING'    { 'Yellow' }
        default      { 'Red' }
    }
    Write-Host ("    {0,-28} {1}" -f $k, $results[$k]) -ForegroundColor $colour
}
Write-Host ""
Write-Host "  File permissions: $aclNote"
Write-Host "  No value was displayed, stored elsewhere, or transmitted."
Write-Host ""

# Clear the loop variable so nothing survives in the session.
Remove-Variable -Name plain -ErrorAction SilentlyContinue
[System.GC]::Collect()
