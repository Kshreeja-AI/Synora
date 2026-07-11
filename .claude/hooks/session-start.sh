#!/usr/bin/env bash

echo "=================================="
echo "Starting Synora Development Session"
echo "=================================="

node --version
pnpm --version
git --version

echo ""

echo "Installing dependencies..."

pnpm install

echo ""

echo "Checking formatting..."

pnpm lint || true

echo ""

echo "Checking types..."

pnpm typecheck || true

echo ""

echo "Running tests..."

pnpm test || true

echo ""

echo "Building..."

pnpm build || true

echo ""

echo "Environment Ready."

echo "Claude Code may now begin."
