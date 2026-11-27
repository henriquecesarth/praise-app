#!/usr/bin/env python3
"""Sync FreePats Upright KW piano assets to Flutter mobile assets directory and verify SHA256."""
import hashlib
import json
import shutil
import sys
from pathlib import Path


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest().lower()


def main():
    repo = Path(__file__).resolve().parent.parent
    web_audio_dir = repo / "web/public/audio/upright-kw"
    shared_manifest = repo / "shared/audio/upright-kw.json"
    provenance_file = repo / "docs/exec-plans/evidence/m21-2-r1/sample-provenance.json"
    mobile_audio_dir = repo / "mobile/assets/audio/upright-kw"

    if not web_audio_dir.exists():
        print(f"Error: web audio dir not found: {web_audio_dir}", file=sys.stderr)
        sys.exit(1)
    if not shared_manifest.exists():
        print(f"Error: shared manifest not found: {shared_manifest}", file=sys.stderr)
        sys.exit(1)
    if not provenance_file.exists():
        print(f"Error: provenance file not found: {provenance_file}", file=sys.stderr)
        sys.exit(1)

    with provenance_file.open("r", encoding="utf-8") as f:
        provenance = json.load(f)

    expected_hashes = {}
    for item in provenance["files"]:
        basename = Path(item["file"]).name
        expected_hashes[basename] = item["sha256"].lower()

    if "cc0Sha256" in provenance or "licenseSha256" in provenance:
        expected_hashes["cc0.txt"] = provenance.get("licenseSha256", "").lower()
    if "readmeSha256" in provenance:
        expected_hashes["readme.txt"] = provenance.get("readmeSha256", "").lower()

    mobile_audio_dir.mkdir(parents=True, exist_ok=True)

    # Copy 14 WAV files byte-for-byte and verify
    wav_files = sorted(web_audio_dir.glob("midi-*.wav"))
    if len(wav_files) != 14:
        print(f"Error: expected 14 WAV files, found {len(wav_files)}", file=sys.stderr)
        sys.exit(1)

    for src in wav_files:
        name = src.name
        dst = mobile_audio_dir / name
        shutil.copy2(src, dst)
        actual_hash = sha256(dst)
        expected = expected_hashes.get(name)
        if expected and actual_hash != expected:
            print(f"Error: Hash mismatch for {name}: expected {expected}, got {actual_hash}", file=sys.stderr)
            sys.exit(1)
        print(f"Synced {name}: {actual_hash[:16]}... OK")

    # Copy notices
    for notice in ["cc0.txt", "readme.txt", "README.md"]:
        src = web_audio_dir / notice
        if src.exists():
            dst = mobile_audio_dir / notice
            shutil.copy2(src, dst)
            actual_hash = sha256(dst)
            expected = expected_hashes.get(notice)
            if expected and actual_hash != expected:
                print(f"Error: Hash mismatch for {notice}: expected {expected}, got {actual_hash}", file=sys.stderr)
                sys.exit(1)
            print(f"Synced {notice}: OK")

    # Copy canonical manifest as manifest.json without modifying fields
    dst_manifest = mobile_audio_dir / "manifest.json"
    shutil.copy2(shared_manifest, dst_manifest)
    print(f"Synced manifest.json: OK")

    print("\nAll FreePats piano assets synchronized and verified successfully.")


if __name__ == "__main__":
    main()
