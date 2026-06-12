"use client";

/**
 * Small ⓘ trigger with an anchored explanation popover — for guidance worth
 * keeping one tap away instead of permanently on screen. Closes on outside
 * click or Escape. The open panel elevates above pinned toolbars (see the
 * .info-tip z-index rules). Safe inside a <details> summary: the click is
 * stopped so toggling the tip never toggles the disclosure.
 */
import { useEffect, useRef, useState } from "react";
import { InfoIcon } from "./Icon";

export default function InfoTip({
  panelId,
  label,
  align = "right",
  children,
}: {
  panelId: string;
  label: string;
  /** Which edge of the trigger the panel hugs — use "left" near the page's left edge. */
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div className={`info-tip${open ? " info-tip--open" : ""}`} ref={wrapRef}>
      <button
        type="button"
        className="info-tip-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <InfoIcon />
      </button>
      <div
        id={panelId}
        className={`info-tip-panel${align === "left" ? " info-tip-panel--left" : ""}`}
        role="tooltip"
      >
        {children}
      </div>
    </div>
  );
}
