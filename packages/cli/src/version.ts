import { readFileSync } from "node:fs";

export function readVersion(): string {
  try {
    const contents = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const parsed: unknown = JSON.parse(contents);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      typeof parsed.version === "string"
    ) {
      return parsed.version;
    }
  } catch {
    // Fall through to the placeholder version.
  }
  return "0.0.0";
}
