import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";

const DATA_PATH = path.join(process.cwd(), "data", "zee-audi-connect.json");

const HDR_XAPP_VERSION = "4.31.0";
const HDR_USER_AGENT =
  "Android/4.31.0 (Build 800341641.root project 'myaudi_android'.ext.buildTime) Android/13";

const DEFAULT_CLIENT_ID = "09b6cbec-cd19-4589-82fd-363dfa8c24da@apps_vw-dilab_com";

function getCountry() {
  return String(process.env.ZEE_AUDI_COUNTRY || "US").trim().toUpperCase() || "US";
}

function getConfiguredVin() {
  return String(process.env.ZEE_AUDI_VIN || "").trim().toUpperCase();
}

function cariadBaseUrl(country) {
  return country === "US" ? "https://na.bff.cariad.digital" : "https://emea.bff.cariad.digital";
}

function graphqlEndpoint(country) {
  return country === "US"
    ? "https://app-api.my.aoa.audi.com/vgql/v1/graphql"
    : "https://app-api.live-my.audi.com/vgql/v1/graphql";
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

function calculateXQmAuth() {
  const gmtime100sec = Math.floor(Date.now() / 1000 / 100);
  const secret = Buffer.from([
    26, 256 - 74, 256 - 103, 37, 256 - 84, 23, 256 - 102, 256 - 86, 78, 256 - 125, 256 - 85, 256 - 26, 113, 256 - 87, 71, 109, 23, 100, 24, 256 - 72, 91, 256 - 41, 6, 256 - 15, 67, 108, 256 - 95, 91, 256 - 26, 71, 256 - 104, 256 - 100,
  ]);
  const h = crypto.createHmac("sha256", secret).update(String(gmtime100sec), "ascii").digest("hex");
  return `v1:01da27b0:${h}`;
}

function parseSetCookie(setCookie) {
  const jar = new Map();
  const parts = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const line of parts) {
    const [pair] = String(line || "").split(";");
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (!name) continue;
    jar.set(name, val);
  }
  return jar;
}

function mergeCookieJars(a, b) {
  const out = new Map(a || []);
  for (const [k, v] of b || []) out.set(k, v);
  return out;
}

