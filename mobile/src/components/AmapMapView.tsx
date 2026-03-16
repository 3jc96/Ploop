/**
 * Amap (Gaode) MapView wrapper – exposes react-native-maps–compatible API
 * for use when the user is in China.
 */
import React, { forwardRef, useImperativeHandle, useRef, useEffect } from 'react';
import { Platform } from 'react-native';
import { MapView as GaodeMapView, Marker as GaodeMarker, Polyline as GaodePolyline, ExpoGaodeMapModule } from 'expo-gaode-map';
import type { MapViewRef as GaodeMapViewRef } from 'expo-gaode-map';
import { longitudeDeltaToZoom } from '../utils/mapUtils';
import { useLanguage } from '../context/LanguageContext';

export interface PloopMapRef {
  getCamera(): Promise<{ center: { latitude: number; longitude: number }; zoom: number }>;
  animateCamera(
    camera: { center: { latitude: number; longitude: number }; zoom?: number },
    options?: { duration?: number }
  ): void;
  animateToRegion(
    region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number },
    duration?: number
  ): void;
  fitToCoordinates(
    coordinates: Array<{ latitude: number; longitude: number }>,
    options?: { edgePadding?: { top?: number; right?: number; bottom?: number; left?: number }; animated?: boolean }
  ): void;
}

export interface AmapMapViewProps {
  style?: any;
  initialRegion: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
  region?: {
    latitude: number;
    longitude: number;
    latitudeDelta?: number;
    longitudeDelta?: number;
  };
  showsUserLocation?: boolean;
  onMapReady?: () => void;
  onRegionChangeComplete?: (region: any) => void;
  onPanDrag?: () => void;
  onPoiClick?: (e: { nativeEvent: { coordinate?: { latitude: number; longitude: number }; placeId?: string; name?: string } }) => void;
  onPress?: (e: { nativeEvent: { coordinate?: { latitude: number; longitude: number } } }) => void;
  scrollEnabled?: boolean;
  zoomEnabled?: boolean;
  pitchEnabled?: boolean;
  rotateEnabled?: boolean;
  children?: React.ReactNode;
}

/** Initialize Gaode SDK once (privacy + init). Must run BEFORE first MapView render. */
let gaodeInitialized = false;
function ensureGaodeInit() {
  if (gaodeInitialized) return;
  try {
    ExpoGaodeMapModule.setPrivacyConfig?.({
      hasShow: true,
      hasContainsPrivacy: true,
      hasAgree: true,
      privacyVersion: '2026-03-13',
    });
    // Enable world/overseas map – required for Singapore, US, etc. Must be called before initSDK.
    // If tiles stay blank, your Gaode key may need 世界地图 enabled via Gaode support (工单).
    ExpoGaodeMapModule.setLoadWorldVectorMap?.(true);
    ExpoGaodeMapModule.initSDK?.({});
    gaodeInitialized = true;
  } catch {
    // ignore
  }
}

function useThrottledCallback(cb: () => void, ms: number) {
  const lastCall = useRef(0);
  return () => {
    const now = Date.now();
    if (now - lastCall.current >= ms) {
      lastCall.current = now;
      cb();
    }
  };
}

