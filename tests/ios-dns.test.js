import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
test("DNS UI requires consent, rejects unsafe endpoints and never claims activation after export", async () => {
  const nodes = new Map(),
    messages = [];
  for (const id of [
    "dns-consent",
    "export-dns",
    "dns-status",
    "dns-endpoint",
    "dns-guide",
    "install-dns",
    "install-custom-dns",
  ])
    nodes.set(id, {
      checked: false,
      disabled: false,
      value: "https://dns.example/dns-query",
      addEventListener(event, fn) {
        this[event] = fn;
      },
    });
  const context = {
    URL,
    document: { getElementById: (id) => nodes.get(id) },
    webkit: {
      messageHandlers: {
        controller: { postMessage: (value) => messages.push(value) },
      },
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(
    await readFile(
      new URL(
        "../ios/AdsFriendly_iOS/AdsFriendly_iOS/Resources/DNS.js",
        import.meta.url,
      ),
      "utf8",
    ),
    context,
  );
  nodes.get("export-dns").click();
  assert.equal(messages.length, 0);
  nodes.get("dns-consent").checked = true;
  nodes.get("dns-consent").change();
  nodes.get("dns-endpoint").value = "http://dns.example/query";
  nodes.get("export-dns").click();
  assert.equal(messages.length, 0);
  nodes.get("dns-endpoint").value = "https://dns.example/query";
  nodes.get("export-dns").click();
  nodes.get("export-dns").click();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].consent, true);
  assert.match(nodes.get("dns-status").textContent, /chưa thay đổi DNS/);
  context.handleDNSResult({
    kind: "ready",
    message: "Profile exported, not activated.",
  });
  assert.equal(nodes.get("export-dns").disabled, false);
  assert.equal(
    nodes.get("dns-status").textContent,
    "Profile exported, not activated.",
  );
  nodes.get("dns-endpoint").value = "not-a-valid-custom-address";
  nodes.get("install-dns").click();
  assert.equal(messages.length, 2);
  assert.equal(messages[1].action, "installDefaultDNSProfile");
  assert.equal(
    "endpoint" in messages[1],
    false,
    "Bundled default never borrows the custom input",
  );
  nodes.get("install-custom-dns").click();
  assert.equal(
    messages.length,
    2,
    "Repeated taps while handoff is pending are ignored",
  );
  context.handleDNSResult({
    kind: "ready",
    message: "Chưa xác nhận DNS đã bật.",
  });
  nodes.get("install-custom-dns").click();
  assert.equal(
    messages.length,
    2,
    "Invalid custom endpoints cannot be delivered",
  );
  context.handleDNSPreferences({
    endpoint: "https://private.example/dns-query?id=profile",
  });
  nodes.get("install-custom-dns").click();
  assert.equal(messages.length, 3);
  assert.equal(messages[2].action, "installCustomDNSProfile");
  assert.equal(
    messages[2].endpoint,
    "https://private.example/dns-query?id=profile",
  );
  context.handleDNSResult({
    kind: "ready",
    message: "Đã chuyển file; chưa xác nhận DNS đã bật.",
  });
  nodes.get("dns-consent").checked = false;
  nodes.get("dns-consent").change();
  assert.equal(nodes.get("install-dns").disabled, true);
  assert.equal(nodes.get("install-custom-dns").disabled, true);
});
