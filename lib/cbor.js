// Minimal CBOR decoder for App Attest objects (maps, arrays, byte/text strings, integers).

export function decodeCbor(buffer) {
  let offset = 0;

  function length(info) {
    if (info < 24) return info;
    if (info === 24) return buffer.readUInt8(offset++);
    if (info === 25) { const v = buffer.readUInt16BE(offset); offset += 2; return v; }
    if (info === 26) { const v = buffer.readUInt32BE(offset); offset += 4; return v; }
    if (info === 27) { const v = Number(buffer.readBigUInt64BE(offset)); offset += 8; return v; }
    throw new Error(`Unsupported CBOR length ${info}`);
  }

  function item() {
    if (offset >= buffer.length) throw new Error("CBOR ended early");
    const byte = buffer.readUInt8(offset++);
    const major = byte >> 5;
    const info = byte & 0x1f;
    switch (major) {
      case 0: return length(info);
      case 1: return -1 - length(info);
      case 2: { const n = length(info); const v = buffer.subarray(offset, offset + n); offset += n; return v; }
      case 3: { const n = length(info); const v = buffer.toString("utf8", offset, offset + n); offset += n; return v; }
      case 4: { const n = length(info); return Array.from({ length: n }, item); }
      case 5: {
        const n = length(info);
        const map = {};
        for (let i = 0; i < n; i++) { const key = item(); map[key] = item(); }
        return map;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new Error(`Unsupported CBOR simple value ${info}`);
      default:
        throw new Error(`Unsupported CBOR type ${major}`);
    }
  }

  return item();
}
