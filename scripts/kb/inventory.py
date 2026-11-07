#!/usr/bin/env python3
"""Read-only ingestion inventory for Synora knowledge sources.

Walks the given roots and writes a JSON + CSV manifest: path, type, size,
SHA-256, duplicate flags, classification. Nothing is embedded or uploaded.

Safety rules (enforced here, covered by tests/test_inventory.py):
  * Never opens a file whose NAME looks secret-bearing (.env*, *recovery*,
    *token*, *secret*, *.pem, ...). Those are classed SENSITIVE and listed
    with sha256 = "not-computed". Their bytes are never read.
  * ZIP archives are listed from the central directory only. Nothing is
    extracted or executed. Encrypted entries, absolute paths and ".."
    traversal are flagged.
  * Default class is PRIVATE. PUBLIC is never assigned automatically: it
    needs an explicit founder decision.

Usage (run isolated; the output dir must be OUTSIDE the repository because
file names can themselves be private):
  python3 -I scripts/kb/inventory.py --out /mnt/f/SYNORA-BACKUPS/inventory ROOT [ROOT ...]
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

SKIP_DIRS = {"node_modules", ".git", ".next", ".turbo", "__pycache__", ".cache", ".pnpm-store", ".venv", "$RECYCLE.BIN", "System Volume Information"}

# Matched against the lower-cased file NAME only (never content).
SECRET_NAME = re.compile(
    r"(^\.env(\.|$))|(\.env$)|(\.app\.env$)|recovery|secret|token|credential|passw|\.pem$|\.key$|\.p12$|\.pfx$"
    r"|id_rsa|id_ed25519|kaggle\.json|\.npmrc$|\.netrc$|service[-_]?account",
    re.I,
)

TYPE_BY_EXT = {
    "code": {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".sql", ".sh", ".go", ".rs", ".java", ".css", ".html", ".prisma"},
    "config": {".json", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".tsv", ".csv"},
    "doc": {".md", ".txt", ".pdf", ".docx", ".doc", ".rtf"},
    "sheet": {".xlsx", ".xls"},
    "slides": {".pptx", ".ppt"},
    "image": {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"},
    "video": {".mp4", ".mov", ".mkv", ".webm", ".avi"},
    "audio": {".mp3", ".wav", ".m4a", ".ogg", ".flac"},
    "archive": {".zip", ".tar", ".gz", ".tgz", ".7z", ".rar"},
    "executable": {".exe", ".dll", ".msi", ".bat", ".cmd", ".ps1", ".so", ".bin", ".apk", ".jar"},
}
EXT_TO_TYPE = {ext: t for t, exts in TYPE_BY_EXT.items() for ext in exts}


def file_type(path: Path) -> str:
    return EXT_TO_TYPE.get(path.suffix.lower(), "other")


def is_secret_name(name: str) -> bool:
    return bool(SECRET_NAME.search(name))


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


def classify(path: Path, ftype: str) -> tuple[str, str]:
    """Return (class, reason). Conservative: PRIVATE unless it must be SENSITIVE."""
    if is_secret_name(path.name):
        return "SENSITIVE", "secret-like file name; content never read"
    if ftype == "executable":
        return "PRIVATE", "executable; never run, never ingested"
    return "PRIVATE", "default; PUBLIC needs explicit founder approval"


def inspect_zip(path: Path) -> dict:
    """List a zip without extracting anything."""
    info = {"entries": 0, "total_uncompressed": 0, "encrypted": 0, "unsafe_paths": 0, "executables": 0, "error": None, "members": []}
    try:
        with zipfile.ZipFile(path) as zf:
            for zi in zf.infolist():
                info["entries"] += 1
                info["total_uncompressed"] += zi.file_size
                if zi.flag_bits & 0x1:
                    info["encrypted"] += 1
                n = zi.filename
                if n.startswith("/") or ".." in Path(n).parts or re.match(r"^[A-Za-z]:", n):
                    info["unsafe_paths"] += 1
                if EXT_TO_TYPE.get(Path(n).suffix.lower()) == "executable":
                    info["executables"] += 1
                if not zi.is_dir():
                    info["members"].append(
                        {
                            "name": n,
                            "size": zi.file_size,
                            "crc32": f"{zi.CRC:08x}",
                            "secret_name": is_secret_name(Path(n).name),
                        }
                    )
    except (zipfile.BadZipFile, OSError, NotImplementedError) as e:
        info["error"] = f"{type(e).__name__}: {e}"
    return info


def walk(roots: list[Path]):
    for root in roots:
        if root.is_file():
            yield root
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
            for fn in sorted(filenames):
                yield Path(dirpath) / fn


def build_manifest(roots: list[Path]) -> dict:
    records = []
    for p in walk(roots):
        try:
            size = p.stat().st_size
        except OSError as e:
            records.append({"path": str(p), "error": f"stat failed: {e}"})
            continue
        ftype = file_type(p)
        cls, reason = classify(p, ftype)
        rec = {
            "path": str(p),
            "name": p.name,
            "type": ftype,
            "size": size,
            "class": cls,
            "class_reason": reason,
            "sha256": "not-computed",
        }
        if cls != "SENSITIVE":
            try:
                rec["sha256"] = sha256_file(p)
            except OSError as e:
                rec["error"] = f"read failed: {e}"
        if ftype == "archive" and p.suffix.lower() == ".zip" and cls != "SENSITIVE":
            z = inspect_zip(p)
            rec["zip"] = {k: v for k, v in z.items() if k != "members"}
            rec["_members"] = z["members"]
        records.append(rec)

    # Duplicates: identical bytes (sha256) across files.
    by_hash = defaultdict(list)
    for r in records:
        if r.get("sha256") not in (None, "not-computed"):
            by_hash[r["sha256"]].append(r["path"])
    for r in records:
        group = by_hash.get(r.get("sha256"), [])
        r["duplicate_of"] = [x for x in group if x != r["path"]] if len(group) > 1 else []

    # Same-name-different-bytes conflicts, and zip members that exist both
    # in two archives (by crc32+size) — a cheap signal for versions of one doc.
    by_name = defaultdict(set)
    for r in records:
        if r.get("sha256") not in (None, "not-computed"):
            by_name[r["name"]].add(r["sha256"])
    for r in records:
        r["name_conflict"] = len(by_name.get(r["name"], ())) > 1

    member_index = defaultdict(list)
    for r in records:
        for m in r.pop("_members", []):
            member_index[(m["name"], m["size"], m["crc32"])].append(r["path"])
    shared = [
        {"member": k[0], "size": k[1], "archives": sorted(set(v))}
        for k, v in member_index.items()
        if len(set(v)) > 1
    ]

    summary = {
        "files": len(records),
        "by_class": {c: sum(1 for r in records if r.get("class") == c) for c in ("PUBLIC", "PRIVATE", "SENSITIVE")},
        "by_type": {t: sum(1 for r in records if r.get("type") == t) for t in sorted({r.get("type", "?") for r in records})},
        "duplicate_files": sum(1 for r in records if r["duplicate_of"]),
        "name_conflicts": sum(1 for r in records if r["name_conflict"]),
        "zip_files": sum(1 for r in records if "zip" in r),
        "zips_with_unsafe_paths": sum(1 for r in records if r.get("zip", {}).get("unsafe_paths")),
        "zips_encrypted": sum(1 for r in records if r.get("zip", {}).get("encrypted")),
        "stat_or_read_errors": sum(1 for r in records if "error" in r),
    }
    return {"summary": summary, "records": records, "shared_zip_members": shared}


def write_outputs(manifest: dict, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    with open(out / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["path", "type", "size", "sha256", "class", "class_reason", "duplicate_count", "name_conflict"])
        for r in manifest["records"]:
            w.writerow([r["path"], r.get("type", ""), r.get("size", ""), r.get("sha256", ""), r.get("class", ""), r.get("class_reason", ""), len(r.get("duplicate_of", [])), r.get("name_conflict", "")])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("roots", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, required=True, help="output dir (must be outside any git repo)")
    args = ap.parse_args(argv)

    out = args.out.resolve()
    for parent in [out, *out.parents]:
        if (parent / ".git").exists():
            print(f"refusing to write manifest inside a git repository: {parent}", file=sys.stderr)
            return 2

    manifest = build_manifest([r.resolve() for r in args.roots])
    write_outputs(manifest, out)
    print(json.dumps(manifest["summary"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
