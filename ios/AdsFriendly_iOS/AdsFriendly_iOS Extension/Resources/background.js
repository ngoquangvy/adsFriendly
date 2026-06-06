var bgApi = (typeof browser !== 'undefined') ? browser : chrome;

bgApi.runtime.onMessage.addListener(function(request) {
  if (request.action === "open_tabs" && request.urls) {
    request.urls.forEach(function(url) {
      bgApi.tabs.create({ url: url, active: false });
    });
  }
});

console.log("[AdsFriendly BG] Service Worker da khoi dong.");
