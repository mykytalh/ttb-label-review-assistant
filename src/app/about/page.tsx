import type { Metadata } from "next";
import AboutNav from "./AboutNav";

export const metadata: Metadata = {
  title: "About · TTB Label Review Console",
};

const STEPS = [
  {
    n: 1,
    title: "Open a case",
    body: "Pick a pending application from the Review Queue. Its data and label artwork are already attached — nothing is typed by hand.",
  },
  {
    n: 2,
    title: "Run AI verification",
    body: "One click reads the label and cross-checks every mandatory element against what the applicant submitted.",
  },
  {
    n: 3,
    title: "Read the findings",
    body: "An overall recommendation plus a field-by-field breakdown — each result in one of five clear statuses.",
  },
  {
    n: 4,
    title: "Record a disposition",
    body: "Approve, request info, or reject. Decisions persist locally and show right on the queue.",
  },
];

const LEGEND: { cls: string; label: string; body: string }[] = [
  { cls: "pill--match", label: "Match", body: "The label matches the application." },
  { cls: "pill--variation", label: "Acceptable variation", body: "Different but within tolerance — an ABV inside the CFR band, or a casing / punctuation difference." },
  { cls: "pill--needs_review", label: "Needs review", body: "Can't be auto-judged — verify by eye (e.g. a partially legible warning)." },
  { cls: "pill--mismatch", label: "Mismatch", body: "The label conflicts with the application." },
  { cls: "pill--missing", label: "Missing", body: "A mandatory element isn't on the submitted label." },
];

/**
 * About — explains the mock-COLA interpretation, the architecture, and the
 * deliberate limitations. Full-width docs layout with a sticky in-page nav.
 */
export default function AboutPage() {
  return (
    <div className="about">
      <header className="about-hero">
        <h1 className="about-title">About this console</h1>
        <p className="about-lede">
          An agent-side review workstation for alcohol beverage label applications — a proof of concept for the
          U.S. Alcohol and Tobacco Tax and Trade Bureau (TTB) Certificate of Label Approval (COLA) workflow.
        </p>
      </header>

      <div className="about-layout">
        <AboutNav />

        <div className="about-body">
          <section id="how" className="about-section">
            <h2 className="about-h">How the review works</h2>
            <ol className="about-steps">
              {STEPS.map((s) => (
                <li key={s.n} className="about-step">
                  <span className="about-step-n" aria-hidden="true">{s.n}</span>
                  <div>
                    <h3 className="about-step-title">{s.title}</h3>
                    <p className="about-step-body">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section id="engine" className="about-section">
            <h2 className="about-h">The model transcribes; the code judges</h2>
            <p className="about-p">
              The AI is used only to <strong>extract</strong> structured text from the label into a fixed schema.
              Every compliance verdict is computed by deterministic TypeScript — brand matched with case and
              punctuation tolerance, ABV against the CFR tolerance for its beverage type, the government warning
              byte-checked against 27 CFR 16.21. The model never decides pass or fail, which keeps the judgments
              auditable and the failure mode safe: an unreadable warning routes to &ldquo;verify by eye,&rdquo; it is
              never guessed.
            </p>
            <ul className="status-legend">
              {LEGEND.map((l) => (
                <li key={l.label} className="legend-row">
                  <span className={`pill ${l.cls}`}>{l.label}</span>
                  <span className="legend-text">{l.body}</span>
                </li>
              ))}
            </ul>
            <p className="about-p">
              These roll up into a recommended disposition: <strong>Ready for Approval</strong>,{" "}
              <strong>Needs Agent Review</strong>, or <strong>Likely Rejection</strong>.
            </p>
          </section>

          <section id="data" className="about-section">
            <h2 className="about-h">Where the mock data comes from</h2>
            <p className="about-p">
              The queue is generated at build time from a free public sample of the TTB COLA registry (the COLA Cloud
              Sample Pack): real brands and real submitted label artwork across wine, spirits, and beer. A few records
              carry a deliberate, realistic discrepancy — a wrong ABV, a brand spelling variance, a front label
              missing the warning — so the review surfaces every result status. The running app has no external
              dependency; the sample is baked in.
            </p>
          </section>

          <section id="limits" className="about-section">
            <h2 className="about-h">Deliberate limitations</h2>
            <ul className="about-list">
              <li>No real COLA integration. Decisions persist in the browser (localStorage) for the demo, not a server of record.</li>
              <li>Label boldness and type-size minimums can&rsquo;t be verified from extracted text, so they&rsquo;re flagged for the eye rather than passed silently.</li>
              <li>Each record carries a single label image. A mandatory element absent from it is reported as Missing — the front of a bottle isn&rsquo;t the full label.</li>
              <li>Producer / address is shown for reference but not auto-graded; its on-label form varies too much to assert against one image.</li>
              <li>A production deployment would add agency SSO, a tamper-evident audit log, and a shared rate-limit store.</li>
            </ul>

            <p className="about-source">
              <a className="footer-link" href="https://github.com/mykytalh/ttb-label-review-assistant" target="_blank" rel="noopener noreferrer">
                Source code, evaluation methodology, and security notes &rarr;
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
