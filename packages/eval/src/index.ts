import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Agent, TurnResult } from "@harness/core";

export interface EvalTask {
  id: string;
  prompt: string;
  expectedFiles?: Record<string, string>;
  tags?: string[];
}

export interface TaskResult {
  id: string;
  passed: boolean;
  failures: string[];
  text: string;
  cost: number;
  usage: TurnResult["usage"];
}

export interface ScoreSummary {
  total: number;
  passed: number;
  failed: number;
  rate: number;
  cost: number;
}

export async function checkExpectedFiles(task: EvalTask, cwd: string): Promise<string[]> {
  const failures: string[] = [];
  for (const [path, expected] of Object.entries(task.expectedFiles ?? {})) {
    try {
      const actual = await readFile(join(cwd, path), "utf8");
      if (actual !== expected) failures.push(`${path}: content mismatch`);
    } catch {
      failures.push(`${path}: missing`);
    }
  }
  return failures;
}

export async function runEvalTask(task: EvalTask, agent: Agent, cwd: string): Promise<TaskResult> {
  const result = await agent.prompt(task.prompt);
  const failures = await checkExpectedFiles(task, cwd);
  return {
    id: task.id,
    passed: failures.length === 0,
    failures,
    text: result.text,
    cost: result.cost,
    usage: result.usage,
  };
}

export function scoreResults(results: TaskResult[]): ScoreSummary {
  const passed = results.filter((result) => result.passed).length;
  const total = results.length;
  return {
    total,
    passed,
    failed: total - passed,
    rate: total === 0 ? 0 : passed / total,
    cost: results.reduce((sum, result) => sum + result.cost, 0),
  };
}

export interface BenchmarkAdapter {
  readonly id: string;
  fromRows(rows: unknown[]): EvalTask[];
}

interface SweBenchRow {
  instance_id?: string;
  problem_statement?: string;
  repo?: string;
}

export class SweBenchAdapter implements BenchmarkAdapter {
  readonly id = "swe-bench-lite";

  fromRows(rows: unknown[]): EvalTask[] {
    return rows.map((row, index) => {
      const record = (row ?? {}) as SweBenchRow;
      return {
        id: record.instance_id ?? `swe-${index}`,
        prompt: `Repository: ${record.repo ?? "unknown"}\n\n${record.problem_statement ?? ""}`,
        tags: ["swe-bench-lite"],
      };
    });
  }
}

interface TerminalBenchRow {
  instance_id?: string;
  instruction?: string;
  task?: string;
}

export class TerminalBenchAdapter implements BenchmarkAdapter {
  readonly id = "terminal-bench";

  fromRows(rows: unknown[]): EvalTask[] {
    return rows.map((row, index) => {
      const record = (row ?? {}) as TerminalBenchRow;
      return {
        id: record.instance_id ?? `terminal-${index}`,
        prompt: record.instruction ?? record.task ?? "",
        tags: ["terminal-bench"],
      };
    });
  }
}

export function parseJsonl(source: string): unknown[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}
