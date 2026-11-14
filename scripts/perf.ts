import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { bashTool, SessionStore } from "../packages/core/dist/index.js";
import { createLogger } from "../packages/shared/dist/index.js";

const execFileAsync = promisify(execFile);
const CHECK = process.argv.includes("--check");

interface Measurement {
  name: string;
  value: number;
  unit: string;
  budget: number;
}

const budgets: Record<string, number> = {
  cliColdStartMs: 1_500,
  bashSpawnMs: 150,
  eventReplay10kMs: 2_500,
  search1kMs: 1_000,
  rssMb: 350,
};

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function measureCliColdStart(): Promise<number> {
  const samples: number[] = [];
  for (let index = 0; index < 5; index++) {
    const start = performance.now();
    await execFileAsync(process.execPath, ["packages/cli/dist/index.js", "--version"]);
    samples.push(performance.now() - start);
  }
  return median(samples);
}

async function measureBashSpawn(): Promise<number> {
  const context = {
    sessionID: "ses_perf",
    cwd: process.cwd(),
    workspaceRoot: process.cwd(),
    signal: new AbortController().signal,
    logger: createLogger({ level: "silent" }),
    state: {},
  };
  const samples: number[] = [];
  for (let index = 0; index < 20; index++) {
    const start = performance.now();
    await bashTool.execute({ command: "printf hi" }, context);
    samples.push(performance.now() - start);
  }
  return median(samples);
}

async function measureSessionStore(): Promise<{ replay: number; search: number }> {
  const directory = await mkdtemp(join(tmpdir(), "harness-perf-"));
  const store = new SessionStore({ dataDir: directory });
  const session = store.create({ cwd: process.cwd(), model: "fake/test" });

  try {
    const replayStart = performance.now();
    for (let index = 0; index < 10_000; index++) {
      store.appendEvent(session.id, {
        type: "turn.start",
        turn: index,
        prompt: `prompt ${index}`,
      });
    }
    store.readEvents(session.id);
    const replay = performance.now() - replayStart;

    const searchStart = performance.now();
    for (let index = 0; index < 1_000; index++) {
      store.appendMessage(session.id, { role: "user", content: `needle ${index}` });
    }
    store.search("needle");
    const search = performance.now() - searchStart;

    return { replay, search };
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const cliColdStartMs = await measureCliColdStart();
  const bashSpawnMs = await measureBashSpawn();
  const store = await measureSessionStore();
  const rssMb = process.memoryUsage().rss / 1_000_000;

  const measurements: Measurement[] = [
    {
      name: "cliColdStartMs",
      value: cliColdStartMs,
      unit: "ms",
      budget: budgets.cliColdStartMs ?? 0,
    },
    { name: "bashSpawnMs", value: bashSpawnMs, unit: "ms", budget: budgets.bashSpawnMs ?? 0 },
    {
      name: "eventReplay10kMs",
      value: store.replay,
      unit: "ms",
      budget: budgets.eventReplay10kMs ?? 0,
    },
    { name: "search1kMs", value: store.search, unit: "ms", budget: budgets.search1kMs ?? 0 },
    { name: "rssMb", value: rssMb, unit: "MB", budget: budgets.rssMb ?? 0 },
  ];

  const failed = measurements.filter((measurement) => measurement.value > measurement.budget);

  process.stdout.write(
    `${JSON.stringify({ measurements, failed: failed.map((entry) => entry.name) }, null, 2)}\n`,
  );

  if (CHECK && failed.length > 0) {
    process.stderr.write(
      `Performance budget exceeded: ${failed.map((entry) => `${entry.name} ${entry.value.toFixed(1)} > ${entry.budget}`).join(", ")}\n`,
    );
    process.exitCode = 1;
  }
}

await main();
