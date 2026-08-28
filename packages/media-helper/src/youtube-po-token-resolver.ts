import { Script, createContext } from "node:vm";
import { BotGuardClient, getChallenge } from "bgutils-js/botguard";
import {
  USER_AGENT,
  base64ToU8,
  buildURL,
  getHeaders,
  parseLooseJSON,
  u8ToBase64,
} from "bgutils-js/utils";
import type { WebPoSignalOutput } from "bgutils-js/shared-types";
import { JSDOM, ResourceLoader } from "jsdom";

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const REMOTE_TIMEOUT_MS = 15_000;
const SCRIPT_TIMEOUT_MS = 3_000;
const TOKEN_CACHE_MS = 30 * 60 * 1000;
const MAX_TOKEN_CACHE_ITEMS = 20;

type TokenMinter = (contentBinding: string) => Promise<string>;
type BotGuardChallenge = {
  program: string;
  globalName: string;
  interpreterJavascript?: {
    privateDoNotAccessOrElseSafeScriptWrappedValue?: string;
  };
};

let minterPromise: Promise<TokenMinter> | null = null;
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export const YOUTUBE_WEB_PO_USER_AGENT = USER_AGENT;

export async function resolveYouTubeWebPoToken(videoId: string) {
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(videoId))
    throw new Error("YouTube PO token requires a valid video ID.");
  const cached = tokenCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const mint = await getTokenMinter();
  const token = validateToken(await mint(videoId));
  tokenCache.set(videoId, {
    token,
    expiresAt: Date.now() + TOKEN_CACHE_MS,
  });
  while (tokenCache.size > MAX_TOKEN_CACHE_ITEMS)
    tokenCache.delete(tokenCache.keys().next().value as string);
  return token;
}

export function attachYouTubeWebPoToken(value: string, token: string) {
  const url = validatedGoogleVideoUrl(value);
  url.searchParams.set("pot", validateToken(token));
  return url.href;
}

function getTokenMinter() {
  if (!minterPromise) {
    minterPromise = createTokenMinter().catch((error) => {
      minterPromise = null;
      throw error;
    });
  }
  return minterPromise;
}

async function createTokenMinter(): Promise<TokenMinter> {
  const dom = new JSDOM(
    "<!DOCTYPE html><html><head></head><body></body></html>",
    {
      url: "https://www.youtube.com/",
      referrer: "https://www.youtube.com/",
      // JSDOM ignores a top-level `userAgent` option. ResourceLoader is the
      // supported path and also updates navigator.userAgent, which BotGuard
      // inspects while minting the proof. A mismatched JSDOM/HTTP UA produces
      // a syntactically valid token that GVS rejects with HTTP 403.
      resources: new ResourceLoader({ userAgent: USER_AGENT }),
    },
  );
  installCanvasFallback(dom);
  const sandbox: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    origin: dom.window.origin,
    navigator: dom.window.navigator,
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    atob,
    btoa,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  createContext(sandbox);

  const challenge = await resolveBotGuardChallenge(dom, sandbox);
  const interpreter =
    challenge.interpreterJavascript
      ?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (!interpreter || interpreter.length > 5_000_000)
    throw new Error("YouTube BotGuard interpreter is unavailable.");
  new Script(interpreter).runInContext(sandbox, {
    timeout: SCRIPT_TIMEOUT_MS,
  });
  const botGuard = await BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObject: sandbox,
  });
  const webPoSignalOutput: WebPoSignalOutput = [];
  const snapshot = await botGuard.snapshot(
    { webPoSignalOutput },
    REMOTE_TIMEOUT_MS,
  );
  // Both the homepage attestation challenge and the bounded WAA fallback use
  // the WAA integrity exchange. Sending their snapshot to YouTube's separate
  // `/api/jnn/v1/GenerateIT` endpoint yields a token-shaped value that GVS
  // rejects.
  const response = await boundedFetch(buildURL("GenerateIT"), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify([REQUEST_KEY, snapshot]),
  });
  if (!response.ok)
    throw new Error(
      `YouTube integrity token request returned HTTP ${response.status}.`,
    );
  const payload = await response.json();
  if (!Array.isArray(payload) || typeof payload[0] !== "string")
    throw new Error("YouTube integrity token response is invalid.");
  const getMinter = webPoSignalOutput[0];
  if (!getMinter) throw new Error("YouTube PO token minter is unavailable.");
  const crossRealmMinter = await getMinter(base64ToU8(payload[0]));
  if (typeof crossRealmMinter !== "function")
    throw new Error("YouTube PO token minter could not be initialized.");

  return async (contentBinding) => {
    const bytes = await crossRealmMinter(
      new TextEncoder().encode(contentBinding),
    );
    if (!bytes)
      throw new Error("YouTube PO token generation returned no data.");
    return u8ToBase64(new Uint8Array(bytes), true);
  };
}