function cookieHeaderForUrl(jar, urlStr) {
  if (!jar || !jar.size) return "";
  let host = "";
  try {
    host = new URL(urlStr).hostname;
  } catch {
    return "";
  }
  // Keep it simple: send all cookies to vwgroup + audi + cariad + vwg-connect hosts.
  const allow =
    host.endsWith("vwgroup.io") ||
    host.endsWith("my.audi.com") ||
    host.endsWith("audi.com") ||
    host.endsWith("cariad.digital") ||
    host.endsWith("vwg-connect.com");
  if (!allow) return "";
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function extractHiddenInputs(html) {
  /** @type {Record<string, string>} */
  const out = {};
  const re = /<input\b[^>]*type=["']hidden["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const nameM = tag.match(/\bname=["']([^"']+)["']/i);
    const valM = tag.match(/\bvalue=["']([^"']*)["']/i);
    if (!nameM) continue;
    out[nameM[1]] = valM ? valM[1] : "";
  }
  return out;
}

function extractFormAction(html) {
  const m = html.match(/<form[^>]*\baction=["']([^"']+)["']/i);
  return m ? m[1] : "";
}

function toAbsoluteUrl(baseUrl, action) {
  const a = String(action || "").trim();
  if (!a) return "";
  if (/^myaudi:/i.test(a)) return a;
  if (/^https?:\/\//i.test(a)) return a;
  if (a.startsWith("//")) return `https:${a}`;
  const u = new URL(baseUrl);
  if (a.startsWith("/")) return `${u.protocol}//${u.host}${a}`;
  return new URL(a, baseUrl).toString();
}

/**
 * Tank % — Cariad often exposes ICE level under `measurements.fuelLevelStatus` (see audi_connect_ha
 * TANK_LEVEL_IN_PERCENTAGE). `fuelStatus.rangeStatus.primaryEngine.currentFuelLevelPct` may be 0 or missing.
 * @param {Record<string, unknown>} status selectivestatus JSON root
 * @returns {number | null}
 */
function pickFuelLevelPct(status) {
  const getters = [
    () => status?.measurements?.fuelLevelStatus?.value?.currentFuelLevel_pct,
    () => status?.measurements?.fuelLevelStatus?.value?.currentFuelLevelPct,
    () => status?.fuelStatus?.rangeStatus?.value?.primaryEngine?.currentFuelLevelPct,
    () => status?.fuelStatus?.rangeStatus?.value?.secondaryEngine?.currentFuelLevelPct,
  ];
  for (const g of getters) {
    const v = g();
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

const ACCESS_NAME_LABEL = {
  bonnet: "Hood",
  hood: "Hood",
  trunk: "Tailgate",
  tailgate: "Tailgate",
  rear: "Tailgate",
  frontLeft: "Front left door",
  frontRight: "Front right door",
  rearLeft: "Rear left door",
  rearRight: "Rear right door",
  frontLeftDoor: "Front left door",
  frontRightDoor: "Front right door",
  rearLeftDoor: "Rear left door",
  rearRightDoor: "Rear right door",
  sunRoof: "Sunroof",
  sunroof: "Sunroof",
  roofCoverWindow: "Roof / sunroof",
  frontLeftWindow: "Front left window",
  frontRightWindow: "Front right window",
  rearLeftWindow: "Rear left window",
  rearRightWindow: "Rear right window",
  rearWindow: "Rear window",
  windshield: "Windshield",
  deck: "Rear deck",
};

function prettifyAccessName(name) {
  const key = String(name || "").trim();
  if (!key) return "Unknown";
  if (ACCESS_NAME_LABEL[key]) return ACCESS_NAME_LABEL[key];
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

/** @param {unknown} statusArr */
function normalizeStateList(statusArr) {
  if (Array.isArray(statusArr)) return statusArr.filter((s) => typeof s === "string" && s);
  if (statusArr && typeof statusArr === "object") {
    const out = [];
    for (const x of Object.values(/** @type {Record<string, unknown>} */ (statusArr))) {
      if (typeof x === "string") out.push(x);
      else if (Array.isArray(x)) for (const y of x) if (typeof y === "string") out.push(y);
    }
    return out;
  }
  if (typeof statusArr === "string" && statusArr) return [statusArr];
  return [];
}

/** @param {unknown} statusArr */
function summarizeVwStates(statusArr) {
  const statusArr2 = normalizeStateList(statusArr);
  if (statusArr2.length === 0) return "—";
  if (statusArr2.includes("unsupported")) return "N/A";
  return statusArr2
    .filter((s) => typeof s === "string")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/_/g, " "))
    .join(" · ");
}

/**
 * Doors / hood / tailgate + windows / sunroof + exterior lights from selectivestatus
 * (aligned with audi_connect_ha access + vehicleLights paths).
 * @param {Record<string, unknown>} status
 */
function buildAccessSnapshot(status) {
  const accessVal = status?.access?.accessStatus?.value;
  const capturedAt = accessVal?.carCapturedTimestamp ?? null;

  const doors = [];
  for (const d of accessVal?.doors || []) {
    if (!d || typeof d !== "object") continue;
    const name = /** @type {{ name?: string, status?: string[] }} */ (d).name;
    const st = /** @type {{ name?: string, status?: string[] }} */ (d).status;
    doors.push({
      id: name || "",
      label: prettifyAccessName(name),
      states: summarizeVwStates(st),
    });
  }

  const windows = [];
  for (const w of accessVal?.windows || []) {
    if (!w || typeof w !== "object") continue;
    const name = /** @type {{ name?: string, status?: string[] }} */ (w).name;
    const st = /** @type {{ name?: string, status?: string[] }} */ (w).status;
    windows.push({
      id: name || "",
      label: prettifyAccessName(name),
      states: summarizeVwStates(st),
    });
  }

  const lightsRoot = status?.vehicleLights?.lightsStatus?.value;
  const lights = [];
  const rawLights = lightsRoot?.lights;
  if (Array.isArray(rawLights)) {
    for (const L of rawLights) {
      if (!L || typeof L !== "object") continue;
      const name = /** @type {{ name?: string, text?: string, status?: string[] }} */ (L).name;
      const text = /** @type {{ name?: string, text?: string, status?: string[] }} */ (L).text;
      const st = /** @type {{ name?: string, text?: string, status?: string[] }} */ (L).status;
      const id = name || text || "light";
      lights.push({
        id,
        label: prettifyAccessName(id),
        states: summarizeVwStates(st),
      });
    }
  } else if (rawLights && typeof rawLights === "object") {
    for (const [k, v] of Object.entries(rawLights)) {
      if (!v || typeof v !== "object") continue;
      const st = /** @type {{ status?: string[] }} */ (v).status;
      lights.push({
        id: k,
        label: prettifyAccessName(k),
        states: summarizeVwStates(st),
      });
    }
  }

  return {
    capturedAt,
    doors,
    windows,
    lights,
  };
}

function parseQueryFromMyAudiRedirect(locationHeader) {
  const loc = String(locationHeader || "");
  const idx = loc.indexOf("myaudi:///?");
  const tail = idx >= 0 ? loc.slice(idx + "myaudi:///?".length) : loc.replace(/^myaudi:\/\/?\??/i, "");
  const qs = new URLSearchParams(tail.startsWith("?") ? tail : `?${tail}`);
  return qs;
}

/**
 * @typedef {{
 *  country: string,
 *  clientId: string,
 *  language: string,
 *  authorizationServerBaseLive: string,
 *  mbbOAuthBaseURL: string,
 *  tokenEndpoint: string,
 *  authorizationEndpoint: string,
 *  bearerToken: any,
 *  audiToken: any,
 *  xclientId: string,
 *  vwToken: any,
 *  updatedAt: number,
 *  bearerExpiresAt?: number,
 * }} AudiConnectState
 */

export function getAudiConnectState() {
  const saved = readJsonFile(DATA_PATH);
  if (!saved || typeof saved !== "object") return null;
  return /** @type {AudiConnectState} */ (saved);
}

export function clearAudiConnectState() {
  try {
    if (fs.existsSync(DATA_PATH)) fs.unlinkSync(DATA_PATH);
  } catch {
    // ignore
  }
}

export function getAudiConnectStatus() {
  const st = getAudiConnectState();
  const country = getCountry();
  const vin = getConfiguredVin();
  /** GraphQL + Cariad use IDK `bearerToken`; UI must not show "linked" if only VW token is present. */
  const hasBearer = Boolean(st?.bearerToken?.access_token);
  const hasVw = Boolean(st?.vwToken?.access_token);
  return {
    connected: Boolean(hasBearer && hasVw),
    hasBearer,
    hasVw,
    canRefreshBearer: Boolean(st?.bearerToken?.refresh_token),
    country,
    vinConfigured: Boolean(vin),
    vin,
    updatedAt: st?.updatedAt || null,
    bearerExpiresAt: st?.bearerExpiresAt ?? null,
    graphql: graphqlEndpoint(country),
  };
}

async function postForm(url, body, headers, jar) {
  const h = { ...(headers || {}) };
  const c = cookieHeaderForUrl(jar, url);
  if (c) h.Cookie = c;
  const res = await axios.post(url, body, {
    headers: h,
    maxRedirects: 0,
    validateStatus: () => true,
    responseType: "text",
  });
  const merged = mergeCookieJars(jar, parseSetCookie(res.headers["set-cookie"]));
  return { res, jar: merged, text: String(res.data || "") };
}

async function getUrl(url, headers, jar) {
  const h = { ...(headers || {}) };
  const c = cookieHeaderForUrl(jar, url);
  if (c) h.Cookie = c;
  const res = await axios.get(url, {
    headers: h,
    maxRedirects: 0,
    validateStatus: () => true,
    responseType: "text",
  });
  const merged = mergeCookieJars(jar, parseSetCookie(res.headers["set-cookie"]));
  return { res, jar: merged, text: String(res.data || "") };
}

function isMyAudiAppUrl(urlStr) {
  return /^myaudi:/i.test(String(urlStr || "").trim());
}

/** Terminal OAuth redirect — axios cannot GET custom scheme `myaudi:`. */
function syntheticMyAudiRedirect(locationUrl, jar) {
  const loc = String(locationUrl || "").trim();
  return {
    res: { status: 302, headers: { location: loc } },
    jar,
    text: "",
    finalUrl: loc,
  };
}

async function followGet(location, headers, jar) {
  let url = location;
  let j = jar;
  for (let i = 0; i < 12; i++) {
    if (isMyAudiAppUrl(url)) {
      return syntheticMyAudiRedirect(url, j);
    }
    const g = await getUrl(url, headers, j);
    j = g.jar;
    const status = g.res.status;
    if (status >= 300 && status < 400 && g.res.headers.location) {
      const next = g.res.headers.location;
      const resolved = toAbsoluteUrl(url, next);
      if (isMyAudiAppUrl(resolved)) {
        return {
          res: { status: 302, headers: { location: resolved } },
          jar: j,
          text: "",
          finalUrl: url,
        };
      }
      url = resolved;
      continue;
    }
    return { res: g.res, jar: j, text: g.text, finalUrl: url };
  }
  throw new Error("Too many redirects during Audi login.");
}

/**
 * Login flow adapted from the Home Assistant `audi_connect` implementation (myAudi IDK + MBBOAUTH).
 * This is inherently brittle if Audi changes their HTML/login flow.
 *
 * @param {{ email: string, password: string }} creds
 * @returns {Promise<AudiConnectState>}
 */
export async function loginAudiConnect(creds) {
  const email = String(creds.email || "").trim();
  const password = String(creds.password || "");
  if (!email || !password) throw new Error("email and password are required.");

  const country = getCountry();
  const cariadBase = cariadBaseUrl(country);

  /** @type {Map<string, string>} */
  let jar = new Map();

  const commonJsonHeaders = {
    Accept: "application/json",
    "Accept-Charset": "utf-8",
    "X-App-Version": HDR_XAPP_VERSION,
    "X-App-Name": "myAudi",
    "User-Agent": HDR_USER_AGENT,
  };

  // Markets
  const markets = await axios.get("https://content.app.my.audi.com/service/mobileapp/configurations/markets", {
    headers: commonJsonHeaders,
    validateStatus: () => true,
  });
  if (markets.status !== 200) throw new Error(`markets fetch failed (${markets.status})`);
  const marketsJson = markets.data;
  const specs = marketsJson?.countries?.countrySpecifications?.[country];
  if (!specs) throw new Error(`Unknown Audi market/country: ${country}`);
  const language = String(specs.defaultLanguage || "en").trim();

  const marketcfgUrl = `https://content.app.my.audi.com/service/mobileapp/configurations/market/${encodeURIComponent(
    country
  )}/${encodeURIComponent(language)}?v=4.23.1`;
  const marketcfg = await axios.get(marketcfgUrl, { headers: commonJsonHeaders, validateStatus: () => true });
  if (marketcfg.status !== 200) throw new Error(`market config failed (${marketcfg.status})`);
  const marketcfgJson = marketcfg.data;

  let clientId = DEFAULT_CLIENT_ID;
  if (marketcfgJson?.idkClientIDAndroidLive) clientId = String(marketcfgJson.idkClientIDAndroidLive);

  let authorizationServerBaseLive = `${cariadBase}/login/v1/audi`;
  if (marketcfgJson?.myAudiAuthorizationServerProxyServiceURLProduction) {
    authorizationServerBaseLive = String(marketcfgJson.myAudiAuthorizationServerProxyServiceURLProduction);
  }

  let mbbOAuthBaseURL = "https://mbboauth-1d.prd.ece.vwg-connect.com/mbbcoauth";
  if (marketcfgJson?.mbbOAuthBaseURLLive) mbbOAuthBaseURL = String(marketcfgJson.mbbOAuthBaseURLLive);

  const openidCfgUrl = `${cariadBase}/login/v1/idk/openid-configuration`;
  const openidCfg = await axios.get(openidCfgUrl, { headers: commonJsonHeaders, validateStatus: () => true });
  if (openidCfg.status !== 200) throw new Error(`openid configuration failed (${openidCfg.status})`);
  const openidCfgJson = openidCfg.data;

  let authorizationEndpoint = "https://identity.vwgroup.io/oidc/v1/authorize";
  if (openidCfgJson?.authorization_endpoint) authorizationEndpoint = String(openidCfgJson.authorization_endpoint);

  let tokenEndpoint = `${cariadBase}/login/v1/idk/token`;
  if (openidCfgJson?.token_endpoint) tokenEndpoint = String(openidCfgJson.token_endpoint);

  // PKCE
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier, "ascii").digest("base64url");

  const oauthState = crypto.randomUUID();
  const nonce = crypto.randomUUID();

  const authorizeUrl = new URL(authorizationEndpoint);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", "myaudi:///");
  authorizeUrl.searchParams.set(
    "scope",
    "address profile badge birthdate birthplace nationalIdentifier nationality profession email vin phone nickname name picture mbb gallery openid"
  );
  authorizeUrl.searchParams.set("state", oauthState);
  authorizeUrl.searchParams.set("nonce", nonce);
  authorizeUrl.searchParams.set("prompt", "login");
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("ui_locales", `${language.toLowerCase()}-${country} ${language.toLowerCase()}`);

  // HTML login lives on identity hosts; prefer browser-like Accept (not application/json).
  const authorizeFlowHeaders = {
    ...commonJsonHeaders,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  // VW/Audi often 302 from the authorize URL to identity.vwgroup.io (login HTML). Must follow redirects.
  const idkFollow = await followGet(authorizeUrl.toString(), authorizeFlowHeaders, jar);
  jar = idkFollow.jar;
  if (idkFollow.res.status !== 200) {
    throw new Error(`authorize page failed (${idkFollow.res.status})`);
  }
  const idkHtml = String(idkFollow.text || "");
  const authorizePageUrl = idkFollow.finalUrl;

  // Email step
  const emailForm = extractHiddenInputs(idkHtml);
  emailForm.email = email;
  /** Same hidden fields + email must be carried into the hmac password POST (audi_connect_ha). */
  const sessionAfterEmail = { ...emailForm };
  const emailActionRel = extractFormAction(idkHtml);
  const emailPostUrl = toAbsoluteUrl(authorizePageUrl, emailActionRel);
  const emailPost = await postForm(
    emailPostUrl,
    new URLSearchParams(emailForm).toString(),
    { ...authorizeFlowHeaders, "Content-Type": "application/x-www-form-urlencoded" },
    jar
  );
  jar = emailPost.jar;

  // Identity often returns 302/303 to the password step instead of 200 + HTML inline.
  let emailHtml = emailPost.text;
  let emailStepBaseUrl = emailPostUrl;
  if (emailPost.res.status >= 300 && emailPost.res.status < 400 && emailPost.res.headers.location) {
    const emailFollow = await followGet(
      toAbsoluteUrl(emailPostUrl, emailPost.res.headers.location),
      authorizeFlowHeaders,
      jar
    );
    jar = emailFollow.jar;
    if (emailFollow.res.status !== 200) {
      throw new Error(`email step redirect failed (${emailFollow.res.status})`);
    }
    emailHtml = emailFollow.text;
    emailStepBaseUrl = emailFollow.finalUrl;
  } else if (emailPost.res.status !== 200) {
    throw new Error(`email step failed (${emailPost.res.status})`);
  }

  // Password step — match audi_connect_ha: hmac flow posts to authenticate URL derived from *email* POST URL,
  // reusing the same form fields as the email step (not the password page <form action>, which can 405 on POST).
  const hmacMatch = emailHtml.match(/"hmac"\s*:\s*"([0-9a-fA-F]+)"/);
  let pwForm;
  let pwPostUrl;
  if (hmacMatch) {
    pwForm = { ...sessionAfterEmail, hmac: hmacMatch[1], password };
    pwPostUrl = emailPostUrl.includes("identifier")
      ? emailPostUrl.replace("identifier", "authenticate")
      : emailPostUrl.replace(/\/identifier(\?|$)/, "/authenticate$1");
    if (pwPostUrl === emailPostUrl) {
      throw new Error("password step: could not derive /authenticate URL from email POST URL.");
    }
  } else {
    const rel = extractFormAction(emailHtml) || emailActionRel;
    pwForm = extractHiddenInputs(emailHtml);
    pwForm.password = password;
    pwPostUrl = toAbsoluteUrl(emailStepBaseUrl, rel);
  }
  const pwPost = await postForm(
    pwPostUrl,
    new URLSearchParams(pwForm).toString(),
    { ...authorizeFlowHeaders, "Content-Type": "application/x-www-form-urlencoded" },
    jar
  );
  jar = pwPost.jar;
  if (!(pwPost.res.status >= 300 && pwPost.res.status < 400) || !pwPost.res.headers.location) {
    throw new Error(`password step failed (${pwPost.res.status})`);
  }

  const fwd1 = await followGet(toAbsoluteUrl(pwPostUrl, pwPost.res.headers.location), authorizeFlowHeaders, jar);
  jar = fwd1.jar;
  if (!(fwd1.res.status >= 300 && fwd1.res.status < 400) || !fwd1.res.headers.location) {
    throw new Error(`post-password redirect failed (${fwd1.res.status})`);
  }

  const fwd2 = await followGet(toAbsoluteUrl(fwd1.finalUrl, fwd1.res.headers.location), authorizeFlowHeaders, jar);
  jar = fwd2.jar;
  if (!(fwd2.res.status >= 300 && fwd2.res.status < 400) || !fwd2.res.headers.location) {
    throw new Error(`second redirect failed (${fwd2.res.status})`);
  }

  const codeAuth = await followGet(toAbsoluteUrl(fwd2.finalUrl, fwd2.res.headers.location), authorizeFlowHeaders, jar);
  jar = codeAuth.jar;
  if (!(codeAuth.res.status >= 300 && codeAuth.res.status < 400) || !codeAuth.res.headers.location) {
    throw new Error(`authcode redirect failed (${codeAuth.res.status})`);
  }

  const qs = parseQueryFromMyAudiRedirect(codeAuth.res.headers.location);
  const code = String(qs.get("code") || "");
  if (!code) throw new Error("Missing authorization code from myaudi redirect.");

  // IDK token
  const tokenBody = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: "myaudi:///",
    response_type: "token id_token",
    code_verifier: codeVerifier,
  }).toString();

  const bearerTok = await axios.post(tokenEndpoint, tokenBody, {
    headers: {
      Accept: "application/json",
      "Accept-Charset": "utf-8",
      "X-QMAuth": calculateXQmAuth(),
      "User-Agent": HDR_USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    maxRedirects: 0,
    validateStatus: () => true,
  });
  if (bearerTok.status !== 200) {
    throw new Error(`IDK token exchange failed (${bearerTok.status}): ${String(bearerTok.data || "").slice(0, 220)}`);
  }
  const bearerTokenJson = bearerTok.data;

  // AZS token
  const azsBody = JSON.stringify({
    token: bearerTokenJson.access_token,
    grant_type: "id_token",
    stage: "live",
    config: "myaudi",
  });
  const azs = await axios.post(`${authorizationServerBaseLive}/token`, azsBody, {
    headers: {
      Accept: "application/json",
      "Accept-Charset": "utf-8",
      "X-App-Version": HDR_XAPP_VERSION,
      "X-App-Name": "myAudi",
      "User-Agent": HDR_USER_AGENT,
      "Content-Type": "application/json; charset=utf-8",
    },
    maxRedirects: 0,
    validateStatus: () => true,
  });
  if (azs.status !== 200) {
    throw new Error(`AZS token exchange failed (${azs.status}): ${String(azs.data || "").slice(0, 220)}`);
  }
  const audiTokenJson = azs.data;

  // MBBOAUTH client register
  const regBody = JSON.stringify({
    client_name: "ZeeHUD",
    platform: "windows",
    client_brand: "Audi",
    appName: "myAudi",
    appVersion: HDR_XAPP_VERSION,
    appId: "de.myaudi.mobile.assistant",
  });
  const reg = await axios.post(`${mbbOAuthBaseURL}/mobile/register/v1`, regBody, {
    headers: {
      Accept: "application/json",
      "Accept-Charset": "utf-8",
      "User-Agent": HDR_USER_AGENT,
      "Content-Type": "application/json; charset=utf-8",
    },
    maxRedirects: 0,
    validateStatus: () => true,
  });
  if (reg.status !== 200) throw new Error(`mbb register failed (${reg.status})`);
  const regJar = mergeCookieJars(jar, parseSetCookie(reg.headers["set-cookie"]));
  const xclientId = String(reg.data?.client_id || "").trim();
  if (!xclientId) throw new Error("mbb register missing client_id.");

  // MBBOAUTH auth
  const mbbAuthBody = new URLSearchParams({
    grant_type: "id_token",
    token: String(bearerTokenJson.id_token || ""),
    scope: "sc2:fal",
  }).toString();

  const mbbAuth = await axios.post(`${mbbOAuthBaseURL}/mobile/oauth2/v1/token`, mbbAuthBody, {
    headers: {
      Accept: "application/json",
      "Accept-Charset": "utf-8",
      "User-Agent": HDR_USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Client-ID": xclientId,
    },
    maxRedirects: 0,
    validateStatus: () => true,
  });
  if (mbbAuth.status !== 200) throw new Error(`mbb oauth failed (${mbbAuth.status})`);
  const mbbAuthJson = mbbAuth.data;

  // Immediate refresh (matches HA flow)
  const mbbRefreshBody = new URLSearchParams({
    grant_type: "refresh_token",
    token: String(mbbAuthJson.refresh_token || ""),
    scope: "sc2:fal",
  }).toString();

  const mbbRefresh = await axios.post(`${mbbOAuthBaseURL}/mobile/oauth2/v1/token`, mbbRefreshBody, {
    headers: {
      Accept: "application/json",
      "Accept-Charset": "utf-8",
      "User-Agent": HDR_USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Client-ID": xclientId,
      Cookie: cookieHeaderForUrl(regJar, `${mbbOAuthBaseURL}/mobile/oauth2/v1/token`),
    },
    maxRedirects: 0,
    validateStatus: () => true,
  });
  if (mbbRefresh.status !== 200) throw new Error(`mbb refresh failed (${mbbRefresh.status})`);
  const vwTokenJson = mbbRefresh.data;

  const expIn = Number(bearerTokenJson.expires_in);
  const bearerExpiresAt =
    Number.isFinite(expIn) && expIn > 0 ? Date.now() + expIn * 1000 : Date.now() + 3540 * 1000;

  /** @type {AudiConnectState} */
  const state = {
    country,
    clientId,
    language,
    authorizationServerBaseLive,
    mbbOAuthBaseURL,
    tokenEndpoint,
    authorizationEndpoint,
    bearerToken: bearerTokenJson,
    audiToken: audiTokenJson,
    xclientId,
    vwToken: vwTokenJson,
    bearerExpiresAt,
    updatedAt: Date.now(),
  };

  writeJsonFile(DATA_PATH, state);
  return state;
}

async function graphqlVehicleList(bearerAccessToken, country, language) {
  const url = graphqlEndpoint(country);
  const query = `query vehicleList {\n userVehicles {\n vin\n nickname\n vehicle { core { modelYear } media { shortName longName } }\n }\n}`;
  const lang = String(language || "en").trim() || "en";
  const res = await axios.post(
    url,
    { query },
    {
      headers: {
        Accept: "application/json",
        "Accept-Charset": "utf-8",
        "X-App-Name": "myAudi",
        "X-App-Version": HDR_XAPP_VERSION,
        "Accept-Language": `${lang}-${country}`,
        "X-User-Country": country,
        "User-Agent": HDR_USER_AGENT,
        Authorization: `Bearer ${bearerAccessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      validateStatus: () => true,
    }
  );
  if (res.status !== 200) throw new Error(`graphql vehicles failed (${res.status})`);
  if (res.data?.errors?.length) throw new Error(`graphql error: ${JSON.stringify(res.data.errors).slice(0, 220)}`);
  return res.data?.data?.userVehicles || [];
}

/** @param {unknown} err */
function isAudiAuthHttpError(err) {
  const m = String(err instanceof Error ? err.message : err);
  return /\((401|403)\)/.test(m) || m.includes("failed (401)") || m.includes("failed (403)");
}

/**
 * Refresh IDK bearer (GraphQL / Cariad) using stored `refresh_token`. VW token is unchanged.
 * @returns {Promise<boolean>}
 */
async function refreshAudiIdkBearer() {
  const st = getAudiConnectState();
  const rt = st?.bearerToken?.refresh_token;
  const tokenEndpoint = st?.tokenEndpoint;
  const clientId = st?.clientId;
  if (!st || !rt || !tokenEndpoint || !clientId) return false;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: String(rt),
    client_id: String(clientId),
  }).toString();
  const bearerTok = await axios.post(tokenEndpoint, body, {
    headers: {
      Accept: "application/json",
      "Accept-Charset": "utf-8",
      "X-QMAuth": calculateXQmAuth(),
      "User-Agent": HDR_USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    maxRedirects: 0,
    validateStatus: () => true,
  });
  if (bearerTok.status !== 200) return false;
  const fresh = /** @type {Record<string, unknown>} */ (bearerTok.data);
  const mergedBearer = { ...st.bearerToken, ...fresh };
  if (!mergedBearer.refresh_token) mergedBearer.refresh_token = rt;
  const expIn = Number(fresh.expires_in);
  const bearerExpiresAt =
    Number.isFinite(expIn) && expIn > 0 ? Date.now() + expIn * 1000 : Date.now() + 3540 * 1000;
  const next = {
    ...st,
    bearerToken: mergedBearer,
    bearerExpiresAt,
    updatedAt: Date.now(),
  };
  writeJsonFile(DATA_PATH, next);
  return true;
}

async function cariadSelectiveStatus(bearerAccessToken, country, vin, jobs) {
  const base = cariadBaseUrl(country);
  const url = `${base}/vehicle/v1/vehicles/${encodeURIComponent(vin)}/selectivestatus?jobs=${encodeURIComponent(jobs)}`;
  const res = await axios.get(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${bearerAccessToken}`,
      "User-Agent": HDR_USER_AGENT,
    },
    validateStatus: () => true,
  });
  // Cariad often returns 207 Multi-Status when some `jobs` succeed and others are empty/unavailable — still JSON body.
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`vehicle status failed (${res.status})`);
  }
  return res.data;
}

