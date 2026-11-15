"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { IconButton } from "./Button";
import { MoonIcon, SunIcon } from "./icons";

export type PlateTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "navigatened-plate-theme";

interface ThemeContextValue {
  theme: PlateTheme;
  setTheme: (next: PlateTheme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): PlateTheme | null {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Ignore storage access errors (e.g., private browsing)
  }
  return null;
}

function writeStoredTheme(next: PlateTheme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Ignore storage access errors
  }
}

function resolveInitialTheme(): PlateTheme {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.dataset.theme;
    if (attr === "light" || attr === "dark") return attr;
  }
  if (typeof window !== "undefined") {
    const stored = readStoredTheme();
    if (stored) return stored;
    try {
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        return "dark";
      }
    } catch {
      // Ignore matchMedia failures
    }
  }
  return "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<PlateTheme>("light");

  useEffect(() => {
    const initial = resolveInitialTheme();
    document.documentElement.dataset.theme = initial;
    setThemeState(initial);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && (e.newValue === "light" || e.newValue === "dark")) {
        document.documentElement.dataset.theme = e.newValue;
        setThemeState(e.newValue);
      }
    };

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleMediaChange = (e: MediaQueryListEvent) => {
      if (!readStoredTheme()) {
        const next: PlateTheme = e.matches ? "dark" : "light";
        document.documentElement.dataset.theme = next;
        setThemeState(next);
      }
    };

    window.addEventListener("storage", handleStorage);
    media.addEventListener("change", handleMediaChange);
    return () => {
      window.removeEventListener("storage", handleStorage);
      media.removeEventListener("change", handleMediaChange);
    };
  }, []);

  const setTheme = useCallback((next: PlateTheme) => {
    document.documentElement.dataset.theme = next;
    writeStoredTheme(next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: PlateTheme = prev === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      writeStoredTheme(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
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
      aria-label={
        isDark
          ? "Current theme: Night chart. Switch to Daylight chart"
          : "Current theme: Daylight chart. Switch to Night chart"
      }
      title={isDark ? "Night Chart (Dark)" : "Daylight Chart (Light)"}
      onClick={toggleTheme}
    >
      {isDark ? <MoonIcon size={16} /> : <SunIcon size={16} />}
    </IconButton>
  );
}
