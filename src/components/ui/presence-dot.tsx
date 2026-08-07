interface PresenceDotProps {
  // Optional title for native tooltip on hover.
  title?: string;
  className?: string;
}

/**
 * Small pulsing green dot used to indicate live presence (e.g. a group member
 * currently running the server). The outer ping ring fades out continuously,
 * the inner solid dot stays. Tailwind animate-ping has a 1s cycle.
 */
export function PresenceDot({ title, className = "" }: PresenceDotProps) {
  return (
    <span
      className={`relative inline-flex h-2 w-2 ${className}`}
      title={title}
      aria-label={title}
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[hsl(var(--emerald))] opacity-75"></span>
      <span className="relative inline-flex h-2 w-2 rounded-full bg-[hsl(var(--emerald))]"></span>
    </span>
  );
}
