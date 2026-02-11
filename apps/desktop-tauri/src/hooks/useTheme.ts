import { useState, useEffect, useCallback } from "react";
import type { ThemeMode } from "../lib/theme";

/** Theme management hook. Currently dark-only but extensible */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>("dark");

  useEffect(() => {
    const stored = localStorage.getItem("alfred-theme") as ThemeMode | null;
    if (stored) {
      setMode(stored);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.classList.toggle("light", mode === "light");
    localStorage.setItem("alfred-theme", mode);
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return { mode, setMode, toggle, isDark: mode === "dark" };
}
