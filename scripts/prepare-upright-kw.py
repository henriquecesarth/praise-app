#!/usr/bin/env python3
"""Project the FreePats Upright Piano KW SFZ samples into the vocal MIDI range."""
import argparse
import hashlib
import json
import re
import shutil
import struct
import wave
from pathlib import Path

ARCHIVE_SHA256 = "ffb547fceb91eeb93d78cf8d220d1d5f726dcac891a fc15e517805ac48abb39d".replace(" ", "")
SOURCE = "FreePats Upright Piano KW small SFZ, 2019-07-03"
LICENSE = "CC0-1.0"


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def parse_sfz(text):
    group_loop = None
    regions = []
    for block in re.split(r"(?=<group>|<region>)", text):
        if block.startswith("<group>"):
            m = re.search(r"\bloop_mode=(\S+)", block)
            group_loop = m.group(1) if m else None
        elif block.startswith("<region>"):
            fields = dict(re.findall(r"^\s*(\w+)=(\S+)\s*$", block, re.M))
            regions.append((fields, group_loop))
    return regions


def main():
    p = argparse.ArgumentParser()
    p.add_argument("source", type=Path, help="Extracted UprightPianoKW-small-SFZ-20190703 directory")
    p.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    args = p.parse_args()
    source = args.source.resolve()
    sfz = next(source.glob("*.sfz"))
    readme = source / "readme.txt"
    cc0 = source / "cc0.txt"
    out = args.repo / "web/public/audio/upright-kw"
    out.mkdir(parents=True, exist_ok=True)
    shutil.copy2(readme, out / "readme.txt")
    shutil.copy2(cc0, out / "cc0.txt")
    raw = sfz.read_bytes()
    text = raw.decode("utf-8-sig")
    regions = []
    for fields, loop_mode in parse_sfz(text):
        low, high, root = (int(fields[k]) for k in ("lokey", "hikey", "pitch_keycenter"))
        if high < 48 or low > 88:
            continue
        sample = (source / fields["sample"]).resolve()
        if not sample.is_relative_to(source):
            raise ValueError("sample path escapes source")
        dest_name = f"midi-{root:03}.wav"
        shutil.copyfile(sample, out / dest_name)
        with wave.open(str(sample), "rb") as wav:
            rate, frames, width, channels = wav.getframerate(), wav.getnframes(), wav.getsampwidth(), wav.getnchannels()
        item = {"low": low, "high": high, "root": root, "file": f"/audio/upright-kw/{dest_name}"}
        if loop_mode == "loop_continuous":
            start, end = int(fields["loop_start"]), int(fields["loop_end"])
            if not (0 <= start <= end < frames):
                raise ValueError(f"invalid loop bounds in {sfz.name}: {start}..{end}/{frames}")
            item["loopStartSeconds"] = start / rate
            item["loopEndSeconds"] = (end + 1) / rate
        regions.append(item)
        print(f"{dest_name}: bytes={sample.stat().st_size} frames={frames} rate={rate} width={width} channels={channels} sha256={sha(sample)}")
    manifest = {"version": 1, "source": SOURCE, "license": LICENSE,
                "supportedMidi": [48, 88], "releaseSeconds": 0.6, "regions": regions}
    shared = args.repo / "shared/audio"
    shared.mkdir(parents=True, exist_ok=True)
    (shared / "upright-kw.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"archive_sha256={ARCHIVE_SHA256}")
    print(f"sfz_sha256={sha(sfz)} readme_sha256={sha(readme)} cc0_sha256={sha(cc0)}")
    print(f"regions={len(regions)} copied_bytes={sum((out / Path(x['file']).name).stat().st_size for x in regions)}")


if __name__ == "__main__":
    main()
