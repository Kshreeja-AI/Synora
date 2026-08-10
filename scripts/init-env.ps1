#Requires -Version 5.1
<#
.SYNOPSIS
  Build a complete, sectioned apps/backend/.env.local for Synora WITHOUT ever
  displaying, copying, or destroying a value.

.DESCRIPTION
  This replaces the hidden-prompt entry flow. `Read-Host -AsSecureString` drops
  pasted input in the Windows console (a paste frequently registers as a single
  character), which is a data-entry defect, not a security feature -- so entry
  moves to the file, where paste is reliable and reviewable.

  The operating principle is MERGE, NEVER OVERWRITE:

    * a variable that already holds a real value keeps it, byte for byte
    * a variable that is missing or empty gets a labelled placeholder
    * JWT_SECRET / TOOL_SECRET_MASTER_KEY / NEXTAUTH_SECRET are generated with
      a CSPRNG when absent, and written straight to disk unseen
    * a variable present in the file but unknown to this template is PRESERVED
      in a trailing section rather than dropped

  Existing values pass through memory but are never written to the console, a
  temporary file, a backup, or a command-line argument. No `.bak` is produced:
  a plaintext copy of this file is exactly the artefact that must not exist.

  Every variable below was confirmed by audit to be read by application code,
  the web app, or the production compose file. The HOSTINGER VPS block is the
  sole exception and is labelled accordingly -- those are consumed by
  deployment tooling, not by Synora at runtime.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\init-env.ps1
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
Write-Host "  SYNORA ENVIRONMENT FILE BUILDER" -ForegroundColor Cyan
Write-Host "  Merges into $EnvFile. No value is displayed or overwritten."
Write-Host ""

