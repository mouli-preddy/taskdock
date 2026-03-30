# TaskDock Local Release Publisher
# Usage: .\scripts\publish-release.ps1
# Builds the app, signs it, and publishes a GitHub release.

$ErrorActionPreference = 'Stop'
$repo = "poreddy_microsoft/taskdock"

# Read version from tauri.conf.json
$tauriConf = Get-Content "src-tauri/tauri.conf.json" | ConvertFrom-Json
$version = $tauriConf.version
$tag = "v$version"

Write-Host "Building TaskDock $tag..." -ForegroundColor Cyan

# Set signing key from local key file
$keyFile = "$env:USERPROFILE\.tauri\taskdock.key"
if (-not (Test-Path $keyFile)) {
    Write-Error "Signing key not found at $keyFile. Run: npm run tauri -- signer generate -w $keyFile"
    exit 1
}
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $keyFile -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""

# Build renderer and sidecar
Write-Host "Building renderer..." -ForegroundColor Gray
npm run build:renderer

Write-Host "Building sidecar..." -ForegroundColor Gray
npm run build:sidecar

# Build Tauri app (skip beforeBuildCommand since we already built above)
Write-Host "Building Tauri app (this takes a few minutes)..." -ForegroundColor Gray
npx @tauri-apps/cli build --bundles nsis,msi --config '{"build":{"beforeBuildCommand":""}}'

# Locate artifacts
$bundle = "src-tauri/target/release/bundle"
$nsis = (Get-ChildItem "$bundle/nsis/*.exe" | Select-Object -First 1).FullName
$msi  = (Get-ChildItem "$bundle/msi/*.msi"  | Select-Object -First 1).FullName
$json = (Get-ChildItem "$bundle" -Recurse -Filter "latest.json" | Select-Object -First 1).FullName

if (-not $nsis -or -not $json) {
    Write-Error "Could not locate build artifacts. Check that the build succeeded."
    exit 1
}

Write-Host "Publishing release $tag to GitHub..." -ForegroundColor Cyan

# Delete existing release/tag if re-publishing same version
gh release delete $tag -R $repo --yes 2>$null
git tag -d $tag 2>$null
git push origin ":refs/tags/$tag" 2>$null

# Create git tag and release
git tag $tag
git push origin $tag

gh release create $tag `
    --repo $repo `
    --title "TaskDock $tag" `
    --generate-notes `
    $nsis $msi $json

Write-Host ""
Write-Host "Released TaskDock $tag!" -ForegroundColor Green
Write-Host "https://github.com/$repo/releases/tag/$tag" -ForegroundColor Cyan
