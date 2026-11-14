import type { Session } from "@kiln/shared";
import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { color, type Theme } from "../theme";

interface SessionPickerProps {
  theme: Theme;
  sessions: Session[];
  onSelect: (sessionID: string) => void;
  onClose: () => void;
}

export function SessionPicker({
  theme,
  sessions,
  onSelect,
  onClose,
}: SessionPickerProps): React.ReactNode {
  const [selected, setSelected] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelected((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow) {
      setSelected((current) => Math.min(sessions.length - 1, current + 1));
      return;
    }
    if (key.return) {
      const session = sessions[selected];
      if (session) onSelect(session.id);
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color(theme, theme.border)}
      paddingX={1}
      marginTop={1}
    >
      <Text color={color(theme, theme.accent)}>Sessions</Text>
      {sessions.length === 0 ? <Text color={color(theme, theme.dim)}>(none)</Text> : null}
      {sessions.map((session, index) => (
        <Text key={session.id} color={color(theme, index === selected ? theme.accent : theme.text)}>
          {index === selected ? "❯ " : "  "}
          {session.id} · {session.status} · {session.model}
        </Text>
      ))}
      <Text color={color(theme, theme.dim)}>↑/↓ select · Enter open · Esc close</Text>
    </Box>
  );
}