const AmapMapView = forwardRef<PloopMapRef, AmapMapViewProps>(function AmapMapView(props, ref) {
  const gaodeRef = useRef<GaodeMapViewRef | null>(null);
  const { locale } = useLanguage();

  // Must run BEFORE first render of GaodeMapView – SDK requires privacy config before any map usage
  ensureGaodeInit();

  // Set Gaode language to match app locale (reverse geocode + map display when supported)
  useEffect(() => {
    try {
      const setLang = ExpoGaodeMapModule.setGeoLanguage;
      if (!setLang) return;
      if (Platform.OS === 'ios') {
        // iOS: 0=default, 1=Chinese, 2=English
        (setLang as (lang: number) => void)(locale === 'en' ? 2 : 1);
      } else {
        // Android: "EN" | "ZH" | "DEFAULT"
        (setLang as (lang: string) => void)(locale === 'en' ? 'EN' : 'ZH');
      }
    } catch {
      // ignore if module doesn't support it
    }
  }, [locale]);

  // Throttle more aggressively for Gaode – reduces bridge traffic during pan
  const throttledOnPanDrag = useThrottledCallback(() => props.onPanDrag?.(), 300);

  const zoom = longitudeDeltaToZoom(props.initialRegion.longitudeDelta);
  const initialCamera = {
    target: { latitude: props.initialRegion.latitude, longitude: props.initialRegion.longitude },
    zoom,
  };

  useImperativeHandle(
    ref,
    () => ({
      async getCamera() {
        const pos = await gaodeRef.current?.getCameraPosition();
        if (!pos?.target) return { center: { latitude: 0, longitude: 0 }, zoom: 14 };
        return {
          center: { latitude: pos.target.latitude, longitude: pos.target.longitude },
          zoom: typeof pos.zoom === 'number' ? pos.zoom : 14,
        };
      },
      animateCamera(cam, opts) {
        const duration = opts?.duration ?? 300;
        gaodeRef.current?.moveCamera(
          {
            target: cam.center,
            zoom: cam.zoom ?? 14,
          },
          duration
        );
      },
      animateToRegion(region, duration = 300) {
        const z = longitudeDeltaToZoom(region.longitudeDelta);
        gaodeRef.current?.moveCamera(
          {
            target: { latitude: region.latitude, longitude: region.longitude },
            zoom: z,
          },
          duration
        );
      },
      fitToCoordinates(coords, opts) {
        if (!coords.length) return;
        const lats = coords.map((c) => c.latitude);
        const lngs = coords.map((c) => c.longitude);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        const pad = 1.4;
        const latDelta = (maxLat - minLat) * pad || 0.01;
        const lngDelta = (maxLng - minLng) * pad || 0.01;
        const center = {
          latitude: (minLat + maxLat) / 2,
          longitude: (minLng + maxLng) / 2,
        };
        const z = longitudeDeltaToZoom(Math.max(latDelta, lngDelta));
        gaodeRef.current?.moveCamera(
          { target: center, zoom: Math.max(10, Math.min(18, z - 0.5)) },
          opts?.animated !== false ? 400 : 0
        );
      },
    }),
    []
  );

  const region = props.region;
  const cameraTarget = region
    ? { latitude: region.latitude, longitude: region.longitude }
    : initialCamera.target;
  const cameraZoom = region?.latitudeDelta
    ? longitudeDeltaToZoom(region.longitudeDelta ?? region.latitudeDelta)
    : zoom;

  const mapLanguage = locale === 'en' ? 'en' : 'zh_cn';

  return (
    <GaodeMapView
      ref={gaodeRef}
      style={[{ flex: 1 }, props.style]}
      initialCameraPosition={initialCamera}
      mapLanguage={mapLanguage}
      myLocationEnabled={props.showsUserLocation ?? true}
      zoomGesturesEnabled={props.zoomEnabled !== false}
      scrollGesturesEnabled={props.scrollEnabled !== false}
      rotateGesturesEnabled={props.rotateEnabled ?? false}
      tiltGesturesEnabled={props.pitchEnabled ?? false}
      buildingsEnabled={false}
      indoorViewEnabled={false}
      zoomControlsEnabled={false}
      compassEnabled={false}
      scaleControlsEnabled={false}
      myLocationButtonEnabled={false}
      onLoad={props.onMapReady}
      onMapPress={(e) => {
        const ne = (e as any)?.nativeEvent;
        props.onPress?.({ nativeEvent: { coordinate: ne ? { latitude: ne.latitude, longitude: ne.longitude } : undefined } });
      }}
      onPressPoi={(e) => {
        const ne = (e as any)?.nativeEvent;
        props.onPoiClick?.({
          nativeEvent: {
            coordinate: ne ? { latitude: ne.latitude, longitude: ne.longitude } : undefined,
            placeId: ne?.id,
            name: ne?.name,
          },
        });
      }}
      onCameraIdle={(e) => {
        const ev = (e as any)?.nativeEvent;
        if (ev?.latLngBounds && props.onRegionChangeComplete) {
          const sw = ev.latLngBounds?.southwest ?? ev.latLngBounds?.southWest;
          const ne = ev.latLngBounds?.northeast ?? ev.latLngBounds?.northEast;
          if (sw && ne) {
            const latDelta = Math.abs((ne.latitude ?? ne.lat) - (sw.latitude ?? sw.lat));
            const lngDelta = Math.abs((ne.longitude ?? ne.lng) - (sw.longitude ?? sw.lng));
            const center = ev.cameraPosition?.target ?? { latitude: 0, longitude: 0 };
            props.onRegionChangeComplete({
              latitude: center.latitude,
              longitude: center.longitude,
              latitudeDelta: latDelta,
              longitudeDelta: lngDelta,
            });
          }
        }
      }}
      onCameraMove={(e) => {
        const ev = (e as any)?.nativeEvent;
        if (ev?.cameraPosition && props.onPanDrag) throttledOnPanDrag();
      }}
    >
      {props.children}
    </GaodeMapView>
  );
});

export default AmapMapView;
export { GaodeMarker as AmapMarker, GaodePolyline as AmapPolyline };
