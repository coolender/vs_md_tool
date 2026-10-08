// 生成 1024x1024 品牌 PNG 图标（蓝色背景 + 白色 "M"），作为 tauri icon 的源图。
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;
const BG = [9, 105, 218]; // #0969da accent blue
const FG = [255, 255, 255]; // white

// 构建 RGBA 像素缓冲
const pixels = Buffer.alloc(W * H * 4);

// 一个像素是否属于 "M" 字形（简化：两个斜柱 + 中间 V）
function inM(x, y) {
  // 归一化到 0..1
  const nx = x / W;
  const ny = y / H;
  // M 占据中央 0.2..0.8 水平、0.25..0.8 垂直
  if (nx < 0.2 || nx > 0.8 || ny < 0.25 || ny > 0.8) return false;
  const leftStroke = 0.08; // 笔画宽度
  const rightStroke = 0.08;
  const midStroke = 0.07;
  // 左竖
  if (nx >= 0.2 && nx <= 0.2 + leftStroke) return true;
  // 右竖
  if (nx >= 0.8 - rightStroke && nx <= 0.8) return true;
  // 左斜（从左上到中下）
  const lx = 0.2 + (0.3 - (0.5 - nx)) * 0; // 简化：用线性
  // 用对称两段斜线：左斜从 (0.2,0.25) 到 (0.5,0.55)；右斜从 (0.8,0.25) 到 (0.5,0.55)
  // 判定：点到该线段距离 < stroke/2
  const distSeg = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  };
  if (distSeg(nx, ny, 0.2, 0.25, 0.5, 0.55) < midStroke / 2) return true;
  if (distSeg(nx, ny, 0.8, 0.25, 0.5, 0.55) < midStroke / 2) return true;
  return false;
}

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const c = inM(x, y) ? FG : BG;
    pixels[i] = c[0];
    pixels[i + 1] = c[1];
    pixels[i + 2] = c[2];
    pixels[i + 3] = 255;
  }
}

// 构建 PNG
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  // CRC32
  let crc = 0xffffffff;
  for (const b of crcInput) {
    crc ^= b;
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// IDAT: 每行加 filter 字节 0
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0; // filter none
  pixels.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}
const idat = deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync("source-icon.png", png);
console.log("wrote source-icon.png", png.length, "bytes");