export async function getAudiVehicleSnapshot() {
  let st = getAudiConnectState();
  if (!st?.bearerToken?.access_token) throw new Error("Audi Connect not logged in.");
  const country = st.country || getCountry();
  const language = String(st.language || "en");
  const vinCfg = getConfiguredVin();

  const bearerExp = Number(st.bearerExpiresAt);
  if (Number.isFinite(bearerExp) && Date.now() > bearerExp - 90_000 && st.bearerToken?.refresh_token) {
    await refreshAudiIdkBearer();
    st = getAudiConnectState();
    if (!st?.bearerToken?.access_token) throw new Error("Audi Connect not logged in.");
  }

  const bearer = () => String(getAudiConnectState()?.bearerToken?.access_token || st.bearerToken.access_token);

  let vehicles;
  try {
    vehicles = await graphqlVehicleList(bearer(), country, language);
  } catch (e) {
    if (isAudiAuthHttpError(e) && getAudiConnectState()?.bearerToken?.refresh_token) {
      const ok = await refreshAudiIdkBearer();
      if (!ok) throw e;
      st = getAudiConnectState();
      vehicles = await graphqlVehicleList(bearer(), country, language);
    } else throw e;
  }
  const primary = vinCfg
    ? vehicles.find((v) => String(v?.vin || "").toUpperCase() === vinCfg) || null
    : vehicles[0] || null;
  const vin = String(primary?.vin || vinCfg || "").toUpperCase();
  if (!vin) throw new Error("No VIN found (set ZEE_AUDI_VIN or connect an account with vehicles).");

  const jobs = ["measurements", "fuelStatus", "charging", "climatisation", "access", "vehicleLights"];
  let status;
  try {
    status = await cariadSelectiveStatus(bearer(), country, vin, jobs.join(","));
  } catch (e) {
    if (isAudiAuthHttpError(e) && getAudiConnectState()?.bearerToken?.refresh_token) {
      const ok = await refreshAudiIdkBearer();
      if (!ok) throw e;
      status = await cariadSelectiveStatus(bearer(), country, vin, jobs.join(","));
    } else throw e;
  }

  const odometerKm = status?.measurements?.odometerStatus?.value?.odometer ?? null;
  const fuelPct = pickFuelLevelPct(status);
  const fuelRangeKm = status?.fuelStatus?.rangeStatus?.value?.totalRange_km ?? null;
  const batPct = status?.charging?.batteryStatus?.value?.currentSOC_pct ?? null;
  const rangeKm = status?.charging?.batteryStatus?.value?.cruisingRangeElectric_km ?? null;
  const access = buildAccessSnapshot(status);

  return {
    vin,
    nickname: primary?.nickname || null,
    model: primary?.vehicle?.media?.shortName || primary?.vehicle?.media?.longName || null,
    modelYear: primary?.vehicle?.core?.modelYear || null,
    odometerKm,
    fuelPct,
    fuelRangeKm,
    batteryPct: batPct,
    evRangeKm: rangeKm,
    access,
    raw: status,
  };
}
