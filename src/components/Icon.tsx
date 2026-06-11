/** Inline SVG icons for functional UI. Decorative by default (aria-hidden). */
export function UploadIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 15V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}

export function StackIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 8l9-4 9 4-9 4-9-4Z" />
      <path d="M3 12l9 4 9-4" />
      <path d="M3 16l9 4 9-4" />
    </svg>
  );
}

/** Shared wrapper for the small tool-strip icons (round line style). */
function ToolSvg({ size = 18, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const RotateIcon = ({ size }: { size?: number }) => (
  <ToolSvg size={size}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v4h-4" />
  </ToolSvg>
);

export const ZoomInIcon = ({ size }: { size?: number }) => (
  <ToolSvg size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3M11 8v6M8 11h6" />
  </ToolSvg>
);

export const ZoomOutIcon = ({ size }: { size?: number }) => (
  <ToolSvg size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3M8 11h6" />
  </ToolSvg>
);

export const MagnifyIcon = ({ size }: { size?: number }) => (
  <ToolSvg size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </ToolSvg>
);

export const CropIcon = ({ size }: { size?: number }) => (
  <ToolSvg size={size}>
    <path d="M6 2v14a2 2 0 0 0 2 2h14" />
    <path d="M2 6h14a2 2 0 0 1 2 2v14" />
  </ToolSvg>
);

export const ResetIcon = ({ size }: { size?: number }) => (
  <ToolSvg size={size}>
    <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.36 2.64L3 8" />
    <path d="M3 3v5h5" />
  </ToolSvg>
);
