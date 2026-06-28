import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import ConsoleShell from "@/components/ConsoleShell";
import "./globals.css";

// Inter — a modern, highly legible UI typeface used throughout, exposed to the
// stylesheet as the --font-sans CSS variable.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "TTB Label Review Console",
  description:
    "Agent-side review console for alcohol beverage label applications — pull a pending application, verify its label against the claim, record a disposition.",
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
    <html lang="en" className={inter.variable}>
      <body>
        {/* Skip link — first focusable element, lets keyboard/screen-reader
            users jump past the navigation straight to the work area. */}
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <ConsoleShell>{children}</ConsoleShell>
      </body>
    </html>
  );
}
