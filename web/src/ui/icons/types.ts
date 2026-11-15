import { createElement, type ReactNode, type SVGProps } from "react";

export type IconName =
  | "route"
  | "search"
  | "compass"
  | "locate"
  | "layers"
  | "entrance"
  | "exit"
  | "stairs"
  | "lift"
  | "floor"
  | "building"
  | "accessibility"
  | "assembly-point"
  | "hazard"
  | "blocked-path"
  | "people-flow"
  | "play"
  | "pause"
  | "step"
  | "swap"
  | "close"
  | "menu"
  | "chevrons"
  | "chevron-up"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "settings"
  | "sun"
  | "moon"
  | "distance"
  | "graph";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  size?: number | string;
  strokeWidth?: number;
  title?: string;
}

export function SvgFrame({
  size = 18,
  strokeWidth = 1.75,
  title,
  children,
  ...rest
}: IconProps & { children: ReactNode }) {
  return createElement(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      role: title ? "img" : undefined,
      "aria-label": title,
      "aria-hidden": title ? undefined : true,
      focusable: "false",
      ...rest,
    },
    title ? createElement("title", null, title) : null,
    children,
  );
}
