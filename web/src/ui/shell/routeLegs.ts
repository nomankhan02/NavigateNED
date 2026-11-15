import type { IndoorBuilding } from "@/map";

export interface RouteLeg {
  kind: "outdoor" | "indoor";
  buildingId?: string;
  buildingName?: string;
  nodeIds: string[];
}

/**
 * Splits a merged outdoor+indoor node path into contiguous outdoor and indoor legs.
 */
export function splitRouteIntoLegs(
  path: string[],
  indoorBuildings: Record<string, IndoorBuilding>,
  displayNames: Record<string, string>,
): RouteLeg[] {
  if (!path || path.length === 0) return [];

  const legs: RouteLeg[] = [];

  for (const nodeId of path) {
    const colonIdx = nodeId.indexOf(":");
    const isIndoor = colonIdx > 0;
    const buildingId = isIndoor ? nodeId.slice(0, colonIdx) : undefined;
    const prev = legs[legs.length - 1];

    if (
      prev &&
      prev.kind === (isIndoor ? "indoor" : "outdoor") &&
      prev.buildingId === buildingId
    ) {
      prev.nodeIds.push(nodeId);
    } else {
      const bldg = buildingId ? indoorBuildings[buildingId] : undefined;
      legs.push({
        kind: isIndoor ? "indoor" : "outdoor",
        buildingId,
        buildingName: buildingId
          ? displayNames[buildingId] ?? bldg?.name ?? buildingId
          : undefined,
        nodeIds: [nodeId],
      });
    }
  }

  return legs;
}

/**
 * Extracts all outdoor node IDs from a merged path (for OutdoorMap rendering).
 */
export function extractOutdoorPath(path: string[]): string[] {
  return path.filter((id) => !id.includes(":"));
}
