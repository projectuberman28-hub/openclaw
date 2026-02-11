/** Theme constants for the Batcave dark theme */

export const theme = {
  colors: {
    primary: "#0a0a0f",
    secondary: "#12121a",
    tertiary: "#1a1a25",
    border: "#2a2a35",
    hover: "#252530",
    text: "#e4e4e7",
    textMuted: "#71717a",
    accent: "#dc2626",
    accentHover: "#ef4444",
    success: "#22c55e",
    warning: "#eab308",
    info: "#3b82f6",
  },
  fonts: {
    sans: '"Inter", system-ui, -apple-system, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
  },
} as const;

export type ThemeMode = "dark" | "light";

export function getStatusColor(
  value: number,
  thresholds = { warning: 60, danger: 85 }
): string {
  if (value >= thresholds.danger) return theme.colors.accent;
  if (value >= thresholds.warning) return theme.colors.warning;
  return theme.colors.success;
}

export function getPrivacyColor(level: string): string {
  switch (level) {
    case "local":
      return theme.colors.success;
    case "cloud-redacted":
      return theme.colors.warning;
    case "cloud":
      return theme.colors.accent;
    default:
      return theme.colors.textMuted;
  }
}
