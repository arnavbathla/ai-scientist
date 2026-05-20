import { randomBytes, createHash } from "node:crypto";

export function nanoId(size = 12): string {
  return randomBytes(Math.ceil((size * 3) / 4))
    .toString("base64url")
    .slice(0, size);
}

export function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}
