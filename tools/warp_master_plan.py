#!/usr/bin/env python3
"""
tools/warp_master_plan.py - North-Up Georeferenced Master Plan Warper for NavigateNED.
Warps web/public/map/ned_master_plan.jpg using the 4 control corners in data/graph.json meta
into a north-up, transparent-background RGBA WebP in web/public/map/ned_master_plan_warped.webp
at full available resolution, and writes its axis-aligned [southWest, northEast] bounds to
data/graph.json and web/public/data/graph.json.
"""

import json
import math
import os
import shutil
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

GRAPH_JSON_PATH = os.path.join("data", "graph.json")
PUBLIC_GRAPH_JSON_PATH = os.path.join("web", "public", "data", "graph.json")
SRC_IMAGE_PATH = os.path.join("web", "public", "map", "ned_master_plan.jpg")
OUT_WEBP_PATH = os.path.join("web", "public", "map", "ned_master_plan_warped.webp")


def lat_to_mercator_y(lat_deg: float) -> float:
    lat_rad = math.radians(lat_deg)
    return math.log(math.tan(math.pi / 4.0 + lat_rad / 2.0))


def warp_master_plan():
    if not os.path.exists(GRAPH_JSON_PATH):
        raise FileNotFoundError(f"Missing {GRAPH_JSON_PATH}")
    if not os.path.exists(SRC_IMAGE_PATH):
        raise FileNotFoundError(f"Missing {SRC_IMAGE_PATH}")

    with open(GRAPH_JSON_PATH, "r", encoding="utf-8") as f:
        graph = json.load(f)

    meta = graph.get("meta", {})
    corners = meta.get("masterPlanControlCorners") or meta.get("mapOverlay", {}).get("corners")
    if not corners:
        raise ValueError("Missing masterPlanControlCorners in data/graph.json meta")

    tl_lat, tl_lng = corners["topLeft"]
    tr_lat, tr_lng = corners["topRight"]
    bl_lat, bl_lng = corners["bottomLeft"]
    br_lat, br_lng = corners["bottomRight"]

    src_img = Image.open(SRC_IMAGE_PATH).convert("RGBA")
    src_w, src_h = src_img.size

    # Compute ground sample distance (GSD) of source image to diagnose blurriness
    earth_r = 6371000.0
    mean_lat_rad = math.radians((tl_lat + br_lat) / 2.0)
    width_m = math.hypot(
        (tr_lat - tl_lat) * math.pi / 180.0 * earth_r,
        (tr_lng - tl_lng) * math.pi / 180.0 * earth_r * math.cos(mean_lat_rad),
    )
    height_m = math.hypot(
        (bl_lat - tl_lat) * math.pi / 180.0 * earth_r,
        (bl_lng - tl_lng) * math.pi / 180.0 * earth_r * math.cos(mean_lat_rad),
    )
    gsd_x = width_m / src_w
    gsd_y = height_m / src_h

    print(f"Source image: {SRC_IMAGE_PATH}")
    print(f"  Dimensions: {src_w} x {src_h} px ({src_w * src_h / 1e6:.2f} MP)")
    print(f"  Ground footprint: ~{width_m:.0f}m x {height_m:.0f}m")
    print(f"  Effective ground resolution (GSD): {gsd_x:.2f} m/px (horizontal), {gsd_y:.2f} m/px (vertical)")
    print(
        "  Note: At zoom 18-20 (where 1 screen pixel is ~0.15m - 0.60m), a 1024x993 (~0.92 m/px) raster "
        "is upscaled 2x-6x, which is the primary reason the original master plan drawing looks soft at high zoom."
    )

    # Apply the same inset mask (4% top/left/right, 22% bottom legend crop) as a clean alpha channel
    mask = Image.new("L", (src_w, src_h), 0)
    draw = ImageDraw.Draw(mask)
    x0 = int(round(src_w * 0.04))
    y0 = int(round(src_h * 0.04))
    x1 = int(round(src_w * 0.96))
    y1 = int(round(src_h * 0.78))
    draw.rounded_rectangle([x0, y0, x1, y1], radius=16, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=1.5))
    src_img.putalpha(mask)

    # Slight unsharp mask on RGB channels to preserve crisp architectural linework during bicubic resampling
    rgb = src_img.convert("RGB").filter(
        ImageFilter.UnsharpMask(radius=1.2, percent=110, threshold=2)
    )
    src_prepped = Image.merge("RGBA", (*rgb.split(), mask))

    # Forward affine mapping from source pixel (u, v) in [0, src_w] x [0, src_h] to (lng, lat):
    # lat(u, v) = tl_lat + (u / src_w) * (tr_lat - tl_lat) + (v / src_h) * (bl_lat - tl_lat)
    # lng(u, v) = tl_lng + (u / src_w) * (tr_lng - tl_lng) + (v / src_h) * (bl_lng - tl_lng)
    # Find geographic bounding box of the 4 source corners
    all_lats = [tl_lat, tr_lat, bl_lat, br_lat]
    all_lngs = [tl_lng, tr_lng, bl_lng, br_lng]
    min_lat, max_lat = min(all_lats), max(all_lats)
    min_lng, max_lng = min(all_lngs), max(all_lngs)

    # Compute aspect-correct north-up output dimensions in Web Mercator / equirectangular meters
    lat_span_m = (max_lat - min_lat) * (math.pi / 180.0) * earth_r
    lng_span_m = (max_lng - min_lng) * (math.pi / 180.0) * earth_r * math.cos(mean_lat_rad)

    # Preserve full native pixel density along rotated diagonal (~1.5x source dimensions)
    target_gsd = min(gsd_x, gsd_y) * 0.65
    out_w = int(round(lng_span_m / target_gsd))
    out_h = int(round(lat_span_m / target_gsd))

    # Build 3x3 forward matrix M mapping [u, v, 1]^T -> [out_x, out_y, 1]^T
    # where:
    #   lng = min_lng + (out_x / out_w) * (max_lng - min_lng)
    #   lat = max_lat - (out_y / out_h) * (max_lat - min_lat)
    dlat_du = (tr_lat - tl_lat) / float(src_w)
    dlat_dv = (bl_lat - tl_lat) / float(src_h)
    dlng_du = (tr_lng - tl_lng) / float(src_w)
    dlng_dv = (bl_lng - tl_lng) / float(src_h)

    scale_x = float(out_w) / (max_lng - min_lng)
    scale_y = -float(out_h) / (max_lat - min_lat)

    m00 = scale_x * dlng_du
    m01 = scale_x * dlng_dv
    m02 = scale_x * (tl_lng - min_lng)

    m10 = scale_y * dlat_du
    m11 = scale_y * dlat_dv
    m12 = scale_y * (tl_lat - max_lat)

    M = np.array(
        [
            [m00, m01, m02],
            [m10, m11, m12],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )
    M_inv = np.linalg.inv(M)

    affine_coeffs = (
        float(M_inv[0, 0]),
        float(M_inv[0, 1]),
        float(M_inv[0, 2]),
        float(M_inv[1, 0]),
        float(M_inv[1, 1]),
        float(M_inv[1, 2]),
    )

    warped_img = src_prepped.transform(
        (out_w, out_h),
        Image.Transform.AFFINE,
        affine_coeffs,
        resample=Image.Resampling.BICUBIC,
    )

    os.makedirs(os.path.dirname(OUT_WEBP_PATH), exist_ok=True)
    warped_img.save(OUT_WEBP_PATH, format="WEBP", quality=92, method=6)

    bounds = [
        [round(min_lat, 6), round(min_lng, 6)],
        [round(max_lat, 6), round(max_lng, 6)],
    ]

    meta["warpedOverlay"] = {
        "image": "/map/ned_master_plan_warped.webp",
        "bounds": bounds,
        "sourceResolution": [src_w, src_h],
        "warpedResolution": [out_w, out_h],
    }
    graph["meta"] = meta

    with open(GRAPH_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(graph, f, indent=2)
        f.write("\n")

    if os.path.exists(os.path.dirname(PUBLIC_GRAPH_JSON_PATH)):
        shutil.copyfile(GRAPH_JSON_PATH, PUBLIC_GRAPH_JSON_PATH)

    file_kb = os.path.getsize(OUT_WEBP_PATH) / 1024.0
    print(f"Warped north-up WebP written to: {OUT_WEBP_PATH} ({out_w}x{out_h} px, {file_kb:.1f} KB)")
    print(f"Georeferenced bounds [SW, NE]: {bounds}")


if __name__ == "__main__":
    warp_master_plan()

