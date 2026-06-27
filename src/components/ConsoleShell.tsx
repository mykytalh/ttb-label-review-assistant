"use client";

/**
 * The application shell — a persistent left sidebar + top bar that wraps every
 * route. This is the structural shift from the old single upload form to a
 * review console: the agent's home is a worklist they live in, not a landing
 * page. The sidebar collapses to a horizontal nav on narrow screens.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Match nested routes (e.g. /review/[id] highlights the queue). */
  match?: (path: string) => boolean;
}

const NAV: NavItem[] = [
  {
    href: "/",
    label: "Review Queue",
    match: (p) => p === "/" || p.startsWith("/review"),
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    ),
  },
  {
    href: "/custom",
    label: "Custom Test Mode",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-2-2 2.1-2.1z" />
      </svg>
    ),
  },
  {
    href: "/about",
    label: "About",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><circle cx="12" cy="7.6" r="0.6" fill="currentColor" />
      </svg>
    ),
  },
];

export default function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const isActive = (item: NavItem) => (item.match ? item.match(pathname) : pathname === item.href);

  return (
    <div className="console is-collapsed">
      <div className="console-body">
        <aside className="console-sidebar" aria-label="Primary">
        <Link href="/" className="console-brand">
          <span className="console-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </span>
          <span className="console-brand-text">
            <span className="console-brand-title">Label Review</span>
            <span className="console-brand-sub">TTB Compliance Console</span>
          </span>
        </Link>

        <nav className="console-nav" aria-label="Sections">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`console-nav-link${isActive(item) ? " is-active" : ""}`}
              aria-current={isActive(item) ? "page" : undefined}
              title={item.label}
            >
              <span className="console-nav-icon">{item.icon}</span>
              <span className="console-nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>

      </aside>

      <div className="console-main">
        <main id="main-content" className="console-content">
          {children}
        </main>
      </div>
      </div>
    </div>
  );
}
