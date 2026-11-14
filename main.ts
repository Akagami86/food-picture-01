// food-picture-01 entry: "Golden Plated Feast" — a top-down ramen bowl,
// drawn entirely in code (Node standard library only, no assets, no network).
// The program renders the picture pixel by pixel with soft shapes, seeded
// detail and gentle shading, supersamples it for smooth edges, and writes
// a deterministic PNG to /output/entry.png (or $MAKEFUN_OUTPUT_DIR).

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------- canvas --
const OUT = 1024; // final image is OUT x OUT
const SS = 2; // supersample factor while drawing
const W = OUT * SS;
const H = OUT * SS;
const buf = new Float32Array(W * H * 3);

// Deterministic PRNG (mulberry32) so both grader runs write the same bytes.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261114);

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a, b, t) => a + (b - a) * t;
const mixc = (c1, c2, t) => [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];

// Filled disc; shade(t) maps normalised radius 0..1 to a colour.
function disc(cx, cy, r, shade, alpha = 1) {
  const x0 = Math.max(0, Math.floor((cx - r - 1) * SS)), x1 = Math.min(W - 1, Math.ceil((cx + r + 1) * SS));
  const y0 = Math.max(0, Math.floor((cy - r - 1) * SS)), y1 = Math.min(H - 1, Math.ceil((cy + r + 1) * SS));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x / SS - cx, dy = y / SS - cy, d = Math.hypot(dx, dy);
    if (d > r + 0.7) continue;
    const edge = clamp(r + 0.7 - d, 0, 1);
    const i = (y * W + x) * 3, c = typeof shade === 'function' ? shade(clamp(d / r, 0, 1), dx, dy) : shade;
    const al = alpha * edge;
    buf[i] = mix(buf[i], c[0], al); buf[i + 1] = mix(buf[i + 1], c[1], al); buf[i + 2] = mix(buf[i + 2], c[2], al);
  }
}

// Filled rotated ellipse.
function ellipse(cx, cy, rx, ry, rot, c, alpha = 1) {
  const R = Math.hypot(rx, ry), cs = Math.cos(rot), sn = Math.sin(rot);
  const x0 = Math.max(0, Math.floor((cx - R - 1) * SS)), x1 = Math.min(W - 1, Math.ceil((cx + R + 1) * SS));
  const y0 = Math.max(0, Math.floor((cy - R - 1) * SS)), y1 = Math.min(H - 1, Math.ceil((cy + R + 1) * SS));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x / SS - cx, dy = y / SS - cy;
    const u = (dx * cs + dy * sn) / rx, v = (-dx * sn + dy * cs) / ry, d = Math.hypot(u, v);
    if (d > 1.02) continue;
    const i = (y * W + x) * 3, al = alpha * clamp((1.02 - d) * 24, 0, 1);
    buf[i] = mix(buf[i], c[0], al); buf[i + 1] = mix(buf[i + 1], c[1], al); buf[i + 2] = mix(buf[i + 2], c[2], al);
  }
}

// Ring (stroked circle outline).
function ring(cx, cy, r, w, c, alpha = 1) {
  const ro = r + w / 2;
  const x0 = Math.max(0, Math.floor((cx - ro - 1) * SS)), x1 = Math.min(W - 1, Math.ceil((cx + ro + 1) * SS));
  const y0 = Math.max(0, Math.floor((cy - ro - 1) * SS)), y1 = Math.min(H - 1, Math.ceil((cy + ro + 1) * SS));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = Math.abs(Math.hypot(x / SS - cx, y / SS - cy) - r);
    if (d > w / 2 + 0.7) continue;
    const i = (y * W + x) * 3, al = alpha * clamp(w / 2 + 0.7 - d, 0, 1);
    buf[i] = mix(buf[i], c[0], al); buf[i + 1] = mix(buf[i + 1], c[1], al); buf[i + 2] = mix(buf[i + 2], c[2], al);
  }
}

// Arc stroke (part of a circle), angles in radians.
function arc(cx, cy, r, a0, a1, w, c, alpha = 1) {
  const steps = Math.max(8, Math.ceil(Math.abs(a1 - a0) * r * 2));
  for (let s = 0; s <= steps; s++) {
    const a = a0 + ((a1 - a0) * s) / steps;
    disc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, w / 2, c, alpha);
  }
}

