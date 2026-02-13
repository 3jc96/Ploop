# How to Start the Ploop Backend Server

## Quick Start

1. **Navigate to backend directory**:
   ```bash
   cd /Users/joelchu/quantum-webscraper/Ploop/backend
   ```

2. **Start the server**:
   ```bash
   npm run dev
   ```

3. **You should see**:
   ```
   [DB] Connection OK
   🚽 Ploop API server running on port 8082
   Environment: development
   ```

4. **Test it** (in a new terminal):
   ```bash
   curl http://localhost:8082/health
   ```
   Should return: `{"status":"ok","timestamp":"..."}`

## Important Notes

- The backend API is **not a website** - it's a REST API
- You **cannot** access it directly in a web browser at `http://localhost:8082`
- The API is meant to be accessed by:
  - The mobile app (React Native)
  - API testing tools (curl, Postman, etc.)
  - Command line tools

## Accessing the API

### From Terminal (curl):
```bash
# Health check
curl http://localhost:8082/health

# Get nearby toilets
curl "http://localhost:8082/api/toilets?latitude=37.7749&longitude=-122.4194&radius=1000"
```

### From Browser:
- You can test `http://localhost:8082/health` - it should show JSON
- Most other endpoints require POST requests with JSON bodies
- For full API testing, use Postman or the mobile app

## Troubleshooting

**Port 8082 already in use?**
```bash
# Find what's using port 8082
lsof -ti:8082

# Kill it (replace PID with actual process ID)
kill -9 <PID>
```

**Server won't start?**
- Make sure you're in the `backend` directory
- Make sure dependencies are installed: `npm install`
- Check that PostgreSQL is running: `brew services list | grep postgresql`

**Connection refused?**
- Make sure the server is actually running (check with `ps aux | grep ts-node`)
- Make sure you're using the correct port (8082)
- Check the server logs in the terminal where you ran `npm run dev`

**Database unreachable?**
- The backend verifies DB connection on startup. If you see `[DB] Connection attempt X/5 failed`:
  - Ensure PostgreSQL is running: `brew services list | grep postgresql`
  - Check `backend/.env` has correct DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
  - Run `./setup_database.sh` from the Ploop folder if you haven't set up the database yet

## Next Steps

Once the server is running:
1. The mobile app can connect to it (configure API URL in `mobile/src/config/api.ts`)
2. You can test API endpoints with curl or Postman
3. The server will auto-reload when you make code changes


