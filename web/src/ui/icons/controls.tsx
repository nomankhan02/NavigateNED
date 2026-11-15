import { type IconProps, SvgFrame } from "./types";

/** Play: crisp triangular transport start */
export function PlayIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <polygon points="6.5,4.5 19,12 6.5,19.5" />
    </SvgFrame>
  );
}

/** Pause: dual vertical transport bars */
export function PauseIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <rect x="6.5" y="4.5" width="3.5" height="15" rx="0.75" />
      <rect x="14" y="4.5" width="3.5" height="15" rx="0.75" />
    </SvgFrame>
  );
}

/** Step: single-frame advance (play triangle + vertical stop bar) */
export function StepIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <polygon points="5.5,5.25 15.25,12 5.5,18.75" />
      <path d="M18.25 5 V19" />
    </SvgFrame>
  );
}

/** Close: precision diagonal cross */
export function CloseIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <path d="M5.5 5.5 L18.5 18.5 M18.5 5.5 L5.5 18.5" />
    </SvgFrame>
  );
}

/** Menu: calibrated horizontal drafting rules */
export function MenuIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <path d="M4 6.5 H20 M4 12 H16.5 M4 17.5 H20" />
    </SvgFrame>
  );
}

/** Chevron Up */
export function ChevronUpIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <path d="M5.5 15 L12 8.5 L18.5 15" />
    </SvgFrame>
  );
}

/** Chevron Down */
export function ChevronDownIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <path d="M5.5 9 L12 15.5 L18.5 9" />
    </SvgFrame>
  );
}

/** Chevron Left */
export function ChevronLeftIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <path d="M15 5.5 L8.5 12 L15 18.5" />
    </SvgFrame>
  );
}

/** Chevron Right */
export function ChevronRightIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <path d="M9 5.5 L15.5 12 L9 18.5" />
    </SvgFrame>
  );
}

/** Chevrons: dual vertical expand/collapse chevrons */
export function ChevronsIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <path d="M7.5 9.25 L12 4.75 L16.5 9.25" />
      <path d="M7.5 14.75 L12 19.25 L16.5 14.75" />
    </SvgFrame>
  );
}

/** Settings: three calibration slider tracks with Vernier stops */
export function SettingsIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <path d="M4 6.5 H10 M14 6.5 H20" />
      <rect x="10" y="4.5" width="4" height="4" rx="0.75" />
      <path d="M4 12 H14 M18 12 H20" />
      <rect x="14" y="10" width="4" height="4" rx="0.75" />
      <path d="M4 17.5 H6 M10 17.5 H20" />
      <rect x="6" y="15.5" width="4" height="4" rx="0.75" />
    </SvgFrame>
  );
}

/** Sun: Daylight Survey Plate symbol */
export function SunIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <circle cx="12" cy="12" r="4.25" />
      <path d="M12 2.5 V4.75 M12 19.25 V21.5 M2.5 12 H4.75 M19.25 12 H21.5" />
      <path d="M5.3 5.3 L6.9 6.9 M17.1 17.1 L18.7 18.7 M18.7 5.3 L17.1 6.9 M6.9 17.1 L5.3 18.7" />
    </SvgFrame>
  );
}

/** Moon: Night Survey Plate symbol */
export function MoonIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <path d="M20.25 14.5 A8.25 8.25 0 1 1 9.5 3.75 A6.5 6.5 0 0 0 20.25 14.5 Z" />
    </SvgFrame>
  );
}