// Thick smooth stroke through points.
function stroke(pts, w, c, alpha) {
  for (let s = 0; s < pts.length - 1; s++) {
    const [x0, y0] = pts[s], [x1, y1] = pts[s + 1];
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5));
    for (let i = 0; i <= n; i++) disc(mix(x0, x1, i / n), mix(y0, y1, i / n), w / 2, c, alpha);
  }
}

// Rotated rectangle.
function rect(cx, cy, w, h, rot, c, alpha = 1) {
  const R = Math.hypot(w, h) / 2, cs = Math.cos(rot), sn = Math.sin(rot);
  const x0 = Math.max(0, Math.floor((cx - R - 1) * SS)), x1 = Math.min(W - 1, Math.ceil((cx + R + 1) * SS));
  const y0 = Math.max(0, Math.floor((cy - R - 1) * SS)), y1 = Math.min(H - 1, Math.ceil((cy + R + 1) * SS));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x / SS - cx, dy = y / SS - cy;
    const u = Math.abs(dx * cs + dy * sn), v = Math.abs(-dx * sn + dy * cs);
    const d = Math.max(u - w / 2, v - h / 2);
    if (d > 0.7) continue;
    const i = (y * W + x) * 3, al = alpha * clamp(0.7 - d, 0, 1);
    buf[i] = mix(buf[i], c[0], al); buf[i + 1] = mix(buf[i + 1], c[1], al); buf[i + 2] = mix(buf[i + 2], c[2], al);
  }
}

// ------------------------------------------------------------- background --
// Warm dark wooden table: radial light from the upper middle, plank seams.
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const ox = x / SS, oy = y / SS;
  const glow = clamp(1 - Math.hypot(ox - 512, oy - 330) / 780, 0, 1);
  const vig = clamp(1 - Math.hypot(ox - 512, oy - 512) / 900, 0, 1);
  let c = mixc([26, 15, 10], [74, 44, 26], glow * 0.85 + vig * 0.2);
  const seam = Math.abs(((oy + 40) % 170) - 85) / 85;
  if (seam > 0.965) c = mixc(c, [12, 7, 5], 0.55);
  const grain = Math.sin(ox * 0.11 + Math.sin(oy * 0.013) * 6) * 3.5;
  const i = (y * W + x) * 3;
  buf[i] = c[0] + grain; buf[i + 1] = c[1] + grain * 0.7; buf[i + 2] = c[2] + grain * 0.4;
}

// Soft pool of warm light behind the bowl.
ellipse(512, 520, 480, 470, 0, [120, 74, 36], 0.35);

// ------------------------------------------------------------------ bowl --
const CX = 512, CY = 528;
// Drop shadow, then the lacquered outer bowl.
ellipse(CX + 16, CY + 42, 392, 372, 0, [0, 0, 0], 0.42);
disc(CX, CY, 382, (t) => mixc([122, 30, 26], [52, 10, 10], t));
disc(CX, CY - 6, 360, (t) => mixc([168, 44, 36], [96, 20, 18], t));
// Cream ceramic rim with a thin gold line.
disc(CX, CY - 6, 330, (t) => mixc([250, 240, 222], [226, 208, 178], t));
ring(CX, CY - 6, 318, 5, [198, 152, 74], 0.9);

// Rich amber broth, lighter where the light lands.
disc(CX, CY - 6, 304, (t, dx, dy) => {
  const light = clamp(1 - Math.hypot(dx + 60, dy + 70) / 430, 0, 1);
  return mixc(mixc([196, 104, 26], [146, 66, 14], t), [240, 158, 52], light * 0.55);
});

// Nori sheets standing at the back of the bowl.
rect(415, 268, 118, 168, -0.14, [26, 38, 28], 0.97);
rect(418, 268, 118, 168, -0.14, [40, 58, 40], 0.35);
rect(548, 252, 112, 176, 0.1, [22, 33, 25], 0.97);
rect(551, 252, 112, 176, 0.1, [38, 54, 38], 0.35);

// Noodle swirls under the toppings: many pale arcs at seeded angles.
for (let n = 0; n < 130; n++) {
  const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * 238;
  const nx = CX + Math.cos(a) * rr, ny = CY - 6 + Math.sin(a) * rr * 0.96;
  const r = 16 + rand() * 52, s = rand() * Math.PI * 2, len = 1.2 + rand() * 2.6;
  arc(nx, ny, r, s, s + len, 6.5, [243, 209, 128], 0.5 + rand() * 0.35);
  arc(nx, ny, r * 0.62, s + 0.7, s + 0.7 + len * 0.8, 5, [250, 226, 160], 0.4);
}

