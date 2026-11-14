import { Box, Text } from "ink";
import { color, type Theme } from "./theme";

export type DiffLineType = "add" | "remove" | "context" | "meta";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldLine?: number;
  newLine?: number;
}

export function parseDiff(diff: string): DiffLine[] {
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1] ?? 0);
      newLine = Number(hunk[2] ?? 0);
      result.push({ type: "meta", text: line });
      continue;
    }

    if (line.startsWith("---") || line.startsWith("+++")) {
      result.push({ type: "meta", text: line });
      continue;
    }

    if (line.startsWith("+")) {
      result.push({ type: "add", text: line.slice(1), newLine });
      newLine++;
      continue;
    }

    if (line.startsWith("-")) {
      result.push({ type: "remove", text: line.slice(1), oldLine });
      oldLine++;
      continue;
    }

    if (line.startsWith(" ")) {
      result.push({ type: "context", text: line.slice(1), oldLine, newLine });
      oldLine++;
      newLine++;
      continue;
    }

    result.push({ type: "meta", text: line });
  }

  return result;
}

export function truncateDiff(diff: string, maxLines = 200): { text: string; truncated: boolean } {
  const lines = diff.split("\n");
  if (lines.length <= maxLines) return { text: diff, truncated: false };
  return {
    text: `${lines.slice(0, maxLines).join("\n")}\n... (${lines.length - maxLines} more lines)`,
    truncated: true,
  };
}

interface DiffViewProps {
  diff: string;
  theme: Theme;
  maxLines?: number;
}

export function DiffView({ diff, theme, maxLines = 200 }: DiffViewProps): React.ReactNode {
  const truncated = truncateDiff(diff, maxLines);
  const lines = parseDiff(truncated.text);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color(theme, theme.border)}
      paddingX={1}
    >
      {lines.map((line) => {
        if (line.type === "meta") {
          return (
            <Text key={`${line.type}-${line.text}`} color={color(theme, theme.diffMeta)}>
              {line.text}
            </Text>
          );
        }

        const sign = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
        const lineColor =
          line.type === "add"
            ? theme.diffAdd
            : line.type === "remove"
              ? theme.diffRemove
              : theme.text;

        return (
          <Text key={`${line.type}-${line.text}`} color={color(theme, lineColor)}>
            {`${sign} ${line.text}`}
          </Text>
        );
      })}
    </Box>
  );
}
