const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

const router = express.Router();

const IMAGES_DIR = path.resolve(__dirname, "..", "..", "images");
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_WIDTH = 1600;
const WEBP_QUALITY = 82;

// 只认魔数，不认 Content-Type（header 可伪造）
function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return "";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (buf.slice(0, 4).toString("latin1") === "RIFF" &&
      buf.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return "";
}

// 裸二进制直传（不用 multer / multipart）；body-parser 报错时转成 JSON
const rawParser = express.raw({ type: () => true, limit: MAX_BYTES });

router.post("/upload", (req, res, next) => {
  rawParser(req, res, (err) => {
    if (!err) return next();
    if (err.type === "entity.too.large") {
      return res.status(413).json({ success: false, message: "图片超过 15MB，请先压缩" });
    }
    return res.status(400).json({ success: false, message: "请求体解析失败" });
  });
}, async (req, res) => {
  try {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      return res.status(400).json({ success: false, message: "空文件或请求体不是二进制" });
    }
    if (!sniff(buf)) {
      return res.status(415).json({ success: false, message: "仅支持 JPG / PNG / GIF / WEBP" });
    }

    fs.mkdirSync(IMAGES_DIR, { recursive: true });

    // rotate() 按 EXIF 摆正；animated:false 使 GIF 只取首帧
    const pipeline = sharp(buf, { failOn: "none", animated: false }).rotate();
    const meta = await pipeline.metadata();
    if (meta.width && meta.width > MAX_WIDTH) {
      pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
    }
    const { data, info } = await pipeline
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    // 文件名完全由服务端生成，不含任何用户输入 → 免疫路径穿越
    const filename = `img-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.webp`;
    fs.writeFileSync(path.join(IMAGES_DIR, filename), data);

    res.json({
      success: true,
      // 必须是相对路径：GitHub Pages 站点根为 /dacar-yujian/，前导 / 会 404
      url: `images/${filename}`,
      width: info.width,
      height: info.height,
      bytes: data.length,
    });
  } catch (err) {
    console.error("[upload] Error:", err.message);
    res.status(500).json({ success: false, message: "图片处理失败" });
  }
});

module.exports = router;