// Glossy oil droplets and chilli specks in the broth.
for (let n = 0; n < 90; n++) {
  const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * 282;
  const x = CX + Math.cos(a) * rr, y = CY - 6 + Math.sin(a) * rr;
  disc(x, y, 2.5 + rand() * 7, [252, 196, 92], 0.28 + rand() * 0.3);
}
for (let n = 0; n < 46; n++) {
  const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * 270;
  disc(CX + Math.cos(a) * rr, CY - 6 + Math.sin(a) * rr, 1.6 + rand() * 2.4, [178, 44, 18], 0.55);
}

// -------------------------------------------------------------- toppings --
// Menma (bamboo shoots): a neat stack of golden batons at the right.
for (let n = 0; n < 6; n++) {
  rect(706 + (n % 2) * 16 - 8, 408 + n * 21, 104, 15, 0.5 + (n % 3) * 0.05, [216, 164, 92], 0.95);
  rect(706 + (n % 2) * 16 - 8, 405 + n * 21, 104, 5, 0.5 + (n % 3) * 0.05, [240, 196, 120], 0.8);
}

// Chashu pork slices: seared rims, marbled centres, a darker spiral.
function chashu(cx, cy, r) {
  disc(cx, cy, r, (t) => mixc([233, 178, 128], [206, 138, 88], t));
  ring(cx, cy, r - 5, 11, [150, 84, 44], 0.95);
  ring(cx, cy, r - 16, 4, [250, 222, 190], 0.7);
  arc(cx, cy, r * 0.52, 0.4, 4.6, 7, [190, 116, 64], 0.75);
  arc(cx, cy, r * 0.3, 2.4, 6.4, 6, [250, 228, 198], 0.8);
  arc(cx, cy, r * 0.66, 3.4, 5.6, 5, [250, 228, 198], 0.55);
  disc(cx - r * 0.3, cy - r * 0.34, r * 0.2, [255, 240, 214], 0.35);
}
chashu(388, 448, 82);
chashu(512, 402, 88);
chashu(632, 452, 80);

// Narutomaki: white discs with a pink spiral.
function naruto(cx, cy, r) {
  disc(cx, cy, r, [252, 250, 246]);
  ring(cx, cy, r - 2, 4, [238, 200, 200], 0.8);
  arc(cx, cy, r * 0.55, 0, 4.4, 5.5, [240, 130, 160], 0.95);
  arc(cx, cy, r * 0.3, 1.2, 5.6, 5, [240, 130, 160], 0.95);
  disc(cx, cy, r * 0.1, [240, 130, 160], 0.9);
}
naruto(462, 566, 31);
naruto(528, 540, 34);
naruto(576, 584, 29);

// Ajitama eggs: glossy whites with deep golden jammy yolks.
function egg(cx, cy, rot) {
  ellipse(cx, cy, 66, 49, rot, [252, 247, 236], 1);
  ellipse(cx - 4, cy - 4, 58, 42, rot, [255, 252, 244], 1);
  ellipse(cx, cy, 27, 24, rot, [246, 158, 28], 1);
  ellipse(cx - 3, cy - 3, 21, 18, rot, [252, 178, 44], 1);
  ellipse(cx - 8, cy - 9, 8, 6, rot, [255, 226, 150], 0.95);
}
egg(664, 622, -0.45);
egg(372, 640, 0.35);

// Spring onions: bright little rings scattered over everything.
for (let n = 0; n < 120; n++) {
  const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * 278;
  const x = CX + Math.cos(a) * rr, y = CY - 6 + Math.sin(a) * rr;
  ring(x, y, 4.6 + rand() * 3.4, 3.6, [96, 178, 62], 0.95);
  disc(x, y, 2.2, [52, 122, 40], 0.85);
}
// Sesame seeds.
for (let n = 0; n < 70; n++) {
  const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * 262;
  ellipse(CX + Math.cos(a) * rr, CY - 6 + Math.sin(a) * rr, 3.6, 2, rand() * 3, [250, 238, 208], 0.8);
}

// --------------------------------------------------------------- service --
// Chopsticks resting on the bowl's right rim, with their shadow.
rect(806, 300, 300, 17, 0.72, [0, 0, 0], 0.25);
rect(800, 292, 310, 16, 0.72, [146, 96, 52], 1);
rect(830, 330, 290, 15, 0.78, [0, 0, 0], 0.22);
rect(824, 322, 300, 15, 0.78, [168, 112, 62], 1);
rect(688, 208, 60, 18, 0.72, [198, 152, 74], 1);

