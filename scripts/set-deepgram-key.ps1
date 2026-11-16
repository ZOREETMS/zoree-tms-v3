# Prompts for the Deepgram API key without echoing it and saves it to api/.env
# as DEEPGRAM_API_KEY (replacing any existing value). The key never leaves this machine.
$envFile = Join-Path $PSScriptRoot "..\api\.env"
$secure = Read-Host "Paste your Deepgram API key (input is hidden)" -AsSecureString
$key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
if (-not $key) { Write-Host "No key entered - nothing changed."; Read-Host "Press Enter to close"; exit 1 }
$lines = @()
if (Test-Path $envFile) { $lines = Get-Content $envFile | Where-Object { $_ -notmatch '^\s*DEEPGRAM_API_KEY\s*=' } }
$lines += "DEEPGRAM_API_KEY=$key"
# UTF-8 without BOM: a BOM would corrupt the first variable name for dotenv.
[IO.File]::WriteAllLines((Resolve-Path $envFile), [string[]]$lines, (New-Object Text.UTF8Encoding $false))
Write-Host ""
Write-Host "Saved DEEPGRAM_API_KEY to api\.env (ends in ...$($key.Substring([Math]::Max(0,$key.Length-4))))."
Read-Host "Press Enter to close"
