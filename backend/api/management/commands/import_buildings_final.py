

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

import openpyxl

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q
from django.db.models.deletion import ProtectedError
from django.db import connection, transaction

SHEET_TO_REGION = {
    "גוש תחתון": {
        "region_id": "gush-tachton",
        "region_name": "מעונות גוש תחתון",
    },
    "קנדה": {
        "region_id": "canada",
        "region_name": "מעונות קנדה",
    },
    "ברושים": {
        "region_id": "broshim",
        "region_name": "מעונות ברושים",
    },
    "מזרח": {
        "region_id": "mizrah",
        "region_name": "מעונות מזרח",
    },
    "גוש עליון": {
        "region_id": "gush-elyon",
        "region_name": "מעונות גוש עליון",
    },
    "סגל זוטר": {
        "region_id": "segal-zutar",
        "region_name": "מעונות סגל זוטר",
    },
}


OFFICIAL_DORM_NAMES = {
    1: "ריפקין",
    2: "קנדה",
    3: "קסל",
    4: "זוגות",
    5: "מזרח ישן",
    6: "נווה אמריקה",
    7: "סנט",
    8: "משפחות",
    10: "יחיד בחדר",
    11: "עליון עמים",
    12: "מזרח חדש",
    13: "סגל זוטר",
    14: "כפר משתלמים",
    15: "כפר הסמכה",
    16: "רות הכהן",
    17: "ברושים",
    18: "סנט חדש",
}


SECTION_DORM_RULES = {
    "גוש תחתון": (
        {"contains": "תחתון שניים בחדר", "code": 1},
        {"contains": "יחיד תחתון", "code": 10},
    ),
    "קנדה": (
        {"contains": "", "code": 2},
    ),
    "ברושים": (
        {"contains": "", "code": 17},
    ),
    "מזרח": (
        {"contains": "מזרח ישן", "code": 5},
        {"contains": "מזרח חדש", "code": 12},
    ),
    "גוש עליון": (
        {"contains": "עמים", "code": 11},
        {"contains": "נווה אמריקה", "code": 6},
        {"contains": "סנט", "code": 18},
        {"contains": "כפר הסמכה", "code": 15},
    ),
    "סגל זוטר": (
        {"contains": "", "code": 13},
    ),
}



HEADER_ALIASES = {
    "building": {"בניין"},
    "apartment": {"דירה"},
    "room": {"חדר"},
    "room_id": {"מזהה חדר"},
    "apartment_type": {"סוג דירה"},
    "population": {"אוכלוסיה"},
    "layout_rooms": {"מספר חדרים (כולל סלון)"},
}


SINGLE = "single"
COUPLE = "couple"
FAMILY = "family"
MALE = "male"
FEMALE = "female"

NON_SINGLE = "non_single"



KNOWN_ROOM_ID_CORRECTIONS = {
    ("גוש תחתון", 108, "108/ /1"): "108/9/1",
}


@dataclass(frozen=True)
class InventoryRow:
    sheet_name: str
    section_title: str
    excel_row: int
    region_id: str
    region_name: str
    dorm_code: int
    dorm_name: str
    building_number: int
    physical_apartment_number: str
    room_number: str
    source_room_id: str
    apartment_type: str
    category: str
    source_type_text: str
    capacity: int


@dataclass
class Section:
    title: str
    columns: Dict[str, int]
    rows: List[Tuple[int, Sequence[object]]]


def normalize_text(value: object) -> str:
    if value is None:
        return ""

    text = str(value)
    text = text.replace("\u200f", "").replace("\u200e", "")
    text = text.replace("\xa0", " ")
    return " ".join(text.split()).strip()


def is_blank(value: object) -> bool:
    return normalize_text(value).lower() in {"", "none", "nan"}


def reconnect() -> None:
    """
    Reuse the current database connection when it is healthy.
    Reconnect only when the connection is missing or unusable.
    """
    if connection.connection is None:
        connection.ensure_connection()
        return

    try:
        if connection.is_usable():
            return
    except Exception:
        pass

    connection.close()
    connection.ensure_connection()


