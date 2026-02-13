# Fix: PostGIS Version Mismatch

## The Issue
PostGIS was installed for PostgreSQL@17/18, but the setup script was trying to use PostgreSQL@14.

## Solution: Use PostgreSQL@17

Since PostgreSQL@17 is already installed and PostGIS supports it, we'll use that instead.

### Steps:

1. **Stop PostgreSQL@14 and start PostgreSQL@17**:
   ```bash
   brew services stop postgresql@14
   brew services start postgresql@17
   ```

2. **Update your PATH** (add to ~/.zshrc):
   ```bash
   echo 'export PATH="/usr/local/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc
   source ~/.zshrc
   ```

3. **Now run the database setup**:
   ```bash
   cd /Users/joelchu/quantum-webscraper/Ploop
   createdb ploop
   psql ploop -c "CREATE EXTENSION IF NOT EXISTS postgis;"
   cd database
   psql ploop -f schema.sql
   cd ..
   ```

### Why PostgreSQL@17?
- Already installed on your system
- PostGIS 3.6.1 supports it (files exist)
- Newer version = better performance and features
- Will be supported longer

### Alternative: Use PostgreSQL@14
If you really need PostgreSQL@14, you would need to:
1. Install an older PostGIS version that supports PostgreSQL@14
2. Or compile PostGIS from source for PostgreSQL@14

This is more complex and not recommended unless you have a specific requirement.


