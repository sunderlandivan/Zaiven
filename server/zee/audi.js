import fs from "fs";
import path from "path";

export function getAudiImagePath() {
  const configured = String(process.env.ZEE_AUDI_IMAGE_PATH || "").trim();
  if (!configured) return "";
  return path.resolve(configured);
}

export function createAudiImageHandler() {
  return (_req, res) => {
    const filePath = getAudiImagePath();
    if (!filePath) {
      res.status(404).json({ ok: false, error: "ZEE_AUDI_IMAGE_PATH not configured." });
      return;
    }
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ ok: false, error: "Configured Audi image path does not exist." });
      return;
    }
    res.sendFile(filePath);
  };
}
