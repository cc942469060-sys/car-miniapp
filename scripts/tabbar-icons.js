// Draws the tab bar icons (the prototype's 24×24 line icons) as 81×81 PNGs, the size WeChat recommends.
// Usage: node scripts/tabbar-icons.js — rerun after changing a path or the tab bar colors in app.json.
const fs = require('node:fs'),
  path = require('node:path'),
  zlib = require('node:zlib');
const ICONS = {
  home: ['m3 10 9-7 9 7v11h-7v-7h-4v7H3z'],
  ledger: ['M5 3h14v18H5zM8 7h8M8 11h8M8 15h4'],
  care: ['M14 4a6 6 0 0 0-7 8L3 16a3 3 0 0 0 5 5l5-5a6 6 0 0 0 7-8l-4 4-4-4z'],
  garage: ['m5 7 2-3h10l2 3 2 3v8h-3v-2H6v2H3v-8z', 'M5 9h14M7 12h1m8 0h1'],
};
const COLORS = { '': [0x78, 0x71, 0x6c], '-active': [0x06, 0x5f, 0x46] }; // tabBar color and selectedColor
const SIZE = 81,
  SCALE = 3,
  OFFSET = 4.5,
  HALF = (1.7 * SCALE) / 2,
  OUT = path.resolve(__dirname, '../miniprogram/assets/tabbar');
// Endpoint arc (no rotation) to points, following the SVG implementation notes (F.6.5).
function arc(x1, y1, rx, ry, large, sweep, x2, y2, push) {
  const hx = (x1 - x2) / 2,
    hy = (y1 - y2) / 2,
    lambda = (hx * hx) / (rx * rx) + (hy * hy) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const k =
      (large !== sweep ? 1 : -1) *
      Math.sqrt(
        Math.max(
          0,
          (rx * rx * ry * ry - rx * rx * hy * hy - ry * ry * hx * hx) / (rx * rx * hy * hy + ry * ry * hx * hx)
        )
      ),
    cxp = (k * rx * hy) / ry,
    cyp = (-k * ry * hx) / rx,
    cx = cxp + (x1 + x2) / 2,
    cy = cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy),
    t1 = angle(1, 0, (hx - cxp) / rx, (hy - cyp) / ry);
  let dt = angle((hx - cxp) / rx, (hy - cyp) / ry, (-hx - cxp) / rx, (-hy - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  for (let s = 1; s <= 32; s++) {
    const t = t1 + (dt * s) / 32;
    push(cx + rx * Math.cos(t), cy + ry * Math.sin(t));
  }
}
// Flattens an SVG path using M L H V A Z (absolute or relative) into line segments.
function segments(d) {
  const tokens = d.match(/[MLHVAZmlhvaz]|-?(?:\d+\.?\d*|\.\d+)/g),
    out = [];
  let i = 0,
    cmd = '',
    x = 0,
    y = 0,
    sx = 0,
    sy = 0;
  const num = () => Number(tokens[i++]),
    line = (nx, ny) => {
      out.push([x, y, nx, ny]);
      x = nx;
      y = ny;
    };
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) throw Error('Path must start with a command: ' + d);
    const rel = cmd === cmd.toLowerCase(),
      c = cmd.toUpperCase(),
      ox = rel ? x : 0,
      oy = rel ? y : 0;
    if (c === 'Z') {
      line(sx, sy);
      cmd = '';
    } else if (c === 'M') {
      x = sx = num() + ox;
      y = sy = num() + oy;
      cmd = rel ? 'l' : 'L';
    } else if (c === 'L') {
      const nx = num() + ox,
        ny = num() + oy;
      line(nx, ny);
    } else if (c === 'H') line(num() + ox, y);
    else if (c === 'V') line(x, num() + oy);
    else if (c === 'A') {
      const rx = num(),
        ry = num(),
        rotation = num(),
        large = num(),
        sweep = num(),
        ex = num() + ox,
        ey = num() + oy;
      if (rotation) throw Error('Rotated arcs are not supported');
      arc(x, y, rx, ry, large, sweep, ex, ey, line);
      x = ex;
      y = ey;
    }
  }
  return out;
}
const CRC = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const head = Buffer.alloc(4),
    tail = Buffer.alloc(4),
    body = Buffer.concat([Buffer.from(type), data]);
  head.writeUInt32BE(data.length);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}
// Round caps and joins come from stroking by distance to the nearest segment, with a one-pixel anti-aliased edge.
function png(segs, [r, g, b]) {
  const px = segs.map(s => s.map(v => OFFSET + SCALE * v)),
    row = SIZE * 4 + 1,
    raw = Buffer.alloc(row * SIZE);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      let d = Infinity;
      const cx = x + 0.5,
        cy = y + 0.5;
      for (const [x1, y1, x2, y2] of px) {
        const dx = x2 - x1,
          dy = y2 - y1,
          len = dx * dx + dy * dy,
          t = len ? Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / len)) : 0;
        d = Math.min(d, Math.hypot(x1 + t * dx - cx, y1 + t * dy - cy));
      }
      const o = y * row + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = Math.round(Math.max(0, Math.min(1, HALF + 0.5 - d)) * 255);
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
fs.mkdirSync(OUT, { recursive: true });
for (const [name, paths] of Object.entries(ICONS))
  for (const [suffix, color] of Object.entries(COLORS)) {
    const file = path.join(OUT, name + suffix + '.png'),
      data = png(paths.flatMap(segments), color);
    fs.writeFileSync(file, data);
    console.log(path.relative(process.cwd(), file), data.length + ' bytes');
  }
