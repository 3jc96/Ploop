/**
 * Unified map component – switches between Google Maps and Amap (Gaode) based on region.
 * Use in China for Amap; elsewhere for Google Maps.
 * Falls back to Google when Amap native module is unavailable (Expo Go, etc.).
 */
import React, { forwardRef } from 'react';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useMapProvider } from '../context/MapProviderContext';
import AmapMapView, { AmapMarker, AmapPolyline, type PloopMapRef } from './AmapMapView';
import { AmapErrorBoundary } from './AmapErrorBoundary';

export type { PloopMapRef };

/** Adapter: renders Marker for current provider. */
export function PloopMarker(props: {
  coordinate: { latitude: number; longitude: number };
  title?: string;
  description?: string;
  tracksViewChanges?: boolean;
  pinColor?: string;
  onPress?: (e: any) => void;
  children?: React.ReactNode;
}) {
  const { provider } = useMapProvider();
  if (provider === 'amap') {
    return (
      <AmapMarker
        position={props.coordinate}
        title={props.title}
        snippet={props.description}
        onMarkerPress={props.onPress ? (e) => props.onPress?.({ ...e, stopPropagation: () => {} }) : undefined}
      >
        {props.children}
      </AmapMarker>
    );
  }
  return (
    <Marker
      coordinate={props.coordinate}
      title={props.title}
      description={props.description}
      tracksViewChanges={props.tracksViewChanges}
      pinColor={props.pinColor}
      onPress={props.onPress}
    >
      {props.children}
    </Marker>
  );
}

/** Adapter: renders Polyline for current provider. */
export function PloopPolyline(props: {
  coordinates: Array<{ latitude: number; longitude: number }>;
  strokeColor?: string;
  strokeWidth?: number;
}) {
  const { provider } = useMapProvider();
  if (provider === 'amap') {
    return (
      <AmapPolyline
        points={props.coordinates}
        strokeColor={props.strokeColor}
        strokeWidth={props.strokeWidth}
      />
    );
  }
  return (
    <Polyline
      coordinates={props.coordinates}
      strokeColor={props.strokeColor}
      strokeWidth={props.strokeWidth}
    />
  );
}

interface PloopMapViewProps {
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
  showsMyLocationButton?: boolean;
  mapType?: string;
  pitchEnabled?: boolean;
  rotateEnabled?: boolean;
  scrollEnabled?: boolean;
  zoomEnabled?: boolean;
  toolbarEnabled?: boolean;
  zoomControlEnabled?: boolean;
  onMapReady?: () => void;
  onRegionChangeComplete?: (region: any) => void;
  onPanDrag?: () => void;
  onPoiClick?: (e: any) => void;
  onPress?: (e: any) => void;
  children?: React.ReactNode;
}

const GoogleMapView = forwardRef<any, PloopMapViewProps>(function GoogleMapView(props, ref) {
  return (
    <MapView
      ref={ref}
      provider={PROVIDER_GOOGLE}
      style={props.style}
      initialRegion={props.initialRegion}
      region={props.region}
      showsUserLocation={props.showsUserLocation}
      showsMyLocationButton={props.showsMyLocationButton}
      mapType={props.mapType as any}
      pitchEnabled={props.pitchEnabled}
      rotateEnabled={props.rotateEnabled}
      scrollEnabled={props.scrollEnabled}
      zoomEnabled={props.zoomEnabled}
      toolbarEnabled={props.toolbarEnabled as any}
      zoomControlEnabled={props.zoomControlEnabled as any}
      onMapReady={props.onMapReady}
      onRegionChangeComplete={props.onRegionChangeComplete}
      onPanDrag={props.onPanDrag}
      onPoiClick={props.onPoiClick}
      onPress={props.onPress}
    >
      {props.children}
    </MapView>
  );
});

const PloopMapView = forwardRef<PloopMapRef, PloopMapViewProps>(function PloopMapView(props, ref) {
  const { provider } = useMapProvider();

  const googleFallback = (
    <GoogleMapView
      ref={ref as any}
      {...props}
    />
  );

  if (provider === 'amap') {
    return (
      <AmapErrorBoundary
        fallback={googleFallback}
      >
        <AmapMapView
          ref={ref}
          style={props.style}
          initialRegion={props.initialRegion}
          region={props.region}
          showsUserLocation={props.showsUserLocation}
          onMapReady={props.onMapReady}
          onRegionChangeComplete={props.onRegionChangeComplete}
          onPanDrag={props.onPanDrag}
          onPoiClick={props.onPoiClick}
          onPress={props.onPress}
          scrollEnabled={props.scrollEnabled}
          zoomEnabled={props.zoomEnabled}
          pitchEnabled={props.pitchEnabled}
          rotateEnabled={props.rotateEnabled}
        >
          {props.children}
        </AmapMapView>
      </AmapErrorBoundary>
    );
  }

  return googleFallback;
});

export default PloopMapView;
