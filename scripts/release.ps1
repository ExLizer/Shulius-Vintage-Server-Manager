# release.ps1
# Build, sign and publish a new release of Shulius Vintage Server Manager.
#
# Usage:
#   .\scripts\release.ps1 -Version 0.2.0
#   .\scripts\release.ps1 -Version 0.2.0 -Notes "Fix realtime + backups"
#   .\scripts\release.ps1 -Version 0.2.0 -SkipBump       # version already bumped
#   .\scripts\release.ps1 -Version 0.2.0 -SkipBuild      # already built, only publish
#   .\scripts\release.ps1 -Version 0.2.0 -DryRun         # do everything except gh release
#
# Requires:
#   - $env:USERPROFILE\.tauri\vs-server-manager.key (the signing private key)
#   - gh CLI installed and authenticated
#   - Node + Rust toolchain

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,

    [string]$Notes = "",

    [string]$KeyPath = "$env:USERPROFILE\.tauri\vs-server-manager.key",

    [string]$KeyPassword = "",

    [switch]$SkipBump,

    [switch]$SkipBuild,

    [switch]$DryRun
)

# NOTE: deliberately NOT setting $ErrorActionPreference = "Stop" globally because
# native commands (npm, cargo, tauri) write progress to stderr and that would
# wrap each line in a NativeCommandError and abort the script. We check
# $LASTEXITCODE manually after each native call instead.

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Read-Utf8([string]$path) {
    return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8([string]$path, [string]$content) {
    [System.IO.File]::WriteAllText($path, $content, $script:utf8NoBom)
}

function Assert-NativeOk([string]$step) {
    if ($LASTEXITCODE -ne 0) {
        throw "$step failed with exit code $LASTEXITCODE"
    }
}

Write-Host ""
Write-Host "=== Shulius Vintage Server Manager - release $Version ===" -ForegroundColor Cyan
Write-Host ""

# -------- Pre-flight checks ----------------------------------------------------
if (-not (Test-Path $KeyPath)) {
    throw "Signing key not found at $KeyPath. Generate it with: npm run tauri -- signer generate --ci -w `"$KeyPath`""
}

# Si no se paso -KeyPassword, intentar leerlo del archivo convencional al lado
# de la key. Si tampoco esta, abortar: firmar releases publicas con una key sin
# password equivale a tener la key plana en disco, lo cual la deja inutil como
# segundo factor si la maquina se compromete.
if ([string]::IsNullOrEmpty($KeyPassword)) {
    $passwordFile = "$KeyPath.password"
    if (Test-Path $passwordFile) {
        $KeyPassword = (Get-Content $passwordFile -Raw -ErrorAction Stop).Trim()
    }
}
if ([string]::IsNullOrEmpty($KeyPassword)) {
    throw "Empty signing key password is not allowed. Pass -KeyPassword <pw>, set `$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD, or store it in `"$KeyPath.password`"."
}

if (-not $SkipBuild -and -not $DryRun) {
    gh auth status 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "gh CLI not authenticated. Run: gh auth login"
    }
}

$tag = "v$Version"

