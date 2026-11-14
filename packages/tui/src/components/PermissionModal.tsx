import { summarizeInput } from "@kilncraft/core";
import { Box, Text, useInput } from "ink";
import { color, type Theme } from "../theme";

export interface PermissionRequestView {
  tool: string;
  input: unknown;
  reason?: string;
}

interface PermissionModalProps {
  theme: Theme;
  request: PermissionRequestView;
  onResolve: (decision: "allow" | "deny") => void;
  onAlwaysAllow: () => void;
}

export function PermissionModal({
  theme,
  request,
  onResolve,
  onAlwaysAllow,
}: PermissionModalProps): React.ReactNode {
  useInput((input, key) => {
    if (key.escape || input === "n" || input === "d") {
      onResolve("deny");
      return;
    }
    if (input === "y" || input === "a") {
      onResolve("allow");
      return;
    }
    if (input === "t") {
      onAlwaysAllow();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color(theme, theme.warning)}
      paddingX={1}
      marginTop={1}
    >
      <Text color={color(theme, theme.warning)}>Permission required</Text>
      <Text color={color(theme, theme.text)}>
        {request.tool}: {summarizeInput(request.input)}
      </Text>
      {request.reason ? <Text color={color(theme, theme.dim)}>{request.reason}</Text> : null}
      <Text color={color(theme, theme.dim)}>[y] allow once · [t] always allow · [n] deny</Text>
    </Box>
  );
}
