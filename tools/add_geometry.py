#!/usr/bin/env python3
"""
tools/add_geometry.py - Re-runnable footpath geometry & honest weight generator.

1. Loads OpenStreetMap highway/footpath ways for NED University from
   data/cache/osm_ways.json (or fetches from Overpass API if absent).
2. Builds a unified pedestrian routing mesh from:
   - Subdivided OSM road/footpath segments (prioritized in pathfinding),
   - Offset corner waypoints around every building footprint in data/graph.json,
   - Campus walkway segments that do not cross building footprints.
3. For every edge (a, b) in data/graph.json:
   - Snaps endpoints to the OSM / walkway network and computes the shortest
     path that follows real roads/footpaths and never cuts across buildings.
   - Falls back to footprint-avoiding corner routing or straight line when
     no nearby OSM way matches.
   - Simplifies collinear points and writes `geometry` + recomputed Haversine
     distance `w` into data/graph.json and web/public/data/graph.json.
"""

import heapq
import json
import math
import os
import shutil
import urllib.parse
import urllib.request

EARTH_RADIUS_M = 6371000.0
CACHE_PATH = os.path.join("data", "cache", "osm_ways.json")
GRAPH_PATH = os.path.join("data", "graph.json")
PUBLIC_GRAPH_PATH = os.path.join("web", "public", "data", "graph.json")

OVERPASS_BBOX = (24.926, 67.105, 24.939, 67.120)
OVERPASS_URL = "https://overpass-api.de/api/interpreter"


def haversine(c1, c2):
    """Great-circle distance in meters between two [lat, lng] coordinates."""
    lat1, lon1 = c1[0], c1[1]
    lat2, lon2 = c2[0], c2[1]
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0) ** 2
    )
    return 2.0 * EARTH_RADIUS_M * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))


def polyline_length(pts):
    """Total Haversine length in meters along a list of [lat, lng] points."""
    total = 0.0
    for i in range(len(pts) - 1):
        total += haversine(pts[i], pts[i + 1])
    return total


def point_in_polygon(pt, ring):
    """Ray-casting point-in-polygon check for [lat, lng] point and ring."""
    y, x = pt[0], pt[1]
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        yi, xi = ring[i][0], ring[i][1]
        yj, xj = ring[j][0], ring[j][1]
        if ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / ((yj - yi) + 1e-15) + xi
        ):
            inside = not inside
        j = i
    return inside


def segments_intersect(p1, p2, p3, p4):
    """True if segment p1-p2 strictly intersects segment p3-p4 in 2D (lat, lng)."""
    def ccw(A, B, C):
        return (C[0] - A[0]) * (B[1] - A[1]) - (B[0] - A[0]) * (C[1] - A[1])

    d1 = ccw(p3, p4, p1)
    d2 = ccw(p3, p4, p2)
    d3 = ccw(p1, p2, p3)
    d4 = ccw(p1, p2, p4)

    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and (
        (d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)
    ):
        return True
    return False


def poly_bbox(ring, pad_deg=0.00005):
    lats = [p[0] for p in ring]
    lngs = [p[1] for p in ring]
    return (
        min(lats) - pad_deg,
        max(lats) + pad_deg,
        min(lngs) - pad_deg,
        max(lngs) + pad_deg,
    )


def segment_inside_polygon_meters(p1, p2, ring, bbox=None):
    """
    Returns the approximate length in meters of segment p1->p2 that lies
    inside `ring` (sampled at ~0.75m intervals plus exact edge intersection check).
    """
    if bbox is not None:
        if (
            max(p1[0], p2[0]) < bbox[0]
            or min(p1[0], p2[0]) > bbox[1]
            or max(p1[1], p2[1]) < bbox[2]
            or min(p1[1], p2[1]) > bbox[3]
        ):
            return 0.0

    dist = haversine(p1, p2)
    if dist < 0.05:
        return 0.0

    steps = max(4, int(math.ceil(dist / 0.75)))
    inside_count = 0
    for k in range(steps):
        t = (k + 0.5) / steps
        mid = [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])]
        if point_in_polygon(mid, ring):
            inside_count += 1

    if inside_count > 0:
        return dist * (inside_count / steps)

    # Also check if segment crosses any polygon edge even between samples
    n = len(ring)
    for i in range(n):
        if segments_intersect(p1, p2, ring[i], ring[(i + 1) % n]):
            return min(dist, 0.75)

    return 0.0


