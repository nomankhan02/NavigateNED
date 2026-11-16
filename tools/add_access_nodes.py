#!/usr/bin/env python3
"""
Compute and attach landmarks[].accessNodeIds to data/graph.json and
web/public/data/graph.json.

Re-runnable, deterministic script:
- Considers outdoor nodes with kind in {"path", "entrance", "gate"}.
- Includes nodes inside a landmark's footprint or within 15 m of its boundary.
- Excludes nodes strictly inside another building's footprint interior.
- Always includes the landmark's official entrance node (nodeId).
- Caps at 6 nodes per landmark (closest to the footprint first), sorted by node id.
"""

from __future__ import annotations

import json
import math
import os
from typing import Any, Dict, List, Tuple

ALLOWED_KINDS = {"path", "entrance", "gate"}
MAX_DISTANCE_M = 15.0
MAX_ACCESS_NODES = 6


def point_in_polygon(lat: float, lng: float, poly: List[List[float]]) -> bool:
    if len(poly) < 3:
        return False
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        yi, xi = poly[i][0], poly[i][1]
        yj, xj = poly[j][0], poly[j][1]
        if ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / ((yj - yi) if (yj - yi) != 0 else 1e-12) + xi
        ):
            inside = not inside
        j = i
    return inside


def point_to_segment_distance_m(
    lat: float,
    lng: float,
    a: Tuple[float, float],
    b: Tuple[float, float],
    cos_lat: float,
) -> float:
    ax = (a[1] - lng) * 111320.0 * cos_lat
    ay = (a[0] - lat) * 111320.0
    bx = (b[1] - lng) * 111320.0 * cos_lat
    by = (b[0] - lat) * 111320.0
    dx = bx - ax
    dy = by - ay
    len2 = dx * dx + dy * dy
    if len2 <= 1e-12:
        return math.hypot(ax, ay)
    t = max(0.0, min(1.0, (-ax * dx - ay * dy) / len2))
    return math.hypot(ax + t * dx, ay + t * dy)


def distance_to_footprint_m(
    lat: float, lng: float, poly: List[List[float]]
) -> float:
    if point_in_polygon(lat, lng, poly):
        return 0.0
    cos_lat = math.cos(math.radians(lat))
    best = float("inf")
    n = len(poly)
    for i in range(n):
        a = (poly[i][0], poly[i][1])
        b = (poly[(i + 1) % n][0], poly[(i + 1) % n][1])
        d = point_to_segment_distance_m(lat, lng, a, b, cos_lat)
        if d < best:
            best = d
    return best


def main() -> None:
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_graph_path = os.path.join(repo_root, "data", "graph.json")
    web_graph_path = os.path.join(repo_root, "web", "public", "data", "graph.json")

    with open(data_graph_path, "r", encoding="utf-8") as f:
        graph: Dict[str, Any] = json.load(f)

    nodes = graph.get("nodes", [])
    landmarks = graph.get("landmarks", [])

    # Precompute building footprints for interior exclusion checks
    other_footprints: List[Tuple[str, List[List[float]]]] = [
        (lm["id"], lm.get("footprint", []))
        for lm in landmarks
        if len(lm.get("footprint", [])) >= 3
    ]

    multi_count = 0
    for lm in landmarks:
        lid = lm["id"]
        official_nid = lm["nodeId"]
        fp = lm.get("footprint", [])

        candidates: List[Tuple[float, str]] = []
        for n in nodes:
            nid = n["id"]
            if nid == official_nid:
                continue
            if n.get("kind") not in ALLOWED_KINDS:
                continue
            lat, lng = float(n["lat"]), float(n["lng"])

            # Exclude nodes strictly inside another landmark's footprint interior
            in_other = any(
                other_id != lid and point_in_polygon(lat, lng, other_fp)
                for other_id, other_fp in other_footprints
            )
            if in_other:
                continue

            dist_m = distance_to_footprint_m(lat, lng, fp)
            if dist_m <= MAX_DISTANCE_M:
                candidates.append((dist_m, nid))

        # Sort closest to footprint first (tie-break by node id), cap at MAX_ACCESS_NODES - 1 + official
        candidates.sort(key=lambda item: (item[0], item[1]))
        selected = [official_nid] + [
            nid for _, nid in candidates[: MAX_ACCESS_NODES - 1]
        ]
        # Final list sorted by id
        access_node_ids = sorted(set(selected))
        lm["accessNodeIds"] = access_node_ids
        if len(access_node_ids) > 1:
            multi_count += 1

    for out_path in (data_graph_path, web_graph_path):
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(graph, f, indent=2)
            f.write("\n")

    print(
        f"Updated {len(landmarks)} landmarks in data/graph.json & web/public/data/graph.json; "
        f"{multi_count} landmarks have >1 access node."
    )


if __name__ == "__main__":
    main()
