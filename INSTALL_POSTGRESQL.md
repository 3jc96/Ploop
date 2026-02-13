# Installing PostgreSQL and PostGIS on macOS

Since PostgreSQL is not installed, here's how to install it:

## Option 1: Using Homebrew (Recommended)

1. **Install PostgreSQL and PostGIS**:
   ```bash
   brew install postgresql@14 postgis
   ```

2. **Start PostgreSQL service**:
   ```bash
   brew services start postgresql@14
   ```

3. **Add PostgreSQL to your PATH** (add to `~/.zshrc`):
   ```bash
   echo 'export PATH="/usr/local/opt/postgresql@14/bin:$PATH"' >> ~/.zshrc
   source ~/.zshrc
   ```

   Or if you're using Apple Silicon (M1/M2 Mac):
   ```bash
   echo 'export PATH="/opt/homebrew/opt/postgresql@14/bin:$PATH"' >> ~/.zshrc
   source ~/.zshrc
   ```

4. **Verify installation**:
   ```bash
   psql --version
   createdb --version
   ```

## Option 2: Using Postgres.app (Easier GUI Option)

1. **Download Postgres.app**: https://postgresapp.com/
2. **Install and open** the app
3. **Initialize** a new server (click "Initialize")
4. **Add to PATH** - The app will prompt you, or run:
   ```bash
   sudo mkdir -p /etc/paths.d &&
   echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp
   ```
5. **Restart your terminal** or run:
   ```bash
   source ~/.zshrc
   ```

## After Installation

Once PostgreSQL is installed, you can proceed with the database setup:

```bash
# Create database
createdb ploop

# Enable PostGIS
psql ploop -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# Run schema (from Ploop directory)
cd /Users/joelchu/quantum-webscraper/Ploop
cd database
psql ploop -f schema.sql
cd ..
```

## Troubleshooting

**If `psql` still not found after installation:**
- Make sure you've added it to PATH (see steps above)
- Restart your terminal
- Try the full path: `/usr/local/opt/postgresql@14/bin/psql` (or `/opt/homebrew/opt/postgresql@14/bin/psql` on Apple Silicon)

**If PostgreSQL service won't start:**
```bash
# Check if it's already running
brew services list

# Try starting it manually
pg_ctl -D /usr/local/var/postgresql@14 start
```


