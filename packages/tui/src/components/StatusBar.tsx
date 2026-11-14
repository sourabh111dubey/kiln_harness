import { basename } from "node:path";
import type { Usage } from "@harness/shared";
import { Box, Text } from "ink";
import { color, type Theme } from "../theme";

interface StatusBarProps {
  theme: Theme;
  sessionID: string;
  model: string;
  cwd: string;
  status: string;
  usage: Usage;
  cost: number;
}

export function StatusBar({
  theme,
  sessionID,
  model,
  cwd,
  status,
  usage,
  cost,
}: StatusBarProps): React.ReactNode {
  const statusColor =
    status === "running"
      ? theme.accent
      : status === "error"
        ? theme.error
        : status === "waiting_permission"
          ? theme.warning
          : theme.dim;

  return (
    <Box marginTop={1}>
      <Text color={color(theme, theme.dim)}>{sessionID.slice(0, 12)}</Text>
      <Text color={color(theme, theme.dim)}> │ </Text>
      <Text color={color(theme, theme.text)}>{model}</Text>
      <Text color={color(theme, theme.dim)}> │ </Text>
      <Text color={color(theme, theme.dim)}>{basename(cwd) || cwd}</Text>
      <Text color={color(theme, theme.dim)}> │ </Text>
      <Text color={color(theme, statusColor)}>{status}</Text>
      <Text color={color(theme, theme.dim)}> │ </Text>
      <Text color={color(theme, theme.dim)}>
        ↑{usage.input} ↓{usage.output}
      </Text>
      <Text color={color(theme, theme.dim)}> │ </Text>
      <Text color={color(theme, theme.dim)}>${cost.toFixed(4)}</Text>
    </Box>
  );
}
