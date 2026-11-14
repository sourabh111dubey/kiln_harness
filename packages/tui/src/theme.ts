export interface Theme {
  name: string;
  text: string;
  dim: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  border: string;
  diffAdd: string;
  diffRemove: string;
  diffMeta: string;
  codeBackground: string;
  noColor: boolean;
}

export const defaultTheme: Theme = {
  name: "default",
  text: "white",
  dim: "gray",
  accent: "cyan",
  success: "green",
  warning: "yellow",
  error: "red",
  border: "gray",
  diffAdd: "green",
  diffRemove: "red",
  diffMeta: "gray",
  codeBackground: "black",
  noColor: false,
};

export const THEMES: Record<string, Theme> = {
  default: defaultTheme,
  dim: {
    ...defaultTheme,
    name: "dim",
    text: "gray",
    dim: "blackBright",
    accent: "blue",
    border: "blackBright",
    codeBackground: "black",
  },
  highContrast: {
    ...defaultTheme,
    name: "highContrast",
    text: "white",
    dim: "white",
    accent: "magentaBright",
    success: "greenBright",
    warning: "yellowBright",
    error: "redBright",
    border: "white",
    diffAdd: "greenBright",
    diffRemove: "redBright",
    diffMeta: "white",
  },
  noColor: {
    ...defaultTheme,
    name: "noColor",
    text: "white",
    dim: "white",
    accent: "white",
    success: "white",
    warning: "white",
    error: "white",
    border: "white",
    diffAdd: "white",
    diffRemove: "white",
    diffMeta: "white",
    codeBackground: "black",
    noColor: true,
  },
};

export function resolveTheme(env: NodeJS.ProcessEnv = process.env): Theme {
  if (env.NO_COLOR || env.TERM === "dumb") return THEMES.noColor ?? defaultTheme;
  const name = env.KILN_THEME ?? "default";
  return THEMES[name] ?? defaultTheme;
}

export function color(theme: Theme, value: string): string | undefined {
  return theme.noColor ? undefined : value;
}
