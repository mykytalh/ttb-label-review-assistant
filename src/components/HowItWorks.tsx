"use client";

/** In-app help view with sidebar navigation. Opened from the header "How to use" link. */
import { useEffect, useRef, useState } from "react";
import { GOVERNMENT_WARNING } from "@/lib/warning";

type SectionId =
  | "start"
  | "review"
  | "batch"
  | "tools"
  | "results"
  | "regulations"
  | "why";

const NAV: { id: SectionId; label: string }[] = [
  { id: "start", label: "Getting started" },
  { id: "review", label: "Reviewing a label" },
  { id: "batch", label: "Batch upload" },
  { id: "tools", label: "The image tools" },
  { id: "results", label: "Reading the results" },
  { id: "regulations", label: "What the rules are" },
  { id: "why", label: "Why did it say that?" },
];

export default function HowItWorks({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState<SectionId>("start");
  const [navOpen, setNavOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    backRef.current?.focus();

    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const selectSection = (id: SectionId) => {
    setActive(id);
    setNavOpen(false);
  };

  const activeLabel = NAV.find((s) => s.id === active)?.label ?? "Help";

  return (
    <div
      ref={panelRef}
      className="docs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="docs-dialog-title"
    >
      <h2 id="docs-dialog-title" className="visually-hidden">
        How to use the Label Review Assistant
      </h2>
      <button ref={backRef} type="button" className="hiw-back" onClick={onClose}>
        <span aria-hidden="true">←</span> Back to the tool
      </button>

      <button
        type="button"
        className="docs-menu-toggle"
        aria-expanded={navOpen}
        aria-controls="docs-nav-panel"
        onClick={() => setNavOpen((open) => !open)}
      >
        <span className="docs-menu-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
        </span>
        <span className="docs-menu-label">{activeLabel}</span>
        <span className="docs-menu-caret" aria-hidden="true">
          {navOpen ? "▲" : "▼"}
        </span>
      </button>

      <div className="docs-layout">
        <nav
          id="docs-nav-panel"
          className={`docs-nav${navOpen ? " open" : ""}`}
          aria-label="Help sections"
        >
          <p className="docs-nav-title">Help &amp; documentation</p>
          <ul>
            {NAV.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`docs-nav-link${active === s.id ? " active" : ""}`}
                  aria-current={active === s.id ? "page" : undefined}
                  onClick={() => selectSection(s.id)}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <article className="docs-content card">
          {active === "start" && <Start />}
          {active === "review" && <Review />}
          {active === "batch" && <Batch />}
          {active === "tools" && <Tools />}
          {active === "results" && <Results />}
          {active === "regulations" && <Regulations />}
          {active === "why" && <Why />}
        </article>
      </div>
    </div>
  );
}

/* Highlighted callout box for key notes. */
function Callout({
  kind,
  title,
  children,
}: {
  kind: "tip" | "note" | "important";
  title: string;
  children: React.ReactNode;
}) {
  const icon = kind === "tip" ? "💡" : kind === "important" ? "⚠" : "ℹ";
  return (
    <div className={`callout ${kind}`}>
      <span className="callout-icon" aria-hidden="true">{icon}</span>
      <p>
        <span className="callout-title">{title}:</span> {children}
      </p>
    </div>
  );
}

/* ---------------- Sections ---------------- */

function Start() {
  return (
    <>
      <p className="step">Getting started</p>
      <h2>What this tool does</h2>
      <p className="docs-lead">
        It reads a photo of an alcohol label, compares what it reads against what
        the application says, and reports a result for each field — the brand,
        alcohol content, net contents, bottler, country of origin, and the
        mandatory government health warning.
      </p>
      <p>
        It assists your review; it does not replace your judgment. Every result
        is advisory — confirm by eye before making a decision.
      </p>
      <h3 className="docs-h3">The three pieces</h3>
      <ul className="docs-list">
        <li><strong>Application</strong> — what the producer claims (what you type in).</li>
        <li><strong>Label</strong> — what the AI reads off the photo.</li>
        <li><strong>Review</strong> — the tool comparing the two, field by field.</li>
      </ul>
      <h3 className="docs-h3">Two ways to work</h3>
      <ul className="docs-list">
        <li><strong>One label</strong> — review a single label in detail, with image tools and a printable record.</li>
        <li><strong>Batch upload</strong> — check a whole stack at once and download the results as a spreadsheet.</li>
      </ul>
      <Callout kind="note" title="Privacy">
        Photos are checked instantly and are <strong>never saved</strong> —
        nothing from a review is kept.
      </Callout>
    </>
  );
}

function Review() {
  return (
    <>
      <p className="step">Reviewing a label</p>
      <h2>Check one label</h2>
      <ol className="hiw-steps">
        <li>
          <span className="hiw-num" aria-hidden="true">1</span>
          <span>
            <strong>Type the brand name</strong> as it appears on the label — this
            is the only field you must fill in. Open{" "}
            <strong>&ldquo;Add more label details&rdquo;</strong> to also enter the
            class/type, alcohol %, net contents, bottler, or country of origin. The
            tool compares anything you enter against the label; leave a field blank
            and it simply reads what the label shows.
          </span>
        </li>
        <li>
          <span className="hiw-num" aria-hidden="true">2</span>
          <span>
            <strong>Add a photo of the label.</strong> Click the upload box or drag
            a photo in. The back label usually carries the government warning, so
            include it. You don&rsquo;t need to shrink the photo — the tool resizes
            it for you.
          </span>
        </li>
        <li>
          <span className="hiw-num" aria-hidden="true">3</span>
          <span>
            <strong>Press &ldquo;Check this label.&rdquo;</strong> In a few seconds
            you&rsquo;ll see the result, and you can <strong>Print</strong> a formal
            record.
          </span>
        </li>
      </ol>
      <Callout kind="tip" title="Tip">
        Most mismatches are just a typo in what was entered — if a field fails,
        check your entry before re-shooting the photo.
      </Callout>
      <h3 className="docs-h3">If you don&rsquo;t have the application values</h3>
      <p>
        That&rsquo;s fine — only the brand is required. Leave the rest blank and the
        tool just reads the label and checks the universally-required items (above
        all, the government warning). Fields with nothing to compare come back as{" "}
        <strong>&ldquo;Not checked.&rdquo;</strong>
      </p>
      <h3 className="docs-h3">Beverage type</h3>
      <p>
        Left on <strong>Auto</strong> (the default), the tool detects the type from
        the label — including products outside the three classic classes, like a
        hard seltzer or canned cocktail. This also sets the alcohol-content rule:
        distilled spirits must state ABV; wine and beer may leave it off. If you
        pick a specific type and it doesn&rsquo;t match what the label looks like,
        the tool flags it for you to confirm. When in doubt, leave it on Auto.
      </p>
    </>
  );
}

function Batch() {
  return (
    <>
      <p className="step">Batch upload</p>
      <h2>Check a whole stack at once</h2>
      <p>
        Use the <strong>Batch upload</strong> tab for a stack of labels. Add the
        photos, press <strong>Review all</strong>, and results stream in as each
        finishes.
      </p>
      <h3 className="docs-h3">What gets checked</h3>
      <p>
        Batch has no application form, so the AI <strong>reads every field off the
        label</strong> and checks what federal rules require on the artwork itself:
        brand and class must be present, alcohol content is enforced by detected
        beverage type, and the <strong>government warning</strong> gets the full
        strict check (present, all-caps <strong>GOVERNMENT WARNING:</strong> heading
        with colon, verbatim wording). Producer, net contents, and origin are
        captured when visible but not hard-failed when absent. Click any row for the full
        readout — extracted values, verdicts, and warning sub-checks.
      </p>
      <h3 className="docs-h3">Good to know</h3>
      <ul className="docs-list">
        <li>Up to <strong>5 labels</strong> per batch in this demo (each label is one API call). Two run at a time.</li>
        <li><strong>Stop</strong> halts a run in progress; <strong>Clear</strong> empties the batch.</li>
        <li>If the service is briefly busy, a label retries on its own and only fails after that — the rest keep going.</li>
        <li>After a run, <strong>Retry N failed</strong> re-runs only the ones that didn&rsquo;t succeed.</li>
        <li><strong>Download CSV</strong> mirrors the AI extraction readout (file, date, image quality, every field read off the label) plus a <strong>needsAttention</strong> column that lists only fails and reviews — blank when everything passed.</li>
        <li>Only <strong>PNG, JPEG, and WebP</strong> are accepted — other formats (e.g. HEIC) are skipped with a message.</li>
      </ul>
    </>
  );
}

function Tools() {
  return (
    <>
      <p className="step">The image tools</p>
      <h2>Work the photo before you review</h2>
      <p>
        After you choose a photo, a small toolbar appears under the image. These
        tools change what gets sent to the AI — use them when the label is sideways,
        cropped awkwardly, or the warning is tiny.
      </p>
      <ul className="docs-list">
        <li><strong>Rotate</strong> — turn a sideways phone photo upright. The rotated image is what gets reviewed.</li>
        <li><strong>Crop</strong> — draw a box around just the label or the warning block to cut out background clutter.</li>
        <li><strong>Zoom</strong> — scale the image up in the viewer (view only; does not change what is sent unless you cropped).</li>
        <li><strong>Magnify</strong> — hover to enlarge small print (view only).</li>
        <li><strong>Replace / Remove</strong> — swap the photo or clear it and start over.</li>
      </ul>
      <p>
        On a phone-sized screen only <strong>Rotate</strong> is shown — zoom, crop,
        and magnify need a wider layout. Magnify is also disabled when your device
        has <strong>reduced motion</strong> turned on.
      </p>
      <Callout kind="tip" title="Tip">
        If the government warning runs vertically up the side of a can, rotate the
        photo so the text reads horizontally before reviewing.
      </Callout>
    </>
  );
}

function Results() {
  return (
    <>
      <p className="step">Reading the results</p>
      <h2>What the verdicts mean</h2>
      <p>
        Each field gets one of four results. The headline at the top summarizes the
        whole label; the field cards below explain each one.
      </p>
      <ul className="hiw-meanings">
        <li>
          <span className="vk-icon v-pass" aria-hidden="true">✓</span>
          <span><strong>Pass</strong> — matches or compliant.</span>
        </li>
        <li>
          <span className="vk-icon v-warn" aria-hidden="true">⚠</span>
          <span><strong>Review</strong> — probably fine, but verify by eye (a close match or soft finding).</span>
        </li>
        <li>
          <span className="vk-icon v-fail" aria-hidden="true">✕</span>
          <span><strong>Fail</strong> — mismatch, missing required text, or non-compliant wording.</span>
        </li>
        <li>
          <span className="vk-icon v-na" aria-hidden="true">–</span>
          <span><strong>Not checked</strong> — nothing to compare (field absent from both the application and the label).</span>
        </li>
      </ul>
      <p>
        Failures and reviews are shown expanded first. Verified fields collapse into
        a short checklist you can expand. The label image sits beside the results so
        you can confirm by eye.
      </p>
      <Callout kind="important" title="Advisory">
        Results are AI-assisted — always confirm by eye before making a decision.
      </Callout>
    </>
  );
}

function Regulations() {
  return (
    <>
      <p className="step">What the rules are</p>
      <h2>Federal label requirements (summary)</h2>
      <p>
        Alcohol beverage labels must carry specific information. Requirements vary
        by beverage type, but the tool checks the core fields agents see on most
        applications:
      </p>
      <ul className="docs-list">
        <li><strong>Brand name</strong></li>
        <li><strong>Class / type designation</strong></li>
        <li><strong>Alcohol content</strong> (required for spirits; optional within limits for some wine and beer)</li>
        <li><strong>Net contents</strong></li>
        <li><strong>Bottler / producer name and address</strong></li>
        <li><strong>Country of origin</strong> (imports)</li>
        <li><strong>Government health warning</strong> (all alcohol beverages)</li>
      </ul>
      <h3 className="docs-h3">Government warning (27 CFR 16.21)</h3>
      <p>
        The warning must appear <strong>word for word</strong>, led by{" "}
        <strong>&ldquo;GOVERNMENT WARNING:&rdquo;</strong> in all capital letters.
        The tool checks three things: present, correct heading (all caps with a
        colon), and verbatim body.
      </p>
      <blockquote className="docs-quote">
        {GOVERNMENT_WARNING}
      </blockquote>
      <p className="docs-cite">
        See <a className="docs-link" href="https://www.ttb.gov" target="_blank" rel="noopener noreferrer">ttb.gov</a> for
        the full regulatory guidance.
      </p>
    </>
  );
}

function Why() {
  return (
    <>
      <p className="step">Why did it say that?</p>
      <h2>How matching works</h2>
      <p>
        Different fields use different strictness — the same way an agent would
        treat a brand typo differently from a tampered warning.
      </p>
      <h3 className="docs-h3">Fuzzy fields (brand, class, producer)</h3>
      <p>
        Case, punctuation, and accents are normalized before comparing.{" "}
        <strong>STONE&rsquo;S THROW</strong> and <strong>Stone&rsquo;s Throw</strong>{" "}
        are treated as a match. A close typo returns <strong>Review</strong>, not
        Fail.
      </p>
      <h3 className="docs-h3">Strict warning</h3>
      <p>
        The government warning must be verbatim — including the colon after{" "}
        <strong>GOVERNMENT WARNING</strong>. Title case, paraphrasing, or a missing
        clause fails. If the photo was too poor to read the warning fully,
        the tool declines to auto-pass even if the extracted text looks right —
        it routes you to verify by eye instead of guessing.
      </p>
      <Callout kind="note" title="Batch vs one label">
        Batch reads the label and flags missing required elements — it does not
        compare against a COLA application (no form to type into). Use <strong>One
        label</strong> when you have application data and need full
        application-to-label matching.
      </Callout>
    </>
  );
}
