import { type IconProps, SvgFrame } from "./types";

/** Route: origin circle, stepped survey traverse polyline, destination target diamond */
export function RouteIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <circle cx="5.5" cy="18.5" r="2.25" />
      <path d="M18.5 3.25 L20.75 5.5 L18.5 7.75 L16.25 5.5 Z" />
      <path d="M7.75 18.5 H11.5 C12.88 18.5 14 17.38 14 16 V8 C14 6.62 15.12 5.5 16.5 5.5" />
      <path d="M10.5 12 H13.5" />
    </SvgFrame>
  );
}

/** Search: survey magnifying reticle with hairline crosshair ticks */
export function SearchIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M10.5 6.25 V7.5 M10.5 13.5 V14.75 M6.25 10.5 H7.5 M13.5 10.5 H14.75" />
      <path d="M15.25 15.25 L20.25 20.25" />
    </SvgFrame>
  );
}

/** Compass: geodetic survey compass rose with north pointer and degree ticks */
export function CompassIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 2.25 V4.25 M12 19.75 V21.75 M2.25 12 H4.25 M19.75 12 H21.75" />
      <polygon points="12,6.25 14.25,12 12,10.6 9.75,12" fill="currentColor" stroke="currentColor" />
      <polygon points="12,17.75 14.25,12 12,13.4 9.75,12" />
    </SvgFrame>
  );
}

/** Locate: GPS survey sight reticle with center datum point */
export function LocateIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="1.75" fill="currentColor" />
      <path d="M12 2.5 V5.5 M12 18.5 V21.5 M2.5 12 H5.5 M18.5 12 H21.5" />
    </SvgFrame>
  );
}

/** Layers: stacked survey map plates (street, master plan, satellite) */
export function LayersIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <polygon points="12,3.5 20.5,8 12,12.5 3.5,8" />
      <path d="M3.5 12.25 L12 16.75 L20.5 12.25" />
      <path d="M3.5 16.25 L12 20.75 L20.5 16.25" />
    </SvgFrame>
  );
}

/** Swap: dual opposing survey arrows for reversing origin & destination */
export function SwapIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <path d="M7.5 4.5 V19.5" />
      <path d="M4.25 7.75 L7.5 4.5 L10.75 7.75" />
      <path d="M16.5 19.5 V4.5" />
      <path d="M13.25 16.25 L16.5 19.5 L19.75 16.25" />
    </SvgFrame>
  );
}

/** Distance: graduated engineering scale bar with end datum ticks */
export function DistanceIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <rect x="2.75" y="7.5" width="18.5" height="9" rx="1.5" />
      <path d="M6.5 7.5 V11.5 M10.25 7.5 V10.25 M13.75 7.5 V11.5 M17.5 7.5 V10.25" />
      <path d="M5.5 19.75 H18.5 M5.5 18.5 V21 M18.5 18.5 V21" />
    </SvgFrame>
  );
}

/** Graph: network topology vertices and weighted edges */
export function GraphIcon(props: IconProps) {
  return (
    <SvgFrame {...props}>
      <circle cx="6" cy="6.5" r="2.25" />
      <circle cx="18" cy="5.5" r="2.25" />
      <circle cx="16.5" cy="18" r="2.25" />
      <circle cx="5.5" cy="17.5" r="2.25" />
      <path d="M8.1 6.2 L15.75 5.7 M7.3 8.2 L15.1 16.2 M7.75 17.6 L14.25 17.9 M5.8 8.75 L5.6 15.25 M17.6 7.75 L16.8 15.75" />
    </SvgFrame>
  );
}
