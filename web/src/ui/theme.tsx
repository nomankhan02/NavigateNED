"use client";

import { useCallback, useEffect, useState } from "react";
import { IconButton } from "./Button";
import { MoonIcon, SunIcon } from "./icons";

export type PlateTheme = "light" | "dark";

const STORAGE_KEY = "navigatened-plate-theme";

export function useTheme() {
  const [theme, setThemeState] = useState<PlateTheme>("light");

  useEffect(() => {
    const root = document.documentElement;
    const saved = window.localStorage.getItem(STORAGE_KEY) as PlateTheme | null;
    if (saved === "light" || saved === "dark") {
      root.dataset.theme = saved;
      setThemeState(saved);
      return;
    }
    const existing = root.dataset.theme as PlateTheme | undefined;
    if (existing === "light" || existing === "dark") {
      setThemeState(existing);
      return;
    }
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial: PlateTheme = prefersDark ? "dark" : "light";
    root.dataset.theme = initial;
    setThemeState(initial);
  }, []);

  const setTheme = useCallback((next: PlateTheme) => {
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: PlateTheme = prev === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme };
}

export interface ThemeSwitchProps {
  size?: "sm" | "md";
}

export function ThemeSwitch({ size = "sm" }: ThemeSwitchProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <IconButton
      size={size}
      aria-label={isDark ? "Switch to Daylight Survey Plate" : "Switch to Night Survey Plate"}
      title={isDark ? "Daylight Plate (Light)" : "Night Plate (Dark)"}
      onClick={toggleTheme}
    >
      {isDark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
    </IconButton>
  );
}
