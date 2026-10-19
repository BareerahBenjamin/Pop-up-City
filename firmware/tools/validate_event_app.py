#!/usr/bin/env python3
"""Validate the immutable Herstory event firmware and persistence contract."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shlex
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_VERSION = "herstory-event-v1"
FLASH_SIZE = 0x800000
FACTORY_OFFSET = 0x10000
FACTORY_SIZE = 0x680000
EVENT_SAVE_OFFSET = 0x690000
EVENT_SAVE_SIZE = 0x170000
MAX_SAVE_QUOTA = 2048
PARTITION_CSV_SHA256 = "5036f083d1a2fd9006a1d5c534ac82a54423fd62db563cce3a66c76b5788598b"
APP_ID_RE = re.compile(r"^[a-z][a-z0-9_]{2,14}$")
VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$")
EXPECTED_PARTITIONS = (
    ("nvs", "data", "nvs", 0x9000, 0x6000),
    ("phy_init", "data", "phy", 0xF000, 0x1000),
    ("factory", "app", "factory", FACTORY_OFFSET, FACTORY_SIZE),
    ("event_save", "data", "nvs", EVENT_SAVE_OFFSET, EVENT_SAVE_SIZE),
)
FORBIDDEN_SOURCE_PATTERNS = (
    "nvs_flash_erase",
    "esp_partition_erase_range",
    "esp_flash_erase_region",
)


def load_json(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read {path.name}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} must contain one JSON object")
    return value


def parse_hex(value: object, field: str) -> int:
    if not isinstance(value, str):
        raise ValueError(f"event-contract.json {field} must be a hexadecimal string")
    try:
        return int(value, 0)
    except ValueError as error:
        raise ValueError(f"event-contract.json {field} is invalid") from error


def parse_partitions(path: Path) -> tuple[tuple[str, str, str, int, int], ...]:
    rows: list[tuple[str, str, str, int, int]] = []
    try:
        lines = [line for line in path.read_text(encoding="utf-8").splitlines()
                 if line.strip() and not line.lstrip().startswith("#")]
        for row in csv.reader(lines):
            if len(row) < 5:
                raise ValueError("partition row has fewer than five columns")
            rows.append((
                row[0].strip(), row[1].strip(), row[2].strip(),
                int(row[3].strip(), 0), int(row[4].strip(), 0),
            ))
    except (OSError, ValueError) as error:
        raise ValueError(f"cannot parse partitions.csv: {error}") from error
    return tuple(rows)


def validate_source_contract(root: Path) -> list[str]:
    errors: list[str] = []
    partitions_path = root / "partitions.csv"
    contract_path = root / "event-contract.json"
    app_path = root / "event-app.json"

    if not partitions_path.is_file():
        return ["missing partitions.csv"]
    if parse_partitions(partitions_path) != EXPECTED_PARTITIONS:
        errors.append("partitions.csv differs from the Herstory event v1 layout")
    digest = hashlib.sha256(partitions_path.read_bytes()).hexdigest()
    if digest != PARTITION_CSV_SHA256:
        errors.append("partitions.csv byte hash differs from the frozen event v1 table")

    try:
        contract = load_json(contract_path)
        expected_fields: dict[str, object] = {
            "contract_version": CONTRACT_VERSION,
            "flash_size_bytes": FLASH_SIZE,
            "factory_offset": "0x10000",
            "factory_size": "0x680000",
            "event_save_offset": "0x690000",
            "event_save_size": "0x170000",
            "event_save_format": "nvs",
            "default_save_quota_bytes": MAX_SAVE_QUOTA,
            "partition_csv_sha256": PARTITION_CSV_SHA256,
        }
        for field, expected in expected_fields.items():
            if contract.get(field) != expected:
                errors.append(f"event-contract.json {field} must remain {expected!r}")
        if parse_hex(contract.get("event_save_offset"), "event_save_offset") != EVENT_SAVE_OFFSET:
            errors.append("event_save_offset does not match the frozen contract")
    except ValueError as error:
        errors.append(str(error))

    try:
        app = load_json(app_path)
        app_id = app.get("app_id")
        display_name = app.get("display_name")
        version = app.get("version")
        quota = app.get("save_quota_bytes")
        if app.get("contract_version") != CONTRACT_VERSION:
            errors.append(f"event-app.json contract_version must be {CONTRACT_VERSION!r}")
        if not isinstance(app_id, str) or not APP_ID_RE.fullmatch(app_id):
            errors.append("event-app.json app_id must be 3-15 lowercase letters, digits, or underscores")
        if not isinstance(display_name, str) or not display_name.strip():
            errors.append("event-app.json display_name must be nonempty")
        if not isinstance(version, str) or not VERSION_RE.fullmatch(version):
            errors.append("event-app.json version must use semantic versioning")
        if not isinstance(quota, int) or isinstance(quota, bool) or not 1 <= quota <= MAX_SAVE_QUOTA:
            errors.append(f"event-app.json save_quota_bytes must be between 1 and {MAX_SAVE_QUOTA}")

        identity_path = root / "main" / "event_app_identity.h"
        identity_text = identity_path.read_text(encoding="utf-8")
        id_match = re.search(
            r'^#define\s+EVENT_APP_ID\s+"([a-z0-9_]+)"',
            identity_text,
            re.MULTILINE,
        )
        quota_match = re.search(
            r"^#define\s+EVENT_APP_SAVE_QUOTA_BYTES\s+([0-9]+)u?",
            identity_text,
            re.MULTILINE,
        )
        if not id_match or id_match.group(1) != app_id:
            errors.append("main/event_app_identity.h EVENT_APP_ID must match event-app.json app_id")
        if not quota_match or not isinstance(quota, int) or int(quota_match.group(1)) != quota:
            errors.append("main/event_app_identity.h quota must match event-app.json save_quota_bytes")
    except ValueError as error:
        errors.append(str(error))
    except OSError as error:
        errors.append(f"cannot read main/event_app_identity.h: {error}")

    cmake = root / "main" / "CMakeLists.txt"
    try:
        cmake_text = cmake.read_text(encoding="utf-8")
        if "event_storage.c" not in cmake_text:
            errors.append("main/CMakeLists.txt must compile the shared event_storage.c component")
    except OSError as error:
        errors.append(f"cannot read main/CMakeLists.txt: {error}")

    for base in (root / "main", root / "components"):
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if path.suffix not in {".c", ".cc", ".cpp", ".h", ".hpp"} or not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            for pattern in FORBIDDEN_SOURCE_PATTERNS:
                if pattern in text:
                    errors.append(f"{path.relative_to(root)} uses forbidden destructive API {pattern}")
    return errors


def parse_flash_args(path: Path) -> dict[str, int]:
    images: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        fields = shlex.split(line)
        if not fields or fields[0].startswith("--"):
            continue
        if len(fields) == 2:
            images[fields[1]] = int(fields[0], 0)
    return images


def validate_build(build_dir: Path) -> list[str]:
    errors: list[str] = []
    merged = build_dir / "FoloToy-AI-Passport-full.bin"
    flash_args = build_dir / "flash_args"
    if not merged.is_file() or not flash_args.is_file():
        return ["build directory is missing the merged image or flash_args"]
    if merged.stat().st_size >= EVENT_SAVE_OFFSET:
        errors.append("merged image reaches the protected event_save partition")
    try:
        images = parse_flash_args(flash_args)
        for name, offset in images.items():
            image = build_dir / name
            if not image.is_file():
                errors.append(f"flash_args references missing image {name}")
                continue
            end = offset + image.stat().st_size
            if offset < EVENT_SAVE_OFFSET + EVENT_SAVE_SIZE and end > EVENT_SAVE_OFFSET:
                errors.append(f"image {name} overlaps the protected event_save partition")
    except (OSError, ValueError) as error:
        errors.append(f"cannot validate flash_args: {error}")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--build-dir", type=Path)
    args = parser.parse_args(argv)

    root = args.root.resolve()
    errors = validate_source_contract(root)
    if args.build_dir:
        errors.extend(validate_build(args.build_dir.resolve()))
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    if errors:
        return 1
    print("Event firmware contract: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
