// 从 exe 内嵌资源中提取最大尺寸的图标并转成 PNG（纯 JS、零依赖）
// 解析 PE 的 RT_ICON 资源：PNG 格式直接透传，DIB(BMP) 格式用 node:zlib 重新编码为 PNG。
// 不用 Electron 的 app.getFileIcon：Windows 下它最多只给 32px，高分屏上卡片会糊
import fs from 'node:fs'
import zlib from 'node:zlib'

const MAX_EXE_BYTES = 64 * 1024 * 1024 // 图标资源通常在 PE 前部，超大 exe 直接放弃（走上层兜底）

function rvaToOffset(sections, rva) {
  for (const s of sections) {
    if (rva >= s.virtualAddress && rva < s.virtualAddress + Math.max(s.virtualSize, s.rawSize)) {
      return rva - s.virtualAddress + s.rawPointer
    }
  }
  return null
}

// 解析 PE 头，返回节表与资源节在文件内的偏移
function parsePe(buf) {
  if (buf.length < 0x40 || buf[0] !== 0x4d || buf[1] !== 0x5a) return null // MZ
  const peOff = buf.readUInt32LE(0x3c)
  if (peOff + 24 > buf.length || buf.readUInt32LE(peOff) !== 0x00004550) return null // PE\0\0

  const numSections = buf.readUInt16LE(peOff + 6)
  const optSize = buf.readUInt16LE(peOff + 20)
  const optOff = peOff + 24
  const magic = buf.readUInt16LE(optOff)
  if (magic !== 0x10b && magic !== 0x20b) return null // PE32 / PE32+
  const dataDirOff = optOff + (magic === 0x20b ? 112 : 96)
  const resRva = buf.readUInt32LE(dataDirOff + 2 * 8) // DataDirectory[2] = 资源表
  const resSize = buf.readUInt32LE(dataDirOff + 2 * 8 + 4)
  if (!resRva || !resSize) return null

  const sections = []
  const secOff = optOff + optSize
  for (let i = 0; i < numSections; i++) {
    const o = secOff + i * 40
    if (o + 40 > buf.length) break
    sections.push({
      virtualSize: buf.readUInt32LE(o + 8),
      virtualAddress: buf.readUInt32LE(o + 12),
      rawSize: buf.readUInt32LE(o + 16),
      rawPointer: buf.readUInt32LE(o + 20)
    })
  }
  const resBase = rvaToOffset(sections, resRva)
  if (resBase == null) return null
  return { sections, resBase }
}

// 三层资源树：类型 → 名称/ID → 语言；第 3 层的偏移无高位标记，直接指向数据项
function* walkResources(buf, resBase, dirOff, level, type) {
  const base = resBase + dirOff
  if (base + 16 > buf.length) return
  const named = buf.readUInt16LE(base + 12)
  const idents = buf.readUInt16LE(base + 14)
  for (let i = 0; i < named + idents; i++) {
    const ent = base + 16 + i * 8
    if (ent + 8 > buf.length) return
    const nameOrId = buf.readUInt32LE(ent)
    const off = buf.readUInt32LE(ent + 4)
    if (level < 3) {
      if ((off & 0x80000000) === 0) continue // 前两层应指向子目录
      const sub = off & 0x7fffffff
      if (level === 1) yield* walkResources(buf, resBase, sub, 2, nameOrId)
      else yield* walkResources(buf, resBase, sub, 3, type)
    } else {
      const dataEntry = resBase + off
      if (dataEntry + 8 > buf.length) return
      yield { type, dataRva: buf.readUInt32LE(dataEntry), size: buf.readUInt32LE(dataEntry + 4) }
    }
  }
}

function isPngBlob(blob) {
  return blob.length > 24 && blob[0] === 0x89 && blob[1] === 0x50 && blob[2] === 0x4e && blob[3] === 0x47
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // 每行前缀 filter=0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // 位深
  ihdr[9] = 6 // 颜色类型 RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// RT_ICON 里的 DIB = BITMAPINFOHEADER + 像素 + AND 掩码（高度字段是两倍，含掩码区）
function dibToPng(blob) {
  if (blob.length < 40) return null
  const headerSize = blob.readUInt32LE(0)
  const width = blob.readInt32LE(4)
  const height2 = blob.readInt32LE(8)
  const bpp = blob.readUInt16LE(14)
  if (headerSize < 40 || width <= 0 || height2 <= 0 || width > 1024 || height2 > 2048) return null
  if (bpp !== 32) return null // 只转 32bpp；更大尺寸转不了时上层会自动换下一个尺寸
  const height = height2 / 2
  const stride = width * 4
  if (headerSize + stride * height > blob.length) return null

  const rgba = Buffer.alloc(width * height * 4)
  let anyAlpha = false
  for (let y = 0; y < height; y++) {
    const src = headerSize + (height - 1 - y) * stride // DIB 自下而上
    for (let x = 0; x < width; x++) {
      const s = src + x * 4
      const d = (y * width + x) * 4
      rgba[d] = blob[s + 2]
      rgba[d + 1] = blob[s + 1]
      rgba[d + 2] = blob[s]
      rgba[d + 3] = blob[s + 3]
      if (blob[s + 3]) anyAlpha = true
    }
  }
  if (!anyAlpha) {
    // 老图标 alpha 全 0，透明度在 AND 掩码里（1 = 透明）
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
    const maskOff = headerSize + stride * height
    const maskStride = Math.ceil(width / 32) * 4
    if (maskOff + maskStride * height <= blob.length) {
      for (let y = 0; y < height; y++) {
        const src = maskOff + (height - 1 - y) * maskStride
        for (let x = 0; x < width; x++) {
          const bit = (blob[src + (x >> 3)] >> (7 - (x & 7))) & 1
          if (bit) rgba[(y * width + x) * 4 + 3] = 0
        }
      }
    }
  }
  return { png: encodePng(width, height, rgba), width, height, area: width * height }
}

// 返回 { png: Buffer, width, height }；exe 无图标资源或不支持时返回 null
export function extractExeIconPng(exePath) {
  let stat
  try {
    stat = fs.statSync(exePath)
  } catch {
    return null
  }
  if (!stat.isFile() || stat.size < 1024 || stat.size > MAX_EXE_BYTES) return null

  let buf
  try {
    buf = fs.readFileSync(exePath)
  } catch {
    return null
  }
  const pe = parsePe(buf)
  if (!pe) return null

  const found = []
  for (const res of walkResources(buf, pe.resBase, 0, 1, 0)) {
    if (res.type !== 3) continue // RT_ICON
    const off = rvaToOffset(pe.sections, res.dataRva)
    if (off == null || off + res.size > buf.length) continue
    const blob = buf.subarray(off, off + res.size)

    if (isPngBlob(blob)) {
      const width = blob.readUInt32BE(16)
      const height = blob.readUInt32BE(20)
      if (width > 0 && width <= 1024 && height > 0 && height <= 1024) {
        found.push({ png: Buffer.from(blob), width, height, area: width * height })
      }
    } else {
      const conv = dibToPng(blob)
      if (conv) found.push(conv)
    }
  }
  if (!found.length) return null

  found.sort((a, b) => b.area - a.area)
  return { png: found[0].png, width: found[0].width, height: found[0].height }
}
