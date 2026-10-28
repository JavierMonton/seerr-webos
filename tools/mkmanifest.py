#!/usr/bin/env python3
# Builds the Homebrew manifest for a packaged .ipk.
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

APP_META = {
    "id": "io.github.javiermonton.seerr",
    "type": "web",
    "title": "Seerr",
    "appDescription": "Browse and request Movies & TV Shows from your Seerr server.",
    "rootRequired": False,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ipk", help="built .ipk file")
    ap.add_argument("--repo", required=True, help="public GitHub repo URL (sourceUrl)")
    ap.add_argument("--icon", default=None,
                    help="public icon URL (default: <repo>/raw/main/seerr-webos/icon160.png)")
    ap.add_argument("--out", default="io.github.javiermonton.seerr.manifest.json")
    args = ap.parse_args()

    ipk = Path(args.ipk)
    if not ipk.is_file():
        sys.exit(f"ipk not found: {ipk}")
    m = re.search(r"_(\d+\.\d+\.\d+)_all\.ipk$", ipk.name)
    if not m:
        sys.exit("cannot parse version from ipk filename (expected *_X.Y.Z_all.ipk)")
    version = m.group(1)
    sha256 = hashlib.sha256(ipk.read_bytes()).hexdigest()
    icon = args.icon or args.repo.rstrip("/") + "/raw/main/seerr-webos/icon160.png"
    manifest = {
        **APP_META,
        "version": version,
        "iconUri": icon,
        "sourceUrl": args.repo,
        "ipkUrl": ipk.name,
        "ipkHash": {"sha256": sha256},
    }
    Path(args.out).write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {args.out} version={version} sha256={sha256}")


if __name__ == "__main__":
    main()
