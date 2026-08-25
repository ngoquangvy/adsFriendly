import { notifyContentScript } from "./bridge.js";
import { EVENTS, createRegisteredEvent } from "../runtime/event-catalog.js";

export function installEmeObserver() {
  const cleanups = [];
  const observedSessions = new WeakSet();
  const mediaKeysSystems = new WeakMap();
  const sessionSystems = new WeakMap();

  const onEncrypted = (event) => {
    emit({ initDataType: event.initDataType || null });
  };
  document.addEventListener("encrypted", onEncrypted, true);
  cleanups.push(() =>
    document.removeEventListener("encrypted", onEncrypted, true),
  );

  patchMethod(
    navigator,
    "requestMediaKeySystemAccess",
    (original) =>
      function requestMediaKeySystemAccess(keySystem, configurations) {
        const requestedKeySystem =
          typeof keySystem === "string" ? keySystem : null;
        emit({
          keySystem: requestedKeySystem,
          encryptionSchemes: collectEncryptionSchemes(configurations),
          licenseStatus: "requested",
        });
        return original.apply(this, arguments);
      },
    cleanups,
  );

  patchMethod(
    globalThis.MediaKeySystemAccess?.prototype,
    "createMediaKeys",
    (original) =>
      function createMediaKeys() {
        const keySystem = this.keySystem || null;
        return Promise.resolve(original.apply(this, arguments)).then(
          (mediaKeys) => {
            if (mediaKeys) mediaKeysSystems.set(mediaKeys, keySystem);
            return mediaKeys;
          },
        );
      },
    cleanups,
  );

  patchMethod(
    globalThis.MediaKeys?.prototype,
    "createSession",
    (original) =>
      function createSession() {
        const session = original.apply(this, arguments);
        const keySystem = mediaKeysSystems.get(this) || null;
        if (session) sessionSystems.set(session, keySystem);
        observeSession(session, keySystem);
        return session;
      },
    cleanups,
  );

  patchMethod(
    globalThis.MediaKeySession?.prototype,
    "generateRequest",
    (original) =>
      function generateRequest(initDataType) {
        emit({
          keySystem: sessionSystems.get(this) || null,
          initDataType: typeof initDataType === "string" ? initDataType : null,
          licenseStatus: "requested",
        });
        return original.apply(this, arguments);
      },
    cleanups,
  );

  patchMethod(
    globalThis.MediaKeySession?.prototype,
    "update",
    (original) =>
      function update() {
        // The license argument is intentionally neither read nor copied.
        const result = original.apply(this, arguments);
        return Promise.resolve(result).then(
          (value) => {
            emit({
              keySystem: sessionSystems.get(this) || null,
              licenseStatus: "updated",
            });
            return value;
          },
          (error) => {
            emit({
              keySystem: sessionSystems.get(this) || null,
              licenseStatus: "error",
            });
            throw error;
          },
        );
      },
    cleanups,
  );

  return () => cleanups.reverse().forEach((cleanup) => cleanup());

  function observeSession(session, keySystem) {
    if (!session || observedSessions.has(session)) return;
    observedSessions.add(session);
    const onStatusesChanged = () => {
      const keyStatuses = [];
      try {
        // Only status values are retained. Key IDs are intentionally ignored.
        session.keyStatuses?.forEach((status) => keyStatuses.push(status));
      } catch {}
      emit({
        keySystem,
        keyStatuses,
        licenseStatus: licenseStatusFromKeyStatuses(keyStatuses),
      });
    };
    session.addEventListener?.("keystatuseschange", onStatusesChanged);
    cleanups.push(() =>
      session.removeEventListener?.("keystatuseschange", onStatusesChanged),
    );
  }

  function emit(payload) {
    notifyContentScript({
      type: "REGISTERED_EVENT",
      event: createRegisteredEvent(EVENTS.MEDIA_EME_OBSERVED, {
        pageUrl: location.href,
        ...payload,
        observedAt: Date.now(),
      }),
    });
  }
}

function patchMethod(target, property, createReplacement, cleanups) {
  if (!target || typeof target[property] !== "function") return;
  const original = target[property];
  const replacement = createReplacement(original);
  try {
    target[property] = replacement;
    cleanups.push(() => {
      try {
        if (target[property] === replacement) target[property] = original;
      } catch {}
    });
  } catch {}
}

function collectEncryptionSchemes(configurations) {
  const schemes = [];
  for (const configuration of Array.isArray(configurations)
    ? configurations
    : []) {
    for (const capability of [
      ...(configuration?.audioCapabilities || []),
      ...(configuration?.videoCapabilities || []),
    ]) {
      if (typeof capability?.encryptionScheme === "string")
        schemes.push(capability.encryptionScheme);
    }
  }
  return [...new Set(schemes)].slice(0, 8);
}

function licenseStatusFromKeyStatuses(statuses) {
  if (statuses.includes("usable")) return "usable";
  if (statuses.includes("expired")) return "expired";
  if (
    statuses.includes("output-restricted") ||
    statuses.includes("output-downscaled")
  )
    return "restricted";
  if (statuses.includes("internal-error")) return "error";
  return null;
}
