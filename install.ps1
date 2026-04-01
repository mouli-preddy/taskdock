# TaskDock Installer
# Usage: irm https://raw.githubusercontent.com/poreddy_microsoft/taskdock/main/install.ps1 | iex

$ErrorActionPreference = 'Stop'
$repo = "mouli-preddy/taskdock"

Write-Host "Fetching latest TaskDock release..." -ForegroundColor Cyan

# Get latest release info from GitHub API
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
$version = $release.tag_name

# Find the NSIS installer asset
$asset = $release.assets | Where-Object { $_.name -like "*x64-setup.exe" } | Select-Object -First 1

if (-not $asset) {
    Write-Error "Could not find installer in release $version"
    exit 1
}

$installerUrl = $asset.browser_download_url
$installerPath = "$env:TEMP\TaskDock-$version-setup.exe"

Write-Host "Downloading TaskDock $version..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

Write-Host "Installing TaskDock $version..." -ForegroundColor Cyan
Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait

Remove-Item $installerPath -Force

Write-Host "TaskDock $version installed successfully!" -ForegroundColor Green