def row_non_empty_values(row: Sequence[object]) -> List[str]:
    return [normalize_text(value) for value in row if not is_blank(value)]


def is_header_row(row: Sequence[object]) -> bool:
    values = set(row_non_empty_values(row))
    return "בניין" in values and "מזהה חדר" in values


def is_title_row(row: Sequence[object]) -> bool:
    if is_header_row(row):
        return False

    values = row_non_empty_values(row)
    if len(values) != 1:
        return False

    value = values[0]
    if value == "בניין":
        return False

    try:
        float(value)
        return False
    except (TypeError, ValueError):
        return True


def get_title_text(row: Sequence[object]) -> str:
    values = row_non_empty_values(row)
    return values[0] if values else ""


def build_column_map(row: Sequence[object]) -> Dict[str, int]:
    normalized_headers = {
        normalize_text(value): index
        for index, value in enumerate(row)
        if not is_blank(value)
    }

    result: Dict[str, int] = {}
    for internal_name, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            if alias in normalized_headers:
                result[internal_name] = normalized_headers[alias]
                break

    if "building" not in result or "room_id" not in result:
        raise CommandError(
            "A detected table is missing required columns: בניין / מזהה חדר."
        )

    return result


def parse_sections(worksheet) -> List[Section]:
    sections: List[Section] = []
    current_title = worksheet.title
    current_columns: Optional[Dict[str, int]] = None
    current_rows: List[Tuple[int, Sequence[object]]] = []

    for row_number, row in enumerate(
        worksheet.iter_rows(values_only=True),
        start=1,
    ):
        if is_title_row(row):
            if current_columns is not None and current_rows:
                sections.append(
                    Section(
                        title=current_title,
                        columns=current_columns,
                        rows=current_rows,
                    )
                )
            current_title = get_title_text(row)
            current_columns = None
            current_rows = []
            continue

        if is_header_row(row):
            if current_columns is not None and current_rows:
                sections.append(
                    Section(
                        title=current_title,
                        columns=current_columns,
                        rows=current_rows,
                    )
                )
                current_rows = []

            current_columns = build_column_map(row)
            continue

        if current_columns is not None:
            current_rows.append((row_number, row))

    if current_columns is not None and current_rows:
        sections.append(
            Section(
                title=current_title,
                columns=current_columns,
                rows=current_rows,
            )
        )

    return sections


def resolve_official_dorm(
    sheet_name: str,
    section_title: str,
) -> Tuple[int, str]:
    rules = SECTION_DORM_RULES.get(sheet_name, ())

    for rule in rules:
        required_text = rule["contains"]
        if not required_text or required_text in section_title:
            code = int(rule["code"])
            try:
                return code, OFFICIAL_DORM_NAMES[code]
            except KeyError as exc:
                raise CommandError(
                    f"Dorm code {code} is missing from OFFICIAL_DORM_NAMES."
                ) from exc

    raise CommandError(
        f'No official dorm ID mapping for sheet="{sheet_name}", '
        f'section="{section_title}".'
    )


def value_from_row(
    row: Sequence[object],
    columns: Dict[str, int],
    key: str,
) -> object:
    index = columns.get(key)
    if index is None or index >= len(row):
        return None
    return row[index]


def parse_building_number(value: object) -> Optional[int]:
    if is_blank(value):
        return None

    try:
        return int(float(normalize_text(value)))
    except (TypeError, ValueError):
        return None


def parse_room_identifier(
    room_id_value: object,
    explicit_apartment: object = None,
    explicit_room: object = None,
) -> Optional[Tuple[str, str, str]]:
    """
    Return (physical apartment number, room number, normalized source id).

    Supported examples:
      103/1/1  -> apartment=1, room=1
      446/2/   -> apartment=2, room=1
      921/32   -> apartment=32, room=1
    """
    source_room_id = normalize_text(room_id_value).rstrip("/")
    parts = [part.strip() for part in source_room_id.split("/")]

    apartment_number = ""
    room_number = ""

    if len(parts) >= 2:
        apartment_number = parts[1]

    if len(parts) >= 3:
        room_number = parts[2]

    if not apartment_number:
        apartment_number = normalize_text(explicit_apartment)

    if not room_number:
        room_number = normalize_text(explicit_room) or "1"

    if not apartment_number:
        return None

    return apartment_number, room_number, source_room_id


