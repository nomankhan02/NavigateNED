#!/usr/bin/env python3
"""
tools/validate.py - Schema and Graph Topology Validator for data/graph.json.
Validates NavigateNED datasets against contracts.md constraints.
"""

import json
import os
import re
import sys
from collections import deque


def validate(graph_path="data/graph.json"):
    print(f"=== Validating NavigateNED Dataset: {graph_path} ===")
    errors = []
    warnings = []

    if not os.path.exists(graph_path):
        print(f"[ERROR] Target file not found: {graph_path}")
        return False

    with open(graph_path, "r", encoding="utf-8") as f:
        try:
            data = json.load(f)
        except Exception as e:
            print(f"[ERROR] Invalid JSON syntax: {e}")
            return False

    # 1. Top-level keys
    for req_key in ("meta", "nodes", "edges", "landmarks"):
        if req_key not in data:
            errors.append(f"Missing top-level key: '{req_key}'")

    meta = data.get("meta", {})
    if "origin" not in meta or not isinstance(meta["origin"], list) or len(meta["origin"]) != 2:
        errors.append("meta.origin must be a [lat, lng] array")
    if "masterPlanControlCorners" not in meta:
        warnings.append("meta.masterPlanControlCorners recommended for calibrated raster overlay")

    nodes = data.get("nodes", [])
    edges = data.get("edges", [])
    landmarks = data.get("landmarks", [])

    # 2. Node schema and unique IDs
    node_id_pattern = re.compile(r"^n\d+$")
    node_ids = set()
    node_kinds = {"path", "entrance", "gate", "assembly", "poi"}

    for idx, node in enumerate(nodes):
        nid = node.get("id")
        if not nid:
            errors.append(f"Node at index {idx} has no 'id'")
            continue
        if nid in node_ids:
            errors.append(f"Duplicate node id detected: '{nid}'")
        node_ids.add(nid)

        if not node_id_pattern.match(nid):
            errors.append(f"Node id '{nid}' does not conform to 'n<number>' pattern")

        lat = node.get("lat")
        lng = node.get("lng")
        if lat is None or lng is None or not (isinstance(lat, (int, float)) and isinstance(lng, (int, float))):
            errors.append(f"Node '{nid}' has invalid or missing coordinates: ({lat}, {lng})")

        kind = node.get("kind")
        if kind not in node_kinds:
            errors.append(f"Node '{nid}' has invalid kind: '{kind}'. Allowed: {sorted(list(node_kinds))}")

    # 3. Edge schema and validity
    adj = {nid: [] for nid in node_ids}
    edge_pairs = set()

    for idx, edge in enumerate(edges):
        u = edge.get("a")
        v = edge.get("b")
        w = edge.get("w")

        if not u or not v:
            errors.append(f"Edge at index {idx} missing endpoints: a={u}, b={v}")
            continue

        if u not in node_ids:
            errors.append(f"Edge references nonexistent node a='{u}'")
        if v not in node_ids:
            errors.append(f"Edge references nonexistent node b='{v}'")

        if u == v:
            errors.append(f"Edge connects node to itself: '{u}'")

        pair = tuple(sorted([u, v]))
        if pair in edge_pairs:
            errors.append(f"Duplicate edge detected between '{u}' and '{v}'")
        edge_pairs.add(pair)

        if w is None or not isinstance(w, (int, float)) or w <= 0:
            errors.append(f"Edge '{u}'--'{v}' has invalid weight: {w}")

        if u in adj and v in adj:
            adj[u].append(v)
            adj[v].append(u)

    # 4. Graph connectivity (Single connected component)
    if node_ids:
        start_node = next(iter(node_ids))
        visited = set()
        queue = deque([start_node])
        visited.add(start_node)

        while queue:
            curr = queue.popleft()
            for neighbor in adj.get(curr, []):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)

        disconnected_count = len(node_ids) - len(visited)
        if disconnected_count > 0:
            errors.append(f"Graph is not connected! {disconnected_count} unreachable nodes out of {len(node_ids)}.")

    # 5. Landmark schema and entrance node constraints
    landmark_id_pattern = re.compile(r"^b-[a-z0-9-]+$")
    landmark_ids = set()

    for idx, lm in enumerate(landmarks):
        lid = lm.get("id")
        if not lid:
            errors.append(f"Landmark at index {idx} has no 'id'")
            continue
        if lid in landmark_ids:
            errors.append(f"Duplicate landmark id detected: '{lid}'")
        landmark_ids.add(lid)

        if not landmark_id_pattern.match(lid):
            errors.append(f"Landmark id '{lid}' does not conform to 'b-<slug>' pattern")

        name = lm.get("name")
        short = lm.get("short")
        if not name or not short:
            errors.append(f"Landmark '{lid}' must provide both 'name' and 'short'")

        nid = lm.get("nodeId")
        if not nid:
            errors.append(f"Landmark '{lid}' has no 'nodeId'")
        elif nid not in node_ids:
            errors.append(f"Landmark '{lid}' references nonexistent entrance node '{nid}'")

        fp = lm.get("footprint")
        if not fp or not isinstance(fp, list) or len(fp) < 3:
            errors.append(f"Landmark '{lid}' must provide a closed footprint polygon (>= 3 points)")

    # Print Validation Report
    print("--- Validation Report ---")
    print(f"Total Nodes: {len(nodes)}")
    print(f"Total Edges: {len(edges)}")
    print(f"Total Landmarks: {len(landmarks)}")
    print(f"Connected Components: 1 (Connected: {len(visited) == len(node_ids)})" if node_ids else "Empty")

    if warnings:
        print(f"\nWarnings ({len(warnings)}):")
        for w in warnings:
            print(f"  [WARN] {w}")

    if errors:
        print(f"\nErrors ({len(errors)}):")
        for e in errors:
            print(f"  [ERROR] {e}")
        return False

    print("\nResult: PASSED. graph.json strictly conforms to contracts.md.")
    return True


if __name__ == "__main__":
    success = validate()
    sys.exit(0 if success else 1)

