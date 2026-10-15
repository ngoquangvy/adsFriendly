import { lookup } from "node:dns/promises";

// Shared HTTP boundary. Every redirect is revalidated before opening a request.
export async function assertSafeRemoteUrl(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Only credential-free HTTP(S) media URLs are allowed.");
  }
  if (process.env.ADSFRIENDLY_HELPER_ALLOW_PRIVATE === "1") return;
  const addresses = await lookup(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => isPrivateAddress(address))
  ) {
    throw new Error("Private or local network media URLs are blocked.");
  }
}

export async function fetchRemote(value: string, init: RequestInit) {
  let url = new URL(value);
  for (let redirectCount = 0; redirectCount <= 5; redirectCount++) {
    await assertSafeRemoteUrl(url.href);
    const response = await fetch(url, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});
    if (!location) throw new Error("Media redirect omitted its destination.");
    url = new URL(location, url);
  }
  throw new Error("Media source redirected too many times.");
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  )
    return true;
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const [, a, b] = match.map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}
