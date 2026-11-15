import { type IconProps, SvgFrame } from "./types";

/** Entrance: architectural portal with inward traverse arrow */
export function EntranceIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <path d="M11 4 H18.5 C19.33 4 20 4.67 20 5.5 V18.5 C20 19.33 19.33 20 18.5 20 H11" />
      <path d="M3.5 12 H14.5" />
      <path d="M11 8.5 L14.5 12 L11 15.5" />
    </SvgFrame>
  );
}

/** Exit: emergency egress portal with outward arrow */
export function ExitIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <path d="M13 4 H5.5 C4.67 4 4 4.67 4 5.5 V18.5 C4 19.33 4.67 20 5.5 20 H13" />
      <path d="M9.5 12 H20.5" />
      <path d="M17 8.5 L20.5 12 L17 15.5" />
    </SvgFrame>
  );
}

/** Stairs: architectural stepped riser profile with ascent arrow */
export function StairsIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <path d="M3.5 19.5 H8 V15 H12.5 V10.5 H17 V6 H20.5" />
      <path d="M4.5 11.5 L11.5 4.5" />
      <path d="M7.5 4.5 H11.5 V8.5" />
    </SvgFrame>
  );
}

/** Lift: vertical elevator shaft cab with up/down indicators */
export function LiftIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
      <path d="M12 3.5 V20.5" />
      <path d="M6.75 9.5 L8.5 7.5 L10.25 9.5" />
      <path d="M13.75 14.5 L15.5 16.5 L17.25 14.5" />
    </SvgFrame>
  );
}

/** Floor: isometric floor plate with elevation datum ticks */
export function FloorIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <polygon points="12,5 20.5,9.5 12,14 3.5,9.5" />
      <path d="M3.5 14.5 L12 19 L20.5 14.5" />
      <path d="M20.5 5 V9.5" />
    </SvgFrame>
  );
}

/** Building: architectural elevation block with structural bays */
export function BuildingIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <path d="M3 20.5 H21" />
      <rect x="5" y="4" width="14" height="16.5" rx="1" />
      <path d="M8.5 8 H10.5 M13.5 8 H15.5 M8.5 12 H10.5 M13.5 12 H15.5" />
      <path d="M10.25 20.5 V16 H13.75 V20.5" />
    </SvgFrame>
  );
}

/** Accessibility: step-free wheelchair / ramp mobility symbol */
export function AccessibilityIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <circle cx="11.5" cy="4.75" r="1.75" />
      <path d="M11.5 8 V13.5 H16.5 L18.5 18.5" />
      <path d="M11.5 10.5 H15.5" />
      <path d="M14.25 16.75 A4.5 4.5 0 1 1 8.5 11.25" />
    </SvgFrame>
  );
}

/** Assembly Point: safe muster zone perimeter with inward convergence arrows */
export function AssemblyPointIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path d="M6.5 6.5 L9.25 9.25 M17.5 6.5 L14.75 9.25 M6.5 17.5 L9.25 14.75 M17.5 17.5 L14.75 14.75" />
      <path d="M6.5 9 V6.5 H9 M15 6.5 H17.5 V9 M9 17.5 H6.5 V15 M17.5 15 V17.5 H15" />
    </SvgFrame>
  );
}

/** Hazard: warning triangle with exclamation datum */
export function HazardIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <path d="M12 3.5 L21 19.5 H3 Z" />
      <path d="M12 9.5 V14" />
      <circle cx="12" cy="16.75" r="0.6" fill="currentColor" />
    </SvgFrame>
  );
}

/** Blocked Path: octagon / barrier sign over severed corridor line */
export function BlockedPathIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M6.2 6.2 L17.8 17.8" />
      <path d="M7.5 12 H16.5" />
    </SvgFrame>
  );
}

/** People Flow: group crowd movement stream toward egress */
export function PeopleFlowIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <circle cx="6.5" cy="7.5" r="2" />
      <path d="M3.5 15.5 C3.5 13.3 5 12 6.5 12 C8 12 9.5 13.3 9.5 15.5" />
      <circle cx="12.5" cy="6.5" r="2" />
      <path d="M9.5 15.5 C9.5 13 11 11.5 12.5 11.5 C14 11.5 15.5 13 15.5 15.5" />
      <path d="M14.5 18.5 H21 M18.5 16 L21 18.5 L18.5 21" />
      <path d="M4 18.5 H11.5" />
    </SvgFrame>
  );
}
