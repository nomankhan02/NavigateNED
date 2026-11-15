import type { SVGProps } from "react";

export interface BrandLogoProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Rendered pixel size (16px renders simplified geometry; 24px+ renders full 3D isometric N) */
  size?: number;
  /** Play staggered 4px rise + fade-in intro on the isometric face groups (<700ms total) */
  animated?: boolean;
  title?: string;
}

/**
 * NavigateNED Brand Mark — Static 3D isometric extruded "N" (30° projection)
 * Flat faces only (top=light, front/left=mid, side/right=dark) + route-colour cut line.
 */
export function BrandLogo({
  size = 24,
  animated = false,
  title = "NavigateNED",
  className,
  ...rest
}: BrandLogoProps) {
  const isSimplified = size <= 18;

  if (isSimplified) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        role={title ? "img" : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        focusable="false"
        className={className}
        {...rest}
      >
        {title ? <title>{title}</title> : null}
        {/* Simplified 16px isometric N */}
        <polygon points="2,4.2 5,2.5 5,13.5 2,11.8" fill="var(--color-logo-mid)" />
        <polygon points="11,2.5 14,4.2 14,11.8 11,13.5" fill="var(--color-logo-dark)" />
        <polygon points="2,4.2 5,2.5 14,11.8 11,13.5" fill="var(--color-logo-light)" />
        <line
          x1="1.5"
          y1="13.2"
          x2="14.5"
          y2="2.8"
          stroke="var(--color-signal-vermilion)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="1.8" cy="13" r="1.25" fill="var(--color-signal-vermilion)" />
        <circle cx="14.2" cy="3" r="1.25" fill="var(--color-signal-vermilion)" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={[animated ? "ned-logo-animated" : "", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    >
      {title ? <title>{title}</title> : null}

      {/* Face Group 1: Dark Right/Side Extruded Faces */}
      <g className={animated ? "ned-logo-face ned-logo-face-1" : undefined}>
        {/* Left pillar inner right side (visible in lower N notch) */}
        <polygon points="20,40.4 28,45 28,31.2 20,26.6" fill="var(--color-logo-dark)" />
        {/* Right pillar inner notch face */}
        <polygon points="36,15.6 44,20.2 44,34 36,29.4" fill="var(--color-logo-dark)" />
        {/* Right pillar outer right side */}
        <polygon points="44,11 52,15.6 52,44.4 44,39.8" fill="var(--color-logo-dark)" />
      </g>

      {/* Face Group 2: Mid Left/Front Faces (Each N stroke) */}
      <g className={animated ? "ned-logo-face ned-logo-face-2" : undefined}>
        {/* Left vertical stroke front face */}
        <polygon points="12,24.4 20,19.8 20,51.4 12,56" fill="var(--color-logo-mid)" />
        {/* Diagonal stroke front face */}
        <polygon points="20,19.8 36,39.8 36,51.4 20,31.4" fill="var(--color-logo-mid)" />
        {/* Right vertical stroke front face */}
        <polygon points="36,10.6 44,6 44,39.8 36,44.4" fill="var(--color-logo-mid)" />
      </g>

      {/* Face Group 3: Light Top Faces */}
      <g className={animated ? "ned-logo-face ned-logo-face-3" : undefined}>
        {/* Left pillar top face */}
        <polygon points="12,24.4 20,19.8 28,24.4 20,29" fill="var(--color-logo-light)" />
        {/* Diagonal bridge top face */}
        <polygon points="20,19.8 28,24.4 44,44.4 36,39.8" fill="var(--color-logo-light)" />
        {/* Right pillar top face */}
        <polygon points="36,10.6 44,6 52,10.6 44,15.2" fill="var(--color-logo-light)" />
      </g>

      {/* Face Group 4: Route-colour cut line + endpoint nodes */}
      <g className={animated ? "ned-logo-face ned-logo-face-4" : undefined}>
        <line
          x1="9"
          y1="52"
          x2="55"
          y2="12"
          stroke="var(--color-bg-canvas)"
          strokeWidth="4.2"
          strokeLinecap="round"
        />
        <line
          x1="9"
          y1="52"
          x2="55"
          y2="12"
          stroke="var(--color-signal-vermilion)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <circle
          cx="9"
          cy="52"
          r="3.2"
          fill="var(--color-signal-vermilion)"
          stroke="var(--color-bg-canvas)"
          strokeWidth="1.2"
        />
        <circle
          cx="55"
          cy="12"
          r="3.2"
          fill="var(--color-signal-vermilion)"
          stroke="var(--color-bg-canvas)"
          strokeWidth="1.2"
        />
      </g>
    </svg>
  );
}
