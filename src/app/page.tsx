"use client";

import { useEffect, useRef, useState } from "react";
import SingleReview from "@/components/SingleReview";
import BatchReview from "@/components/BatchReview";
import ThemeToggle from "@/components/ThemeToggle";
import HowItWorks from "@/components/HowItWorks";

type Mode = "single" | "batch";

const HELP_SEEN_KEY = "howItWorksSeen";
const TAB_ORDER: Mode[] = ["single", "batch"];
const TAB_LABEL: Record<Mode, string> = {
  single: "One label",
  batch: "Batch upload",
};

export default function Home() {
  const [mode, setMode] = useState<Mode>("single");
  // Help is a full view reached from the header — NOT a tab (the tabs are the two
  // review modes only). It overlays the tool area when open.
  const [showHelp, setShowHelp] = useState(false);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);

  // First visit → show the guide once, so a new agent is oriented before diving
  // in (the tool has real depth: image tools, auto-detect, verdicts).
  useEffect(() => {
    try {
      if (localStorage.getItem(HELP_SEEN_KEY) !== "1") setShowHelp(true);
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  }, []);

  const openHelp = () => setShowHelp(true);
  const closeHelp = () => {
    setShowHelp(false);
    try {
      localStorage.setItem(HELP_SEEN_KEY, "1");
    } catch {
      // ignore
    }
    requestAnimationFrame(() => helpTriggerRef.current?.focus());
  };

  // Arrow/Home/End navigation for the tablist (WCAG: a tablist must be operable
  // by keyboard; the non-selected tab carries tabIndex=-1 per roving-tabindex).
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const i = TAB_ORDER.indexOf(mode);
    let next: Mode | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = TAB_ORDER[(i + 1) % TAB_ORDER.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = TAB_ORDER[(i - 1 + TAB_ORDER.length) % TAB_ORDER.length];
    else if (e.key === "Home") next = TAB_ORDER[0];
    else if (e.key === "End") next = TAB_ORDER[TAB_ORDER.length - 1];
    if (next) {
      e.preventDefault();
      setMode(next);
      document.getElementById(`tab-${next}`)?.focus();
    }
  };

  return (
    <>
      <header className="masthead">
        <div className="inner masthead-row">
          <div className="masthead-id">
            <h1>Label Review Assistant</h1>
            <p className="masthead-org">
              AI-assisted alcohol label extraction and compliance verification
            </p>
          </div>
          <div className="masthead-actions">
            <button
              ref={helpTriggerRef}
              type="button"
              className="hiw-trigger"
              onClick={openHelp}
              aria-expanded={showHelp}
              aria-controls="main-content"
              aria-label="How to use this tool"
            >
              <span className="hiw-trigger-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v5" strokeLinecap="round" />
                  <circle cx="12" cy="7.5" r="0.6" fill="currentColor" stroke="none" />
                </svg>
              </span>
              <span className="hiw-trigger-label">How to use</span>
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="main-content" className="container">
        {showHelp ? (
          <HowItWorks onClose={closeHelp} />
        ) : (
          <>
            <div className="tabs" role="tablist" aria-label="Review mode">
              {TAB_ORDER.map((m) => (
                <button
                  key={m}
                  id={`tab-${m}`}
                  className="tab"
                  role="tab"
                  aria-selected={mode === m}
                  aria-controls={`panel-${m}`}
                  tabIndex={mode === m ? 0 : -1}
                  onClick={() => setMode(m)}
                  onKeyDown={onTabKeyDown}
                >
                  {TAB_LABEL[m]}
                </button>
              ))}
            </div>

            {mode === "single" ? (
              <div id="panel-single" role="tabpanel" aria-labelledby="tab-single">
                <SingleReview />
              </div>
            ) : (
              <div id="panel-batch" role="tabpanel" aria-labelledby="tab-batch">
                <BatchReview />
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
