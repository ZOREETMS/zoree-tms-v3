# RTK (Rust Token Killer) one-shot installer for Windows + Claude Code
# Run:  powershell -ExecutionPolicy Bypass -File .\setup-rtk.ps1
$ErrorActionPreference = "Stop"

$dest = "$env:USERPROFILE\.local\bin"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# 1. Download latest Windows release
$zip = "$env:TEMP\rtk-win.zip"
Write-Host "Downloading rtk (latest release)..."
Invoke-WebRequest -Uri "https://github.com/rtk-ai/rtk/releases/latest/download/rtk-x86_64-pc-windows-msvc.zip" -OutFile $zip

# 2. Extract rtk.exe to ~/.local/bin
Write-Host "Extracting to $dest ..."
Expand-Archive -Path $zip -DestinationPath "$env:TEMP\rtk-win" -Force
Get-ChildItem "$env:TEMP\rtk-win" -Recurse -Filter rtk.exe | Select-Object -First 1 | Copy-Item -Destination "$dest\rtk.exe" -Force
Remove-Item $zip -Force
Remove-Item "$env:TEMP\rtk-win" -Recurse -Force

# 3. Add to user PATH if missing
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$dest*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$dest", "User")
    Write-Host "Added $dest to user PATH."
}
$env:Path = "$env:Path;$dest"

# 4. Install ripgrep if missing (rtk uses it for some filters)
if (-not (Get-Command rg -ErrorAction SilentlyContinue)) {
    Write-Host "Installing ripgrep..."
    try { winget install --id BurntSushi.ripgrep.MSVC -e --accept-source-agreements --accept-package-agreements } catch { Write-Warning "ripgrep install skipped: $_" }
}

# 5. Install the Claude Code hook (non-interactive)
Write-Host "Installing Claude Code hook..."
& "$dest\rtk.exe" init -g --auto-patch

# 6. Verify
& "$dest\rtk.exe" --version
Write-Host ""
Write-Host "Done. Restart Claude Code, then run 'rtk gain' anytime to see savings." -ForegroundColor Green
