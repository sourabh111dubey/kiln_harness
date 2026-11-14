import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function randomString(length: number): string {
  const bytes = randomBytes(length);
  let output = "";
  for (const byte of bytes) {
    output += ALPHABET.charAt(byte % ALPHABET.length);
  }
  return output;
}

export function createId(prefix: string, randomLength = 12): string {
  const timestamp = Date.now().toString(36).padStart(9, "0");
  return `${prefix}_${timestamp}${randomString(randomLength)}`;
}

export const ids = {
  session: () => createId("ses"),
  message: () => createId("msg"),
  part: () => createId("prt"),
  toolCall: () => createId("call"),
  request: () => createId("req"),
  turn: () => createId("turn"),
} as const;

export function isPrefixedId(value: string, prefix: string): boolean {
  return new RegExp(`^${prefix}_[0-9a-z]{8,}$`).test(value);
}
