import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { color, type Theme } from "../theme";

interface ComposerProps {
  theme: Theme;
  disabled?: boolean;
  history: string[];
  onSubmit: (value: string) => void;
  onInterrupt: () => void;
  onExit: () => void;
  onTab?: (value: string) => string;
}

export function Composer({
  theme,
  disabled = false,
  history,
  onSubmit,
  onInterrupt,
  onExit,
  onTab,
}: ComposerProps): React.ReactNode {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState("");

  const insert = (text: string) => {
    setValue((current) => {
      const next = `${current.slice(0, cursor)}${text}${current.slice(cursor)}`;
      setCursor(cursor + text.length);
      return next;
    });
  };

  useInput(
    (input, key) => {
      if (disabled) return;

      if (key.return) {
        const text = value.trim();
        if (text.length === 0) return;
        onSubmit(text);
        setValue("");
        setCursor(0);
        setHistoryIndex(-1);
        setDraft("");
        return;
      }

      if (key.ctrl && input === "j") {
        insert("\n");
        return;
      }

      if (key.ctrl && input === "c") {
        if (value.length > 0) {
          setValue("");
          setCursor(0);
        } else {
          onExit();
        }
        return;
      }

      if (key.ctrl && input === "d") {
        onExit();
        return;
      }

      if (key.escape) {
        onInterrupt();
        return;
      }

      if (key.upArrow) {
        if (history.length === 0) return;
        const nextIndex = Math.min(history.length - 1, historyIndex + 1);
        if (historyIndex === -1) setDraft(value);
        setHistoryIndex(nextIndex);
        const next = history[history.length - 1 - nextIndex] ?? "";
        setValue(next);
        setCursor(next.length);
        return;
      }

      if (key.downArrow) {
        if (historyIndex <= 0) {
          setHistoryIndex(-1);
          setValue(draft);
          setCursor(draft.length);
          return;
        }
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        const next = history[history.length - 1 - nextIndex] ?? "";
        setValue(next);
        setCursor(next.length);
        return;
      }

      if (key.leftArrow) {
        setCursor((current) => Math.max(0, current - 1));
        return;
      }

      if (key.rightArrow) {
        setCursor((current) => Math.min(value.length, current + 1));
        return;
      }

      if (key.home) {
        setCursor(0);
        return;
      }

      if (key.end) {
        setCursor(value.length);
        return;
      }

      if (key.backspace) {
        if (cursor === 0) return;
        setValue(`${value.slice(0, cursor - 1)}${value.slice(cursor)}`);
        setCursor(cursor - 1);
        return;
      }

      if (key.delete) {
        setValue(`${value.slice(0, cursor)}${value.slice(cursor + 1)}`);
        return;
      }

      if (key.tab && onTab) {
        const next = onTab(value);
        setValue(next);
        setCursor(next.length);
        return;
      }

      if (input.length > 0 && !key.ctrl && !key.meta) {
        insert(input);
      }
    },
    { isActive: !disabled },
  );

  const before = value.slice(0, cursor);
  const at = value.slice(cursor, cursor + 1) || " ";
  const after = value.slice(cursor + 1);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box borderStyle="round" borderColor={color(theme, theme.border)} paddingX={1}>
        <Text color={color(theme, theme.accent)}>❯ </Text>
        <Text color={color(theme, theme.text)}>
          {before}
          <Text inverse>{at === "\n" ? " " : at}</Text>
          {after}
        </Text>
      </Box>
      <Text color={color(theme, theme.dim)}>
        Enter send · Ctrl+J newline · Esc interrupt · Ctrl+C exit · /help
      </Text>
    </Box>
  );
}
