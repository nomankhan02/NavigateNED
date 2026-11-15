import type { ComponentType } from "react";
import {
  AccessibilityIcon,
  AssemblyPointIcon,
  BlockedPathIcon,
  BuildingIcon,
  EntranceIcon,
  ExitIcon,
  FloorIcon,
  HazardIcon,
  LiftIcon,
  PeopleFlowIcon,
  StairsIcon,
} from "./campus";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsIcon,
  ChevronUpIcon,
  CloseIcon,
  MenuIcon,
  MoonIcon,
  PauseIcon,
  PlayIcon,
  SettingsIcon,
  StepIcon,
  SunIcon,
} from "./controls";
import {
  CompassIcon,
  DistanceIcon,
  GraphIcon,
  LayersIcon,
  LocateIcon,
  RouteIcon,
  SearchIcon,
  SwapIcon,
} from "./navigation";
import type { IconName, IconProps } from "./types";

export * from "./types";
export * from "./navigation";
export * from "./campus";
export * from "./controls";

const ICON_MAP: Record<IconName, ComponentType<IconProps>> = {
  route: RouteIcon,
  search: SearchIcon,
  compass: CompassIcon,
  locate: LocateIcon,
  layers: LayersIcon,
  entrance: EntranceIcon,
  exit: ExitIcon,
  stairs: StairsIcon,
  lift: LiftIcon,
  floor: FloorIcon,
  building: BuildingIcon,
  accessibility: AccessibilityIcon,
  "assembly-point": AssemblyPointIcon,
  hazard: HazardIcon,
  "blocked-path": BlockedPathIcon,
  "people-flow": PeopleFlowIcon,
  play: PlayIcon,
  pause: PauseIcon,
  step: StepIcon,
  swap: SwapIcon,
  close: CloseIcon,
  menu: MenuIcon,
  chevrons: ChevronsIcon,
  "chevron-up": ChevronUpIcon,
  "chevron-down": ChevronDownIcon,
  "chevron-left": ChevronLeftIcon,
  "chevron-right": ChevronRightIcon,
  settings: SettingsIcon,
  sun: SunIcon,
  moon: MoonIcon,
  distance: DistanceIcon,
  graph: GraphIcon,
};

export interface NamedIconProps extends IconProps {
  name: IconName;
}

export function Icon({ name, ...rest }: NamedIconProps) {
  const Component = ICON_MAP[name];
  return <Component {...rest} />;
}

export interface IconCatalogEntry {
  name: IconName;
  group: "navigation" | "campus" | "evacuation" | "controls";
  label: string;
}

export const ICON_CATALOG: readonly IconCatalogEntry[] = [
  { name: "route", group: "navigation", label: "Route Traverse" },
  { name: "search", group: "navigation", label: "Search Reticle" },
  { name: "compass", group: "navigation", label: "Survey Compass" },
  { name: "locate", group: "navigation", label: "GPS Datum Locate" },
  { name: "layers", group: "navigation", label: "Map Plates" },
  { name: "swap", group: "navigation", label: "Swap Origin/Dest" },
  { name: "distance", group: "navigation", label: "Scale Readout" },
  { name: "graph", group: "navigation", label: "Network Topology" },
  { name: "entrance", group: "campus", label: "Building Entrance" },
  { name: "exit", group: "campus", label: "Egress Exit" },
  { name: "stairs", group: "campus", label: "Stairwell Riser" },
  { name: "lift", group: "campus", label: "Vertical Lift" },
  { name: "floor", group: "campus", label: "Floor Level" },
  { name: "building", group: "campus", label: "Campus Building" },
  { name: "accessibility", group: "campus", label: "Step-Free Access" },
  { name: "assembly-point", group: "evacuation", label: "Assembly Point" },
  { name: "hazard", group: "evacuation", label: "Active Hazard" },
  { name: "blocked-path", group: "evacuation", label: "Blocked Corridor" },
  { name: "people-flow", group: "evacuation", label: "Crowd Egress Flow" },
  { name: "play", group: "controls", label: "Play Trace" },
  { name: "pause", group: "controls", label: "Pause Trace" },
  { name: "step", group: "controls", label: "Step Frame" },
  { name: "close", group: "controls", label: "Close / Clear" },
  { name: "menu", group: "controls", label: "Index Rules" },
  { name: "chevrons", group: "controls", label: "Expand / Collapse" },
  { name: "chevron-up", group: "controls", label: "Chevron Up" },
  { name: "chevron-down", group: "controls", label: "Chevron Down" },
  { name: "chevron-left", group: "controls", label: "Chevron Left" },
  { name: "chevron-right", group: "controls", label: "Chevron Right" },
  { name: "settings", group: "controls", label: "Vernier Settings" },
  { name: "sun", group: "controls", label: "Daylight Plate" },
  { name: "moon", group: "controls", label: "Night Plate" },
] as const;
