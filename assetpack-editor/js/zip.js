// ---------- writing a zip ----------
// Stored, not deflated: the whole point is a folder that unzips into
// assetpacks/, and PNG and mp3 are already compressed.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipBlob(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const head = n => { const b = new Uint8Array(n); return { b, v: new DataView(b.buffer) }; };

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);

    const local = head(30);
    local.v.setUint32(0, 0x04034b50, true);
    local.v.setUint16(4, 20, true);
    local.v.setUint16(8, 0, true);          // stored
    local.v.setUint32(14, crc, true);
    local.v.setUint32(18, data.length, true);
    local.v.setUint32(22, data.length, true);
    local.v.setUint16(26, nameBytes.length, true);
    chunks.push(local.b, nameBytes, data);

    const dir = head(46);
    dir.v.setUint32(0, 0x02014b50, true);
    dir.v.setUint16(4, 20, true);
    dir.v.setUint16(6, 20, true);
    dir.v.setUint16(10, 0, true);
    dir.v.setUint32(16, crc, true);
    dir.v.setUint32(20, data.length, true);
    dir.v.setUint32(24, data.length, true);
    dir.v.setUint16(28, nameBytes.length, true);
    dir.v.setUint32(42, offset, true);
    central.push(dir.b, nameBytes);

    offset += local.b.length + nameBytes.length + data.length;
  }

  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const tail = head(22);
  tail.v.setUint32(0, 0x06054b50, true);
  tail.v.setUint16(8, files.length, true);
  tail.v.setUint16(10, files.length, true);
  tail.v.setUint32(12, dirSize, true);
  tail.v.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, tail.b], { type: 'application/zip' });
}

// ---------- reading a zip ----------
// Every file in it, by its path: stored or deflated entries (what this page
// writes, and what Windows, macOS and most tools make), found through the
// central directory at the end. Deflate is undone by the browser's own
// DecompressionStream.
async function readZip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let end = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('that is not a zip file');
  const count = dv.getUint16(end + 10, true);
  let at = dv.getUint32(end + 16, true);
  const names = new TextDecoder();
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(at, true) !== 0x02014b50) throw new Error('the zip is damaged');
    const method = dv.getUint16(at + 10, true);
    const size = dv.getUint32(at + 20, true);
    const nameLen = dv.getUint16(at + 28, true), extraLen = dv.getUint16(at + 30, true), noteLen = dv.getUint16(at + 32, true);
    const local = dv.getUint32(at + 42, true);
    const name = names.decode(u8.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + noteLen;
    if (name.endsWith('/')) continue;                  // a folder
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = u8.subarray(start, start + size);
    if (method === 0) out.set(name, raw.slice());
    else if (method === 8) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
    } else throw new Error(`${name} is packed in a way this page can't read (method ${method})`);
  }
  return out;
}
