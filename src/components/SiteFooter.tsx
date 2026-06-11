/** Site footer in USWDS visual style (dark band, gold top rule). */
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="inner">
        {/* Eagle artwork generated with ChatGPT. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- a static
            decorative asset; plain <img> avoids the Image config overhead. */}
        <img
          src="/eagle-flag.png"
          alt=""
          aria-hidden="true"
          className="footer-eagle"
        />

        <div className="footer-meta">
          <p className="byline">
            designed &amp; built by Mykyta Lepikash ·{" "}
            <a
              href="https://github.com/mykytalh/ttb-label-review-assistant"
              className="footer-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              Source code
            </a>{" "}
            · &copy; 2026
          </p>
        </div>
      </div>
    </footer>
  );
}
