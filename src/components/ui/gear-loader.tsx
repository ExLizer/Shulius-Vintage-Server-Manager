import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

interface GearLoaderProps {
  size?: Size;
  className?: string;
}

interface GearLoaderWithLabelProps extends GearLoaderProps {
  label?: string;
  /** Forces inline (no padding wrapper). Defaults to false. */
  inline?: boolean;
}

const SIZE_PX: Record<Size, number> = {
  sm: 28,
  md: 56,
  lg: 88,
};

/**
 * Twin-gear loader inspired by Vintage Story's coppery, mechanical aesthetic.
 * The big gear spins clockwise; the small one meshes counter-clockwise.
 */
export function GearLoader({ size = "md", className }: GearLoaderProps) {
  const px = SIZE_PX[size];
  // The small gear sits outside the main gear's bounding circle, so we render
  // into a viewBox slightly larger than 100 and scale the whole svg to `px`.
  return (
    <span
      className={cn("vs-gear-loader inline-block", className)}
      style={{ width: px, height: px }}
      role="status"
      aria-label="Loading"
    >
      <svg viewBox="0 0 132 132" width="100%" height="100%" aria-hidden>
        <defs>
          <radialGradient id="vs-gear-main" cx="50%" cy="40%" r="65%">
            <stop offset="0%" stopColor="hsl(35 92% 68%)" />
            <stop offset="55%" stopColor="hsl(25 85% 50%)" />
            <stop offset="100%" stopColor="hsl(18 70% 28%)" />
          </radialGradient>
          <radialGradient id="vs-gear-small" cx="50%" cy="40%" r="65%">
            <stop offset="0%" stopColor="hsl(45 95% 72%)" />
            <stop offset="55%" stopColor="hsl(38 80% 52%)" />
            <stop offset="100%" stopColor="hsl(25 65% 30%)" />
          </radialGradient>
          <radialGradient id="vs-gear-hub" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="hsl(40 60% 28%)" />
            <stop offset="100%" stopColor="hsl(20 55% 14%)" />
          </radialGradient>

          {/* 16-tooth gear, radius 40, tooth height ~10 */}
          <symbol id="vs-gear-shape-main" viewBox="-50 -50 100 100">
            <path
              d={buildGearPath({
                teeth: 16,
                innerR: 32,
                outerR: 42,
                toothTopRatio: 0.55,
              })}
              fill="url(#vs-gear-main)"
              stroke="hsl(20 70% 22%)"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            {/* Six radial perforations */}
            {Array.from({ length: 6 }).map((_, i) => {
              const a = (i / 6) * Math.PI * 2;
              const r = 20;
              return (
                <circle
                  key={i}
                  cx={Math.cos(a) * r}
                  cy={Math.sin(a) * r}
                  r="4"
                  fill="url(#vs-gear-hub)"
                  stroke="hsl(20 70% 18%)"
                  strokeWidth="0.8"
                />
              );
            })}
            {/* Hub */}
            <circle
              cx="0"
              cy="0"
              r="10"
              fill="url(#vs-gear-hub)"
              stroke="hsl(20 70% 18%)"
              strokeWidth="1"
            />
            <circle cx="0" cy="0" r="3.5" fill="hsl(20 55% 10%)" />
          </symbol>

          {/* 12-tooth gear, radius 24, tooth height ~6 */}
          <symbol id="vs-gear-shape-small" viewBox="-30 -30 60 60">
            <path
              d={buildGearPath({
                teeth: 12,
                innerR: 18,
                outerR: 25,
                toothTopRatio: 0.6,
              })}
              fill="url(#vs-gear-small)"
              stroke="hsl(20 70% 22%)"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
            <circle
              cx="0"
              cy="0"
              r="7"
              fill="url(#vs-gear-hub)"
              stroke="hsl(20 70% 18%)"
              strokeWidth="0.9"
            />
            <circle cx="0" cy="0" r="2.5" fill="hsl(20 55% 10%)" />
          </symbol>
        </defs>

        {/* Main gear, centered slightly to upper-left */}
        <g transform="translate(54 54)">
          <g className="vs-gear-spin">
            <use
              href="#vs-gear-shape-main"
              x="-50"
              y="-50"
              width="100"
              height="100"
            />
          </g>
        </g>

        {/* Small gear, meshing in the lower-right */}
        <g transform="translate(104 104)">
          <g className="vs-gear-spin-rev">
            <use
              href="#vs-gear-shape-small"
              x="-30"
              y="-30"
              width="60"
              height="60"
            />
          </g>
        </g>
      </svg>
    </span>
  );
}

/**
 * Convenience block: gear + optional label centered. Use as drop-in replacement
 * for the old <Loader2 /> + "Cargando..." pattern.
 */
export function GearLoaderBlock({
  size = "md",
  label,
  inline = false,
  className,
}: GearLoaderWithLabelProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        !inline && "py-10",
        className,
      )}
    >
      <GearLoader size={size} />
      {label && (
        <p className="text-sm text-muted-foreground tracking-wide">{label}</p>
      )}
    </div>
  );
}

/**
 * Build an SVG path describing a gear with `teeth` trapezoidal teeth.
 * - innerR: radius at the base of each tooth (the body of the gear).
 * - outerR: radius at the tip of each tooth.
 * - toothTopRatio: tooth-top width / tooth-base width (0..1). 0.55 looks chunky.
 */
function buildGearPath({
  teeth,
  innerR,
  outerR,
  toothTopRatio,
}: {
  teeth: number;
  innerR: number;
  outerR: number;
  toothTopRatio: number;
}): string {
  const step = (Math.PI * 2) / teeth;
  // A tooth spans half the step (the other half is the gap between teeth).
  const toothBaseHalf = step * 0.25;
  const toothTopHalf = toothBaseHalf * toothTopRatio;
  const gapHalf = step * 0.25;

  const pts: Array<[number, number]> = [];
  for (let i = 0; i < teeth; i++) {
    const center = i * step;
    // base-left, top-left, top-right, base-right, then walk along innerR to the
    // next tooth.
    const aBaseL = center - toothBaseHalf;
    const aTopL = center - toothTopHalf;
    const aTopR = center + toothTopHalf;
    const aBaseR = center + toothBaseHalf;
    const aNextBaseL = center + toothBaseHalf + (step - 2 * toothBaseHalf);

    pts.push([Math.cos(aBaseL) * innerR, Math.sin(aBaseL) * innerR]);
    pts.push([Math.cos(aTopL) * outerR, Math.sin(aTopL) * outerR]);
    pts.push([Math.cos(aTopR) * outerR, Math.sin(aTopR) * outerR]);
    pts.push([Math.cos(aBaseR) * innerR, Math.sin(aBaseR) * innerR]);
    // Walk to the next tooth's base-left along the inner radius (straight line
    // is fine at 16 teeth — visually indistinguishable from an arc).
    pts.push([Math.cos(aNextBaseL) * innerR, Math.sin(aNextBaseL) * innerR]);
    void gapHalf; // not used; intentionally kept for clarity above.
  }

  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`;
  }
  d += " Z";
  return d;
}