# --------------------------------------------------------------------------
# Locate git. Same reasoning as set-secrets.ps1: git is regularly absent from
# the PowerShell PATH even when installed, and "cannot verify" must never be
# reported as "not protected".
# --------------------------------------------------------------------------
function Resolve-GitExecutable {
    $onPath = Get-Command git -CommandType Application -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    foreach ($c in @(
        (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Git\cmd\git.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe'))) {
        if ($c -and (Test-Path -LiteralPath $c)) { return $c }
    }
    return $null
}

$GitExe = Resolve-GitExecutable
if (-not $GitExe) {
    Write-Host "  ABORTED: git not found. Cannot verify the target is protected." -ForegroundColor Red
    exit 1
}

# stderr is data; the exit code is the contract. See set-secrets.ps1.
function Invoke-GitCapture {
    param([Parameter(Mandatory)][string[]] $Arguments)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try   { $stdout = & $GitExe @Arguments; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $previous }
    [pscustomobject]@{ Lines = @($stdout); ExitCode = $code }
}

function Test-PathIgnored {
    param([Parameter(Mandatory)][string] $RelativePath)
    $r = Invoke-GitCapture -Arguments @('check-ignore','-q','--',$RelativePath)
    switch ($r.ExitCode) {
        0       { return $true }
        1       { return $false }
        default { throw "git check-ignore failed with exit code $($r.ExitCode)" }
    }
}

function Test-PathTracked {
    param([Parameter(Mandatory)][string] $RelativePath)
    $r = Invoke-GitCapture -Arguments @('ls-files','--',$RelativePath)
    if ($r.ExitCode -ne 0) { throw "git ls-files failed with exit code $($r.ExitCode); tracking state unknown" }
    $wanted = ($RelativePath -replace '\\','/').Trim()
    foreach ($line in $r.Lines) {
        if ($null -ne $line -and $line.ToString().Trim() -eq $wanted) { return $true }
    }
    return $false
}

$stateError = $null; $ignored = $false; $tracked = $false
Push-Location $RepoRoot
try {
    $ignored = Test-PathIgnored -RelativePath $EnvFile
    $tracked = Test-PathTracked -RelativePath $EnvFile
} catch { $stateError = $_.Exception.Message } finally { Pop-Location }

if ($stateError) {
    Write-Host "  ABORTED: could not determine git state. $stateError" -ForegroundColor Red
    exit 1
}
if ($tracked) {
    Write-Host "  ABORTED: $EnvFile is TRACKED by git. Untrack it deliberately first." -ForegroundColor Red
    exit 1
}
if (-not $ignored) {
    Write-Host "  ABORTED: $EnvFile is NOT git-ignored." -ForegroundColor Red
    exit 1
}
Write-Host "  Target is git-ignored and untracked." -ForegroundColor Green

# --------------------------------------------------------------------------
# Cryptographically secure generation. 32 bytes of CSPRNG output rendered as
# 64 lowercase hex characters -- matching the length already in use, and
# avoiding base64's '+' and '/' which trip naive .env parsers and shell
# interpolation. The value is returned into the file and never to the console.
# --------------------------------------------------------------------------
function New-GeneratedSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

# --------------------------------------------------------------------------
# The template. Kind:
#   config    - not a secret; safe to read, safe to commit to a template
#   secret    - credential; placeholder until pasted
#   generated - created here with a CSPRNG if absent
# Every name below was verified against the code that reads it.
# --------------------------------------------------------------------------
$Spec = @(
    @{ S='SYNORA APPLICATION'; N='NODE_ENV';   K='config'; D='production | development | test'; V='production' }
    @{ S='SYNORA APPLICATION'; N='APP_STAGE';  K='config'; D='Stage gate for fail-closed config: production | staging | development'; V='production' }
    @{ S='SYNORA APPLICATION'; N='PORT';       K='config'; D='Backend HTTP listen port'; V='3001' }
    @{ S='SYNORA APPLICATION'; N='LOG_LEVEL';  K='config'; D='error | warn | info | debug'; V='info' }

    @{ S='DATABASE'; N='DATABASE_URL'; K='secret'; D='Postgres connection string. Contains a password -- treat as a secret.'; V='PASTE_DATABASE_URL_HERE' }

    @{ S='REDIS'; N='REDIS_URL';      K='secret'; D='redis://:PASSWORD@host:6379 -- password inline, treat as a secret'; V='PASTE_REDIS_URL_HERE' }
    @{ S='REDIS'; N='REDIS_TLS';      K='config'; D='true when Redis requires TLS (managed providers usually do)'; V='false' }
    @{ S='REDIS'; N='REDIS_DB';       K='config'; D='Redis logical database index'; V='0' }

    @{ S='AUTHENTICATION'; N='JWT_SECRET';                    K='generated'; D='HS256 signing key for access tokens. Generated here; never invent one by hand.' }
    @{ S='AUTHENTICATION'; N='TOOL_SECRET_MASTER_KEY';        K='generated'; D='Master key encrypting per-workspace tool secrets at rest. Losing it makes stored tool secrets unrecoverable.' }
    @{ S='AUTHENTICATION'; N='NEXTAUTH_SECRET';               K='generated'; D='Reserved for the future OAuth2 flow; generated now so it is never left empty.' }
    @{ S='AUTHENTICATION'; N='JWT_EXPIRY';                    K='config'; D='Access token lifetime'; V='15m' }
    @{ S='AUTHENTICATION'; N='JWT_REFRESH_EXPIRY';            K='config'; D='Refresh token lifetime'; V='7d' }
    @{ S='AUTHENTICATION'; N='JWT_REFRESH_EXPIRY_REMEMBER_ME'; K='config'; D='Refresh lifetime when rememberMe is set'; V='30d' }
    @{ S='AUTHENTICATION'; N='MAX_FAILED_LOGIN_ATTEMPTS';     K='config'; D='Failed logins before lockout'; V='5' }
    @{ S='AUTHENTICATION'; N='LOCKOUT_DURATION_MINUTES';      K='config'; D='Lockout duration in minutes'; V='15' }

    @{ S='AI ROUTER'; N='AI_PROVIDER';               K='config'; D='Pins the text provider. Set to self-hosted so the OpenAI-compatible router wins over any other configured provider.'; V='self-hosted' }
    @{ S='AI ROUTER'; N='SELF_HOSTED_TEXT_BASE_URL'; K='config'; D='OpenAI-compatible base URL, e.g. https://host/v1 (NOT a secret)'; V='PASTE_AI_ROUTER_BASE_URL_HERE' }
    @{ S='AI ROUTER'; N='SELF_HOSTED_TEXT_API_KEY';  K='secret'; D='Bearer key for the router'; V='PASTE_AI_ROUTER_API_KEY_HERE' }
    @{ S='AI ROUTER'; N='SELF_HOSTED_TEXT_MODEL';    K='config'; D='Default model identifier (NOT a secret)'; V='PASTE_AI_ROUTER_MODEL_HERE' }
    @{ S='AI ROUTER'; N='SELF_HOSTED_TEXT_MODELS';   K='config'; D='Optional comma-separated allow-list of selectable models'; V='' }
    @{ S='AI ROUTER'; N='AI_GLOBAL_MAX_COST_PER_DAY_CENTS'; K='config'; D='Spend guard: platform-wide daily ceiling, in cents'; V='500' }
    @{ S='AI ROUTER'; N='AI_USER_MAX_COST_PER_DAY_CENTS';   K='config'; D='Spend guard: per-user daily ceiling, in cents'; V='100' }
    @{ S='AI ROUTER'; N='AI_GLOBAL_MAX_TOKENS_PER_DAY';     K='config'; D='Spend guard: platform-wide daily token ceiling'; V='2000000' }

    @{ S='HOSTINGER VPS'; N='HOSTINGER_API_TOKEN'; K='secret'; D='Hostinger API token. NOTE: not read by Synora at runtime -- deployment tooling only.'; V='PASTE_HOSTINGER_API_TOKEN_HERE' }
    @{ S='HOSTINGER VPS'; N='VPS_IP';              K='config'; D='Public IPv4 of the VPS. Not a secret. Deployment tooling only.'; V='200.234.32.93' }
    @{ S='HOSTINGER VPS'; N='VPS_ID';              K='config'; D='Hostinger VPS identifier (hostname srv1891213.hstgr.cloud). Deployment tooling only.'; V='PASTE_VPS_ID_HERE' }
    @{ S='HOSTINGER VPS'; N='VPS_SSH_USER';        K='config'; D='SSH login user. Not a secret; the private key is, and stays outside this file.'; V='root' }
    @{ S='HOSTINGER VPS'; N='VPS_SSH_PORT';        K='config'; D='SSH port'; V='22' }
    @{ S='HOSTINGER VPS'; N='POSTGRES_PASSWORD';   K='secret'; D='Password for the Postgres container in docker-compose.production.yml'; V='PASTE_POSTGRES_PASSWORD_HERE' }

    @{ S='DOMAIN / NETWORK'; N='SYNORA_DOMAIN';        K='config'; D='Apex domain used by the production compose file and reverse proxy'; V='trysynora.com' }
    @{ S='DOMAIN / NETWORK'; N='BACKEND_URL';          K='config'; D='Public origin of the API'; V='https://api.trysynora.com' }
    @{ S='DOMAIN / NETWORK'; N='FRONTEND_URL';         K='config'; D='Public origin of the web app'; V='https://trysynora.com' }
    @{ S='DOMAIN / NETWORK'; N='NEXT_PUBLIC_API_URL';  K='config'; D='API origin exposed to the BROWSER. Public by definition -- never put a secret in a NEXT_PUBLIC_* variable.'; V='https://api.trysynora.com' }
    @{ S='DOMAIN / NETWORK'; N='NEXT_PUBLIC_SITE_URL'; K='config'; D='Site origin exposed to the BROWSER. Public by definition.'; V='https://trysynora.com' }

    @{ S='CORS'; N='CORS_ORIGINS'; K='config'; D='Comma-separated allowed origins. THE authoritative CORS setting -- HTTP and realtime both read this one.'; V='https://trysynora.com' }

    @{ S='EMAIL'; N='MAIL_TRANSPORT';      K='config'; D='console | smtp'; V='console' }
    @{ S='EMAIL'; N='MAIL_FROM_ADDRESS';   K='config'; D='From address on transactional mail'; V='no-reply@trysynora.com' }
    @{ S='EMAIL'; N='MAIL_FROM_NAME';      K='config'; D='From display name'; V='Synora' }
    @{ S='EMAIL'; N='SMTP_HOST';           K='config'; D='SMTP host (only when MAIL_TRANSPORT=smtp)'; V='' }
    @{ S='EMAIL'; N='SMTP_PORT';           K='config'; D='SMTP port'; V='587' }
    @{ S='EMAIL'; N='SMTP_SECURE';         K='config'; D='true for implicit TLS on 465'; V='false' }
    @{ S='EMAIL'; N='SMTP_USER';           K='secret'; D='SMTP username'; V='' }
    @{ S='EMAIL'; N='SMTP_PASSWORD';       K='secret'; D='SMTP password'; V='' }

    @{ S='OBSERVABILITY'; N='SENTRY_DSN';                  K='secret'; D='Sentry DSN. Blank disables Sentry.'; V='' }
    @{ S='OBSERVABILITY'; N='SENTRY_RELEASE';              K='config'; D='Release identifier reported to Sentry'; V='' }
    @{ S='OBSERVABILITY'; N='SENTRY_TRACES_SAMPLE_RATE';   K='config'; D='0.0-1.0 trace sampling'; V='0.1' }
    @{ S='OBSERVABILITY'; N='METRICS_TOKEN';               K='secret'; D='Bearer token guarding the metrics endpoint. Blank leaves it closed.'; V='' }
    @{ S='OBSERVABILITY'; N='OTEL_EXPORTER_OTLP_ENDPOINT'; K='config'; D='OTLP collector endpoint. Blank disables export.'; V='' }
    @{ S='OBSERVABILITY'; N='OTEL_SERVICE_NAME';           K='config'; D='Service name in traces'; V='synora-backend' }
    @{ S='OBSERVABILITY'; N='EOS_SLOW_REQUEST_MS';         K='config'; D='Threshold marking a request slow'; V='1000' }
    @{ S='OBSERVABILITY'; N='RATE_LIMIT_WINDOW_MS';        K='config'; D='Rate limit window'; V='900000' }
    @{ S='OBSERVABILITY'; N='RATE_LIMIT_MAX_REQUESTS';     K='config'; D='Requests permitted per window'; V='100' }

    @{ S='OPTIONAL AI PROVIDERS'; N='OPENAI_API_KEY';       K='secret'; D='Leave blank unless used'; V='' }
    @{ S='OPTIONAL AI PROVIDERS'; N='ANTHROPIC_API_KEY';    K='secret'; D='Leave blank unless used'; V='' }
    @{ S='OPTIONAL AI PROVIDERS'; N='GOOGLE_AI_API_KEY';    K='secret'; D='Leave blank unless used'; V='' }
    @{ S='OPTIONAL AI PROVIDERS'; N='DEEPSEEK_API_KEY';     K='secret'; D='Leave blank unless used'; V='' }
    @{ S='OPTIONAL AI PROVIDERS'; N='GROQ_API_KEY';         K='secret'; D='Leave blank unless used'; V='' }
    @{ S='OPTIONAL AI PROVIDERS'; N='OPENROUTER_API_KEY';   K='secret'; D='Leave blank unless used'; V='' }
    @{ S='OPTIONAL AI PROVIDERS'; N='TOGETHER_API_KEY';     K='secret'; D='Leave blank unless used'; V='' }
    @{ S='OPTIONAL AI PROVIDERS'; N='XAI_API_KEY';          K='secret'; D='Leave blank unless used'; V='' }
    @{ S='OPTIONAL AI PROVIDERS'; N='AZURE_OPENAI_API_KEY'; K='secret'; D='Leave blank unless used'; V='' }
    @{ S='OPTIONAL AI PROVIDERS'; N='REPLICATE_API_KEY';    K='secret'; D='Video generation. Leave blank unless used.'; V='' }

    @{ S='OTHER OPTIONAL SERVICES'; N='QUEUE_ENABLED';         K='config'; D='BullMQ workers on/off. Requires REDIS_URL.'; V='true' }
    @{ S='OTHER OPTIONAL SERVICES'; N='STORAGE_PROVIDER';      K='config'; D='local | s3'; V='local' }
    @{ S='OTHER OPTIONAL SERVICES'; N='STORAGE_LOCAL_DIRECTORY'; K='config'; D='On-disk root when STORAGE_PROVIDER=local'; V='./storage' }
    @{ S='OTHER OPTIONAL SERVICES'; N='AWS_ACCESS_KEY_ID';     K='secret'; D='S3-compatible object storage. Blank unless STORAGE_PROVIDER=s3.'; V='' }
    @{ S='OTHER OPTIONAL SERVICES'; N='AWS_SECRET_ACCESS_KEY'; K='secret'; D='S3-compatible object storage secret'; V='' }
    @{ S='OTHER OPTIONAL SERVICES'; N='EMBEDDING_ENABLED';     K='config'; D='Embedding subsystem on/off'; V='false' }
    @{ S='OTHER OPTIONAL SERVICES'; N='EMBEDDING_PROVIDER';    K='config'; D='openai | ollama | self-hosted | cohere | voyage | gemini'; V='' }
    @{ S='OTHER OPTIONAL SERVICES'; N='VOYAGE_API_KEY';        K='secret'; D='Embeddings. Blank unless used.'; V='' }
    @{ S='OTHER OPTIONAL SERVICES'; N='COHERE_API_KEY';        K='secret'; D='Embeddings. Blank unless used.'; V='' }
    @{ S='OTHER OPTIONAL SERVICES'; N='VECTORDB_ENABLED';      K='config'; D='Vector database subsystem on/off'; V='false' }
    @{ S='OTHER OPTIONAL SERVICES'; N='VECTORDB_PROVIDER';     K='config'; D='pgvector | qdrant | pinecone | weaviate | milvus'; V='' }
    @{ S='OTHER OPTIONAL SERVICES'; N='PINECONE_API_KEY';      K='secret'; D='Blank unless used'; V='' }
    @{ S='OTHER OPTIONAL SERVICES'; N='QDRANT_API_KEY';        K='secret'; D='Blank unless used'; V='' }
    @{ S='OTHER OPTIONAL SERVICES'; N='WEAVIATE_API_KEY';      K='secret'; D='Blank unless used'; V='' }
    @{ S='OTHER OPTIONAL SERVICES'; N='MILVUS_TOKEN';          K='secret'; D='Blank unless used'; V='' }
    @{ S='OTHER OPTIONAL SERVICES'; N='BILLING_PROVIDER';      K='config'; D='none | stripe'; V='none' }
    @{ S='OTHER OPTIONAL SERVICES'; N='STRIPE_SECRET_KEY';     K='secret'; D='Blank unless BILLING_PROVIDER=stripe'; V='' }
    @{ S='OTHER OPTIONAL SERVICES'; N='STRIPE_WEBHOOK_SECRET'; K='secret'; D='Blank unless BILLING_PROVIDER=stripe'; V='' }
    @{ S='OTHER OPTIONAL SERVICES'; N='VIRUS_SCAN_PROVIDER';   K='config'; D='none | clamav -- upload scanning'; V='none' }
)

# --- Read the current file. Values stay in memory and are never echoed. -----
$existing = [ordered]@{}
if (Test-Path -LiteralPath $Target) {
    foreach ($line in [System.IO.File]::ReadAllLines($Target)) {
        if ($line -match '^\s*#') { continue }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) { continue }
        $k = $line.Substring(0, $eq).Trim()
        $v = $line.Substring($eq + 1).TrimEnd("`r")
        if ($k) { $existing[$k] = $v }
    }
}

$PlaceholderPattern = '^(PASTE_|CHANGE_ME|YOUR_|REPLACE_|<)'

$stats = [ordered]@{ Preserved = 0; Placeholder = 0; Generated = 0; Defaulted = 0 }
$resolved = [ordered]@{}
$generatedNames = @()

foreach ($item in $Spec) {
    $name = $item.N
    $had  = $existing.Contains($name)
    $cur  = if ($had) { [string]$existing[$name] } else { '' }
    $real = $had -and -not [string]::IsNullOrWhiteSpace($cur) -and ($cur -notmatch $PlaceholderPattern)

    if ($real) {
        $resolved[$name] = $cur                 # untouched, byte for byte
        $stats.Preserved++
    } elseif ($item.K -eq 'generated') {
        $resolved[$name] = New-GeneratedSecret  # never surfaced
        $generatedNames += $name
        $stats.Generated++
    } else {
        $default = if ($item.Contains('V')) { [string]$item.V } else { '' }
        $resolved[$name] = $default
        if ($default -match $PlaceholderPattern) { $stats.Placeholder++ } else { $stats.Defaulted++ }
    }
}

# Anything already in the file that this template does not know about is kept.
# Silently dropping a variable the founder added would be data loss disguised
# as tidiness.
$unknown = @($existing.Keys | Where-Object { -not $resolved.Contains($_) })

# --- Compose the file ------------------------------------------------------
$out = [System.Collections.Generic.List[string]]::new()
$out.Add('# ============================================================================')
$out.Add('#  SYNORA - LOCAL PRODUCTION ENVIRONMENT')
$out.Add('#')
$out.Add('#  This file is git-ignored and MUST stay that way. Never commit it, never')
$out.Add('#  copy it into a Docker image, never paste its contents into a chat, an')
$out.Add('#  issue, or a log. Values marked SECRET are credentials; the rest are')
$out.Add('#  ordinary configuration and are safe to read aloud.')
$out.Add('#')
$out.Add('#  Paste values directly after the "=" with no surrounding quotes.')
$out.Add('#  Verify at any time with:  powershell -File scripts\check-env.ps1')
$out.Add('# ============================================================================')

$lastSection = ''
foreach ($item in $Spec) {
    if ($item.S -ne $lastSection) {
        $out.Add('')
        $out.Add('# ---------------------------------------------------------------------------')
        $out.Add("# $($item.S)")
        $out.Add('# ---------------------------------------------------------------------------')
        if ($item.S -eq 'HOSTINGER VPS') {
            $out.Add('# NOTE: no Synora runtime code reads these. They exist for deployment')
            $out.Add('#       tooling only. The SSH PRIVATE KEY is deliberately absent -- keep')
            $out.Add('#       it in the SSH agent or ~/.ssh, never in an env file.')
        }
        $lastSection = $item.S
    }
    $tag = switch ($item.K) {
        'secret'    { 'SECRET' }
        'generated' { 'SECRET, generated' }
        default     { 'config' }
    }
    $out.Add("# [$tag] $($item.D)")
    $out.Add("$($item.N)=$($resolved[$item.N])")
}

if ($unknown.Count -gt 0) {
    $out.Add('')
    $out.Add('# ---------------------------------------------------------------------------')
    $out.Add('# PRESERVED - present in your file, not part of the template')
    $out.Add('# ---------------------------------------------------------------------------')
    foreach ($k in $unknown) { $out.Add("$k=$($existing[$k])") }
}
$out.Add('')

# LF endings, UTF-8 without BOM. CRLF survives the trip to AlmaLinux and leaves
# a trailing \r inside values like DATABASE_URL, which fails in ways that look
# like a network problem. A BOM corrupts the first variable's NAME.
$text = ($out -join "`n")
[System.IO.File]::WriteAllText($Target, $text, (New-Object System.Text.UTF8Encoding($false)))

try {
    $acl = Get-Acl -LiteralPath $Target
    $acl.SetAccessRuleProtection($true, $false)
    @($acl.Access) | ForEach-Object { [void]$acl.RemoveAccessRule($_) }
    foreach ($who in @([System.Security.Principal.WindowsIdentity]::GetCurrent().Name, 'NT AUTHORITY\SYSTEM')) {
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($who,'FullControl','None','None','Allow')))
    }
    Set-Acl -LiteralPath $Target -AclObject $acl
    $aclNote = 'restricted to your account + SYSTEM'
} catch { $aclNote = 'could not be tightened (non-fatal)' }

Write-Host ""
Write-Host "  ------------------------------------------------------------"
Write-Host "  RESULT (counts and names only -- no values)" -ForegroundColor Cyan
Write-Host "    variables written    : $($resolved.Count)"
Write-Host "    existing preserved   : $($stats.Preserved)" -ForegroundColor Green
Write-Host "    secrets generated    : $($stats.Generated)" -ForegroundColor Green
Write-Host "    safe defaults filled : $($stats.Defaulted)"
Write-Host "    awaiting your paste  : $($stats.Placeholder)" -ForegroundColor Yellow
Write-Host "    preserved unknown    : $($unknown.Count)"
if ($generatedNames.Count -gt 0) {
    Write-Host "    generated (names only):"
    foreach ($n in $generatedNames) { Write-Host "      $n" -ForegroundColor Green }
}
Write-Host ""
Write-Host "  File permissions: $aclNote"
Write-Host "  No value was displayed, backed up, or transmitted."
Write-Host ""
Write-Host "  Next: open $EnvFile in VS Code, replace every PASTE_*_HERE," -ForegroundColor Cyan
Write-Host "        then run:  powershell -File scripts\check-env.ps1" -ForegroundColor Cyan
Write-Host ""
