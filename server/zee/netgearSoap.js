/**
 * Minimal NETGEAR Genie SOAP client (patterns from pyNetgear / Home Assistant).
 * Unofficial API — firmware updates can break it. Use only on your LAN.
 * @see https://gitlab.com/matmaul/pynetgear
 */
import axios from "axios";
import https from "https";

const SERVICE_PREFIX = "urn:NETGEAR-ROUTER:service:";
const SESSION_ID = "A7D88AE69687E58D9A00";

/** @type {import("https").Agent | undefined} */
let insecureHttpsAgent;

function getHttpsAgent() {
  if (!insecureHttpsAgent) insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });
  return insecureHttpsAgent;
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** SOAP body: one method element with xsi:nil (DeviceInfo / DeviceConfig reads). */
function envelopeNil(service, method) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  soap:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"
  xmlns:M1="urn:NETGEAR-ROUTER:service:${service}"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soap:Header>
    <SessionID>${SESSION_ID}</SessionID>
  </soap:Header>
  <soap:Body>
    <M1:${method} xsi:nil="true" />
  </soap:Body>
</soap:Envelope>`;
}

/** SOAP body: method wrapper with inner child elements only. */
function envelopeParams(service, method, innerXml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  soap:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"
  xmlns:M1="urn:NETGEAR-ROUTER:service:${service}"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soap:Header>
    <SessionID>${SESSION_ID}</SessionID>
  </soap:Header>
  <soap:Body>
    <M1:${method}>
      ${innerXml}
    </M1:${method}>
  </soap:Body>
</soap:Envelope>`;
}

function soapAction(service, method) {
  return `${SERVICE_PREFIX}${service}#${method}`;
}

function isSoapOk(xml) {
  if (!xml || typeof xml !== "string") return false;
  if (/<ResponseCode>\s*000\s*<\/ResponseCode>/i.test(xml)) return true;
  return xml.includes("<ResponseCode>000</ResponseCode>");
}

function isUnauthorized(xml) {
  return /<\s*ResponseCode\s*>\s*401\s*<\//i.test(String(xml || ""));
}

function firstTag(block, tag) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
  return m ? String(m[1]).trim() : null;
}

export class NetgearSoapClient {
  /**
   * @param {{ soapUrl: string; username: string; password: string; forceLoginV2?: boolean }} opts
   */
  constructor(opts) {
    let base = String(opts.soapUrl || "").trim();
    if (!base.endsWith("/soap/server_sa/")) {
      base = `${base.replace(/\/$/, "")}/soap/server_sa/`;
    }
    this.soapUrl = base;
    this.username = opts.username || "admin";
    this.password = opts.password || "";
    this.forceLoginV2 = Boolean(opts.forceLoginV2);
    /** @type {string | true | null} */
    this.cookie = null;
    this.configStarted = false;
    /** @type {Promise<unknown>} */
    this._chain = Promise.resolve();
  }