def polyline_max_building_crossing(pts, building_polys):
    """
    Returns the maximum meters any single building footprint is crossed by `pts`.
    """
    max_cross = 0.0
    for ring, bbox, _bid in building_polys:
        crossed = 0.0
        for i in range(len(pts) - 1):
            crossed += segment_inside_polygon_meters(pts[i], pts[i + 1], ring, bbox)
        if crossed > max_cross:
            max_cross = crossed
    return max_cross


def ensure_osm_cache():
    """Loads cached Overpass JSON or downloads it if missing."""
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    if os.path.exists(CACHE_PATH) and os.path.getsize(CACHE_PATH) > 500:
        with open(CACHE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)

    s, w, n, e = OVERPASS_BBOX
    query = f'[out:json][timeout:25];(way["highway"]({s},{w},{n},{e}););out body;>;out skel qt;'
    url = f"{OVERPASS_URL}?data={urllib.parse.quote(query)}"
    req = urllib.request.Request(url, headers={"User-Agent": "NavigateNED-Campus-GIS/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return data


def closest_point_on_segment(pt, a, b):
    """Projects pt=[lat,lng] onto segment a->b in local metric coordinates."""
    cos_lat = math.cos(math.radians(pt[0]))
    ax, ay = (a[1] - pt[1]) * cos_lat, a[0] - pt[0]
    bx, by = (b[1] - pt[1]) * cos_lat, b[0] - pt[0]
    dx, dy = bx - ax, by - ay
    denom = dx * dx + dy * dy
    if denom < 1e-16:
        return [a[0], a[1]], 0.0
    t = max(0.0, min(1.0, -(ax * dx + ay * dy) / denom))
    proj_lat = a[0] + t * (b[0] - a[0])
    proj_lng = a[1] + t * (b[1] - a[1])
    return [proj_lat, proj_lng], t


def offset_polygon_vertices(ring, offsets_m=(0.9, 1.8, 3.0)):
    """
    Generates exterior waypoint coordinates pushed outward at multiple distances
    from each vertex of `ring` so narrow alleys between buildings remain navigable.
    """
    pts = ring[:-1] if (len(ring) > 3 and ring[0] == ring[-1]) else list(ring)
    if len(pts) < 3:
        return []
    clat = sum(p[0] for p in pts) / len(pts)
    clng = sum(p[1] for p in pts) / len(pts)
    cos_lat = math.cos(math.radians(clat))
    dlat_per_m = (180.0 / math.pi) / EARTH_RADIUS_M
    dlng_per_m = dlat_per_m / cos_lat

    out = []
    n = len(pts)
    for i, p in enumerate(pts):
        prev_p = pts[(i - 1) % n]
        next_p = pts[(i + 1) % n]
        # Radial direction from centroid
        ry = (p[0] - clat) / dlat_per_m
        rx = (p[1] - clng) / dlng_per_m
        rnorm = math.hypot(rx, ry) or 1.0
        rx, ry = rx / rnorm, ry / rnorm

        # Edge normals
        e1x = (p[1] - prev_p[1]) / dlng_per_m
        e1y = (p[0] - prev_p[0]) / dlat_per_m
        l1 = math.hypot(e1x, e1y) or 1.0
        e2x = (next_p[1] - p[1]) / dlng_per_m
        e2y = (next_p[0] - p[0]) / dlat_per_m
        l2 = math.hypot(e2x, e2y) or 1.0

        # Candidate outward unit vectors (radial + both normals)
        dirs = [(rx, ry)]
        for nx, ny in [(-e1y / l1, e1x / l1), (e1y / l1, -e1x / l1)]:
            if nx * rx + ny * ry > 0:
                dirs.append((nx, ny))
        for nx, ny in [(-e2y / l2, e2x / l2), (e2y / l2, -e2x / l2)]:
            if nx * rx + ny * ry > 0:
                dirs.append((nx, ny))

        for offset_m in offsets_m:
            for dx, dy in dirs:
                olat = p[0] + dy * offset_m * dlat_per_m
                olng = p[1] + dx * offset_m * dlng_per_m
                cand = [round(olat, 6), round(olng, 6)]
                if not point_in_polygon(cand, ring):
                    out.append(cand)

        # Also sample along the edge p -> next_p every ~10m and push outward along edge normal
        edge_len = haversine(p, next_p)
        sub_steps = max(2, int(math.ceil(edge_len / 10.0)))
        for s in range(1, sub_steps):
            t = s / sub_steps
            mlat = p[0] + t * (next_p[0] - p[0])
            mlng = p[1] + t * (next_p[1] - p[1])
            for nx, ny in [(-e2y / l2, e2x / l2), (e2y / l2, -e2x / l2)]:
                for offset_m in (0.8, 1.8):
                    cand = [
                        round(mlat + ny * offset_m * dlat_per_m, 6),
                        round(mlng + nx * offset_m * dlng_per_m, 6),
                    ]
                    if not point_in_polygon(cand, ring):
                        out.append(cand)
    return out


def simplify_polyline(pts, tol_m=0.35, building_polys=None):
    """
    Removes nearly-collinear intermediate vertices from `pts` using Douglas-Peucker,
    provided the simplified segment does not cross any building footprint.
    """
    if len(pts) <= 2:
        return pts

    # Find point with max perpendicular distance
    max_d = -1.0
    idx = -1
    a, b = pts[0], pts[-1]
    for i in range(1, len(pts) - 1):
        proj, _ = closest_point_on_segment(pts[i], a, b)
        d = haversine(pts[i], proj)
        if d > max_d:
            max_d = d
            idx = i

    if max_d <= tol_m:
        # Check that direct segment a->b doesn't cross any building
        crosses = False
        if building_polys:
            for ring, bbox, _bid in building_polys:
                if segment_inside_polygon_meters(a, b, ring, bbox) > 0.5:
                    crosses = True
                    break
        if not crosses:
            return [a, b]

    left = simplify_polyline(pts[: idx + 1], tol_m, building_polys)
    right = simplify_polyline(pts[idx:], tol_m, building_polys)
    return left[:-1] + right


def build_routing_network(graph, osm_data, building_polys):
    """
    Constructs an enriched pedestrian routing graph:
    - Nodes: 0..N-1 with coordinates `coords[i] = [lat, lng]`
    - Edges: `adj[u] = [(v, cost, real_dist_m, is_osm), ...]`
    """
    coords = []
    adj = []
    coord_index = {}

    def add_pt(pt):
        key = (round(pt[0], 6), round(pt[1], 6))
        if key in coord_index:
            return coord_index[key]
        idx = len(coords)
        coords.append([key[0], key[1]])
        adj.append([])
        coord_index[key] = idx
        return idx

    def segment_building_penalty(p1, p2):
        total_inside = 0.0
        for ring, bbox, _bid in building_polys:
            inside_m = segment_inside_polygon_meters(p1, p2, ring, bbox)
            if inside_m > 0.0:
                total_inside += inside_m
        return total_inside

    def add_seg(u, v, cost_mult=1.0, is_osm=False, allow_if_clean_only=False):
        if u == v:
            return
        p1, p2 = coords[u], coords[v]
        d = haversine(p1, p2)
        if d < 0.05:
            return
        inside_m = segment_building_penalty(p1, p2)
        if allow_if_clean_only and inside_m > 0.2:
            return
        # Heavy penalty if segment touches any building interior
        penalty = inside_m * 500.0
        cost = d * cost_mult + penalty
        adj[u].append((v, cost, d, is_osm))
        adj[v].append((u, cost, d, is_osm))

    # 1. Extract OSM highway ways and subdivide segments every ~6m
    osm_nodes = {}
    osm_ways = []
    for el in osm_data.get("elements", []):
        if el.get("type") == "node":
            osm_nodes[el["id"]] = [float(el["lat"]), float(el["lon"])]
        elif el.get("type") == "way":
            osm_ways.append(el)

    osm_node_indices = set()
    for way in osm_ways:
        nd_ids = way.get("nodes", [])
        way_pts = [osm_nodes[nid] for nid in nd_ids if nid in osm_nodes]
        if len(way_pts) < 2:
            continue
        # Filter to campus area + margin
        if not any(
            24.925 <= p[0] <= 24.940 and 67.104 <= p[1] <= 67.121 for p in way_pts
        ):
            continue

        for i in range(len(way_pts) - 1):
            pa, pb = way_pts[i], way_pts[i + 1]
            seg_len = haversine(pa, pb)
            steps = max(1, int(math.ceil(seg_len / 6.0)))
            prev_idx = add_pt(pa)
            osm_node_indices.add(prev_idx)
            for s in range(1, steps + 1):
                t = s / steps
                mid = [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])]
                cur_idx = add_pt(mid)
                osm_node_indices.add(cur_idx)
                # Prefer OSM road/footpath segments (0.72x cost multiplier)
                add_seg(prev_idx, cur_idx, cost_mult=0.72, is_osm=True)
                prev_idx = cur_idx

    # 2. Add exterior corner waypoints around every building footprint
    corner_indices = []
    for ring, _bbox, _bid in building_polys:
        c_pts = offset_polygon_vertices(ring)
        ring_idxs = []
        for cp in c_pts:
            # Skip corner waypoint if it falls inside another building footprint
            if any(point_in_polygon(cp, r2) for r2, _, _ in building_polys):
                continue
            idx = add_pt(cp)
            ring_idxs.append(idx)
            corner_indices.append(idx)
        # Connect corners of the same building if segment is clean
        for i in range(len(ring_idxs)):
            for j in range(i + 1, len(ring_idxs)):
                u, v = ring_idxs[i], ring_idxs[j]
                if haversine(coords[u], coords[v]) <= 85.0:
                    add_seg(u, v, cost_mult=1.02, is_osm=False, allow_if_clean_only=True)

    # 3. Add campus walkway junction nodes, exit waypoints for any node inside a polygon,
    #    and subdivide clean walkway edges
    node_map = {n["id"]: [n["lat"], n["lng"]] for n in graph["nodes"]}
    campus_idxs = {}
    for nid, npt in node_map.items():
        u_idx = add_pt(npt)
        campus_idxs[nid] = u_idx
        # If npt sits inside any building footprint, create a perpendicular exit point
        # just outside the closest polygon edge so paths exit the wall immediately
        for ring, _bbox, _bid in building_polys:
            if point_in_polygon(npt, ring):
                best_d = float("inf")
                best_proj = None
                for k in range(len(ring)):
                    proj, _ = closest_point_on_segment(npt, ring[k], ring[(k + 1) % len(ring)])
                    d = haversine(npt, proj)
                    if d < best_d:
                        best_d = d
                        best_proj = proj
                if best_proj is not None:
                    vy = best_proj[0] - npt[0]
                    vx = best_proj[1] - npt[1]
                    vnorm = math.hypot(vx, vy) or 1e-9
                    # Push 0.6m (~0.000006 deg) past the boundary
                    for push_deg in (0.000006, 0.000014, 0.000025):
                        ext = [
                            round(best_proj[0] + (vy / vnorm) * push_deg, 6),
                            round(best_proj[1] + (vx / vnorm) * push_deg, 6),
                        ]
                        if not any(point_in_polygon(ext, r2) for r2, _, _ in building_polys):
                            ext_idx = add_pt(ext)
                            corner_indices.append(ext_idx)
                            d_ext = haversine(npt, ext)
                            adj[u_idx].append((ext_idx, d_ext, d_ext, False))
                            adj[ext_idx].append((u_idx, d_ext, d_ext, False))
                            break

    for edge in graph["edges"]:
        pa, pb = node_map[edge["a"]], node_map[edge["b"]]
        if segment_building_penalty(pa, pb) <= 0.2:
            # Subdivide clean campus walkway edges every 8m so corners/OSM can link
            seg_len = haversine(pa, pb)
            steps = max(1, int(math.ceil(seg_len / 8.0)))
            prev_idx = campus_idxs[edge["a"]]
            for s in range(1, steps + 1):
                t = s / steps
                mid = [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])]
                cur_idx = add_pt(mid) if s < steps else campus_idxs[edge["b"]]
                add_seg(prev_idx, cur_idx, cost_mult=0.95, is_osm=False, allow_if_clean_only=True)
                prev_idx = cur_idx

    # 4. Connect all (campus_idxs + corner_indices) visibility pairs within 220m
    vis_nodes = list(set(campus_idxs.values()) | set(corner_indices))
    for i, u in enumerate(vis_nodes):
        pu = coords[u]
        for v in vis_nodes[i + 1 :]:
            pv = coords[v]
            if abs(pu[0] - pv[0]) > 0.0020 or abs(pu[1] - pv[1]) > 0.0020:
                continue
            d = haversine(pu, pv)
            if d <= 220.0:
                pen = segment_building_penalty(pu, pv)
                if pen <= 0.25:
                    add_seg(u, v, cost_mult=1.02, is_osm=False, allow_if_clean_only=False)
                elif (u in campus_idxs.values() or v in campus_idxs.values()) and d <= 35.0 and pen <= 4.0:
                    # Allow short exit step if a campus node sits near/inside a building edge
                    add_seg(u, v, cost_mult=1.5, is_osm=False, allow_if_clean_only=False)

    # 5. Connect campus nodes & corner waypoints to nearby OSM nodes (< 65m)
    for u in vis_nodes:
        pu = coords[u]
        osm_cands = []
        for v in osm_node_indices:
            if u == v:
                continue
            pv = coords[v]
            if abs(pu[0] - pv[0]) > 0.00065 or abs(pu[1] - pv[1]) > 0.00065:
                continue
            d = haversine(pu, pv)
            if d <= 65.0:
                osm_cands.append((d, v))
        osm_cands.sort()
        linked_osm = 0
        for d, v in osm_cands:
            if segment_building_penalty(pu, coords[v]) <= 0.15:
                add_seg(u, v, cost_mult=0.85, is_osm=False, allow_if_clean_only=True)
                linked_osm += 1
                if linked_osm >= 10:
                    break

    # Also bridge nearby OSM components within 18m if clean
    osm_list = list(osm_node_indices)
    for i, u in enumerate(osm_list):
        pu = coords[u]
        for v in osm_list[i + 1 :]:
            pv = coords[v]
            if abs(pu[0] - pv[0]) > 0.00018 or abs(pu[1] - pv[1]) > 0.00018:
                continue
            d = haversine(pu, pv)
            if d <= 16.0 and segment_building_penalty(pu, pv) <= 0.1:
                add_seg(u, v, cost_mult=0.90, is_osm=False, allow_if_clean_only=True)

    return coords, adj, campus_idxs, osm_node_indices


