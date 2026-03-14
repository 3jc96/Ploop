#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(PoiClickManager, RCTEventEmitter)

RCT_EXTERN_METHOD(enablePoiClicks:(nonnull NSNumber *)reactTag)
RCT_EXTERN_METHOD(disablePoiClicks)

@end