// Two chillies and scattered herbs on the table.
ellipse(214, 806, 52, 17, -0.5, [196, 40, 26], 1);
ellipse(206, 800, 40, 9, -0.5, [232, 84, 52], 0.9);
rect(168, 776, 26, 10, -0.7, [70, 138, 52], 1);
ellipse(292, 848, 46, 15, 0.4, [178, 34, 22], 1);
ellipse(286, 843, 34, 8, 0.4, [222, 76, 46], 0.9);
for (let n = 0; n < 42; n++) {
  const x = 90 + rand() * 844, y = 90 + rand() * 844;
  if (Math.hypot(x - CX, y - CY) < 404) continue;
  disc(x, y, 2 + rand() * 3.4, [104, 168, 70], 0.5 + rand() * 0.4);
}

// Warm sheen from the upper left over the whole scene.
for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
  const g = clamp(1 - Math.hypot(x / SS - 300, y / SS - 210) / 720, 0, 1) * 0.1;
  if (g <= 0.004) continue;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const i = ((y + dy) * W + (x + dx)) * 3;
    buf[i] = mix(buf[i], 255, g); buf[i + 1] = mix(buf[i + 1], 236, g); buf[i + 2] = mix(buf[i + 2], 200, g);
  }
}

// ----------------------------------------------------------------- steam --
// Gentle steam curling up from the hot broth: three soft sine strokes,
// each a wide faint halo under a narrower brighter core.
for (const [sx, phase, sway] of [[398, 0.4, 26], [512, 2.2, 34], [622, 4.1, 24]]) {
  // Drawn segment by segment, fading as it rises, so it stays a wisp.
  for (let s = 0; s < 14; s++) {
    const t0 = s / 14, t1 = (s + 1) / 14;
    const p0 = [sx + Math.sin(phase + t0 * 4.4) * sway * t0, 366 - t0 * 252];
    const p1 = [sx + Math.sin(phase + t1 * 4.4) * sway * t1, 366 - t1 * 252];
    const fade = (1 - t0) * (0.35 + 0.65 * t0);
    stroke([p0, p1], 30, [255, 250, 240], 0.028 * fade + 0.006);
    stroke([p0, p1], 13, [255, 252, 246], 0.045 * fade + 0.008);
  }
}

// Final gloss: broth sheen crescents and a wet shine on each chashu slice.
arc(CX, CY - 6, 268, 2.55, 3.65, 15, [255, 214, 130], 0.13);
arc(CX, CY - 6, 238, 5.5, 6.15, 11, [255, 220, 150], 0.1);
for (const [hx, hy] of [[388, 448], [512, 402], [632, 452]]) {
  ellipse(hx - 26, hy - 34, 34, 15, -0.6, [255, 246, 224], 0.28);
}
// A lifted tangle of noodles spilling over the middle chashu, glossy and hot.
for (let n = 0; n < 12; n++) {
  const nx = 500 + (rand() - 0.5) * 90, ny = 356 + (rand() - 0.5) * 36;
  const r = 12 + rand() * 22, s = rand() * Math.PI * 2;
  arc(nx, ny, r, s, s + 1.6 + rand() * 1.6, 6, [246, 216, 138], 0.85);
}

// ------------------------------------------------------------ PNG output --
const outBuf = new Uint8Array(OUT * OUT * 3);
for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) {
  let r = 0, g = 0, b = 0;
  for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
    const i = ((y * SS + dy) * W + (x * SS + dx)) * 3;
    r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
  }
  const o = (y * OUT + x) * 3, n = SS * SS;
  outBuf[o] = clamp(Math.round(r / n), 0, 255);
  outBuf[o + 1] = clamp(Math.round(g / n), 0, 255);
  outBuf[o + 2] = clamp(Math.round(b / n), 0, 255);
}

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OUT, 0); ihdr.writeUInt32BE(OUT, 4);
ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolour
const raw = Buffer.alloc((OUT * 3 + 1) * OUT);
for (let y = 0; y < OUT; y++) {
  raw[y * (OUT * 3 + 1)] = 0; // filter: none
  Buffer.from(outBuf.buffer, y * OUT * 3, OUT * 3).copy(raw, y * (OUT * 3 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), png);
console.log(`wrote ${join(outDir, 'entry.png')} (${png.length} bytes)`);