# -------- Bump versions --------------------------------------------------------
if ($SkipBump) {
    Write-Host "[1/5] Skipping version bump (-SkipBump)"
} else {
    Write-Host "[1/5] Bumping version to $Version in package.json, Cargo.toml, tauri.conf.json"

    # package.json (preserve formatting via regex)
    $pkgPath = Join-Path $root "package.json"
    $pkg = Read-Utf8 $pkgPath
    $pkg = [regex]::Replace($pkg, '("version"\s*:\s*)"[^"]+"', "`$1`"$Version`"", 1)
    Write-Utf8 $pkgPath $pkg

    # Cargo.toml
    $cargoPath = Join-Path $root "src-tauri\Cargo.toml"
    $cargo = Read-Utf8 $cargoPath
    $cargo = [regex]::Replace($cargo, '(?m)^version\s*=\s*"[^"]+"\s*$', "version = `"$Version`"", 1)
    Write-Utf8 $cargoPath $cargo

    # tauri.conf.json
    $confPath = Join-Path $root "src-tauri\tauri.conf.json"
    $conf = Read-Utf8 $confPath
    $conf = [regex]::Replace($conf, '("version"\s*:\s*)"[^"]+"', "`$1`"$Version`"", 1)
    Write-Utf8 $confPath $conf
}

# -------- Build (signed) -------------------------------------------------------
if ($SkipBuild) {
    Write-Host "[2/5] Skipping build (-SkipBuild)"
} else {
    Write-Host "[2/5] Building signed release artifacts (this can take 5-10 minutes)..."
    $env:TAURI_SIGNING_PRIVATE_KEY = $KeyPath
    # KeyPassword ya fue validado como no vacio en el pre-flight check.
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $KeyPassword
    try {
        npm run tauri -- build
        Assert-NativeOk "tauri build"
    } finally {
        Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
        Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    }
}

# -------- Locate artifacts -----------------------------------------------------
Write-Host "[3/5] Locating build artifacts"

$bundleDir = Join-Path $root "src-tauri\target\release\bundle\nsis"
if (-not (Test-Path $bundleDir)) {
    throw "Bundle dir not found: $bundleDir. Did the build run the NSIS target?"
}

$installer = Get-ChildItem $bundleDir -Filter "*_${Version}_*-setup.exe" | Where-Object { $_.Name -notlike "*.sig" } | Select-Object -First 1
$updaterSig = Get-ChildItem $bundleDir -Filter "*_${Version}_*-setup.exe.sig" | Select-Object -First 1

if (-not $installer) { throw "Installer .exe not found in $bundleDir" }
if (-not $updaterSig) { throw "Updater .sig not found in $bundleDir" }

Write-Host "  installer  : $($installer.Name)"
Write-Host "  signature  : $($updaterSig.Name)"

# -------- Normalize filenames (replace spaces with dashes) ---------------------
$stage = Join-Path $root "scripts\release-stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

function Format-AssetName([string]$name) { return ($name -replace '\s+', '-') }

$installerOut = Join-Path $stage (Format-AssetName $installer.Name)
$updaterSigOut = Join-Path $stage (Format-AssetName $updaterSig.Name)

Copy-Item $installer.FullName $installerOut
Copy-Item $updaterSig.FullName $updaterSigOut

# -------- Build latest.json ----------------------------------------------------
Write-Host "[4/5] Generating latest.json"

$sigContent = (Read-Utf8 $updaterSig.FullName).Trim()
$assetName = [System.IO.Path]::GetFileName($installerOut)
$assetUrl = "https://github.com/ExLizer/Shulius-Vintage-Server-Manager/releases/download/$tag/$assetName"

$latest = [ordered]@{
    version   = $Version
    notes     = $Notes
    pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $sigContent
            url       = $assetUrl
        }
    }
}

$latestJsonPath = Join-Path $stage "latest.json"
$latestJson = $latest | ConvertTo-Json -Depth 10
Write-Utf8 $latestJsonPath $latestJson

Write-Host "  $latestJsonPath"

# -------- Publish release ------------------------------------------------------
if ($DryRun) {
    Write-Host '[5/5] DryRun: skipping gh release create'
    Write-Host ""
    Write-Host "Staged artifacts ready in: $stage" -ForegroundColor Yellow
    Write-Host "Files to upload:"
    Get-ChildItem $stage | ForEach-Object { Write-Host "  $($_.Name)" }
    return
}

Write-Host "[5/5] Creating GitHub release $tag"

$releaseNotes = if ([string]::IsNullOrWhiteSpace($Notes)) { "Release $Version" } else { $Notes }

gh release create $tag $installerOut $updaterSigOut $latestJsonPath --repo "ExLizer/Shulius-Vintage-Server-Manager" --title "v$Version" --notes $releaseNotes
Assert-NativeOk "gh release create"

Write-Host ""
Write-Host "Release $tag published successfully." -ForegroundColor Green
Write-Host "Users will receive the update next time they check (or within 6h if auto-check is on)."
