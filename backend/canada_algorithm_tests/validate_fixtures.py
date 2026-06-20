#!/usr/bin/env python3
"""Validate the synthetic fixture package without importing Django or running the solver."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def normalize_csv_value(value):
    return "" if value is None else str(value).strip()


def fail(message):
    raise AssertionError(message)


def read_csv(path):
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def validate_case(case_dir):
    json_files = list(case_dir.glob("*.json"))
    if len(json_files) != 1:
        fail(f"{case_dir.name}: expected exactly one JSON file, found {len(json_files)}")

    with json_files[0].open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    required = {"case_name", "description", "constraints_config", "apartments", "rooms", "students", "expected_result", "expected_metrics"}
    missing = required - set(data)
    if missing:
        fail(f"{case_dir.name}: missing JSON keys {sorted(missing)}")

    csv_map = {
        "apartments": case_dir / "apartments.csv",
        "rooms": case_dir / "rooms.csv",
        "students": case_dir / "students.csv",
    }
    id_key = {
        "apartments": "apartment_code",
        "rooms": "room_code",
        "students": "student_id",
    }

    for entity, csv_path in csv_map.items():
        rows = read_csv(csv_path)
        json_rows = data[entity]
        if len(rows) != len(json_rows):
            fail(f"{case_dir.name}: {entity} CSV has {len(rows)} rows but JSON has {len(json_rows)}")

        csv_ids = [normalize_csv_value(row[id_key[entity]]) for row in rows]
        json_ids = [normalize_csv_value(row[id_key[entity]]) for row in json_rows]
        if csv_ids != json_ids:
            fail(f"{case_dir.name}: {entity} identifiers differ between CSV and JSON")
        if len(set(json_ids)) != len(json_ids):
            fail(f"{case_dir.name}: duplicate {id_key[entity]} values")

    apartment_ids = {row["apartment_code"] for row in data["apartments"]}
    student_ids = {str(row["student_id"]) for row in data["students"]}

    for room in data["rooms"]:
        if room["apartment_code"] not in apartment_ids:
            fail(f"{case_dir.name}: room {room['room_code']} references unknown apartment {room['apartment_code']}")
        if int(room.get("capacity", 0) or 0) < 0:
            fail(f"{case_dir.name}: room {room['room_code']} has negative capacity")

    for student in data["students"]:
        for index in range(1, 6):
            target = normalize_csv_value(student.get(f"roommate_request_student_id_{index}", ""))
            if target and target not in student_ids:
                fail(f"{case_dir.name}: student {student['student_id']} requests unknown roommate {target}")

    metrics = data["expected_metrics"]
    for key in ("allowed_solver_status", "successful_assignments", "conflicts"):
        if key not in metrics:
            fail(f"{case_dir.name}: expected_metrics missing {key}")

    if metrics["successful_assignments"] + metrics["conflicts"] != len(data["students"]):
        fail(f"{case_dir.name}: successful_assignments + conflicts must equal student count")

    return {
        "case": case_dir.name,
        "students": len(data["students"]),
        "apartments": len(data["apartments"]),
        "rooms": len(data["rooms"]),
    }


def main():
    case_dirs = sorted(path for path in ROOT.glob("case_*") if path.is_dir())
    if not case_dirs:
        fail("No case folders found")

    summaries = [validate_case(path) for path in case_dirs]

    case_09 = ROOT / "case_09_initial_run_without_accessibility_data"
    if case_09.exists():
        with next(case_09.glob("*.json")).open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if any(bool(student.get("needs_accessibility")) for student in data["students"]):
            fail("Case 09 must not contain an active student accessibility requirement")
        if any("נגיש" in str(student.get("priority_reason", "")).lower() for student in data["students"]):
            fail("Case 09 contains an accessibility keyword in priority_reason")

    print(f"Validated {len(summaries)} synthetic cases successfully.")
    for item in summaries:
        print(f"- {item['case']}: {item['students']} students, {item['apartments']} apartments, {item['rooms']} rooms")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"VALIDATION FAILED: {exc}", file=sys.stderr)
        raise
