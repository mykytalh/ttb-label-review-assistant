"use client";

/**
 * Light/dark theme toggle. The initial theme is set before paint by an inline
 * script in the layout (saved choice → else OS preference); this control just
 * flips the `data-theme` attribute on <html> and persists the choice. The whole
 * theme is driven by CSS-variable redefinition under [data-theme="dark"], so no
 * component needs to know the theme — they all read var(--…).
 */
import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // Sync state with whatever the pre-paint script already applied.
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "dark" || current === "light") setTheme(current);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  };

  const isDark = theme === "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-pressed={isDark}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {isDark ? (
          // sun
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
          </svg>
        ) : (
          // moon
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" />
          </svg>
        )}
      </span>
      <span className="theme-toggle-text">{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}
