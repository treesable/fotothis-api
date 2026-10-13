// Small key-value store: Upstash Redis over its REST API (connected from Vercel's Storage tab),
// or memory when it isn't configured (local runs and tests; on Vercel memory is per instance,
// so caps and App Attest keys don't hold until Upstash is connected).

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

export const isPersistent = Boolean(url && token);
if (!isPersistent) console.warn("No Upstash Redis configured: using memory (caps don't hold across instances)");

async function redis(...command) {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`Redis ${command[0]} failed: ${response.status}`);
  return (await response.json()).result;
}

const memory = new Map();
function memoryGet(key) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expires && entry.expires < Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

export const store = {
  async get(key) {
    return isPersistent ? redis("GET", key) : memoryGet(key);
  },
  async set(key, value, ttlSeconds) {
    if (isPersistent) return ttlSeconds ? redis("SET", key, value, "EX", ttlSeconds) : redis("SET", key, value);
    memory.set(key, { value: String(value), expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
  },
  /** Get and delete (one-time challenges). */
  async take(key) {
    if (isPersistent) return redis("GETDEL", key);
    const value = memoryGet(key);
    memory.delete(key);
    return value;
  },
  /** Adds `by` and returns the new value; sets the expiry when the key is new. */
  async incr(key, ttlSeconds, by = 1) {
    if (isPersistent) {
      const value = await redis("INCRBY", key, by);
      if (value === by && ttlSeconds) await redis("EXPIRE", key, ttlSeconds);
      return value;
    }
    const value = Number(memoryGet(key) ?? 0) + by;
    const existing = memory.get(key);
    memory.set(key, { value: String(value), expires: existing?.expires ?? (ttlSeconds ? Date.now() + ttlSeconds * 1000 : null) });
    return value;
  },
  /** Tests only. */
  _clearMemory() {
    memory.clear();
  },
};
