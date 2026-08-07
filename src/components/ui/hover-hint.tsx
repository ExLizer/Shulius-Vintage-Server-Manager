import type { ReactNode } from "react";

interface HoverHintProps {
  hint?: string | null;
  side?: "top" | "bottom";
  children: ReactNode;
  className?: string;
}

/**
 * Lightweight CSS-only tooltip for explaining why a control is disabled.
 * If `hint` is falsy, renders children unchanged. Otherwise wraps them so a
 * styled bubble appears on hover/focus-within (works on disabled buttons too
 * because the hover listener lives on the wrapper).
 */
export function HoverHint({ hint, side = "top", children, className }: HoverHintProps) {
  if (!hint) return <>{children}</>;

  const isTop = side === "top";
  const positionClasses = isTop
    ? "bottom-full left-1/2 -translate-x-1/2 mb-2"
    : "top-full left-1/2 -translate-x-1/2 mt-2";
  const arrowClasses = isTop
    ? "top-full left-1/2 -translate-x-1/2 border-t-[hsl(var(--popover))] border-l-transparent border-r-transparent border-b-transparent"
    : "bottom-full left-1/2 -translate-x-1/2 border-b-[hsl(var(--popover))] border-l-transparent border-r-transparent border-t-transparent";

  return (
    <span className={`relative inline-flex group ${className ?? ""}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${positionClasses} z-50 whitespace-nowrap rounded-md border border-border bg-[hsl(var(--popover))] px-2.5 py-1.5 text-xs text-[hsl(var(--popover-foreground))] shadow-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 delay-100`}
      >
        {hint}
        <span
          className={`absolute h-0 w-0 border-4 ${arrowClasses}`}
          aria-hidden="true"
        />
      </span>
    </span>
  );
}