def classify_inventory_type(
    raw_type_value: object,
    raw_population_value: object = None,
) -> Tuple[str, str]:
    """
    Interpretation:
      בנים                     -> single, male
      בנות                     -> single, female
      רווק בדירת זוגות         -> couple, male
      רווקה בדירת זוגות        -> couple, female
      זוגות                    -> couple, non-gendered
      משפחות                   -> family, non-gendered
    """
    type_text = normalize_text(raw_type_value)
    population_text = normalize_text(raw_population_value)
    combined_text = normalize_text(f"{type_text} {population_text}")

    if not combined_text:
        raise CommandError(
            "Empty סוג דירה / אוכלוסיה values cannot be classified."
        )

    if "משפח" in combined_text:
        return FAMILY, NON_SINGLE


    if "בדירת זוגות" in combined_text:
        if any(
            marker in combined_text
            for marker in ("רווקה", "רווקות", "בנות")
        ):
            return COUPLE, FEMALE

        if any(
            marker in combined_text
            for marker in ("רווק", "רווקים", "בנים")
        ):
            return COUPLE, MALE

        raise CommandError(
            "Couple-apartment single occupancy is missing a male/female "
            f'classification: סוג דירה="{type_text}", '
            f'אוכלוסיה="{population_text}".'
        )

    if any(marker in type_text for marker in ("בנות", "רווקות", "רווקה")):
        return SINGLE, FEMALE

    if any(marker in type_text for marker in ("בנים", "רווקים", "רווק")):
        return SINGLE, MALE

    if any(marker in population_text for marker in ("בנות", "רווקות", "רווקה")):
        return SINGLE, FEMALE

    if any(marker in population_text for marker in ("בנים", "רווקים", "רווק")):
        return SINGLE, MALE

    if "זוג" in combined_text:
        return COUPLE, NON_SINGLE

    raise CommandError(
        "Unsupported housing classification: "
        f'סוג דירה="{type_text}", אוכלוסיה="{population_text}".'
    )


def capacity_for_row(
    section_title: str,
    apartment_type: str,
) -> int:
    if apartment_type in {COUPLE, FAMILY}:
        return 1

    if "שניים בחדר" in section_title:
        return 2

    return 1


def parse_inventory_row(
    sheet_name: str,
    section: Section,
    row_number: int,
    row: Sequence[object],
    warnings: List[str],
) -> Optional[InventoryRow]:
    region_info = SHEET_TO_REGION[sheet_name]

    building_number = parse_building_number(
        value_from_row(row, section.columns, "building")
    )
    if building_number is None:
        return None

    room_id_value = value_from_row(row, section.columns, "room_id")
    if is_blank(room_id_value):
        return None

    original_room_id = normalize_text(room_id_value)
    corrected_room_id = KNOWN_ROOM_ID_CORRECTIONS.get(
        (sheet_name, building_number, original_room_id)
    )
    if corrected_room_id:
        warnings.append(
            f"Known workbook typo corrected: {sheet_name}!row {row_number} "
            f"{original_room_id} -> {corrected_room_id}."
        )
        room_id_value = corrected_room_id

    parsed_room = parse_room_identifier(
        room_id_value,
        explicit_apartment=value_from_row(
            row,
            section.columns,
            "apartment",
        ),
        explicit_room=value_from_row(
            row,
            section.columns,
            "room",
        ),
    )
    if parsed_room is None:
        raise CommandError(
            f"{sheet_name}!row {row_number}: invalid room identifier "
            f'"{normalize_text(room_id_value)}".'
        )

    apartment_number, room_number, source_room_id = parsed_room

    dorm_code, dorm_name = resolve_official_dorm(
        sheet_name,
        section.title,
    )

    source_type_text = normalize_text(
        value_from_row(row, section.columns, "apartment_type")
    )
    source_population_text = normalize_text(
        value_from_row(row, section.columns, "population")
    )

    try:
        apartment_type, category = classify_inventory_type(
            source_type_text,
            source_population_text,
        )
    except CommandError as exc:
        raise CommandError(
            f"{sheet_name}!row {row_number}: {exc}"
        ) from exc

    return InventoryRow(
        sheet_name=sheet_name,
        section_title=section.title,
        excel_row=row_number,
        region_id=region_info["region_id"],
        region_name=region_info["region_name"],
        dorm_code=dorm_code,
        dorm_name=dorm_name,
        building_number=building_number,
        physical_apartment_number=apartment_number,
        room_number=room_number,
        source_room_id=source_room_id,
        apartment_type=apartment_type,
        category=category,
        source_type_text=normalize_text(
            f"סוג דירה={source_type_text}; אוכלוסיה={source_population_text}"
        ),
        capacity=capacity_for_row(section.title, apartment_type),
    )


