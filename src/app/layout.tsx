import type { Metadata, Viewport } from "next";
import { Public_Sans, Source_Serif_4 } from "next/font/google";
import SiteFooter from "@/components/SiteFooter";
import "./globals.css";

// Public Sans is the U.S. Web Design System typeface — used for all body text.
const publicSans = Public_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-public-sans",
});

// Source Serif 4 for the product title only — the serif companion to Source
// Sans, designed for federal/institutional documents. Gives the masthead a
// "Treasury document" presence while the body stays in the official sans.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  weight: ["600", "700"],
  variable: "--font-serif",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "Label Review Assistant",
  description:
    "Check alcohol beverage labels against federal compliance requirements.",
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${publicSans.variable} ${sourceSerif.variable}`} suppressHydrationWarning>
      <head>
        {/* Set the theme before first paint to avoid a flash: use the saved
            choice if present, otherwise follow the OS preference. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        {/* Skip link — first focusable element, lets keyboard/screen-reader
            users jump past the banner straight to the tool. */}
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
