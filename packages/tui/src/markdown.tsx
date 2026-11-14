import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { color, type Theme } from "./theme";

interface MarkdownProps {
  text: string;
  theme: Theme;
}

function inline(text: string, theme: Theme): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);

  return parts
    .filter((part) => part.length > 0)
    .map((part) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <Text key={part} bold color={color(theme, theme.text)}>
            {part.slice(2, -2)}
          </Text>
        );
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <Text
            key={part}
            backgroundColor={color(theme, theme.codeBackground)}
            color={color(theme, theme.accent)}
          >
            {part.slice(1, -1)}
          </Text>
        );
      }
      if (part.startsWith("*") && part.endsWith("*")) {
        return (
          <Text key={part} italic color={color(theme, theme.text)}>
            {part.slice(1, -1)}
          </Text>
        );
      }
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link) {
        return (
          <Text key={part} color={color(theme, theme.accent)}>
            {link[1]} ({link[2]})
          </Text>
        );
      }
      return <Text key={part}>{part}</Text>;
    });
}

function isBlockStart(line: string): boolean {
  return (
    line.trim().length === 0 ||
    line.trim().startsWith("```") ||
    /^#{1,6}\s/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    line.startsWith(">") ||
    /^\s*\|.*\|\s*$/.test(line) ||
    line.trim() === "---"
  );
}

export function Markdown({ text, theme }: MarkdownProps): React.ReactNode {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let position = 0;

  while (position < lines.length) {
    const line = lines[position] ?? "";

    if (line.trim().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      position++;
      while (position < lines.length && !(lines[position] ?? "").trim().startsWith("```")) {
        code.push(lines[position] ?? "");
        position++;
      }
      position++;
      blocks.push(
        <Box
          key={`code-${language}-${code.join("\n").slice(0, 20)}`}
          flexDirection="column"
          borderStyle="round"
          borderColor={color(theme, theme.border)}
          paddingX={1}
          marginBottom={1}
        >
          {language ? <Text color={color(theme, theme.dim)}>{language}</Text> : null}
          <Text color={color(theme, theme.text)}>{code.join("\n")}</Text>
        </Box>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      blocks.push(
        <Text
          key={`h-${heading[2]}`}
          bold
          underline={level <= 2}
          color={color(theme, theme.accent)}
        >
          {heading[2]}
        </Text>,
      );
      position++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      blocks.push(
        <Text key={`li-${line}`} color={color(theme, theme.text)}>
          {"  • "}
          {inline(line.replace(/^\s*[-*]\s+/, ""), theme)}
        </Text>,
      );
      position++;
      continue;
    }

    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      blocks.push(
        <Text key={`oli-${line}`} color={color(theme, theme.text)}>
          {line.match(/^\s*\d+\.\s+/)?.[0]?.trim()}
          {inline(numbered[1] ?? "", theme)}
        </Text>,
      );
      position++;
      continue;
    }

    if (line.startsWith(">")) {
      blocks.push(
        <Text key={`quote-${line}`} color={color(theme, theme.dim)}>
          {line.replace(/^>\s?/, "")}
        </Text>,
      );
      position++;
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim());
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) {
        position++;
        continue;
      }
      blocks.push(
        <Text key={`table-${line}`} color={color(theme, theme.text)}>
          {cells.join(" │ ")}
        </Text>,
      );
      position++;
      continue;
    }

    if (line.trim() === "---") {
      blocks.push(
        <Text key={`hr-${line}`} color={color(theme, theme.dim)}>
          {"────────────────────────────────────────"}
        </Text>,
      );
      position++;
      continue;
    }

    if (line.trim().length === 0) {
      blocks.push(<Text key={`blank-${position}`}> </Text>);
      position++;
      continue;
    }

    const paragraph = [line];
    position++;
    while (position < lines.length && !isBlockStart(lines[position] ?? "")) {
      paragraph.push(lines[position] ?? "");
      position++;
    }

    blocks.push(
      <Text key={`p-${paragraph.join("\n").slice(0, 20)}`} color={color(theme, theme.text)}>
        {inline(paragraph.join("\n"), theme)}
      </Text>,
    );
  }

  return <Box flexDirection="column">{blocks}</Box>;
}
