# TaskDock Local Release Publisher
# Usage: .\scripts\publish-release.ps1

$ErrorActionPreference = 'Stop'
$repo = "poreddy_microsoft/taskdock"

# Read version from tauri.conf.json
$tauriConf = Get-Content "src-tauri/tauri.conf.json" | ConvertFrom-Json
$version = $tauriConf.version
$tag = "v$version"

Write-Host "Building TaskDock $tag..." -ForegroundColor Cyan

# Verify signing key exists
$keyFile = "$env:USERPROFILE\.tauri\taskdock.key"
if (-not (Test-Path $keyFile)) {
    Write-Error "Signing key not found at $keyFile"
    exit 1
}

# Locate NSIS installer for current version
$bundle  = "src-tauri/target/release/bundle"
$nsis    = (Get-ChildItem "$bundle/nsis/*_${version}_*.exe" | Select-Object -First 1).FullName
$msi     = (Get-ChildItem "$bundle/msi/*_${version}_*.msi"  | Select-Object -First 1).FullName

# Build only if installers not already present for this version
if (-not $nsis) {
    Write-Host "Building renderer..." -ForegroundColor Gray
    npm run build:renderer

    Write-Host "Building sidecar..." -ForegroundColor Gray
    npm run build:sidecar

    Write-Host "Building Tauri app (this takes a few minutes)..." -ForegroundColor Gray
    $configFile = "$env:TEMP\tauri-build-config.json"
    '{"build":{"beforeBuildCommand":""}}' | Set-Content $configFile -Encoding UTF8
    npx @tauri-apps/cli build --bundles nsis,msi --config $configFile
    Remove-Item $configFile -Force -ErrorAction SilentlyContinue

    $nsis = (Get-ChildItem "$bundle/nsis/*_${version}_*.exe" | Select-Object -First 1).FullName
    $msi  = (Get-ChildItem "$bundle/msi/*_${version}_*.msi"  | Select-Object -First 1).FullName
} else {
    Write-Host "Installers already built for $version, skipping build." -ForegroundColor Gray
}

if (-not $nsis) {
    Write-Error "NSIS installer not found. Build failed."
    exit 1
}

# Sign the NSIS installer with tauri signer sign
Write-Host "Signing installer..." -ForegroundColor Gray

# Resolve password from env, then prompt if not set
$signingPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
if (-not $signingPassword) {
    $signingPassword = [System.Environment]::GetEnvironmentVariable("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "User")
}
if (-not $signingPassword) {
    $signingPassword = Read-Host "Enter signing key password (leave blank if none)" -AsSecureString
    $signingPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($signingPassword))
}

$env:TAURI_SIGNING_PRIVATE_KEY_PATH = $keyFile
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $signingPassword
npx @tauri-apps/cli signer sign "$nsis"

$sigFile = "$nsis.sig"
if (-not (Test-Path $sigFile)) {
    Write-Error "Signature file not created at $sigFile"
    exit 1
}

# Build latest.json
Write-Host "Generating latest.json..." -ForegroundColor Gray
$sig = (Get-Content $sigFile -Raw).Trim()
$nsisName = Split-Path $nsis -Leaf
$jsonObj = [ordered]@{
    version   = $version
    notes     = "See the release page for details."
    pub_date  = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $sig
            url       = "https://github.com/$repo/releases/download/$tag/$nsisName"
        }
    }
}
$json = "$bundle\latest.json"
$jsonObj | ConvertTo-Json -Depth 5 | Set-Content $json -Encoding UTF8
Write-Host "Generated latest.json" -ForegroundColor Gray

# Publish to GitHub
Write-Host "Publishing $tag to GitHub..." -ForegroundColor Cyan

gh release delete $tag -R $repo --yes 2>$null
git tag -d $tag 2>$null
git push origin ":refs/tags/$tag" 2>$null

git tag $tag
git push origin $tag

gh release create $tag `
    --repo $repo `
    --title "TaskDock $tag" `
    --generate-notes `
    "$nsis" "$msi" "$json"

Write-Host ""
Write-Host "TaskDock $tag released!" -ForegroundColor Green
Write-Host "https://github.com/$repo/releases/tag/$tag"
