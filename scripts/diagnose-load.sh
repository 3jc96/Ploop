#!/bin/bash
# Run load diagnostics to compare backend latency.
# Usage: ./scripts/diagnose-load.sh [API_URL]
# Default: https://ploop-api.onrender.com

API_URL="${1:-https://ploop-api.onrender.com}"

echo "=== Ploop Load Diagnostics ==="
echo "Backend: $API_URL"
echo ""

# Health check (lightweight)
echo "1. Health check:"
curl -w "   Time: %{time_total}s | HTTP: %{http_code}\n" -o /dev/null -s "$API_URL/health"

# Cold start: first request may wake Render; second is "warm"
echo ""
echo "2. First request (may include cold start):"
curl -w "   Time: %{time_total}s | HTTP: %{http_code}\n" -o /dev/null -s "$API_URL/api/toilets?latitude=37.7749&longitude=-122.4194&radius=1000&limit=10"

echo ""
echo "3. Second request (warm):"
curl -w "   Time: %{time_total}s | HTTP: %{http_code}\n" -o /dev/null -s "$API_URL/api/toilets?latitude=37.7749&longitude=-122.4194&radius=1000&limit=10"

echo ""
echo "4. Third request (warm):"
curl -w "   Time: %{time_total}s | HTTP: %{http_code}\n" -o /dev/null -s "$API_URL/api/toilets?latitude=37.7749&longitude=-122.4194&radius=1000&limit=10"

echo ""
echo "=== In-app diagnostics ==="
echo "Run the app in dev mode (npx expo start) on both iOS and Android."
echo "Check Metro/console for '[Ploop Load]' output, e.g.:"
echo "  [Ploop Load] android | total=4200ms | perm=120ms | loc=3500ms (currentPosition) | api=580ms | ✓"
echo "  [Ploop Load] ios     | total=1800ms | perm=80ms  | loc=200ms (lastKnown)       | api=520ms | ✓"
echo ""
echo "If Android loc >> iOS loc: location/GPS is slower on Android."
echo "If Android api >> iOS api: network or backend cold start."
echo "If both similar: device/network conditions differ."
