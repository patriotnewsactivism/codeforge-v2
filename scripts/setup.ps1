# CodeForge V2 Setup — Windows PowerShell
Write-Host "🚀 CodeForge V2 — Setting up..." -ForegroundColor Cyan

# Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "❌ Node.js is required. Install from https://nodejs.org" -ForegroundColor Red
  exit 1
}
Write-Host "✓ Node.js $(node -v)"

# Install dependencies
Write-Host ""
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
npm ci

# Setup environment
Write-Host ""
if (-not (Test-Path .env.local)) {
  Copy-Item .env.example .env.local
  Write-Host "✓ Created .env.local from .env.example" -ForegroundColor Green
  Write-Host ""
  Write-Host "⚠️  Edit .env.local and add your API keys:" -ForegroundColor Yellow
  Write-Host "   - DEEPSEEK_API_KEY (or another AI key)"
  Write-Host "   - RESEND_API_KEY (for auth emails)"
} else {
  Write-Host "✓ .env.local already exists" -ForegroundColor Green
}

# Start Convex dev
Write-Host ""
Write-Host "🔧 Starting Convex dev server..." -ForegroundColor Yellow
Write-Host "   Press Ctrl+C to stop."
Write-Host ""
npx convex dev