def logical_apartment_suffix(
    apartment_type: str,
    category: str,
) -> str:
    if apartment_type == COUPLE:
        if category == FEMALE:
            return "C-F"
        if category == MALE:
            return "C-M"
        return "C"
    if apartment_type == FAMILY:
        return "FAM"
    if category == FEMALE:
        return "F"
    return "M"


def build_inventory_plan(
    workbook,
    sheets_to_process: Sequence[str],
) -> Tuple[List[InventoryRow], List[str]]:
    parsed_rows: List[InventoryRow] = []
    warnings: List[str] = []

    for sheet_name in sheets_to_process:
        if sheet_name not in SHEET_TO_REGION:
            raise CommandError(f'Unknown sheet "{sheet_name}".')

        if sheet_name not in workbook.sheetnames:
            raise CommandError(
                f'Sheet "{sheet_name}" does not exist in the workbook.'
            )

        worksheet = workbook[sheet_name]
        sections = parse_sections(worksheet)

        if not sections:
            raise CommandError(
                f'No inventory tables were found in sheet "{sheet_name}".'
            )

        for section in sections:
            for row_number, row in section.rows:
                parsed = parse_inventory_row(
                    sheet_name,
                    section,
                    row_number,
                    row,
                    warnings,
                )
                if parsed is not None:
                    parsed_rows.append(parsed)


    unique_rows: List[InventoryRow] = []
    seen_room_keys: Set[
        Tuple[int, int, str, str, str, str]
    ] = set()

    for item in parsed_rows:
        duplicate_key = (
            item.dorm_code,
            item.building_number,
            item.physical_apartment_number,
            item.room_number,
            item.apartment_type,
            item.category,
        )
        if duplicate_key in seen_room_keys:
            warnings.append(
                f"Duplicate ignored: {item.sheet_name}!row "
                f"{item.excel_row} ({item.source_room_id})."
            )
            continue
        seen_room_keys.add(duplicate_key)
        unique_rows.append(item)

    return unique_rows, warnings