  /** @template T @param {() => Promise<T>} fn */
  _serial(fn) {
    const run = this._chain.then(fn, fn);
    this._chain = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  _axiosConfig() {
    const useHttps = this.soapUrl.startsWith("https:");
    return {
      timeout: 45_000,
      validateStatus: () => true,
      ...(useHttps ? { httpsAgent: getHttpsAgent() } : {}),
    };
  }

  /**
   * @param {string} service e.g. DeviceInfo:1
   * @param {string} method
   * @param {string} bodyXml full SOAP XML
   * @param {{ needAuth?: boolean }} [meta]
   */
  async _postRaw(service, method, bodyXml, meta = {}) {
    const needAuth = meta.needAuth !== false;
    const headers = {
      SOAPAction: soapAction(service, method),
      "Cache-Control": "no-cache",
      "User-Agent": "TCG-Zee-Netgear/1",
      "Content-Type": "text/xml; charset=utf-8",
    };
    if (needAuth && typeof this.cookie === "string") {
      headers.Cookie = this.cookie;
    }

    const doReq = async () =>
      axios.post(this.soapUrl, bodyXml, {
        ...this._axiosConfig(),
        headers,
      });

    if (needAuth && !this.cookie) {
      const ok = await this.login();
      if (!ok) return { ok: false, status: 0, text: "", setCookie: null };
    }

    let res = await doReq();
    let text = String(res.data || "");
    if (needAuth && isUnauthorized(text)) {
      this.cookie = null;
      if (await this.login()) {
        if (typeof this.cookie === "string") headers.Cookie = this.cookie;
        res = await doReq();
        text = String(res.data || "");
      }
    }
    const ok = res.status === 200 && isSoapOk(text);
    const sc = res.headers["set-cookie"];
    const setCookie = sc ? (Array.isArray(sc) ? sc.join("; ") : String(sc)) : null;
    return { ok, status: res.status, text, setCookie };
  }

  async login() {
    this.cookie = null;
    if (!this.forceLoginV2) {
      const v1 = await this._loginV1();
      if (v1) return true;
    }
    return this._loginV2();
  }

  async _loginV1() {
    const customBody = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  soap:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"
  xmlns:M1="urn:NETGEAR-ROUTER:service:ParentalControl:1"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soap:Header>
    <SessionID>${SESSION_ID}</SessionID>
  </soap:Header>
  <soap:Body>
    <M1:Authenticate>
      <NewUserName xsi:type="xsd:string">${xmlEscape(this.username)}</NewUserName>
      <NewPassword xsi:type="xsd:string">${xmlEscape(this.password)}</NewPassword>
    </M1:Authenticate>
  </soap:Body>
</soap:Envelope>`;
    const r = await this._postRaw("ParentalControl:1", "Authenticate", customBody, { needAuth: false });
    if (r.ok) {
      this.cookie = true;
      return true;
    }
    return false;
  }

  async _loginV2() {
    const body = envelopeParams(
      "DeviceConfig:1",
      "SOAPLogin",
      `
      <Username>${xmlEscape(this.username)}</Username>
      <Password>${xmlEscape(this.password)}</Password>`
    );
    const r = await this._postRaw("DeviceConfig:1", "SOAPLogin", body, { needAuth: false });
    if (!r.ok) return false;
    this.cookie = r.setCookie || true;
    return true;
  }

  async getAttachDevice2() {
    return this._serial(async () => {
      const body = envelopeNil("DeviceInfo:1", "GetAttachDevice2");
      const r = await this._postRaw("DeviceInfo:1", "GetAttachDevice2", body);
      const text = r.text;
      if (!r.ok) return { ok: false, error: "GetAttachDevice2 failed", raw: text.slice(0, 400) };
      const m = /<NewAttachDevice>([\s\S]*?)<\/NewAttachDevice>/i.exec(text);
      if (!m) return { ok: false, error: "No NewAttachDevice in response", raw: text.slice(0, 400) };
      const block = m[1];
      const devices = [];
      const re = /<Device>([\s\S]*?)<\/Device>/gi;
      let x;
      while ((x = re.exec(block))) {
        const seg = x[1];
        devices.push({
          name: firstTag(seg, "Name"),
          ip: firstTag(seg, "IP"),
          mac: firstTag(seg, "MAC"),
          connectionType: firstTag(seg, "ConnectionType"),
          allowOrBlock: firstTag(seg, "AllowOrBlock"),
          linkSpeed: firstTag(seg, "Linkspeed"),
        });
      }
      return { ok: true, devices };
    });
  }

  async configurationStarted() {
    const body = envelopeParams("DeviceConfig:1", "ConfigurationStarted", `<NewSessionID>${SESSION_ID}</NewSessionID>`);
    return this._postRaw("DeviceConfig:1", "ConfigurationStarted", body);
  }

  async configurationFinished() {
    const body = envelopeParams("DeviceConfig:1", "ConfigurationFinished", `<NewStatus>ChangesApplied</NewStatus>`);
    return this._postRaw("DeviceConfig:1", "ConfigurationFinished", body);
  }

  /**
   * @param {string} mac e.g. 44:85:00:7D:9B:00
   * @param {"Allow"|"Block"} status
   */
  async setBlockDeviceByMAC(mac, status) {
    return this._serial(async () => {
      if (this.configStarted) return { ok: false, error: "config session already open" };
      const start = await this.configurationStarted();
      if (!start.ok) return { ok: false, error: "ConfigurationStarted failed", raw: start.text?.slice(0, 300) };
      this.configStarted = true;
      try {
        const body = envelopeParams(
          "DeviceConfig:1",
          "SetBlockDeviceByMAC",
          `
          <NewAllowOrBlock>${status}</NewAllowOrBlock>
          <NewMACAddress>${xmlEscape(mac)}</NewMACAddress>`
        );
        const r = await this._postRaw("DeviceConfig:1", "SetBlockDeviceByMAC", body);
        if (!r.ok) return { ok: false, error: "SetBlockDeviceByMAC failed", raw: r.text?.slice(0, 400) };
        const fin = await this.configurationFinished();
        if (!fin.ok) return { ok: false, error: "ConfigurationFinished failed", raw: fin.text?.slice(0, 300) };
        return { ok: true };
      } finally {
        this.configStarted = false;
      }
    });
  }
}
