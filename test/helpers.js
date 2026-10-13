// Test helpers: a tiny CBOR encoder and fake requests/responses for the handlers.
import { Readable } from "node:stream";

export function encodeCbor(value) {
  const head = (major, length) => {
    if (length < 24) return Buffer.from([(major << 5) | length]);
    if (length < 256) return Buffer.from([(major << 5) | 24, length]);
    if (length < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(length, 1); return b; }
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(length, 1); return b;
  };
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === "string") { const s = Buffer.from(value); return Buffer.concat([head(3, s.length), s]); }
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(encodeCbor)]);
  const entries = Object.entries(value);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [encodeCbor(k), encodeCbor(v)])]);
}

export function fakeRequest({ method = "POST", headers = {}, body = "" } = {}) {
  const req = Readable.from([Buffer.from(body)]);
  req.method = method;
  req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return req;
}

export function fakeResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(text) { this.body = JSON.parse(text); },
  };
  return res;
}
