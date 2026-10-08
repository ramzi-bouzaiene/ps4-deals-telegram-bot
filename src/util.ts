import fs from "fs";
import path from "path";

export const DATA_DIR = process.env.DATA_DIR ?? "data";
export function slugify(title: string): string {
  return String(title)
    .toLowerCase()
    .replace(/[™®]/g, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const normalizeTitle = slugify;

export function titleize(slug: string): string {
  return String(slug)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export const todayISO = (d = new Date()) => d.toISOString().slice(0, 10);

export function readJsonFile<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}
