// Nutrikit JavaScript SDK — works in browsers and Node 18+ (anything with fetch).
//
//   import { Nutrikit } from './nutrikit.mjs';
//   const nk = new Nutrikit({ apiKey: 'nk_...', baseUrl: 'http://localhost:8787' });
//   const { items, totals } = await nk.logText('2 eggs and a slice of toast');

export class NutrikitError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message);
    this.name = 'NutrikitError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter ?? null;
  }
}

const RETRYABLE = new Set([429, 502, 503]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Accepts File/Blob, ArrayBuffer, Uint8Array/Buffer, a data URL or a base64 string.
async function encodeImage(image, mediaType) {
  if (typeof Blob !== 'undefined' && image instanceof Blob) {
    return { image: toBase64(new Uint8Array(await image.arrayBuffer())), mediaType: mediaType || image.type || 'image/jpeg' };
  }
  if (image instanceof ArrayBuffer) return { image: toBase64(new Uint8Array(image)), mediaType: mediaType || 'image/jpeg' };
  if (ArrayBuffer.isView(image)) return { image: toBase64(new Uint8Array(image.buffer, image.byteOffset, image.byteLength)), mediaType: mediaType || 'image/jpeg' };
  if (typeof image === 'string') return { image, mediaType: mediaType || (image.startsWith('data:') ? undefined : 'image/jpeg') };
  throw new TypeError('image must be a File/Blob, ArrayBuffer, typed array, data URL or base64 string');
}

// Without a baseUrl: the page's own origin in a browser, otherwise a local development server.
const defaultBaseUrl = () => globalThis.location?.origin || 'http://localhost:8787';

export class Nutrikit {
  /**
   * @param {{apiKey: string, baseUrl?: string, fetch?: typeof fetch, maxRetries?: number, timeoutMs?: number}} options
   */
  constructor({ apiKey, baseUrl = defaultBaseUrl(), fetch: fetchImpl, maxRetries = 2, timeoutMs = 60_000 } = {}) {
    if (!apiKey) throw new TypeError('apiKey is required');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this.maxRetries = maxRetries;
    this.timeoutMs = timeoutMs;
    /** Token accounting from the most recent call: { charged, remaining }. */
    this.lastUsage = null;
  }

  async request(method, path, { query, body } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const charged = res.headers.get('x-tokens-charged');
      if (charged != null) this.lastUsage = { charged: Number(charged), remaining: res.headers.has('x-tokens-remaining') ? Number(res.headers.get('x-tokens-remaining')) : null };
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;
      const retryAfter = res.headers.get('retry-after') ? Number(res.headers.get('retry-after')) : null;
      const err = new NutrikitError(res.status, data.error?.code || 'error', data.error?.message || res.statusText, retryAfter);
      // Quota exhaustion is a 429 that waiting a minute will not fix.
      if (!RETRYABLE.has(res.status) || err.code === 'quota_exceeded' || attempt >= this.maxRetries) throw err;
      await sleep(retryAfter != null ? retryAfter * 1000 : 500 * 2 ** attempt);
    }
  }

  // ---- food database
  /** @param {string} q @param {{limit?: number, offset?: number, source?: 'survey'|'foundation'|'sr_legacy'}} [opts] */
  searchFoods(q, opts = {}) { return this.request('GET', '/v1/foods/search', { query: { q, ...opts } }); }
  getFood(id) { return this.request('GET', `/v1/foods/${encodeURIComponent(id)}`); }
  /** @param {number} id @param {{quantity?: number, unit?: string, grams?: number}} [portion] */
  getNutrients(id, portion = {}) { return this.request('GET', `/v1/foods/${encodeURIComponent(id)}/nutrients`, { query: portion }); }
  listNutrients() { return this.request('GET', '/v1/nutrients'); }

  // ---- logging
  /** @param {string} text @param {{ai?: boolean}} [opts] */
  logText(text, { ai = false } = {}) { return this.request('POST', '/v1/log/text', { body: { text, ai } }); }
  /** @param {string} transcript @param {{ai?: boolean}} [opts] */
  logVoice(transcript, { ai = false } = {}) { return this.request('POST', '/v1/log/voice', { body: { transcript, ai } }); }
  /** @param {Blob|ArrayBuffer|Uint8Array|string} image @param {{mediaType?: string, hint?: string}} [opts] */
  async logPhoto(image, { mediaType, hint } = {}) {
    return this.request('POST', '/v1/log/photo', { body: { ...(await encodeImage(image, mediaType)), hint } });
  }

  // ---- packaged foods
  lookupBarcode(code) { return this.request('GET', `/v1/barcodes/${encodeURIComponent(String(code).trim())}`); }
  /** @param {{text?: string, image?: Blob|ArrayBuffer|Uint8Array|string, mediaType?: string}} input */
  async parseLabel(input) {
    if (input.text != null) return this.request('POST', '/v1/labels/parse', { body: { text: input.text } });
    return this.request('POST', '/v1/labels/parse', { body: await encodeImage(input.image, input.mediaType) });
  }

  // ---- planning & account
  /** @param {{calories?: number, proteinGrams?: number, diet?: string, meals?: string[], days?: number, exclude?: string[], seed?: number}} [opts] */
  createMealPlan(opts = {}) { return this.request('POST', '/v1/meal-plans', { body: opts }); }
  getUsage() { return this.request('GET', '/v1/usage'); }
  /**
   * Exchange this client's secret API key for a 1-hour access token (server-side only).
   * Hand the token to browsers/mobile apps: `new Nutrikit({ apiKey: token.access_token })`.
   */
  createAccessToken() { return this.request('POST', '/v1/auth/token'); }

  // ---- on-device capture (browser only)

  /**
   * Capture one spoken phrase with the browser's speech recognition and return the transcript.
   * Audio never leaves the device through this SDK; only the transcript is sent by voiceLog().
   */
  static listen({ lang = 'en-US', timeoutMs = 15_000 } = {}) {
    const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!Recognition) return Promise.reject(new NutrikitError(0, 'unsupported', 'speech recognition is not available in this browser'));
    return new Promise((resolve, reject) => {
      const rec = new Recognition();
      rec.lang = lang;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      const timer = setTimeout(() => rec.abort(), timeoutMs);
      rec.onresult = (e) => { clearTimeout(timer); resolve(e.results[0][0].transcript); };
      rec.onerror = (e) => { clearTimeout(timer); reject(new NutrikitError(0, 'speech_error', e.error || 'speech recognition failed')); };
      rec.onend = () => clearTimeout(timer);
      rec.start();
    });
  }

  /** listen() then logVoice(). */
  async voiceLog(opts = {}) {
    const transcript = await Nutrikit.listen(opts);
    return this.logVoice(transcript, { ai: opts.ai });
  }

  /**
   * Read barcodes from a playing <video> element with the BarcodeDetector API (Chromium, Safari 17+).
   * Resolves with the first EAN/UPC value seen.
   */
  static scanBarcode(video, { timeoutMs = 20_000, intervalMs = 250 } = {}) {
    if (!('BarcodeDetector' in globalThis)) return Promise.reject(new NutrikitError(0, 'unsupported', 'BarcodeDetector is not available in this browser'));
    const detector = new globalThis.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = async () => {
        try {
          const codes = await detector.detect(video);
          if (codes.length) return resolve(codes[0].rawValue);
        } catch { /* frame not ready */ }
        if (Date.now() - started > timeoutMs) return reject(new NutrikitError(0, 'timeout', 'no barcode found'));
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }
}

export default Nutrikit;
