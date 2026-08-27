import { Script, createContext } from "node:vm";
import { BotGuardClient, getChallenge } from "bgutils-js/botguard";
import {
  USER_AGENT,
  base64ToU8,
  buildURL,
  getHeaders,
  u8ToBase64,
} from "bgutils-js/utils";
import type { WebPoSignalOutput } from "bgutils-js/shared-types";
import { JSDOM } from "jsdom";

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const REMOTE_TIMEOUT_MS = 15_000;
const SCRIPT_TIMEOUT_MS = 3_000;
const TOKEN_CACHE_MS = 30 * 60 * 1000;
const MAX_TOKEN_CACHE_ITEMS = 20;

type TokenMinter = (contentBinding: string) => Promise<string>;

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
      userAgent: USER_AGENT,
    },
  );
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

  const challenge = await getChallenge({
    fetchFunction: boundedFetch,
    requestKey: REQUEST_KEY,
  });
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
  const response = await boundedFetch(buildURL("GenerateIT", true), {
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
  if (
    typeof value !== "string" ||
    value.length < 32 ||
    value.length > 1_024 ||
    !/^[a-zA-Z0-9_-]+$/.test(value)
  )
    throw new Error("YouTube PO token is invalid.");
  return value;
}
