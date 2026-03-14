import Foundation
import React
import GoogleMaps

// Proxy that allows us to observe POI taps without breaking react-native-maps' delegate.
// GMSMapView only supports a single delegate, so we forward everything to the original delegate
// while also handling didTapPOI.
final class PoiClickDelegateProxy: NSObject, GMSMapViewDelegate {
    weak var primary: GMSMapViewDelegate?
    weak var poiManager: PoiClickManager?

    init(primary: GMSMapViewDelegate?, poiManager: PoiClickManager) {
        self.primary = primary
        self.poiManager = poiManager
        super.init()
    }

    override func responds(to aSelector: Selector!) -> Bool {
        if super.responds(to: aSelector) { return true }
        return (primary as AnyObject?)?.responds(to: aSelector) ?? false
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        // Forward any unimplemented delegate methods to the original delegate (react-native-maps).
        if super.responds(to: aSelector) { return self }
        return primary
    }

    func mapView(_ mapView: GMSMapView, didTapPOIWithPlaceID placeID: String, name: String, location: CLLocationCoordinate2D) {
        poiManager?.handlePoiTap(placeID: placeID, name: name, location: location)
        // Also forward to the original delegate if it implements this method (so RN props keep working).
        primary?.mapView?(mapView, didTapPOIWithPlaceID: placeID, name: name, location: location)
    }
}

@objc(PoiClickManager)
class PoiClickManager: RCTEventEmitter, GMSMapViewDelegate {

    private var mapView: GMSMapView?
    private var delegateProxy: PoiClickDelegateProxy?
    private var hasListeners = false

    override init() {
        super.init()
    }

    override static func requiresMainQueueSetup() -> Bool {
        return true
    }

    override func supportedEvents() -> [String]! {
        return ["onPoiClick"]
    }

    override func startObserving() {
        hasListeners = true
    }

    override func stopObserving() {
        hasListeners = false
    }

    @objc(enablePoiClicks:)
    func enablePoiClicks(reactTag: NSNumber) {
        DispatchQueue.main.async {
            guard let bridge = self.bridge else {
                print("❌ PoiClickManager: bridge not ready")
                return
            }

            if let view = bridge.uiManager.view(forReactTag: reactTag) {
                // Find GMSMapView within the React Native MapView
                if let mapView = self.findGMSMapView(in: view) {
                    self.mapView = mapView
                    // Keep react-native-maps delegate intact; observe POI taps via a proxy.
                    let existing = mapView.delegate
                    let proxy = PoiClickDelegateProxy(primary: existing, poiManager: self)
                    self.delegateProxy = proxy
                    mapView.delegate = proxy
                    self.mapView?.isBuildingsEnabled = true // Ensure POIs are visible
                    self.mapView?.isTrafficEnabled = false
                    print("✅ iOS Native POI clicks enabled for MapView with reactTag: \(reactTag)")
                } else {
                    print("❌ Could not find GMSMapView within view for reactTag: \(reactTag)")
                }
            } else {
                print("❌ Could not find view for reactTag: \(reactTag)")
            }
        }
    }

    @objc
    func disablePoiClicks() {
        DispatchQueue.main.async {
            // Restore original delegate (react-native-maps)
            if let mv = self.mapView, let proxy = self.delegateProxy {
                mv.delegate = proxy.primary
            }
            self.delegateProxy = nil
            self.mapView = nil
            print("✅ iOS Native POI clicks disabled")
        }
    }

    // Helper to find GMSMapView in view hierarchy
    private func findGMSMapView(in view: UIView) -> GMSMapView? {
        if let mapView = view as? GMSMapView {
            return mapView
        }
        for subview in view.subviews {
            if let mapView = findGMSMapView(in: subview) {
                return mapView
            }
        }
        return nil
    }

    // MARK: - GMSMapViewDelegate

    func mapView(_ mapView: GMSMapView, didTapPOIWithPlaceID placeID: String, name: String, location: CLLocationCoordinate2D) {
        // Note: we usually receive this via the delegate proxy.
        handlePoiTap(placeID: placeID, name: name, location: location)
    }

    fileprivate func handlePoiTap(placeID: String, name: String, location: CLLocationCoordinate2D) {
        print("📍 POI Tapped: \(name) (\(placeID)) at \(location.latitude), \(location.longitude)")
        if hasListeners {
            sendEvent(withName: "onPoiClick", body: [
                "latitude": location.latitude,
                "longitude": location.longitude,
                "placeId": placeID,
                "name": name
            ])
        }
    }
}


