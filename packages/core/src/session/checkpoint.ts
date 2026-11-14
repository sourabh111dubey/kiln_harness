import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export interface Checkpoint {
  hash: string;
  path: string;
  createdAt: string;
}

interface CheckpointMeta extends Checkpoint {
  file: string;
}

function readMeta(directory: string): CheckpointMeta | undefined {
  const metaPath = join(directory, "meta.json");
  if (!existsSync(metaPath)) return undefined;
  try {
    return JSON.parse(readFileSync(metaPath, "utf8")) as CheckpointMeta;
  } catch {
    return undefined;
  }
}

export class CheckpointManager {
  constructor(private readonly dataDir: string) {}

  private root(sessionID: string): string {
    return join(this.dataDir, "sessions", sessionID, "checkpoints");
  }

  snapshot(sessionID: string, path: string): Checkpoint | undefined {
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      return undefined;
    }

    const hash = createHash("sha256").update(`${path}\0${content}`).digest("hex").slice(0, 16);
    const directory = join(this.root(sessionID), hash);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, basename(path)), content, "utf8");

    const checkpoint: Checkpoint = {
      hash,
      path,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(
      join(directory, "meta.json"),
      JSON.stringify({ ...checkpoint, file: basename(path) }),
      "utf8",
    );
    return checkpoint;
  }

  list(sessionID: string): Checkpoint[] {
    const root = this.root(sessionID);
    if (!existsSync(root)) return [];

    const checkpoints: Checkpoint[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const meta = readMeta(join(root, entry.name));
      if (meta) {
        checkpoints.push({ hash: meta.hash, path: meta.path, createdAt: meta.createdAt });
      }
    }

    return checkpoints.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  latest(sessionID: string): Checkpoint | undefined {
    return this.list(sessionID)[0];
  }

  restore(sessionID: string, hash: string): number {
    const meta = readMeta(join(this.root(sessionID), hash));
    if (!meta) return 0;

    try {
      mkdirSync(dirname(meta.path), { recursive: true });
      copyFileSync(join(this.root(sessionID), hash, meta.file), meta.path);
      return 1;
    } catch {
      return 0;
    }
  }

  restoreLatest(sessionID: string): number {
    const latest = this.latest(sessionID);
    return latest ? this.restore(sessionID, latest.hash) : 0;
  }
}
