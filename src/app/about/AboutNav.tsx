"use client";

import { useEffect, useState } from "react";

const SECTIONS = [
  { id: "how", label: "How the review works" },
  { id: "scale", label: "Built for the volume" },
  { id: "engine", label: "Transcribe vs. judge" },
  { id: "data", label: "Where the data comes from" },
  { id: "limits", label: "Deliberate limitations" },
];

/**
 * In-page navigation rail for the About page. A scroll-position spy highlights
 * the section currently in view; clicking a link smooth-scrolls to it. Client
 * component so the page itself stays a server component (keeps its metadata).
 *
 * Uses scroll position (not IntersectionObserver) on purpose: the last section
 * is short and never reaches an observer band near the top, so an IO spy would
 * never mark it active. Here the bottom of the page forces the last section.
 */
export default function AboutNav() {
  const [active, setActive] = useState(SECTIONS[0].id);

  useEffect(() => {
    const OFFSET = 140; // a section is "current" once its top passes this line
    const onScroll = () => {
      const doc = document.documentElement;
      // At the very bottom, the last section is the one being read.
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 4) {
        setActive(SECTIONS[SECTIONS.length - 1].id);
        return;
      }
      let current = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= OFFSET) current = s.id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const jump = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    setActive(id);
    window.history.replaceState(null, "", `#${id}`);
  };

  return (
    <nav className="about-nav" aria-label="On this page">
      <span className="about-nav-title">On this page</span>
      {SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          onClick={(e) => jump(e, s.id)}
          aria-current={active === s.id ? "true" : undefined}
          className={`about-nav-link${active === s.id ? " is-active" : ""}`}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
