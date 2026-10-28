// Loaded only by the localhost fixture server, never by the extension manifest.
// All Chrome/native operations below are disposable in-memory test doubles.
(() => {
  const listeners = new Set();
  const store = {
    appSettings: {
      enabled: true,
      protectionMode: "assist",
      featureOverrides: { "background.browser-download-observer": true, "background.browser-file-auto-check": true },
      mediaDownloadConnections: 8,
    },
    whitelist: ["account.example", "news.example", "work.example"],
    blacklist: ["ads.example", "popup.example"],
    userCustomRules: {
      "video.example": [".top-banner", "#overlay-ad"],
      "news.example": [".sponsor-card"],
      "stream.example": [".ad-panel"],
    },
    userElementExceptions: {},
    blockedLogs: [
      {
        url: "https://ads.example/promo",
        source: "https://video.example/",
        timestamp: Date.now(),
      },
      {
        url: "https://popup.example/",
        source: "https://news.example/",
        timestamp: Date.now() - 10000,
      },
    ],
  };
  const jobs = [
    {
      id: "demo-hls-progress", title: "HLS progress fixture", kind: "hls", status: "downloading",
      progress: { downloadedBytes: 3500000000, totalBytes: null, completedResources: 400, totalResources: 1000, bytesPerSecond: 9500000, resumedBytes: 6500000, resumable: true, stage: "segment_download", etaSeconds: 175, etaUpdatedAt: Date.now() }, connections: 16,
    },
    {
      id: "demo-active",
      title: "Demo nature documentary",
      kind: "adaptive",
      status: "downloading",
      progress: {
        downloadedBytes: 30000000,
        totalBytes: 100000000,
        bytesPerSecond: 2500000,
        resumable: true,
      },
      connections: 8,
    },
    {
      id: "demo-completed",
      title: "A weekend in the mountains",
      kind: "direct",
      status: "completed",
      outputPath: "C:\\Downloads\\AdsFriendly\\A weekend in the mountains.mp4",
      progress: { totalBytes: 70000000 },
    },
    {
      id: "demo-failed",
      title: "Sample unavailable source",
      kind: "hls",
      status: "failed",
      error: "Segment request returned HTTP 403. The session may have expired.",
    },
  ];
  const notify = (values, area = "local") =>
    listeners.forEach((fn) =>
      fn(
        Object.fromEntries(
          Object.entries(values).map(([key, value]) => [
            key,
            { newValue: value },
          ]),
        ),
        area,
      ),
    );
  window.chrome = {
    permissions: {request: async () => true},
    storage: {
      local: {
        get: async (keys) =>
          keys == null
            ? structuredClone(store)
            : typeof keys === "string"
              ? { [keys]: structuredClone(store[keys]) }
              : Object.fromEntries(
                  keys.map((key) => [key, structuredClone(store[key])]),
                ),
        set: async (values) => {
          Object.assign(store, structuredClone(values));
          notify(values);
        },
        remove: async (keys) => {
          for (const key of [].concat(keys)) delete store[key];
          notify(
            Object.fromEntries([].concat(keys).map((key) => [key, undefined])),
          );
        },
      },
      onChanged: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
      },
    },
    runtime: {
      getManifest: () => ({ version: "2.4.35 · UI fixture" }),
      getURL: (path) => new URL(`/${path}`, location.href).href,
      sendMessage: async (message) => {
        if (message.type === "GET_BROWSER_DOWNLOAD_INTAKE")
          return {status:store.appSettings.featureOverrides["background.browser-download-observer"] ? "observing":"off",
            checks:[{browserId:1,checkId:'fixture',expiresAt:Date.now()+10000}],
            autoChecks:{enabled:true,items:[{browserId:3,status:'checking',reason:'preflight_required'}]},
            items: store.appSettings.featureOverrides["background.browser-download-observer"] ? [
              {id:1,filename:"Verified signed archive.zip",host:"cdn.example",totalBytes:24600000,state:"in_progress",authorizationHints:true,
                assessment:{disposition:"needs_validation",reason:"request_not_verified"}},
              {id:2,filename:"Actions artifact.zip",host:"results.example",totalBytes:465920,state:"complete",authorizationHints:true,
                assessment:{disposition:"browser_only",reason:"not_active"}},
              {id:3,filename:"Signed active archive.zip",host:"results.example",totalBytes:24600000,state:"in_progress",authorizationHints:true,
                assessment:{disposition:"needs_validation",reason:"authorization_not_verified"}},
            ] : []};
        if (message.type === "CLEAR_BROWSER_DOWNLOAD_INTAKE")
          return {status:"cleared"};
        if (message.type === "GET_MEDIA_DOWNLOAD_JOBS")
          return { status: "ok", items: structuredClone(jobs).map(job => ({ ...job, progress: { ...job.progress, etaUpdatedAt: Date.now() } })) };
        if (message.type === "GET_MEDIA_HELPER_STATUS")
          return {
            status: "ready",
            helperVersion: "0.24.2",
            capabilities: { "output.open": true, "output.reveal": true },
          };
        if (message.type === "GET_STORAGE_HEALTH")
          return { status: "ok", bytesInUse: 42000, unlimited: true };
        if (message.type === "GET_NAVIGATION_DIAGNOSTICS")
          return {
            status: "ok",
            events: [
              {
                stage: "navigation_policy",
                outcome: "allowed",
                host: "news.example",
                reason: "user_address_bar",
              },
            ],
          };
        if (message.type === "SAVE_DOMAIN_DECISION") {
          const key =
            message.action === "WHITELIST" ? "whitelist" : "blacklist";
          if (!store[key].includes(message.domain))
            store[key].push(message.domain);
          notify({ [key]: store[key] });
          return { status: "saved" };
        }
        if (message.type === "REMOVE_DOMAIN_DECISION") {
          store[message.listName] = store[message.listName].filter(
            (domain) => domain !== message.domain,
          );
          notify({ [message.listName]: store[message.listName] });
          return { status: "saved" };
        }
        if (message.type === "REMOVE_CUSTOM_RULES") {
          store.userCustomRules[message.hostname] = store.userCustomRules[
            message.hostname
          ].filter((rule) => !message.selectors.includes(rule));
          notify({ userCustomRules: store.userCustomRules });
          return { status: "saved" };
        }
        if (
          [
            "START_NAVIGATION_DIAGNOSTICS",
            "STOP_NAVIGATION_DIAGNOSTICS",
            "CLEAR_NAVIGATION_DIAGNOSTICS",
          ].includes(message.type)
        )
          return { status: "ok" };
        if (
          [
            "OPEN_MEDIA_DOWNLOAD_OUTPUT",
            "REVEAL_MEDIA_DOWNLOAD_OUTPUT",
          ].includes(message.type)
        )
          return { status: "opened" };
        if (
          [
            "PAUSE_MEDIA_DOWNLOAD_JOB",
            "RESUME_MEDIA_DOWNLOAD_JOB",
            "RETRY_MEDIA_DOWNLOAD_JOB",
          ].includes(message.type)
        )
          return {
            status: message.type.startsWith("PAUSE") ? "pausing" : "started",
          };
        throw new Error(`Fixture does not support ${message.type}`);
      },
    },
  };
})();