def assign_logical_apartment_numbers(
    rows: Sequence[InventoryRow],
) -> Tuple[Dict[InventoryRow, str], List[str]]:
    """
    Split only the physical apartments that contain conflicting classifications.

    This is necessary because Apartment.category is stored at apartment level,
    while the supplied workbook contains one physical apartment (177/15) with
    one male and one female room.
    """
    classifications_by_physical_apartment: Dict[
        Tuple[int, int, str],
        Set[Tuple[str, str]],
    ] = defaultdict(set)

    for item in rows:
        physical_key = (
            item.dorm_code,
            item.building_number,
            item.physical_apartment_number,
        )
        classifications_by_physical_apartment[physical_key].add(
            (item.apartment_type, item.category)
        )

    result: Dict[InventoryRow, str] = {}
    warnings: List[str] = []

    for item in rows:
        physical_key = (
            item.dorm_code,
            item.building_number,
            item.physical_apartment_number,
        )
        classifications = classifications_by_physical_apartment[physical_key]

        if len(classifications) == 1:
            result[item] = item.physical_apartment_number
            continue

        suffix = logical_apartment_suffix(
            item.apartment_type,
            item.category,
        )
        logical_number = (
            f"{item.physical_apartment_number}-{suffix}"
        )
        result[item] = logical_number

    for physical_key, classifications in (
        classifications_by_physical_apartment.items()
    ):
        if len(classifications) <= 1:
            continue

        dorm_code, building_number, apartment_number = physical_key
        classes_text = ", ".join(
            f"{apartment_type}/{category}"
            for apartment_type, category in sorted(classifications)
        )
        warnings.append(
            f"Physical apartment split: dorm={dorm_code}, "
            f"building={building_number}, apartment={apartment_number}; "
            f"classifications={classes_text}."
        )

    return result, warnings


def group_inventory(
    rows: Sequence[InventoryRow],
    logical_numbers: Dict[InventoryRow, str],
):
    """
    Build:
      dorm_code -> dorm metadata/buildings
      building -> apartment -> room -> capacity
    """
    plan = {}

    for item in rows:
        dorm_entry = plan.setdefault(
            item.dorm_code,
            {
                "name": item.dorm_name,
                "region_id": item.region_id,
                "region_name": item.region_name,
                "buildings": {},
            },
        )

        building_entry = dorm_entry["buildings"].setdefault(
            item.building_number,
            {},
        )

        logical_apartment_number = logical_numbers[item]
        apartment_entry = building_entry.setdefault(
            logical_apartment_number,
            {
                "physical_number": item.physical_apartment_number,
                "apartment_type": item.apartment_type,
                "category": item.category,
                "rooms": {},
            },
        )

        expected_signature = (
            item.apartment_type,
            item.category,
        )
        actual_signature = (
            apartment_entry["apartment_type"],
            apartment_entry["category"],
        )
        if actual_signature != expected_signature:
            raise CommandError(
                "Internal grouping error: a logical apartment contains "
                "incompatible classifications."
            )

        if item.room_number in apartment_entry["rooms"]:
            raise CommandError(
                f"Duplicate room after normalization: dorm={item.dorm_code}, "
                f"building={item.building_number}, "
                f"apartment={logical_apartment_number}, "
                f"room={item.room_number}."
            )

        apartment_entry["rooms"][item.room_number] = {
            "capacity": item.capacity,
            "source_room_id": item.source_room_id,
        }

    return plan


def count_plan(plan) -> Counter:
    counts = Counter()

    for dorm_entry in plan.values():
        for apartments in dorm_entry["buildings"].values():
            counts["buildings"] += 1
            for apartment_entry in apartments.values():
                counts["apartments"] += 1
                counts[
                    f"apartments_{apartment_entry['apartment_type']}"
                ] += 1

                for room_entry in apartment_entry["rooms"].values():
                    counts["rooms"] += 1
                    counts["allocation_units"] += int(
                        room_entry["capacity"]
                    )

    return counts


def resolve_database_category(Apartment, apartment_type: str, category: str) -> Tuple[str, bool]:
    """
    Map the internal population class to a value supported by Apartment.category.

    Single apartments always require male/female. Couple-layout apartments that
    contain single residents (`רווק/ה בדירת זוגות`) also retain male/female.
    Regular couple and family inventory is non-gendered; use a neutral model
    choice when available, otherwise use male only as a schema placeholder and
    report it.
    """
    if apartment_type == SINGLE:
        if category not in {MALE, FEMALE}:
            raise CommandError(
                f"Single apartment has invalid category: {category}."
            )
        return category, False

    if apartment_type == COUPLE and category in {MALE, FEMALE}:
        return category, False

    supported_values = {
        str(value)
        for value, _label in getattr(Apartment.Category, "choices", ())
    }
    for neutral_value in ("not_applicable", "mixed", "neutral"):
        if neutral_value in supported_values:
            return neutral_value, False

    return MALE, True


