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
});
