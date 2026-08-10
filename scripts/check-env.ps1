#Requires -Version 5.1
<#
.SYNOPSIS
  Validate apps/backend/.env.local without ever revealing a value.

.DESCRIPTION
  Answers only the questions that can be answered from metadata: is the
  variable present, is it non-empty, does it still hold a placeholder, does it
  parse as a URL where a URL is required, is it long enough where length is a
  security property, and is it wrapped in quotes the parser will not strip.

  It never prints, logs, or returns a value. Where length is reported, that is
  deliberate -- length is the one property that distinguishes a real 64-hex key
  from a typo without disclosing anything usable.

  Exit code 0 = every REQUIRED variable is usable. Exit code 1 = at least one
  is missing, placeholder, or malformed.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\check-env.ps1
#>

[CmdletBinding()]
param(
    [string] $EnvFile = "apps/backend/.env.local"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Target   = Join-Path $RepoRoot $EnvFile

Write-Host ""
Write-Host "  SYNORA ENVIRONMENT VALIDATION" -ForegroundColor Cyan
Write-Host "  Reports status only. No value is ever displayed."
Write-Host ""

if (-not (Test-Path -LiteralPath $Target)) {
    Write-Host "  FAIL: $EnvFile does not exist. Run scripts\init-env.ps1 first." -ForegroundColor Red
    exit 1
}

# --- Parse. Values stay in memory. -----------------------------------------
$env_ = [ordered]@{}
$crlf = $false
foreach ($line in [System.IO.File]::ReadAllLines($Target)) {
    if ($line -match '^\s*#') { continue }
    if ($line.EndsWith("`r")) { $crlf = $true }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { continue }
    $k = $line.Substring(0, $eq).Trim()
    $v = $line.Substring($eq + 1).TrimEnd("`r")
    if ($k) { $env_[$k] = $v }
}

# Rule: Name, Required, Type. Types are shape checks only.
#   url     - must parse as http/https
#   urlish  - postgres:// or redis:// scheme with a host
#   secret32- >= 32 chars, no whitespace (high-entropy key material). NOT
#             hex-only: TOOL_SECRET_MASTER_KEY is fed through a salted KDF
#             (encryption.service.ts, KEY_LENGTH=32) and JWT_SECRET is an HMAC
#             key, so both accept any encoding. Demanding hex would reject a
#             perfectly good base64 secret and invite regenerating it -- which
#             for JWT_SECRET would silently log out every existing session.
#   int     - digits only
#   csvurl  - comma-separated list of http/https origins
#   opaque  - non-empty, no shape opinion
$Rules = @(
    @{ N='NODE_ENV';                    R=$true;  T='enum'; E=@('production','development','test') }
    @{ N='APP_STAGE';                   R=$true;  T='enum'; E=@('production','staging','development') }
    @{ N='PORT';                        R=$true;  T='int' }
    @{ N='LOG_LEVEL';                   R=$true;  T='enum'; E=@('error','warn','info','debug') }
    @{ N='DATABASE_URL';                R=$true;  T='urlish' }
    @{ N='REDIS_URL';                   R=$true;  T='urlish' }
    @{ N='JWT_SECRET';                  R=$true;  T='secret32' }
    @{ N='TOOL_SECRET_MASTER_KEY';      R=$true;  T='secret32' }
    @{ N='NEXTAUTH_SECRET';             R=$false; T='secret32' }
    @{ N='JWT_EXPIRY';                  R=$true;  T='opaque' }
    @{ N='JWT_REFRESH_EXPIRY';          R=$true;  T='opaque' }
    @{ N='AI_PROVIDER';                 R=$true;  T='opaque' }
    @{ N='SELF_HOSTED_TEXT_BASE_URL';   R=$true;  T='url' }
    @{ N='SELF_HOSTED_TEXT_API_KEY';    R=$true;  T='opaque' }
    @{ N='SELF_HOSTED_TEXT_MODEL';      R=$true;  T='opaque' }
    @{ N='AI_GLOBAL_MAX_COST_PER_DAY_CENTS'; R=$true; T='int' }
    @{ N='AI_USER_MAX_COST_PER_DAY_CENTS';   R=$true; T='int' }
    @{ N='BACKEND_URL';                 R=$true;  T='url' }
    @{ N='FRONTEND_URL';                R=$true;  T='url' }
    @{ N='NEXT_PUBLIC_API_URL';         R=$true;  T='url' }
    @{ N='NEXT_PUBLIC_SITE_URL';        R=$true;  T='url' }
    @{ N='CORS_ORIGINS';                R=$true;  T='csvurl' }
    @{ N='SYNORA_DOMAIN';               R=$true;  T='opaque' }
    @{ N='HOSTINGER_API_TOKEN';         R=$false; T='opaque' }
    @{ N='VPS_IP';                      R=$false; T='opaque' }
    @{ N='POSTGRES_PASSWORD';           R=$false; T='opaque' }
    @{ N='MAIL_TRANSPORT';              R=$true;  T='enum'; E=@('console','smtp') }
    @{ N='SENTRY_DSN';                  R=$false; T='opaque' }
    @{ N='METRICS_TOKEN';               R=$false; T='opaque' }
    @{ N='STRIPE_SECRET_KEY';           R=$false; T='opaque' }
)

$PlaceholderPattern = '^(PASTE_|CHANGE_ME|YOUR_|REPLACE_|<)'

function Test-Shape {
    param([string] $Type, [string] $Value, [string[]] $Enum)
    switch ($Type) {
        'int'    { return ($Value -match '^\d+$') }
        'secret32' { return ($Value.Length -ge 32 -and $Value -notmatch '\s') }
        'enum'   { return ($Enum -contains $Value) }
        'url'    { try { $u=[uri]$Value; return ($u.Scheme -in @('http','https') -and $u.Host) } catch { return $false } }
        'urlish' { try { $u=[uri]$Value; return ($u.Scheme -in @('postgres','postgresql','redis','rediss') -and $u.Host) } catch { return $false } }
        'csvurl' {
            foreach ($p in $Value.Split(',')) {
                $p = $p.Trim(); if (-not $p) { return $false }
                try { $u=[uri]$p; if ($u.Scheme -notin @('http','https') -or -not $u.Host) { return $false } } catch { return $false }
            }
            return $true
        }
        default  { return $true }
    }
}

$fail = 0; $warn = 0
$rows = @()

foreach ($rule in $Rules) {
    $n = $rule.N
    $present = $env_.Contains($n)
    $v = if ($present) { [string]$env_[$n] } else { '' }

    $status = 'OK'; $note = ''
    if (-not $present) {
        $status = if ($rule.R) { 'MISSING' } else { 'absent (optional)' }
    } elseif ([string]::IsNullOrWhiteSpace($v)) {
        $status = if ($rule.R) { 'EMPTY' } else { 'blank (optional)' }
    } elseif ($v -match $PlaceholderPattern) {
        $status = 'PLACEHOLDER'
    } elseif (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
        $status = 'QUOTED'
        $note = 'surrounding quotes are kept literally by the parser - remove them'
    } else {
        $enum = if ($rule.Contains('E')) { $rule.E } else { @() }
        if (-not (Test-Shape -Type $rule.T -Value $v -Enum $enum)) {
            $status = 'INVALID'
            $note = "does not match expected shape: $($rule.T)"
        }
    }

    $isBad = $status -in @('MISSING','EMPTY','PLACEHOLDER','QUOTED','INVALID')
    if ($isBad) { if ($rule.R) { $fail++ } else { $warn++ } }

    $rows += [pscustomobject]@{
        Name     = $n
        Required = $(if ($rule.R) { 'required' } else { 'optional' })
        Status   = $status
        Length   = $(if ($present -and $v) { $v.Length } else { 0 })
        Note     = $note
    }
}

foreach ($r in $rows) {
    $colour = switch -Regex ($r.Status) {
        '^OK$'                                   { 'Green' }
        '^(absent|blank) \(optional\)$'          { 'DarkGray' }
        '^(MISSING|EMPTY|PLACEHOLDER|INVALID|QUOTED)$' { if ($r.Required -eq 'required') { 'Red' } else { 'Yellow' } }
        default                                  { 'Gray' }
    }
    $line = "    {0,-34} {1,-9} {2,-18} len={3}" -f $r.Name, $r.Required, $r.Status, $r.Length
    Write-Host $line -ForegroundColor $colour
    if ($r.Note) { Write-Host "        ^ $($r.Note)" -ForegroundColor Yellow }
}

Write-Host ""
if ($crlf) {
    Write-Host "  WARNING: file uses CRLF endings. On Linux some dotenv parsers keep the" -ForegroundColor Yellow
    Write-Host "           trailing CR inside values, corrupting DATABASE_URL and REDIS_URL." -ForegroundColor Yellow
    Write-Host "           Re-run scripts\init-env.ps1 to rewrite with LF." -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "  ------------------------------------------------------------"
Write-Host "  required failing : $fail" -ForegroundColor $(if ($fail) { 'Red' } else { 'Green' })
Write-Host "  optional pending : $warn" -ForegroundColor DarkGray
Write-Host "  total checked    : $($rows.Count)"
Write-Host ""
if ($fail -eq 0) {
    Write-Host "  PASS - every required variable is present and well-formed." -ForegroundColor Green
} else {
    Write-Host "  FAIL - $fail required variable(s) still need attention." -ForegroundColor Red
}
Write-Host "  No value was displayed at any point."
Write-Host ""
exit $(if ($fail -eq 0) { 0 } else { 1 })
