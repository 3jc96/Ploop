/**
 * Map coordinate/zoom utilities for Google Maps and Amap compatibility.
 */

/** Convert longitudeDelta to zoom level (Google/Amap style). */
export function longitudeDeltaToZoom(longitudeDelta: number): number {
  if (longitudeDelta <= 0) return 21;
  const zoom = Math.log2(360 / longitudeDelta);
  return Math.max(2, Math.min(21, zoom));
}

/** Convert zoom level to longitudeDelta. */
export function zoomToLongitudeDelta(zoom: number): number {
  return 360 / Math.pow(2, Math.max(2, Math.min(21, zoom)));
}
