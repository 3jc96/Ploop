/**
 * Types for native POI click events
 */

export interface PoiClickEvent {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  types?: string[];
}

export interface PoiClickManager {
  /**
   * Enable POI click detection on the map
   */
  enablePoiClicks(mapRef: any): void;

  /**
   * Disable POI click detection
   */
  disablePoiClicks(): void;

  /**
   * Add event listener for POI clicks
   */
  addPoiClickListener(callback: (event: PoiClickEvent) => void): () => void;
}