def shortest_mesh_path(u_start, u_goal, coords, adj):
    """Dijkstra on the routing mesh returning (path_indices, used_osm_flag)."""
    n = len(coords)
    dist = [float("inf")] * n
    parent = [-1] * n
    used_osm_edge = [False] * n
    dist[u_start] = 0.0
    pq = [(0.0, u_start)]

    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        if u == u_goal:
            break
        for v, cost, _real_d, is_osm in adj[u]:
            nd = d + cost
            if nd < dist[v]:
                dist[v] = nd
                parent[v] = u
                used_osm_edge[v] = is_osm or used_osm_edge[u]
                heapq.heappush(pq, (nd, v))

    if dist[u_goal] == float("inf"):
        return None, False

    path = []
    cur = u_goal
    while cur != -1:
        path.append(cur)
        cur = parent[cur]
    path.reverse()
    return path, used_osm_edge[u_goal]


def main():
    with open(GRAPH_PATH, "r", encoding="utf-8") as f:
        graph = json.load(f)

    osm_data = ensure_osm_cache()

    # Build list of building polygons (exclude non-building sports fields / gates)
    non_building_categories = {"sports", "gate", "emergency"}
    building_polys = []
    for lm in graph.get("landmarks", []):
        if lm.get("category") in non_building_categories:
            continue
        ring = lm.get("footprint", [])
        if len(ring) >= 3:
            building_polys.append((ring, poly_bbox(ring), lm["id"]))

    # Ensure no node itself sits strictly inside a building footprint:
    # if a fallback box encloses its own entrance node, nudge the footprint box
    # slightly or check if any node is inside a building polygon.
    node_map = {n["id"]: n for n in graph["nodes"]}
    for nid, nobj in node_map.items():
        pt = [nobj["lat"], nobj["lng"]]
        for ring, _bbox, bid in building_polys:
            if point_in_polygon(pt, ring):
                print(f"  [NODE-IN-POLY] Node {nid} ({nobj['kind']}) is inside {bid}")

    coords, adj, campus_idxs, _osm_idxs = build_routing_network(
        graph, osm_data, building_polys
    )

    osm_matched_count = 0
    detour_count = 0
    straight_fallback_count = 0

    for edge in graph["edges"]:
        u_id, v_id = edge["a"], edge["b"]
        pa = [node_map[u_id]["lat"], node_map[u_id]["lng"]]
        pb = [node_map[v_id]["lat"], node_map[v_id]["lng"]]
        direct_dist = haversine(pa, pb)
        direct_cross = polyline_max_building_crossing([pa, pb], building_polys)

        u_idx = campus_idxs[u_id]
        v_idx = campus_idxs[v_id]
        idx_path, used_osm = shortest_mesh_path(u_idx, v_idx, coords, adj)

        chosen_geom = [pa, pb]
        mode = "straight"

        if idx_path and len(idx_path) >= 2:
            raw_pts = [coords[i] for i in idx_path]
            raw_pts[0] = pa
            raw_pts[-1] = pb
            simp_pts = simplify_polyline(raw_pts, tol_m=0.4, building_polys=building_polys)
            simp_pts[0] = [round(pa[0], 6), round(pa[1], 6)]
            simp_pts[-1] = [round(pb[0], 6), round(pb[1], 6)]
            simp_pts = [[round(p[0], 6), round(p[1], 6)] for p in simp_pts]
            mesh_dist = polyline_length(simp_pts)
            mesh_cross = polyline_max_building_crossing(simp_pts, building_polys)

            # Accept mesh path if it reduces building crossing or follows OSM without absurd detour
            if direct_cross > 0.8 and mesh_cross < direct_cross - 0.2:
                chosen_geom = simp_pts
                mode = "osm" if used_osm else "detour"
            elif used_osm and mesh_dist <= direct_dist * 1.45 + 12.0 and mesh_cross <= max(1.0, direct_cross):
                chosen_geom = simp_pts
                mode = "osm"
            elif len(simp_pts) > 2 and mesh_dist <= direct_dist * 1.35 and mesh_cross <= max(1.0, direct_cross):
                chosen_geom = simp_pts
                mode = "detour"

        if mode == "osm" and len(chosen_geom) > 2:
            osm_matched_count += 1
        elif mode in ("osm", "detour") and len(chosen_geom) > 2:
            detour_count += 1
        else:
            straight_fallback_count += 1

        edge["geometry"] = chosen_geom
        edge["w"] = round(polyline_length(chosen_geom), 1)
        final_cross = polyline_max_building_crossing(chosen_geom, building_polys)
        if final_cross > 2.0:
            print(f"  [WARN] Edge {u_id}-{v_id} crosses building by {final_cross:.1f}m (direct={direct_cross:.1f}m)")

    with open(GRAPH_PATH, "w", encoding="utf-8") as f:
        json.dump(graph, f, indent=2)

    os.makedirs(os.path.dirname(PUBLIC_GRAPH_PATH), exist_ok=True)
    shutil.copyfile(GRAPH_PATH, PUBLIC_GRAPH_PATH)

    total_edges = len(graph["edges"])
    improved = osm_matched_count + detour_count
    print(
        f"=== Geometry Generation Report (tools/add_geometry.py) ===\n"
        f"Total Edges: {total_edges}\n"
        f"Improved with multi-point geometry (OSM / footprint detour): {improved} "
        f"(OSM snapped: {osm_matched_count}, footprint corner detour: {detour_count})\n"
        f"Clean straight-line fallback: {straight_fallback_count}\n"
        f"Updated: {GRAPH_PATH} and {PUBLIC_GRAPH_PATH}"
    )


if __name__ == "__main__":
    main()
