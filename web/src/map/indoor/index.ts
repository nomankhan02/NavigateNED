/**
 * web/src/map/indoor/index.ts
 * Barrel exports for IndoorMap and indoor navigation types.
 */

export { IndoorMap } from "./IndoorMap";
export { FloorSwitcher, getBuildingFloors, getFloorsWithRoute } from "./floors";
export {
  computeIndoorLabels,
  getIndoorShortLabel,
  getIndoorShortName,
  getIndoorShortCode,
  type FittedRoomLabel,
} from "./labels";
export * from "./types";
