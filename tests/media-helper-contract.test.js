import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPONENT_IDS,
  PRODUCT_IDS,
  isComponentOptionalForProduct,
  isComponentRequiredByProduct,
} from "../src/runtime/ecosystem-catalog.js";
import {
  CAPABILITIES,
  doesCapabilityRequireComponent,
  getCapabilitiesForProduct,
} from "../src/runtime/feature-catalog.js";
import {
  MEDIA_HELPER_EVENTS,
  MEDIA_HELPER_PROTOCOL_VERSION,
  MEDIA_HELPER_REQUESTS,
  createHelperEvent,
  normalizeHelperRequest,
} from "../src/media/helper-contract.js";

test("ad protection is extension-only while the media helper stays optional", () => {
  assert.equal(
    isComponentRequiredByProduct(
      PRODUCT_IDS.AD_PROTECTION,
      COMPONENT_IDS.BROWSER_EXTENSION,
    ),
    true,
  );
  assert.equal(
    isComponentRequiredByProduct(
      PRODUCT_IDS.AD_PROTECTION,
      COMPONENT_IDS.MEDIA_HELPER,
    ),
    false,
  );
  assert.equal(
    isComponentOptionalForProduct(
      PRODUCT_IDS.MEDIA_TOOLS,
      COMPONENT_IDS.MEDIA_HELPER,
    ),
    true,
  );
});

test("browser media stays shared and only native download requires the helper", () => {
  const protectionCapabilities = getCapabilitiesForProduct(
    PRODUCT_IDS.AD_PROTECTION,
  );
  const mediaCapabilities = getCapabilitiesForProduct(PRODUCT_IDS.MEDIA_TOOLS);
  assert(protectionCapabilities.includes(CAPABILITIES.MEDIA_OBSERVE));
  assert(mediaCapabilities.includes(CAPABILITIES.MEDIA_OBSERVE));
  assert(!protectionCapabilities.includes(CAPABILITIES.MEDIA_DOWNLOAD));
  assert.equal(
    doesCapabilityRequireComponent(
      CAPABILITIES.MEDIA_DOWNLOAD,
      COMPONENT_IDS.MEDIA_HELPER,
    ),
    false,
  );
  assert.equal(
    doesCapabilityRequireComponent(
      CAPABILITIES.MEDIA_NATIVE_DOWNLOAD,
      COMPONENT_IDS.MEDIA_HELPER,
    ),
    true,
  );
  assert.equal(
    doesCapabilityRequireComponent(
      CAPABILITIES.NAVIGATION_GUARD,
      COMPONENT_IDS.MEDIA_HELPER,
    ),
    false,
  );
});

test("media helper messages are versioned and normalized", () => {
  const request = normalizeHelperRequest({
    type: MEDIA_HELPER_REQUESTS.HELLO,
    requestId: " request-1 ",
    protocolVersion: MEDIA_HELPER_PROTOCOL_VERSION,
    payload: { extensionVersion: "2.2.0" },
  });
  assert.equal(request.requestId, "request-1");
  assert.equal(request.payload.extensionVersion, "2.2.0");
  assert.throws(
    () =>
      normalizeHelperRequest({
        type: "helper.unknown",
        requestId: "request-2",
        protocolVersion: 1,
      }),
    /Unknown request type/,
  );

  const event = createHelperEvent(MEDIA_HELPER_EVENTS.READY, "request-1", {
    helperVersion: "0.1.0",
  });
  assert.equal(event.protocolVersion, MEDIA_HELPER_PROTOCOL_VERSION);
  assert.equal(event.payload.helperVersion, "0.1.0");
});
