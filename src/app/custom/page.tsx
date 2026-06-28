"use client";

/**
 * Custom Test Mode — the secondary, ad-hoc path.
 *
 * The main workflow pulls applications from the queue, but agents sometimes need
 * to test an arbitrary label that isn't in COLA. This is the original manual
 * flow: upload a photo, optionally enter the application fields, and verify. Kept
 * but demoted out of the primary path.
 */
import Link from "next/link";
import SingleReview from "@/components/SingleReview";

export default function CustomTestModePage() {
  return (
    <div>
      <header className="page-head">
        <h1 className="page-title">Custom Test Mode</h1>
        <p className="page-sub">
          Check an arbitrary label that isn’t in the queue — upload a photo, optionally enter the application
          fields to cross-check, and run verification. This is a testing tool; the day-to-day workflow is{" "}
          <Link href="/" className="footer-link">Label Approvals</Link>.
        </p>
      </header>

      <SingleReview />
    </div>
  );
}
