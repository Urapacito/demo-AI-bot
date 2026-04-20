<#
start-dev.ps1
Automates local development setup for the Bubble Tea assistant.

Usage (PowerShell):
  1. Place filled `backend/.env` (copy from `backend/.env.example`).
  2. Open PowerShell as Administrator and run: .\start-dev.ps1

What it does:
- Verifies `backend/.env` exists and loads env values into the process
- Ensures Docker is available and starts Postgres + Redis containers if missing
- Installs backend npm deps, runs Prisma generate & db push, runs create_db helper
- Starts the backend in a new PowerShell window
- Starts `ngrok` in a new PowerShell window (if `ngrok` is installed)
- Attempts to register Telegram webhook automatically (if TELEGRAM env values present)
#>

Param(
    [switch]$SkipNgrok
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $root) { $root = Get-Location }

$backendEnv = Join-Path $root 'backend\.env'
if (-not (Test-Path $backendEnv)) {
    Write-Error "backend/.env not found. Copy backend/.env.example to backend/.env and fill values, then re-run this script."
    exit 1
}

# Parse .env into a hashtable and also set Process env vars
$envHash = @{}
Get-Content $backendEnv | ForEach-Object {
    $line = $_.Trim()
    if ($line -match '^[ \t]*#') { return }
    if ($line -eq '') { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 0) { return }
    $key = $line.Substring(0,$idx).Trim()
    $val = $line.Substring($idx+1).Trim()
    if ((($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'" ) -and $val.EndsWith("'")))) {
        $val = $val.Substring(1,$val.Length-2)
    }
    $envHash[$key] = $val
    [System.Environment]::SetEnvironmentVariable($key,$val,'Process')
}

function Ensure-Container($name, $image, $runArgs) {
    Write-Host "Ensuring container '$name'..."
    try {
        $exists = & docker ps -a --filter "name=^$name$" --format "{{.Names}}" 2>$null
    } catch {
        Write-Error "Docker CLI returned an error. Ensure Docker Desktop is installed and running."
        exit 1
    }
    if (-not $exists) {
        Write-Host "Creating and starting container $name..."
        & docker run --name $name $runArgs -d $image | Out-Null
        Start-Sleep -Seconds 2
    } else {
        $running = & docker ps --filter "name=^$name$" --format "{{.Names}}" 2>$null
        if (-not $running) {
            Write-Host "Starting existing container $name..."
            & docker start $name | Out-Null
            Start-Sleep -Seconds 1
        } else {
            Write-Host "Container $name is already running."
        }
    }
}

Write-Host "Checking Docker..."
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker CLI not found. Please install Docker Desktop and re-run this script."
    exit 1
}

# Ensure Postgres and Redis run
Ensure-Container 'demo-postgres' 'postgres:15' "-e POSTGRES_USER=demo -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=demo -p 55432:5432"
Ensure-Container 'demo-redis' 'redis:7' "-p 6379:6379"

# Install backend deps and prepare database
$backendPath = Join-Path $root 'backend'
Write-Host "Installing backend dependencies..."
Push-Location $backendPath
try {
    npm install
} catch {
    Write-Warning "npm install failed. Please check npm logs and try running 'npm install' manually inside backend/."
}

Write-Host "Generating Prisma client and pushing schema..."
try {
    npx prisma generate
    npx prisma db push --accept-data-loss
} catch {
    Write-Warning "Prisma commands failed. Ensure DATABASE_URL in backend/.env is correct and Postgres is reachable."
}

if (Test-Path "scripts/create_db.js") {
    Write-Host "Running scripts/create_db.js..."
    try { node scripts/create_db.js } catch { Write-Warning "create_db.js failed: $_" }
}

Write-Host "Starting backend in a new PowerShell window (development mode)..."
$backendCmd = "cd '$backendPath'; npm run start"
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit","-Command",$backendCmd -WorkingDirectory $backendPath

# Start ngrok (if requested and available)
$ngrokUrl = $null
function Ensure-Ngrok {
    param([switch]$ForceDownload)

    # Return existing ngrok in PATH if available
    $cmd = Get-Command ngrok -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $toolsDir = Join-Path $root 'tools\ngrok'
    $exePath = Join-Path $toolsDir 'ngrok.exe'
    if (Test-Path $exePath -and -not $ForceDownload) { return $exePath }

    $archLower = ($env:PROCESSOR_ARCHITECTURE ?? '').ToLower()
    switch ($archLower) {
        'amd64' { $arch = 'amd64' }
        'x86'   { $arch = '386' }
        'arm64' { $arch = 'arm64' }
        default { $arch = 'amd64' }
    }

    $zipUrl = "https://bin.equinox.io/c/4VmDzA7iaHb/ngrok-stable-windows-$arch.zip"
    Write-Host "Downloading ngrok ($arch) from $zipUrl ..."
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
    $zipPath = Join-Path $toolsDir 'ngrok.zip'
    try {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -ErrorAction Stop
        Expand-Archive -Path $zipPath -DestinationPath $toolsDir -Force
        Remove-Item $zipPath -Force
    } catch {
        Write-Warning "Failed to download or extract ngrok: $_"
        return $null
    }

    if (Test-Path $exePath) {
        # Add to PATH for this process so Start-Process children inherit it
        $env:Path = $toolsDir + ';' + $env:Path
        Write-Host "ngrok downloaded to $exePath"
        return $exePath
    } else {
        Write-Warning "ngrok download did not produce expected exe at $exePath"
        return $null
    }
}

if (-not $SkipNgrok) {
    $ngrokExe = Ensure-Ngrok
    if (-not $ngrokExe) {
        Write-Warning "ngrok not available — automatic webhook registration won't run."
    } else {
        Write-Host "Starting ngrok in a new PowerShell window..."
        $ngrokCmd = "& '$ngrokExe' http 3001 --host-header=localhost"
        Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit","-Command",$ngrokCmd -WorkingDirectory $root
        Write-Host "Waiting up to 30s for ngrok to report a public URL (tries ports 4040,4041,4042)..."
        $found = $false
        for ($i=0; $i -lt 30; $i++) {
            Start-Sleep -Seconds 1
            foreach ($port in @(4040,4041,4042)) {
                try {
                    $tunnels = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/tunnels" -ErrorAction Stop
                    if ($tunnels -and $tunnels.tunnels.Count -gt 0) {
                        $ngrokUrl = $tunnels.tunnels[0].public_url
                        $found = $true
                        break
                    }
                } catch { }
            }
            if ($found) { break }
        }
        if (-not $ngrokUrl) { Write-Warning "ngrok did not report a public URL within timeout. You can still set the webhook manually later." }
        else { Write-Host "ngrok public URL: $ngrokUrl" }
    }
}

# Set Telegram webhook if possible
if ($ngrokUrl -and $envHash.ContainsKey('TELEGRAM_BOT_TOKEN') -and $envHash.ContainsKey('TELEGRAM_WEBHOOK_SECRET')) {
    Write-Host "Registering Telegram webhook..."
    $token = $envHash['TELEGRAM_BOT_TOKEN']
    $secret = $envHash['TELEGRAM_WEBHOOK_SECRET']
    $setUrl = "https://api.telegram.org/bot$token/setWebhook?url=$ngrokUrl/telegram/webhook&secret_token=$secret"
    try {
        $resp = Invoke-RestMethod -Uri $setUrl -Method Get -ErrorAction Stop
        Write-Host "Telegram setWebhook response: $($resp | ConvertTo-Json -Depth 2)"
    } catch {
        Write-Warning "Failed to set Telegram webhook: $_"
    }
} else {
    Write-Warning "Automatic Telegram webhook registration skipped (missing ngrok or TELEGRAM values in backend/.env)."
}

Pop-Location

Write-Host "`nFinished. Backend started, ngrok started (if available), and webhook registered (if possible)."
Write-Host "To test: message your bot on Telegram or run the local test from README. To simulate PayOS webhook: run backend\scripts\send-webhook-test.js"

exit 0
