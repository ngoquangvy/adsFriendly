import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "127.0.0.1",
  storageDir: process.env.STORAGE_DIR || path.join(serverRoot, "storage"),
  maxBodyBytes: Number(process.env.MAX_BODY_BYTES || 256 * 1024),
  corsOrigin: process.env.CORS_ORIGIN || "*",
};

export const paths = {
  dataset: path.join(config.storageDir, "dataset.jsonl"),
  rejected: path.join(config.storageDir, "rejected.jsonl"),
  reviews: path.join(config.storageDir, "reviews.jsonl"),
  publicDir: path.join(serverRoot, "public"),
};
