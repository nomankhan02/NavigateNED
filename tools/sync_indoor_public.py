#!/usr/bin/env python3
"""
tools/sync_indoor_public.py - Sync indoor building JSON datasets to web/public/data/indoor/.
Enables client-only static loading for the IndoorMap component.
"""

import os
import shutil
import glob

def sync_indoor_datasets():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    src_dir = os.path.join(repo_root, "data", "indoor")
    dst_dir = os.path.join(repo_root, "web", "public", "data", "indoor")

    os.makedirs(dst_dir, exist_ok=True)

    json_files = glob.glob(os.path.join(src_dir, "*.json"))
    if not json_files:
        print(f"No indoor JSON files found in {src_dir}")
        return

    for src_file in json_files:
        filename = os.path.basename(src_file)
        dst_file = os.path.join(dst_dir, filename)
        shutil.copy2(src_file, dst_file)
        print(f"Copied {filename} -> web/public/data/indoor/{filename}")

    print(f"Successfully synced {len(json_files)} indoor files to {dst_dir}")

if __name__ == "__main__":
    sync_indoor_datasets()
