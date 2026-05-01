import { createRequire } from 'module';
import { mkdirSync, writeFileSync } from 'fs';
const require = createRequire(import.meta.url);
const zlib = require('zlib');
const path = require('path');

const OUT = 'src-tauri/icons';
mkdirSync(OUT, { recursive: true });

// CRC32 table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type), data]);
  const chksum = Buffer.alloc(4); chksum.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, chksum]);
}

// Build a solid color RGBA PNG
function makePNG(size, r, g, b, a = 255) {
  const rowLen = size * 4 + 1;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const i = y * rowLen + 1 + x * 4;
      raw[i] = r; raw[i+1] = g; raw[i+2] = b; raw[i+3] = a;
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Orchestrator brand color: deep blue
const [R, G, B] = [30, 64, 175]; // blue-700

const p32   = makePNG(32,   R, G, B);
const p128  = makePNG(128,  R, G, B);
const p256  = makePNG(256,  R, G, B);
const p512  = makePNG(512,  R, G, B);
const p1024 = makePNG(1024, R, G, B);

writeFileSync(`${OUT}/32x32.png`,       p32);
writeFileSync(`${OUT}/128x128.png`,     p128);
writeFileSync(`${OUT}/128x128@2x.png`,  p256);
console.log('PNG icons written');

// --- ICO (Windows) ---
// Embed four sizes: 16, 32, 48, 256
const p16  = makePNG(16, R, G, B);
const p48  = makePNG(48, R, G, B);
const icoImages = [
  { size: 16,  data: p16  },
  { size: 32,  data: p32  },
  { size: 48,  data: p48  },
  { size: 256, data: p256 }, // size byte = 0 means 256
];
const headerSize = 6;
const dirSize = icoImages.length * 16;
let offset = headerSize + dirSize;
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2); // type: icon
icoHeader.writeUInt16LE(icoImages.length, 4);
const dirEntries = icoImages.map(({ size, data }) => {
  const e = Buffer.alloc(16);
  e[0] = size >= 256 ? 0 : size;
  e[1] = size >= 256 ? 0 : size;
  e[2] = 0; e[3] = 0;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});
writeFileSync(`${OUT}/icon.ico`,
  Buffer.concat([icoHeader, ...dirEntries, ...icoImages.map(i => i.data)]));
console.log('icon.ico written');

// --- ICNS (macOS) ---
// Use PNG data chunks directly (supported since OS X 10.7)
// Type codes: icp4=16, icp5=32, icp6=48, ic07=128, ic08=256, ic09=512, ic10=1024
const icnsEntries = [
  ['icp4', p16], ['icp5', p32], ['ic07', p128], ['ic08', p256], ['ic09', p512], ['ic10', p1024],
];
function icnsChunk(type, data) {
  const h = Buffer.alloc(8);
  Buffer.from(type).copy(h, 0);
  h.writeUInt32BE(8 + data.length, 4);
  return Buffer.concat([h, data]);
}
const chunks = icnsEntries.map(([t, d]) => icnsChunk(t, d));
const totalLen = 8 + chunks.reduce((s, c) => s + c.length, 0);
const icnsHeader = Buffer.alloc(8);
Buffer.from('icns').copy(icnsHeader, 0);
icnsHeader.writeUInt32BE(totalLen, 4);
writeFileSync(`${OUT}/icon.icns`, Buffer.concat([icnsHeader, ...chunks]));
console.log('icon.icns written');

console.log('All icons generated in', OUT);
console.log('Replace with proper artwork when ready: npx tauri icon <square-image.png>');
