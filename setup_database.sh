#!/bin/bash

# Setup script for Ploop database
# This script installs PostgreSQL if needed and sets up the database

set -e

echo "🚀 Setting up Ploop database..."

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo "📦 PostgreSQL not found. Installing via Homebrew..."
    brew install postgresql@17 postgis
    
    echo "🔧 Starting PostgreSQL service..."
    brew services start postgresql@17
    
    # Add to PATH for current session
    export PATH="/usr/local/opt/postgresql@17/bin:$PATH"
    
    # Add to ~/.zshrc for future sessions
    if ! grep -q "postgresql@17/bin" ~/.zshrc 2>/dev/null; then
        echo 'export PATH="/usr/local/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc
        echo "✅ Added PostgreSQL to PATH in ~/.zshrc"
    fi
else
    echo "✅ PostgreSQL is already installed"
fi

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Create database
echo "🗄️  Creating database 'ploop'..."
createdb ploop 2>/dev/null || echo "⚠️  Database 'ploop' may already exist"

# Enable PostGIS
echo "📍 Enabling PostGIS extension..."
psql ploop -c "CREATE EXTENSION IF NOT EXISTS postgis;" || {
    echo "❌ Failed to enable PostGIS. Make sure PostgreSQL is running."
    echo "   Try: brew services start postgresql@17"
    exit 1
}

# Run schema
echo "📋 Running database schema..."
cd database
psql ploop -f schema.sql || {
    echo "❌ Failed to run schema.sql"
    exit 1
}
cd ..

echo "✅ Database setup complete!"
echo ""
echo "Next steps:"
echo "1. cd backend"
echo "2. npm install"
echo "3. cp env.example .env"
echo "4. Edit .env with your database credentials"
echo "5. npm run dev"

