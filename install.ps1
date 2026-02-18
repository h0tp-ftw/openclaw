# OpenClaw Windows Installer (Fork)

Write-Host "🚀 Installing OpenClaw (Fork Edition)..." -ForegroundColor Cyan

# Check for Git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "Git is not installed. Please install Git for Windows first."
    exit 1
}

# Check for PNPM
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Warning "pnpm not found. Installing via npm..."
    npm install -g pnpm
}

# Configure Upstream Remote
Write-Host "🔗 Configuring upstream remote..." -ForegroundColor Yellow
git remote add upstream https://github.com/openclaw/openclaw.git 2>$null
git fetch upstream

# Install & Build
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
pnpm install

Write-Host "🔨 Building project..." -ForegroundColor Yellow
pnpm build

# Setup Alias
$aliasCommand = 'function update-openclaw { git fetch upstream; git merge -X ours upstream/main -m "merge: sync"; pnpm i; pnpm build }'
$profilePath = $PROFILE

if (-not (Test-Path $profilePath)) {
    New-Item -Type File -Path $profilePath -Force | Out-Null
}

$content = Get-Content $profilePath -ErrorAction SilentlyContinue
if ($content -notmatch "function update-openclaw") {
    Write-Host "⚡ Adding 'update-openclaw' alias to User Profile..." -ForegroundColor Green
    Add-Content -Path $profilePath -Value "`n# OpenClaw Updater"
    Add-Content -Path $profilePath -Value $aliasCommand
    Write-Host "✅ Alias added! Restart your terminal or run: . `$PROFILE" -ForegroundColor Green
} else {
    Write-Host "✅ 'update-openclaw' alias already exists." -ForegroundColor Green
}

Write-Host "`n🎉 Installation Complete!" -ForegroundColor Cyan
Write-Host "To start OpenClaw: pnpm start"
Write-Host "To update later:   update-openclaw"
