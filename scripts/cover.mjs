// -----------------------------------------------------------------------------
// Generates cover.png (800×534, the store size): a dark-to-teal gradient, the
// rings of a network scan around a router, and the devices found on it
// (online ones lit green, one grey offline, one amber just arrived). Plain
// Node (zlib), no dependency, no logo.
// Run: npm run cover
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WIDTH = 800;
const HEIGHT = 534;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
const smooth = (edge, distance) => Math.min(1, Math.max(0, edge - distance + 0.5));

const DARK = [10, 18, 28];
const TEAL = [16, 84, 104];
const WHITE = [236, 244, 248];
const GREEN = [70, 210, 120];
const GREY = [120, 130, 145];
const AMBER = [255, 170, 50];
const RING = [90, 190, 210];

const CENTER = [400, 267];
// The devices: [x, y, radius, light].
const DEVICES = [
  [180, 150, 30, GREEN],
  [620, 130, 30, GREEN],
  [130, 380, 30, GREY],
  [660, 400, 30, AMBER],
  [400, 470, 26, GREEN],
  [400, 66, 26, GREEN],
  [260, 300, 22, GREEN],
  [545, 270, 22, GREEN],
];

function segment(x, y, [x0, y0], [x1, y1]) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
}

function pixel(x, y) {
  let color = mix(DARK, TEAL, (x / WIDTH) * 0.45 + (y / HEIGHT) * 0.55);
  const r = Math.hypot(x - CENTER[0], y - CENTER[1]);
  // The scan rings.
  for (const ring of [90, 170, 250, 330]) {
    color = mix(color, RING, smooth(1.5, Math.abs(r - ring)) * 0.35);
  }
  // Links from the router to the devices online.
  for (const [dx, dy, , light] of DEVICES) {
    if (light === GREY) continue;
    const d = segment(x, y, CENTER, [dx, dy]);
    color = mix(color, RING, smooth(1.8, d) * 0.6);
  }
  // The router: a rounded box with three lights.
  const qx = Math.abs(x - CENTER[0]) - 54;
  const qy = Math.abs(y - CENTER[1]) - 22;
  const box = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 10;
  color = mix(color, WHITE, smooth(0, box) * 0.95);
  color = mix(color, DARK, smooth(-5, box) * 0.85);
  for (const lx of [-28, 0, 28]) {
    color = mix(color, GREEN, smooth(6, Math.hypot(x - (CENTER[0] + lx), y - CENTER[1])));
  }
  for (const [cx, cy, radius, light] of DEVICES) {
    const dist = Math.hypot(x - cx, y - cy);
    color = mix(color, WHITE, smooth(radius, dist) * 0.95);
    color = mix(color, DARK, smooth(radius - 4, dist) * 0.85);
    color = mix(color, light, smooth(radius * 0.42, dist));
  }
  return color;
}

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw.set([r, g, b], row + 1 + x * 3);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../cover.png', import.meta.url), png);
console.log(`cover.png: ${WIDTH}×${HEIGHT}, ${png.length} bytes`);