function installCanvasFallback(dom: JSDOM) {
  const prototype = dom.window.HTMLCanvasElement.prototype;
  Object.defineProperty(prototype, "getContext", {
    configurable: true,
    value(this: HTMLCanvasElement, kind: string) {
      if (kind !== "2d") return null;
      const gradient = { addColorStop() {} };
      const imageData = (width = 1, height = 1) => ({
        data: new Uint8ClampedArray(
          Math.max(0, Number(width) * Number(height) * 4),
        ),
        width: Number(width),
        height: Number(height),
      });
      return new Proxy(
        { canvas: this },
        {
          get(target, property) {
            if (property in target)
              return target[property as keyof typeof target];
            if (property === "measureText") return () => ({ width: 0 });
            if (property === "getImageData" || property === "createImageData")
              return imageData;
            if (
              property === "createLinearGradient" ||
              property === "createRadialGradient"
            )
              return () => gradient;
            if (property === "createPattern") return () => null;
            if (property === "isPointInPath" || property === "isPointInStroke")
              return () => false;
            return () => undefined;
          },
          set(target, property, value) {
            (target as Record<PropertyKey, unknown>)[property] = value;
            return true;
          },
        },
      );
    },
  });
  Object.defineProperty(prototype, "toDataURL", {
    configurable: true,
    value: () => "data:image/png;base64,",
  });
}

async function resolveBotGuardChallenge(
  dom: JSDOM,
  sandbox: Record<string, unknown>,
): Promise<BotGuardChallenge> {
  try {
    const response = await boundedFetch("https://www.youtube.com/", {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.7",
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok)
      throw new Error(`homepage returned HTTP ${response.status}`);
    const html = await response.text();
    if (html.length > 5_000_000)
      throw new Error("homepage challenge response is too large");

    const configText = html.match(/ytcfg\.set\(({[\s\S]+?})\);/)?.[1];
    const attestationText = html.match(
      /window\.ytAtN\(\s*({[\s\S]*?})\s*\)/,
    )?.[1];
    if (!configText || !attestationText)
      throw new Error("homepage attestation data is unavailable");

    const config = parseLooseJSON(configText) as Record<string, unknown>;
    const attestation = parseLooseJSON(attestationText) as {
      R?: {
        bgChallenge?: {
          program?: string;
          globalName?: string;
          interpreterUrl?: {
            privateDoNotAccessOrElseTrustedResourceUrlWrappedValue?: string;
          };
        };
      };
    };
    const source = attestation.R?.bgChallenge;
    const interpreterValue =
      source?.interpreterUrl
        ?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
    if (!source?.program || !source.globalName || !interpreterValue)
      throw new Error("homepage BotGuard challenge is incomplete");

    const interpreterUrl = new URL(
      interpreterValue,
      "https://www.youtube.com/",
    );
    if (
      interpreterUrl.protocol !== "https:" ||
      !(
        interpreterUrl.hostname === "youtube.com" ||
        interpreterUrl.hostname.endsWith(".youtube.com") ||
        interpreterUrl.hostname === "google.com" ||
        interpreterUrl.hostname.endsWith(".google.com")
      )
    )
      throw new Error("homepage interpreter URL is not trusted");
    const interpreterResponse = await boundedFetch(interpreterUrl, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!interpreterResponse.ok)
      throw new Error(
        `homepage interpreter returned HTTP ${interpreterResponse.status}`,
      );
    const interpreter = await interpreterResponse.text();
    if (!interpreter || interpreter.length > 5_000_000)
      throw new Error("homepage interpreter is invalid");

    const youtubeRuntime = { config_: config };
    sandbox.yt = youtubeRuntime;
    (dom.window as unknown as { yt: typeof youtubeRuntime }).yt =
      youtubeRuntime;
    return {
      program: source.program,
      globalName: source.globalName,
      interpreterJavascript: {
        privateDoNotAccessOrElseSafeScriptWrappedValue: interpreter,
      },
    };
  } catch {
    // The WAA endpoint is retained as a bounded fallback for environments
    // where YouTube does not embed an attestation challenge in the homepage.
    return (await getChallenge({
      fetchFunction: boundedFetch,
      requestKey: REQUEST_KEY,
    })) as BotGuardChallenge;
  }
}

function boundedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const timeoutSignal = AbortSignal.timeout(REMOTE_TIMEOUT_MS);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  return fetch(input, { ...init, signal });
}

function validatedGoogleVideoUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !(
      url.hostname === "googlevideo.com" ||
      url.hostname.endsWith(".googlevideo.com")
    ) ||
    url.pathname !== "/videoplayback"
  )
    throw new Error("PO token target is not a Google Video playback URL.");
  return url;
}

function validateToken(value: string) {
  const normalized = typeof value === "string" ? value.replace(/=+$/u, "") : "";
  const length = normalized.length;
  const alphabetValid =
    typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(normalized);
  if (
    typeof value !== "string" ||
    length < 32 ||
    length > 1_024 ||
    !alphabetValid
  )
    throw new Error(
      `YouTube PO token is invalid (length=${length}, alphabet=${alphabetValid ? "valid" : "invalid"}).`,
    );
  return normalized;
}