class Command(BaseCommand):
    help = (
        "Import the authoritative dorm building inventory using official "
        "DormType codes and apartment population types."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "excel_path",
            type=str,
            help="Path to מיטות במעונות.xlsx inside the running environment.",
        )
        parser.add_argument(
            "sheet_name",
            nargs="?",
            default=None,
            help="Optional single sheet name to import.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Parse and validate the workbook without changing the database.",
        )
        parser.add_argument(
            "--replace",
            action="store_true",
            help=(
                "Delete the existing building inventory in the processed "
                "regions before import. Refuses to run if any BedAssignment "
                "history exists in those regions."
            ),
        )

    def handle(self, *args, **options):
        from api.models import (
            Apartment,
            Bed,
            BedAssignment,
            Building,
            DormType,
            Region,
            Room,
        )

        excel_path = options["excel_path"]
        target_sheet = options["sheet_name"]
        dry_run = bool(options["dry_run"])
        replace = bool(options["replace"])

        sheets_to_process = (
            [target_sheet]
            if target_sheet
            else list(SHEET_TO_REGION.keys())
        )

        self.stdout.write(f"Reading: {excel_path}")

        try:
            workbook = openpyxl.load_workbook(
                excel_path,
                read_only=True,
                data_only=True,
            )
        except Exception as exc:
            raise CommandError(
                f"Could not open Excel workbook: {exc}"
            ) from exc

        rows, parse_warnings = build_inventory_plan(
            workbook,
            sheets_to_process,
        )
        logical_numbers, split_warnings = (
            assign_logical_apartment_numbers(rows)
        )
        plan = group_inventory(rows, logical_numbers)
        counts = count_plan(plan)

        self.stdout.write("")
        self.stdout.write("Validated inventory plan:")
        self.stdout.write(
            f"  Dorm types:       {len(plan)}"
        )
        self.stdout.write(
            f"  Buildings:        {counts['buildings']}"
        )
        self.stdout.write(
            f"  Apartments:       {counts['apartments']}"
        )
        self.stdout.write(
            f"    single:         {counts['apartments_single']}"
        )
        self.stdout.write(
            f"    couple:         {counts['apartments_couple']}"
        )
        self.stdout.write(
            f"    family:         {counts['apartments_family']}"
        )
        self.stdout.write(
            f"  Rooms/units:      {counts['rooms']}"
        )
        self.stdout.write(
            f"  Allocation slots: {counts['allocation_units']}"
        )

        all_warnings = parse_warnings + split_warnings
        if all_warnings:
            self.stdout.write("")
            self.stdout.write(
                self.style.WARNING(
                    f"Validation warnings: {len(all_warnings)}"
                )
            )
            for warning in all_warnings:
                self.stdout.write(
                    self.style.WARNING(f"  - {warning}")
                )

        if dry_run:
            self.stdout.write(
                self.style.SUCCESS(
                    "\nDry run completed. No database rows were changed."
                )
            )
            return

        reconnect()

        processed_region_ids = {
            SHEET_TO_REGION[sheet_name]["region_id"]
            for sheet_name in sheets_to_process
        }


        if not replace:
            stale_conflicts = []
            for dorm_code, dorm_entry in plan.items():
                for building_number in dorm_entry["buildings"]:
                    matches = Building.objects.filter(
                        number=building_number,
                        dorm_type__region_id=dorm_entry["region_id"],
                    ).select_related("dorm_type")

                    correct_count = matches.filter(
                        dorm_type__code=dorm_code
                    ).count()
                    wrong_matches = list(
                        matches.exclude(dorm_type__code=dorm_code)
                        .values_list("id", "dorm_type__code", "dorm_type__name")
                    )

                    if correct_count > 1 or wrong_matches:
                        stale_conflicts.append(
                            {
                                "region": dorm_entry["region_id"],
                                "building": building_number,
                                "expected_dorm_code": dorm_code,
                                "correct_count": correct_count,
                                "wrong_matches": wrong_matches,
                            }
                        )

            if stale_conflicts:
                sample = stale_conflicts[:10]
                raise CommandError(
                    "Existing building inventory conflicts with the official "
                    "dorm mapping. This is likely leftover data from the old "
                    "hash-based importer. Re-run with --replace after confirming "
                    "that no BedAssignment history must be preserved. "
                    f"Conflict sample: {sample}"
                )

        if replace:

            replacement_filter = Q(pk__in=[])
            for dorm_entry in plan.values():
                planned_numbers = list(dorm_entry["buildings"].keys())
                replacement_filter |= Q(
                    number__in=planned_numbers,
                    dorm_type__region_id=dorm_entry["region_id"],
                )

            existing_buildings = Building.objects.filter(replacement_filter)
            replacement_building_ids = list(
                existing_buildings.values_list("id", flat=True)
            )

            assignment_count = BedAssignment.objects.filter(
                bed__room__apartment__building_id__in=(
                    replacement_building_ids
                )
            ).count()

            if assignment_count:
                raise CommandError(
                    "--replace was refused because "
                    f"{assignment_count} BedAssignment record(s) exist in "
                    "the exact building inventory that would be replaced. "
                    "Preserve or clear assignment history first."
                )

            existing_count = len(replacement_building_ids)
            self.stdout.write(
                self.style.WARNING(
                    f"\nReplacing {existing_count} existing building "
                    "record(s) represented by this workbook."
                )
            )

            try:
                existing_buildings.delete()
            except ProtectedError as exc:
                raise CommandError(
                    "Existing inventory could not be deleted because "
                    "protected dependent records exist."
                ) from exc

        operation_counts = Counter()

        for dorm_code in sorted(plan):
            dorm_entry = plan[dorm_code]

            reconnect()
            region, region_created = Region.objects.update_or_create(
                id=dorm_entry["region_id"],
                defaults={"name": dorm_entry["region_name"]},
            )
            operation_counts[
                "regions_created" if region_created else "regions_updated"
            ] += 1

            by_code = DormType.objects.filter(code=dorm_code).first()
            by_name = DormType.objects.filter(name=dorm_entry["name"]).first()

            if by_code and by_name and by_code.pk != by_name.pk:
                raise CommandError(
                    f"DormType collision: official code {dorm_code} and name "
                    f'"{dorm_entry["name"]}" belong to different rows.'
                )

            dorm_type = by_code or by_name
            if dorm_type is None:
                dorm_type = DormType.objects.create(
                    code=dorm_code,
                    name=dorm_entry["name"],
                    region=region,
                )
                operation_counts["dorm_types_created"] += 1
            else:
                changed_fields = []
                desired_values = {
                    "code": dorm_code,
                    "name": dorm_entry["name"],
                    "region": region,
                }

                if dorm_type.code != desired_values["code"]:
                    dorm_type.code = desired_values["code"]
                    changed_fields.append("code")
                if dorm_type.name != desired_values["name"]:
                    dorm_type.name = desired_values["name"]
                    changed_fields.append("name")
                if dorm_type.region_id != region.id:
                    dorm_type.region = region
                    changed_fields.append("region")

                if changed_fields:
                    dorm_type.save(update_fields=changed_fields)
                    operation_counts["dorm_types_updated"] += 1
            self.stdout.write(
                f"\nDorm {dorm_code} - {dorm_type.name}"
            )

            for building_number, apartments in sorted(
                dorm_entry["buildings"].items()
            ):
                reconnect()

                with transaction.atomic():
                    building, building_created = (
                        Building.objects.update_or_create(
                            number=building_number,
                            dorm_type=dorm_type,
                            defaults={"is_active": True},
                        )
                    )
                    operation_counts[
                        "buildings_created"
                        if building_created
                        else "buildings_updated"
                    ] += 1

                    expected_apartment_numbers = set(apartments)

                    for apartment_number, apartment_data in sorted(
                        apartments.items()
                    ):
                        rooms_data = apartment_data["rooms"]
                        room_count = len(rooms_data)
                        apartment_capacity = sum(
                            int(room_data["capacity"])
                            for room_data in rooms_data.values()
                        )

                        database_category, used_placeholder = (
                            resolve_database_category(
                                Apartment,
                                apartment_data["apartment_type"],
                                apartment_data["category"],
                            )
                        )
                        if used_placeholder:
                            operation_counts[
                                "non_single_category_placeholders"
                            ] += 1

                        apartment, apartment_created = (
                            Apartment.objects.update_or_create(
                                building=building,
                                number=str(apartment_number),
                                defaults={
                                    "category": database_category,
                                    "apartment_type": (
                                        apartment_data["apartment_type"]
                                    ),
                                    "room_count": room_count,
                                    "apartment_capacity": (
                                        apartment_capacity
                                    ),
                                    "is_active": True,
                                    "inactive_reason": "",
                                },
                            )
                        )
                        operation_counts[
                            "apartments_created"
                            if apartment_created
                            else "apartments_updated"
                        ] += 1

                        expected_room_names = set(rooms_data)

                        for room_number, room_data in sorted(
                            rooms_data.items()
                        ):
                            capacity = int(room_data["capacity"])

                            room, room_created = (
                                Room.objects.update_or_create(
                                    apartment=apartment,
                                    name=str(room_number),
                                    defaults={
                                        "capacity": capacity,
                                        "is_active": True,
                                    },
                                )
                            )
                            operation_counts[
                                "rooms_created"
                                if room_created
                                else "rooms_updated"
                            ] += 1

                            existing_beds = {
                                bed.label: bed
                                for bed in room.beds.all()
                            }
                            expected_labels = {
                                f"Bed {index}"
                                for index in range(1, capacity + 1)
                            }

                            for label in sorted(
                                expected_labels - set(existing_beds)
                            ):
                                Bed.objects.create(
                                    room=room,
                                    label=label,
                                )
                                operation_counts["beds_created"] += 1

                            for label in sorted(
                                set(existing_beds) - expected_labels
                            ):
                                bed = existing_beds[label]

                                if bed.assignments.exists():
                                    raise CommandError(
                                        f"Cannot remove extra bed {bed}: "
                                        "assignment history exists."
                                    )

                                bed.delete()
                                operation_counts["beds_deleted"] += 1


                        stale_rooms = apartment.rooms.exclude(
                            name__in=expected_room_names
                        )
                        for stale_room in stale_rooms:
                            if BedAssignment.objects.filter(
                                bed__room=stale_room
                            ).exists():
                                raise CommandError(
                                    f"Cannot remove stale room "
                                    f"{stale_room}: assignment history exists."
                                )
                            stale_room.delete()
                            operation_counts["rooms_deleted"] += 1


                    stale_apartments = building.apartments.exclude(
                        number__in=expected_apartment_numbers
                    )
                    for stale_apartment in stale_apartments:
                        if BedAssignment.objects.filter(
                            bed__room__apartment=stale_apartment
                        ).exists():
                            raise CommandError(
                                f"Cannot remove stale apartment "
                                f"{stale_apartment}: assignment history exists."
                            )
                        stale_apartment.delete()
                        operation_counts["apartments_deleted"] += 1

                self.stdout.write(
                    f"  Building {building_number}: "
                    f"{len(apartments)} apartment(s)"
                )

        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS("Import completed successfully.")
        )

        for key in sorted(operation_counts):
            self.stdout.write(
                f"  {key}: {operation_counts[key]}"
            )

        if operation_counts["non_single_category_placeholders"]:
            self.stdout.write("")
            self.stdout.write(
                self.style.WARNING(
                    "Schema note: Apartment.category currently has no neutral "
                    "choice. Regular couple/family units therefore use "
                    "category='male' only as a database placeholder. Couple "
                    "apartments occupied by single men/women keep their real "
                    "male/female category, so the solver must not ignore gender "
                    "for those rows."
                )
            )

