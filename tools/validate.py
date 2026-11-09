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
    landmark_outdoor_node = {}

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
        else:
            landmark_outdoor_node[lid] = nid

        fp = lm.get("footprint")
        if not fp or not isinstance(fp, list) or len(fp) < 3:
            errors.append(f"Landmark '{lid}' must provide a closed footprint polygon (>= 3 points)")

    # 6. Indoor buildings validation (data/indoor/*.json)
    indoor_dir = os.path.join(os.path.dirname(graph_path), "indoor")
    indoor_summaries = []
    if os.path.isdir(indoor_dir):
        indoor_files = sorted(f for f in os.listdir(indoor_dir) if f.endswith(".json"))
        for fname in indoor_files:
            fpath = os.path.join(indoor_dir, fname)
            with open(fpath, "r", encoding="utf-8") as f:
                try:
                    ind = json.load(f)
                except Exception as e:
                    errors.append(f"{fname}: Invalid JSON ({e})")
                    continue

            bid = ind.get("id")
            lmid = ind.get("landmarkId")
            if not bid or bid != lmid:
                errors.append(f"{fname}: 'id' ({bid}) must match 'landmarkId' ({lmid})")
            if bid not in landmark_outdoor_node:
                errors.append(f"{fname}: landmarkId '{bid}' not found in data/graph.json")
                continue

            outdoor_target = landmark_outdoor_node[bid]
            ind_meta = ind.get("meta", {})
            if ind_meta.get("demo") is not True:
                errors.append(f"{fname}: meta.demo must be true")

            in_nodes = ind.get("nodes", [])
            in_edges = ind.get("edges", [])
            in_rooms = ind.get("rooms", [])
            floors = ind.get("floors", [])
            floor_levels = {fl.get("level") for fl in floors}

            in_node_map = {}
            entrances = []
            exits = []
            room_nodes = set()
            valid_types = {"corridor", "room", "stairs", "lift", "entrance", "exit"}

            for n in in_nodes:
                nid = n.get("id", "")
                if not nid.startswith(f"{bid}:"):
                    errors.append(f"{fname}: node id '{nid}' does not start with '{bid}:'")
                if nid in in_node_map:
                    errors.append(f"{fname}: duplicate indoor node id '{nid}'")
                in_node_map[nid] = n
                ntype = n.get("type")
                if ntype not in valid_types:
                    errors.append(f"{fname}: invalid node type '{ntype}' on '{nid}'")
                if n.get("floor") not in floor_levels:
                    errors.append(f"{fname}: node '{nid}' references invalid floor {n.get('floor')}")
                if ntype == "entrance":
                    entrances.append(nid)
                elif ntype == "exit":
                    exits.append(nid)
                elif ntype == "room":
                    room_nodes.add(nid)
                    if not n.get("name"):
                        errors.append(f"{fname}: room node '{nid}' missing realistic name")

            if len(entrances) != 1:
                errors.append(f"{fname}: expected exactly 1 entrance node, found {len(entrances)}")
            if len(exits) < 1:
                errors.append(f"{fname}: expected at least 1 exit node, found {len(exits)}")

            ent_id = entrances[0] if entrances else None

            # Build adjacency lists (all edges vs accessible-only edges)
            adj_all = {nid: [] for nid in in_node_map}
            adj_acc = {nid: [] for nid in in_node_map}
            has_outdoor_link = False

            for e in in_edges:
                u, v = e.get("a"), e.get("b")
                kind = e.get("kind")
                w = e.get("w")
                acc = e.get("accessible")

                if kind not in {"walk", "stairs", "lift"}:
                    errors.append(f"{fname}: invalid edge kind '{kind}' ({u}--{v})")
                if not isinstance(acc, bool):
                    errors.append(f"{fname}: edge ({u}--{v}) missing boolean 'accessible'")

                if kind == "stairs":
                    if w != 10 or acc is not False:
                        errors.append(f"{fname}: stairs edge ({u}--{v}) must have w=10 and accessible=false (got w={w}, accessible={acc})")
                elif kind == "lift":
                    if w != 15 or acc is not True:
                        errors.append(f"{fname}: lift edge ({u}--{v}) must have w=15 and accessible=true (got w={w}, accessible={acc})")

                # Check outdoor link
                if {u, v} == {ent_id, outdoor_target}:
                    if w == 3.0 and kind == "walk" and acc is True:
                        has_outdoor_link = True
                    else:
                        errors.append(f"{fname}: outdoor link ({u}--{v}) must have w=3.0, kind='walk', accessible=true")
                    continue

                if u not in in_node_map or v not in in_node_map:
                    errors.append(f"{fname}: edge ({u}--{v}) references unknown indoor node")
                    continue

                adj_all[u].append(v)
                adj_all[v].append(u)
                if acc is True:
                    adj_acc[u].append(v)
                    adj_acc[v].append(u)

            if not has_outdoor_link:
                errors.append(f"{fname}: entrance '{ent_id}' not linked to outdoor node '{outdoor_target}' by 3m edge")

            # Reachability (all edges & accessible-only edges)
            def bfs_reach(start, graph_adj):
                if not start or start not in graph_adj:
                    return set()
                seen = {start}
                q = deque([start])
                while q:
                    cur = q.popleft()
                    for nb in graph_adj[cur]:
                        if nb not in seen:
                            seen.add(nb)
                            q.append(nb)
                return seen

            reached_all = bfs_reach(ent_id, adj_all)
            reached_acc = bfs_reach(ent_id, adj_acc)

            if len(reached_all) != len(in_node_map):
                errors.append(f"{fname}: {len(in_node_map) - len(reached_all)} indoor nodes unreachable from entrance")

            unreached_rooms_acc = room_nodes - reached_acc
            if unreached_rooms_acc:
                errors.append(f"{fname}: {len(unreached_rooms_acc)} rooms unreachable via accessible-only edges: {sorted(unreached_rooms_acc)[:3]}")

            # Room rect validation & non-overlapping check per floor
            rooms_by_floor = {fl: [] for fl in floor_levels}
            seen_room_ids = set()
            for r in in_rooms:
                rnid = r.get("nodeId")
                rect = r.get("rect")
                if rnid not in room_nodes:
                    errors.append(f"{fname}: room entry '{rnid}' does not reference a valid room node")
                    continue
                seen_room_ids.add(rnid)
                if not isinstance(rect, list) or len(rect) != 4 or any(d <= 0 for d in rect[2:]):
                    errors.append(f"{fname}: room '{rnid}' has invalid rect {rect}")
                    continue
                fl = in_node_map[rnid]["floor"]
                rooms_by_floor[fl].append((rnid, rect))

            if seen_room_ids != room_nodes:
                errors.append(f"{fname}: mismatch between room nodes ({len(room_nodes)}) and rooms list ({len(seen_room_ids)})")

            overlap_count = 0
            for fl, rlist in rooms_by_floor.items():
                for i in range(len(rlist)):
                    id1, (x1, y1, w1, h1) = rlist[i]
                    for j in range(i + 1, len(rlist)):
                        id2, (x2, y2, w2, h2) = rlist[j]
                        if x1 < x2 + w2 and x1 + w1 > x2 and y1 < y2 + h2 and y1 + h1 > y2:
                            overlap_count += 1
                            errors.append(f"{fname} (Floor {fl}): overlapping rooms '{id1}' and '{id2}'")

            indoor_summaries.append(
                f"  - {bid} ({ind_meta.get('template')}): {len(floors)} floors, "
                f"{len(in_nodes)} nodes, {len(in_rooms)} rooms, "
                f"outdoor={outdoor_target} (3m), reachable={len(reached_all)}/{len(in_node_map)}, "
                f"accessible_rooms={len(room_nodes - unreached_rooms_acc)}/{len(room_nodes)}, overlaps={overlap_count}"
            )

    # Print Validation Report
    print("--- Outdoor Validation Report ---")
    print(f"Total Nodes: {len(nodes)}")
    print(f"Total Edges: {len(edges)}")
    print(f"Total Landmarks: {len(landmarks)}")
    print(f"Connected Components: 1 (Connected: {len(visited) == len(node_ids)})" if node_ids else "Empty")

    if indoor_summaries:
        print(f"\n--- Indoor Validation Report ({len(indoor_summaries)} buildings) ---")
        for line in indoor_summaries:
            print(line)

    if warnings:
        print(f"\nWarnings ({len(warnings)}):")
        for w in warnings:
            print(f"  [WARN] {w}")

    if errors:
        print(f"\nErrors ({len(errors)}):")
        for e in errors:
            print(f"  [ERROR] {e}")
        return False

    print("\nResult: PASSED. All outdoor and indoor datasets strictly conform to contracts.md.")
    return True


if __name__ == "__main__":
    success = validate()
    sys.exit(0 if success else 1)

