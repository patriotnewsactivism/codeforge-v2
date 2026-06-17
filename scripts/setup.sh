#!/usr/bin/env bash
set -euo pipefail

echo "🚀 CodeForge V2 — Setting up..."

# Check for Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js is required. Install it from https://nodejs.org"
  exit 1
fi

echo "✓ Node.js $(node -v)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm ci

# Set up environment
echo ""
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "✓ Created .env.local from .env.example"
  echo ""
  echo "⚠️  Edit .env.local and add your API keys:"
  echo "   - DEEPSEEK_API_KEY (or another AI key)"
  echo "   - RESEND_API_KEY (for auth emails)"
  echo ""
else
  echo "✓ .env.local already exists"
fi

# Start Convex dev server
echo ""
echo "🔧 Starting Convex dev server..."
echo "   This will initialize the Convex backend and watch for changes."
echo "   Press Ctrl+C to stop."
echo ""
npx convex dev
