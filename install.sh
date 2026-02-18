#!/usr/bin/env bash

echo "🚀 Installing OpenClaw (Fork Edition)..."

# Determine Shell Profile
PROFILE_FILE="$HOME/.bashrc"
if [[ "$SHELL" == *"zsh"* ]]; then
    PROFILE_FILE="$HOME/.zshrc"
fi

# Configure Upstream Remote
echo "🔗 Configuring upstream remote..."
git remote add upstream https://github.com/openclaw/openclaw.git 2>/dev/null
git fetch upstream

# Install & Build
echo "📦 Installing dependencies..."
if ! command -v pnpm &> /dev/null; then
    echo "⚠️ pnpm not found. Installing via npm..."
    npm install -g pnpm
fi
pnpm install

echo "🔨 Building project..."
pnpm build

# Setup Alias
ALIAS_CMD="alias update-openclaw='git fetch upstream && git merge -X ours upstream/main -m \"merge: sync\" && pnpm i && pnpm build'"

if ! grep -q "alias update-openclaw" "$PROFILE_FILE"; then
    echo "⚡ Adding 'update-openclaw' alias to $PROFILE_FILE..."
    echo "" >> "$PROFILE_FILE"
    echo "# OpenClaw Updater" >> "$PROFILE_FILE"
    echo "$ALIAS_CMD" >> "$PROFILE_FILE"
    echo "✅ Alias added! Restart your terminal or run: source $PROFILE_FILE"
else
    echo "✅ 'update-openclaw' alias already exists."
fi

echo ""
echo "🎉 Installation Complete!"
echo "To start OpenClaw: pnpm start"
echo "To update later:   update-openclaw"
