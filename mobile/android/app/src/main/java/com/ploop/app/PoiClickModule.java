package com.ploop.app;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.OnMapReadyCallback;
import com.google.android.gms.maps.model.PointOfInterest;
import com.facebook.react.uimanager.NativeViewHierarchyManager;
import com.facebook.react.uimanager.UIBlock;
import com.facebook.react.uimanager.UIManagerModule;
import com.rnmaps.maps.MapView;

import android.view.View;
import android.view.ViewGroup;
import android.util.Log;

public class PoiClickModule extends ReactContextBaseJavaModule implements GoogleMap.OnPoiClickListener {

    private static ReactApplicationContext reactContext;
    private GoogleMap googleMap;
    private MapView reactMapView;
    private boolean poiClicksEnabled = false;

    PoiClickModule(ReactApplicationContext context) {
        super(context);
        reactContext = context;
    }

    @Override
    public String getName() {
        return "PoiClickManager";
    }

    @ReactMethod
    public void enablePoiClicks(final int reactTag) {
        Log.d("PoiClickModule", "enablePoiClicks called for reactTag: " + reactTag);
        UIManagerModule uiManager = reactContext.getNativeModule(UIManagerModule.class);
        if (uiManager != null) {
            uiManager.addUIBlock(new UIBlock() {
                @Override
                public void execute(NativeViewHierarchyManager nativeViewHierarchyManager) {
                    try {
                        View resolved = nativeViewHierarchyManager.resolveView(reactTag);
                        if (resolved instanceof MapView) {
                            reactMapView = (MapView) resolved;
                        } else {
                            reactMapView = findMapView(resolved);
                        }
                        if (reactMapView != null) {
                            reactMapView.getMapAsync(new OnMapReadyCallback() {
                                @Override
                                public void onMapReady(GoogleMap map) {
                                    googleMap = map;
                                    googleMap.setOnPoiClickListener(PoiClickModule.this);
                                    poiClicksEnabled = true;
                                    Log.d("PoiClickModule", "✅ Android Native POI clicks enabled.");
                                }
                            });
                        } else {
                            Log.e("PoiClickModule", "❌ React Native MapView not found for reactTag: " + reactTag);
                        }
                    } catch (Exception e) {
                        Log.e("PoiClickModule", "❌ Error enabling POI clicks: " + e.getMessage());
                    }
                }
            });
        } else {
            Log.e("PoiClickModule", "❌ UIManagerModule not found.");
        }
    }

    // Required for NativeEventEmitter support (prevents warnings and ensures subscription plumbing).
    @ReactMethod
    public void addListener(String eventName) {
        // no-op
    }

    @ReactMethod
    public void removeListeners(double count) {
        // no-op
    }

    @ReactMethod
    public void disablePoiClicks() {
        if (googleMap != null) {
            googleMap.setOnPoiClickListener(null);
            poiClicksEnabled = false;
            Log.d("PoiClickModule", "✅ Android Native POI clicks disabled.");
        }
    }

    @Override
    public void onPoiClick(PointOfInterest poi) {
        if (poiClicksEnabled) {
            Log.d("PoiClickModule", "📍 POI Tapped: " + poi.name + " (" + poi.placeId + ") at " + poi.latLng.latitude + ", " + poi.latLng.longitude);
            WritableMap params = Arguments.createMap();
            params.putDouble("latitude", poi.latLng.latitude);
            params.putDouble("longitude", poi.latLng.longitude);
            params.putString("placeId", poi.placeId);
            params.putString("name", poi.name);
            sendEvent("onPoiClick", params);
        }
    }

    private void sendEvent(String eventName, WritableMap params) {
        reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit(eventName, params);
    }

    private MapView findMapView(View root) {
        if (root == null) return null;
        if (root instanceof MapView) return (MapView) root;
        if (root instanceof ViewGroup) {
            ViewGroup vg = (ViewGroup) root;
            for (int i = 0; i < vg.getChildCount(); i++) {
                MapView mv = findMapView(vg.getChildAt(i));
                if (mv != null) return mv;
            }
        }
        return null;
    }
}
