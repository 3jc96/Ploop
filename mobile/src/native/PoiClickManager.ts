/**
 * Native POI Click Manager
 * 
 * This module bridges native Google Maps SDK POI click events to React Native.
 * It provides true POI click detection, matching the native Google Maps app experience.
 */

import { NativeModules, NativeEventEmitter, findNodeHandle } from 'react-native';
import { PoiClickEvent } from './PoiClickTypes';

// Native module names (will be created in native code)
const PoiClickModule = NativeModules.PoiClickManager || null;
const eventEmitter = PoiClickModule ? new NativeEventEmitter(PoiClickModule) : null;

class PoiClickManagerImpl {
  private listeners: Array<(event: PoiClickEvent) => void> = [];
  private subscription: any = null;

  /**
   * Check if native POI click support is available
   */
  isAvailable(): boolean {
    return PoiClickModule !== null && eventEmitter !== null;
  }

  /**
   * Enable POI click detection on a map view
   * @param mapRef - Reference to the MapView component
   */
  enablePoiClicks(mapRef: any): void {
    if (!this.isAvailable()) {
      console.warn('Native POI click support not available. Falling back to coordinate-based detection.');
      return;
    }

    try {
      // Our native modules expect the React tag (node handle) for the MapView.
      // Using `findNodeHandle` is the most reliable approach across RN versions.
      const node = mapRef?.current ?? mapRef;
      const reactTag = findNodeHandle(node);

      if (typeof reactTag === 'number' && reactTag > 0) {
        PoiClickModule.enablePoiClicks(reactTag);
        this.setupEventListeners();
      } else {
        console.warn('Could not resolve MapView reactTag. POI clicks may not work.');
      }
    } catch (error) {
      console.error('Error enabling POI clicks:', error);
    }
  }

  /**
   * Disable POI click detection
   */
  disablePoiClicks(): void {
    if (!this.isAvailable()) {
      return;
    }

    try {
      PoiClickModule.disablePoiClicks();
      this.removeEventListeners();
    } catch (error) {
      console.error('Error disabling POI clicks:', error);
    }
  }

  /**
   * Add a listener for POI click events
   * @param callback - Function to call when a POI is clicked
   * @returns Unsubscribe function
   */
  addPoiClickListener(callback: (event: PoiClickEvent) => void): () => void {
    this.listeners.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Set up native event listeners
   */
  private setupEventListeners(): void {
    if (!eventEmitter) {
      return;
    }

    this.removeEventListeners();

    this.subscription = eventEmitter.addListener('onPoiClick', (event: PoiClickEvent) => {
      // Notify all registered listeners
      this.listeners.forEach(listener => {
        try {
          listener(event);
        } catch (error) {
          console.error('Error in POI click listener:', error);
        }
      });
    });
  }

  /**
   * Remove native event listeners
   */
  private removeEventListeners(): void {
    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }
  }
}

// Export singleton instance
export const PoiClickManager = new PoiClickManagerImpl();

// Export types
export type { PoiClickEvent };


