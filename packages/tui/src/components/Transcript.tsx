import { summarizeInput } from "@kiln/core";
import type { PermissionDecision, ToolCall, ToolOutput } from "@kiln/shared";
import { Box, Text } from "ink";
import { DiffView } from "../diff";
import { Markdown } from "../markdown";
import { color, type Theme } from "../theme";

export type TranscriptEntry =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string; streaming?: boolean }
  | {
      id: string;
      kind: "tool";
      call: ToolCall;
      result?: ToolOutput;
      decision?: PermissionDecision;
      durationMs?: number;
    }
  | { id: string; kind: "error"; text: string }
  | { id: string; kind: "info"; text: string };

interface TranscriptProps {
  entries: TranscriptEntry[];
  theme: Theme;
}

function truncate(text: string, max = 1_500): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n... [truncated]`;
}

function ToolResult({ output, theme }: { output: ToolOutput; theme: Theme }): React.ReactNode {
  switch (output.kind) {
    case "diff":
      return <DiffView diff={output.diff || "(no diff)"} theme={theme} />;
    case "terminal":
      return (
        <Box flexDirection="column">
          {output.stdout ? (
            <Text color={color(theme, theme.text)}>{truncate(output.stdout)}</Text>
          ) : null}
          {output.stderr ? (
            <Text color={color(theme, theme.error)}>{truncate(output.stderr)}</Text>
          ) : null}
          <Text color={color(theme, theme.dim)}>exit {output.exitCode}</Text>
        </Box>
      );
    case "text":
      return <Markdown text={truncate(output.text)} theme={theme} />;
    case "json":
    case "structured":
      return (
        <Text color={color(theme, theme.text)}>
          {truncate(JSON.stringify(output.kind === "json" ? output.value : output.value, null, 2))}
        </Text>
      );
    case "image":
      return <Text color={color(theme, theme.dim)}>[image {output.mime}]</Text>;
  }
}

export function Transcript({ entries, theme }: TranscriptProps): React.ReactNode {
  return (
    <Box flexDirection="column">
      {entries.map((entry) => {
        if (entry.kind === "user") {
          return (
            <Box key={entry.id} marginBottom={1}>
              <Text color={color(theme, theme.accent)}>❯ </Text>
              <Text color={color(theme, theme.text)}>{entry.text}</Text>
            </Box>
          );
        }

        if (entry.kind === "assistant") {
          return (
            <Box key={entry.id} marginBottom={1}>
              <Markdown text={`${entry.text}${entry.streaming ? "▋" : ""}`} theme={theme} />
            </Box>
          );
        }

        if (entry.kind === "tool") {
          const status =
            entry.decision === "deny"
              ? "denied"
              : entry.result
                ? entry.durationMs !== undefined
                  ? `${entry.durationMs}ms`
                  : "done"
                : "running";
          return (
            <Box key={entry.id} flexDirection="column" marginBottom={1}>
              <Box>
                <Text color={color(theme, entry.decision === "deny" ? theme.error : theme.accent)}>
                  ⚙ {entry.call.name}
                </Text>
                <Text color={color(theme, theme.dim)}>
                  {" "}
                  {summarizeInput(entry.call.input)} · {status}
                </Text>
              </Box>
              {entry.result ? <ToolResult output={entry.result} theme={theme} /> : null}
            </Box>
          );
        }

        if (entry.kind === "error") {
          return (
            <Box key={entry.id} marginBottom={1}>
              <Text color={color(theme, theme.error)}>error: {entry.text}</Text>
            </Box>
          );
        }

        return (
          <Box key={entry.id} marginBottom={1}>
            <Text color={color(theme, theme.dim)}>{entry.text}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
