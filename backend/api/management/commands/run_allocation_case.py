import csv
import json
from collections import Counter, defaultdict
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from api.models import (
    Region,
    DormType,
    Building,
    Apartment,
    Room,
    Bed,
    Student,
    BedAssignment,
)

import allocation.solver as allocation_solver


class Command(BaseCommand):
    help = (
        "Run one allocation test case, print the exact allocation, and compare "
        "the actual placement with machine-readable expected allocation rules."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "case_name",
            type=str,
            help="Test-case folder name, for example case_09_initial_run_without_accessibility_data",
        )
        time_group = parser.add_mutually_exclusive_group()
        time_group.add_argument(
            "--max-seconds",
            type=float,
            default=None,
            help="CP-SAT time limit in seconds.",
        )
        time_group.add_argument(
            "--max-minutes",
            type=float,
            default=None,
            help="CP-SAT time limit in minutes.",
        )
        time_group.add_argument(
            "--max-hours",
            type=float,
            default=None,
            help="CP-SAT time limit in hours.",
        )
        parser.add_argument(
            "--solve-mode",
            choices=["best-effort", "optimal-required"],
            default="optimal-required",
            help=(
                "best-effort persists the best feasible solution; "
                "optimal-required persists only an exactly proven optimum."
            ),
        )
        parser.add_argument(
            "--max-relative-gap",
            type=float,
            default=0.0,
            help=(
                "Optional accepted relative gap for best-effort mode, e.g. "
                "0.01 for 1%%. Exact optimal-required mode must use 0."
            ),
        )
        parser.add_argument(
            "--persist-feasible-on-timeout",
            action="store_true",
            help=(
                "In optimal-required mode, persist the FEASIBLE preview even "
                "though exact optimality was not proven. Disabled by default."
            ),
        )
        parser.add_argument(
            "--log-search-progress",
            action="store_true",
            help="Print verbose CP-SAT search progress for diagnostics.",
        )
        parser.add_argument(
            "--report-only",
            action="store_true",
            help="Print failures but return exit code 0. By default, failed expectations raise CommandError.",
        )

    def handle(self, *args, **options):
        case_name = options["case_name"]
        report_only = options["report_only"]
        solve_mode = options["solve_mode"]
        max_relative_gap = float(options["max_relative_gap"] or 0.0)
        persist_feasible_on_timeout = options["persist_feasible_on_timeout"]
        log_search_progress = options["log_search_progress"]

        if options["max_seconds"] is not None:
            max_seconds = float(options["max_seconds"])
        elif options["max_minutes"] is not None:
            max_seconds = float(options["max_minutes"]) * 60.0
        elif options["max_hours"] is not None:
            max_seconds = float(options["max_hours"]) * 3600.0
        else:
            max_seconds = 500.0

        if max_seconds <= 0:
            raise CommandError("The selected solver time must be greater than zero.")

        if max_relative_gap < 0:
            raise CommandError("--max-relative-gap cannot be negative.")

        if solve_mode == "optimal-required" and max_relative_gap > 0:
            raise CommandError(
                "--max-relative-gap must be 0 in optimal-required mode. "
                "Use best-effort mode for a gap-accepted run."
            )

        self.print_active_database()
        self.ensure_local_test_database()

        base_dir = Path(settings.BASE_DIR)
        tests_dir = base_dir / "canada_algorithm_tests"
        case_dir = tests_dir / case_name

        self.stdout.write("=" * 78)
        self.stdout.write(f"Running allocation test case: {case_name}")
        self.stdout.write(f"Case path: {case_dir}")
        self.stdout.write(f"Solver time limit for this run: {max_seconds:g} seconds")
        self.stdout.write(f"Solve mode: {solve_mode}")
        self.stdout.write(f"Maximum relative gap: {max_relative_gap:.6%}")
        self.stdout.write(
            "Persist FEASIBLE on timeout: "
            f"{'YES' if persist_feasible_on_timeout else 'NO'}"
        )
        self.stdout.write("=" * 78)

        if not case_dir.exists():
            raise CommandError(f"Case folder does not exist: {case_dir}")

        required_files = [
            "students.csv",
            "apartments.csv",
            "rooms.csv",
            "expected_result.md",
        ]
        for file_name in required_files:
            file_path = case_dir / file_name
            if file_path.exists():
                self.stdout.write(self.style.SUCCESS(f"FOUND: {file_name}"))
            else:
                raise CommandError(f"Missing required file: {file_name}")

        students_rows = self.read_csv(case_dir / "students.csv")
        apartments_rows = self.read_csv(case_dir / "apartments.csv")
        rooms_rows = self.read_csv(case_dir / "rooms.csv")
        case_config = self.load_case_config(case_dir)
        constraints_config = case_config["constraints_config"]
        expected_metrics = case_config.get("expected_metrics", {})
        allocation_expectations = case_config.get("allocation_expectations", {})

        self.stdout.write(self.style.SUCCESS("Case structure is valid."))
        self.stdout.write("")
        self.stdout.write("=" * 78)
        self.stdout.write("CSV and expectation data loaded")
        self.stdout.write("=" * 78)
        self.stdout.write(f"Students rows: {len(students_rows)}")
        self.stdout.write(f"Apartments rows: {len(apartments_rows)}")
        self.stdout.write(f"Rooms rows: {len(rooms_rows)}")
        self.stdout.write(
            f"Machine-readable allocation expectations: "
            f"{'YES' if allocation_expectations else 'NO (generic hard checks only)'}"
        )

        self.clear_test_data()

        housing_objects = self.load_housing_data(
            apartments_rows=apartments_rows,
            rooms_rows=rooms_rows,
        )
        self.load_students_data(
            students_rows=students_rows,
            dorm_type=housing_objects["dorm_type"],
        )

        self.stdout.write("")
        self.stdout.write("=" * 78)
        self.stdout.write("Data loaded into LOCAL test DB")
        self.stdout.write("=" * 78)
        self.stdout.write(f"Region: {housing_objects['region'].id}")
        self.stdout.write(f"DormType: {housing_objects['dorm_type'].name}")
        self.stdout.write(f"Building: {housing_objects['building'].number}")
        self.stdout.write(f"Apartments created: {Apartment.objects.count()}")
        self.stdout.write(f"Rooms created: {Room.objects.count()}")
        self.stdout.write(f"Beds created: {Bed.objects.count()}")
        self.stdout.write(f"Students created: {Student.objects.count()}")
        self.stdout.write(
            "Active assignments before algorithm: "
            f"{BedAssignment.objects.filter(status=BedAssignment.Status.ACTIVE).count()}"
        )

        with self.temporary_solver_fixture_attributes(
            students_rows=students_rows,
            apartments_rows=apartments_rows,
        ):
            results = self.run_algorithm(
                constraints_config=constraints_config,
                max_seconds=max_seconds,
                solve_mode=solve_mode,
                max_relative_gap=max_relative_gap,
                persist_feasible_on_timeout=persist_feasible_on_timeout,
                log_search_progress=log_search_progress,
            )

        self.print_solver_summary(results)

        report = self.evaluate_allocation(
            case_name=case_name,
            results=results,
            expected_metrics=expected_metrics,
            allocation_expectations=allocation_expectations,
            constraints_config=constraints_config,
            students_rows=students_rows,
            apartments_rows=apartments_rows,
            rooms_rows=rooms_rows,
        )

        self.print_expected_vs_actual(report)

        self.print_allocation_by_apartment_with_constraints(
            report=report,
            students_rows=students_rows,
        )

        self.print_final_verdict(report)

        if report["failures"] and not report_only:
            raise CommandError(
                f"CASE FAILED: {len(report['failures'])} expectation(s) failed. "
                "See EXPECTED VS ACTUAL above."
            )

    # ------------------------------------------------------------------
    # Safety and input
    # ------------------------------------------------------------------

    def print_active_database(self):
        self.stdout.write("=" * 78)
        self.stdout.write("Active database")
        self.stdout.write("=" * 78)
        self.stdout.write(f"DB NAME: {connection.settings_dict.get('NAME')}")
        self.stdout.write(f"DB USER: {connection.settings_dict.get('USER')}")
        self.stdout.write(f"DB HOST: {connection.settings_dict.get('HOST')}")
        self.stdout.write(f"DB PORT: {connection.settings_dict.get('PORT')}")
        self.stdout.write(f"DB OPTIONS: {connection.settings_dict.get('OPTIONS')}")
        self.stdout.write("")

    def ensure_local_test_database(self):
        db_name = str(connection.settings_dict.get("NAME") or "")
        db_host = str(connection.settings_dict.get("HOST") or "")
        db_port = str(connection.settings_dict.get("PORT") or "")

        is_local = db_host in {"localhost", "127.0.0.1"}
        is_test_db = db_name == "dormify_test"
        is_test_port = db_port == "5433"

        if not (is_local and is_test_db and is_test_port):
            raise CommandError(
                "Safety stop: this command must run only on the local test DB.\n"
                f"Current DB_NAME={db_name}, DB_HOST={db_host}, DB_PORT={db_port}\n"
                "Expected DB_NAME=dormify_test, DB_HOST=localhost, DB_PORT=5433"
            )

    def read_csv(self, file_path):
        try:
            with open(file_path, mode="r", encoding="utf-8-sig", newline="") as file:
                return list(csv.DictReader(file))
        except Exception as exc:
            raise CommandError(f"Failed to read CSV file {file_path}: {exc}") from exc

    def load_case_config(self, case_dir):
        json_files = sorted(case_dir.glob("*.json"))
        if not json_files:
            raise CommandError(f"No JSON case configuration found in {case_dir}")

        json_path = json_files[0]
        try:
            with open(json_path, mode="r", encoding="utf-8-sig") as file:
                data = json.load(file)
        except Exception as exc:
            raise CommandError(f"Failed to read JSON config {json_path}: {exc}") from exc

        constraints = data.get("constraints_config") or data.get("constraints")
        if not isinstance(constraints, dict):
            raise CommandError(
                f"JSON file {json_path.name} has no constraints_config/constraints object."
            )

        data["constraints_config"] = constraints
        self.stdout.write(f"Using case configuration from: {json_path.name}")
        return data

    def parse_bool(self, value):
        return str(value).strip().lower() in {"true", "1", "yes", "כן"}

    def parse_int(self, value, default=0):
        try:
            if value is None or str(value).strip() == "":
                return default
            return int(float(str(value).strip()))
        except (TypeError, ValueError):
            return default

    def parse_decimal(self, value, default="0"):
        try:
            if value is None or str(value).strip() == "":
                return Decimal(default)
            return Decimal(str(value).strip())
        except Exception:
            return Decimal(default)

    def has_model_field(self, model, field_name):
        try:
            model._meta.get_field(field_name)
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Fixture loading
    # ------------------------------------------------------------------

    def clear_test_data(self):
        self.stdout.write("")
        self.stdout.write("=" * 78)
        self.stdout.write("Clearing local test DB data")
        self.stdout.write("=" * 78)

        BedAssignment.objects.all().delete()
        Student.objects.all().delete()
        Bed.objects.all().delete()
        Room.objects.all().delete()
        Apartment.objects.all().delete()
        Building.objects.all().delete()
        DormType.objects.all().delete()
        Region.objects.all().delete()

        self.stdout.write(self.style.SUCCESS("Local test DB cleaned."))

    def load_housing_data(self, apartments_rows, rooms_rows):
        self.stdout.write("")
        self.stdout.write("=" * 78)
        self.stdout.write("Loading housing data into LOCAL test DB")
        self.stdout.write("=" * 78)

        region = Region.objects.create(
            id="canada_test",
            name="Canada Test Region",
        )
        dorm_type = DormType.objects.create(
            code=999,
            name="Canada Test Dorm",
            region=region,
        )
        building = Building.objects.create(
            number=999,
            dorm_type=dorm_type,
            is_active=True,
        )

        rooms_by_apartment_code = defaultdict(list)
        for room_row in rooms_rows:
            apartment_code = room_row.get("apartment_code", "").strip()
            if apartment_code:
                rooms_by_apartment_code[apartment_code].append(room_row)

        apartment_by_code = {}
        for apartment_row in apartments_rows:
            apartment_code = apartment_row.get("apartment_code", "").strip()
            if not apartment_code:
                raise CommandError("apartment_code is missing in apartments.csv")

            apartment_rooms = rooms_by_apartment_code.get(apartment_code, [])
            apartment_capacity = sum(
                self.parse_int(room.get("capacity"), 0)
                for room in apartment_rooms
            )
            category = apartment_row.get("category", "female").strip() or "female"
            if category not in {"male", "female"}:
                raise CommandError(
                    f"Invalid apartment category {category!r} for {apartment_code}."
                )

            inactive_reason = apartment_row.get("inactive_reason", "").strip()
            if self.parse_bool(apartment_row.get("is_reserved", "False")):
                inactive_reason = "reserved"

            apartment_kwargs = {
                "building": building,
                "number": apartment_code,
                "category": category,
                "apartment_type": Apartment.ApartmentType.SINGLE,
                "room_count": len(apartment_rooms),
                "apartment_capacity": apartment_capacity,
                "is_active": self.parse_bool(apartment_row.get("is_active", "True")),
                "inactive_reason": inactive_reason,
            }
            if self.has_model_field(Apartment, "is_accessible"):
                apartment_kwargs["is_accessible"] = self.parse_bool(
                    apartment_row.get("is_accessible", "False")
                )
            if self.has_model_field(Apartment, "is_reserved"):
                apartment_kwargs["is_reserved"] = self.parse_bool(
                    apartment_row.get("is_reserved", "False")
                )

            apartment_by_code[apartment_code] = Apartment.objects.create(
                **apartment_kwargs
            )

        rooms_created = 0
        beds_created = 0
        for room_row in rooms_rows:
            room_code = room_row.get("room_code", "").strip()
            apartment_code = room_row.get("apartment_code", "").strip()
            if not room_code:
                raise CommandError("room_code is missing in rooms.csv")

            apartment = apartment_by_code.get(apartment_code)
            if apartment is None:
                raise CommandError(
                    f"Room {room_code} references unknown apartment_code {apartment_code!r}."
                )

            capacity = self.parse_int(room_row.get("capacity"), 1)
            room = Room.objects.create(
                apartment=apartment,
                name=room_code,
                capacity=capacity,
                is_active=self.parse_bool(room_row.get("is_active", "True")),
            )
            rooms_created += 1

            base_label = room_row.get("bed_label", "").strip() or "Bed"
            for index in range(capacity):
                label = base_label if capacity == 1 else f"{base_label}-{index + 1}"
                Bed.objects.create(room=room, label=label[:20])
                beds_created += 1

        self.stdout.write(self.style.SUCCESS(f"Apartments loaded: {len(apartment_by_code)}"))
        self.stdout.write(self.style.SUCCESS(f"Rooms loaded: {rooms_created}"))
        self.stdout.write(self.style.SUCCESS(f"Beds loaded: {beds_created}"))

        return {
            "region": region,
            "dorm_type": dorm_type,
            "building": building,
        }

    def load_students_data(self, students_rows, dorm_type):
        self.stdout.write("")
        self.stdout.write("=" * 78)
        self.stdout.write("Loading students into LOCAL test DB")
        self.stdout.write("=" * 78)

        created_count = 0
        for row in students_rows:
            student_id = row.get("student_id", "").strip()
            if not student_id:
                raise CommandError("student_id is missing in students.csv")

            gender = row.get("gender", "").strip() or Student.Gender.FEMALE
            if gender not in {"male", "female"}:
                raise CommandError(
                    f"Invalid gender {gender!r} for student {student_id}."
                )

            placement_sector = (
                row.get("placement_sector", "").strip()
                or Student.PlacementSector.UNKNOWN
            )
            if placement_sector not in {"jewish", "arab", "other", "unknown"}:
                placement_sector = Student.PlacementSector.UNKNOWN

            raw_religion = (
                row.get("requested_religion", "").strip()
                or row.get("religion", "").strip()
            )
            religion_map = {
                "muslim": Student.Religion.Muslim,
                "muslims": Student.Religion.Muslim,
                "jewish": Student.Religion.Jewish,
                "christian": Student.Religion.Christian,
                "druze": Student.Religion.Druze,
                "not_specified": Student.Religion.NOT_SPECIFIED,
                "": Student.Religion.NOT_SPECIFIED,
            }
            requested_religion = religion_map.get(
                raw_religion.lower(), Student.Religion.NOT_SPECIFIED
            )

            raw_religious = (
                row.get("religious_for_placement", "").strip()
                or row.get("religious_preference", "").strip()
            )
            religious_map = {
                "religious": Student.Religious.RELIGIOUS,
                "not_religious": "not_religious",
                "christian_religious": "christian_religious",
                "no_preference": Student.Religious.NO_PREFERENCE,
                "not_specified": Student.Religious.NOT_SPECIFIED,
                "לא משנה": Student.Religious.NO_PREFERENCE,
                "לא צוין": Student.Religious.NOT_SPECIFIED,
                "": Student.Religious.NOT_SPECIFIED,
            }
            # The model choices may not list synthetic test values such as
            # not_religious/christian_religious, but CharField still stores them.
            religious = religious_map.get(raw_religious.lower(), raw_religious)

            student_kwargs = {
                "student_id": student_id,
                "first_name": row.get("first_name", "").strip(),
                "last_name": row.get("last_name", "").strip(),
                "gender": gender,
                "housing_type": (
                    Student.HousingType.SINGLE_FEMALE
                    if gender == Student.Gender.FEMALE
                    else Student.HousingType.SINGLE_MALE
                ),
                "is_priority": self.parse_bool(row.get("is_priority", "False")),
                "priority_reason": row.get("priority_reason", "").strip(),
                "placement_sector": placement_sector,
                "requested_religion": requested_religion,
                "religious": religious or Student.Religious.NOT_SPECIFIED,
                "study_points": self.parse_decimal(
                    row.get("academic_points_total", "0")
                ),
                "special_status_1": row.get("special_status_1", "").strip(),
                "special_status_2": row.get("special_status_2", "").strip(),
                "special_status_3": row.get("special_status_3", "").strip(),
                "special_status_4": row.get("special_status_4", "").strip(),
                "category": Student.StudentCategory.NEW,
                "accepted_dorm_type": dorm_type,
            }

            for index in range(1, 6):
                student_kwargs[f"roommate_request_student_id_{index}"] = (
                    row.get(f"roommate_request_student_id_{index}", "").strip()
                )
                student_kwargs[f"roommate_request_flag_{index}"] = self.parse_bool(
                    row.get(f"roommate_request_flag_{index}", "False")
                )

            if self.has_model_field(Student, "needs_accessibility"):
                student_kwargs["needs_accessibility"] = self.parse_bool(
                    row.get("needs_accessibility", "False")
                )

            Student.objects.create(**student_kwargs)
            created_count += 1

        self.stdout.write(self.style.SUCCESS(f"Students loaded: {created_count}"))

    @contextmanager
    def temporary_solver_fixture_attributes(self, students_rows, apartments_rows):
        """
        Expose fixture-only accessibility/reservation values to the solver when
        those fields are not yet persisted in the active Django schema.
        """
        patches = []

        reserved_by_apartment_number = {
            row["apartment_code"].strip(): self.parse_bool(
                row.get("is_reserved", "False")
            )
            for row in apartments_rows
        }

        if not self.has_model_field(Apartment, "is_reserved"):
            old = Apartment.__dict__.get("is_reserved")
            Apartment.is_reserved = property(
                lambda obj: reserved_by_apartment_number.get(obj.number, False)
            )
            patches.append((Apartment, "is_reserved", old))

        try:
            yield
        finally:
            for model, field_name, old in reversed(patches):
                if old is None:
                    delattr(model, field_name)
                else:
                    setattr(model, field_name, old)

    # ------------------------------------------------------------------
    # Solver run
    # ------------------------------------------------------------------

    def run_algorithm(
        self,
        constraints_config,
        max_seconds,
        solve_mode,
        max_relative_gap,
        persist_feasible_on_timeout,
        log_search_progress,
    ):
        self.stdout.write("")
        self.stdout.write("=" * 78)
        self.stdout.write("Running allocation algorithm")
        self.stdout.write("=" * 78)

        students_qs = Student.objects.all().order_by("student_id")
        rooms_qs = Room.objects.all().order_by("name")

        self.stdout.write(f"Students sent to solver: {students_qs.count()}")
        self.stdout.write(f"Rooms sent to solver: {rooms_qs.count()}")
        self.stdout.write(f"Beds before solver: {Bed.objects.count()}")

        results = allocation_solver.run_improved_ortools_allocation(
            students=students_qs,
            rooms=rooms_qs,
            constraints_config=constraints_config,
            max_seconds=max_seconds,
            solve_mode=solve_mode,
            max_relative_gap=max_relative_gap,
            persist_feasible_on_timeout=persist_feasible_on_timeout,
            log_search_progress=log_search_progress,
        )

        self.stdout.write("")
        self.stdout.write("=" * 78)
        self.stdout.write("Algorithm results")
        self.stdout.write("=" * 78)
        for key, value in results.items():
            if key == "proposed_assignments":
                self.stdout.write(f"proposed_assignments: {len(value)} assignment(s)")
            else:
                self.stdout.write(f"{key}: {value}")

        return results

    def print_solver_summary(self, results):
        self.stdout.write("")
        self.stdout.write("=" * 78)
        self.stdout.write("SOLVER OPTIMALITY SUMMARY")
        self.stdout.write("=" * 78)

        objective = results.get("objective_value")
        bound = results.get("best_objective_bound")
        absolute_gap = results.get("absolute_gap")
        relative_gap = results.get("relative_gap")

        self.stdout.write(f"Solver status: {results.get('solver_status')}")
        self.stdout.write(
            "Optimality proven: "
            f"{'YES' if results.get('optimality_proven') else 'NO'}"
        )
        self.stdout.write(f"Objective value: {objective}")
        self.stdout.write(f"Best objective bound: {bound}")
        self.stdout.write(f"Absolute gap: {absolute_gap}")
        self.stdout.write(
            "Relative gap: "
            f"{relative_gap:.6%}" if relative_gap is not None else "Relative gap: N/A"
        )
        self.stdout.write(f"Wall time: {results.get('wall_time')} seconds")
        self.stdout.write(
            "Solution persisted: "
            f"{'YES' if results.get('solution_persisted') else 'NO'}"
        )

        if results.get("stopped_by_time_limit"):
            self.stdout.write(
                self.style.WARNING(
                    "The selected time limit was reached before exact optimality was proven."
                )
            )

    # ------------------------------------------------------------------
    # Evaluation
    # ------------------------------------------------------------------

    def is_constraint_hard(self, config, key):
        item = config.get(key, {})
        return bool(item.get("critical")) or (
            bool(item.get("enabled")) and bool(item.get("strict"))
        )

    def normalize_strict_preference(self, row):
        value = (
            row.get("religious_for_placement", "").strip()
            or row.get("religious_preference", "").strip()
        ).lower()
        value = " ".join(value.replace("_", " ").split())

        if value in {
            "",
            "לא משנה",
            "ללא העדפה",
            "אין העדפה",
            "no preference",
            "not specified",
            "לא צוין",
            "unknown",
            "לא ידוע",
            "none",
        }:
            return ""

        canonical = {
            "דתי": "religious",
            "דתית": "religious",
            "דתי/ה": "religious",
            "religious": "religious",
            "חרדי": "haredi",
            "חרדית": "haredi",
            "haredi": "haredi",
            "orthodox": "haredi",
            "מסורתי": "traditional",
            "מסורתית": "traditional",
            "traditional": "traditional",
            "חילוני": "secular",
            "חילונית": "secular",
            "secular": "secular",
        }
        return canonical.get(value, value)

    def normalize_religion(self, row):
        value = (
            row.get("requested_religion", "").strip()
            or row.get("religion", "").strip()
        ).lower()

        if value in {
            "",
            "not_specified",
            "not specified",
            "לא צוין",
            "unknown",
            "לא ידוע",
        }:
            return ""

        religion_map = {
            "יהודי": "jewish",
            "jewish": "jewish",
            "מוסלמי": "muslim",
            "muslims": "muslim",
            "muslim": "muslim",
            "נוצרי": "christian",
            "christian": "christian",
            "דרוזי": "druze",
            "druze": "druze",
        }
        return religion_map.get(value, value)

    def religious_restriction_state(self, row):
        """
        Mirror allocation.solver._student_religious_state:

        - Only the normalized value "religious" creates a hard restriction.
        - Religious Jewish students may share only with Jewish+religious students.
        - Religious non-Jewish students may share only with students of the
          same religion, regardless of the roommates' observance level.
        - Students without a religious request impose no hard religion restriction.
        """
        if self.normalize_strict_preference(row) != "religious":
            return None

        religion = self.normalize_religion(row)
        if religion == "jewish":
            return ("rj",)

        return ("religion", religion) if religion else None

    def collect_roommate_requests(self, students_rows):
        request_map = defaultdict(dict)
        for row in students_rows:
            source = row["student_id"].strip()
            for index in range(1, 6):
                target = row.get(
                    f"roommate_request_student_id_{index}", ""
                ).strip()
                if not target:
                    continue
                request_map[source][target] = self.parse_bool(
                    row.get(f"roommate_request_flag_{index}", "False")
                )
        return request_map

    def add_check(self, report, name, expected, actual, passed, details=""):
        item = {
            "name": name,
            "expected": expected,
            "actual": actual,
            "passed": bool(passed),
            "details": details,
        }
        report["checks"].append(item)
        if not passed:
            report["failures"].append(item)

    def evaluate_allocation(
        self,
        case_name,
        results,
        expected_metrics,
        allocation_expectations,
        constraints_config,
        students_rows,
        apartments_rows,
        rooms_rows,
    ):
        report = {
            "case_name": case_name,
            "checks": [],
            "failures": [],
            "assignments": [],
            "assignment_by_student": {},
            "students_by_apartment": defaultdict(list),
            "unassigned_students": [],
        }

        student_rows_by_id = {
            row["student_id"].strip(): row for row in students_rows
        }
        apartment_rows_by_code = {
            row["apartment_code"].strip(): row for row in apartments_rows
        }
        room_rows_by_code = {
            row["room_code"].strip(): row for row in rooms_rows
        }

        persisted_assignment_objects = list(
            BedAssignment.objects.filter(status=BedAssignment.Status.ACTIVE)
            .select_related("student", "bed", "bed__room", "bed__room__apartment")
            .order_by("student__student_id")
        )

        persisted_records = []
        for assignment in persisted_assignment_objects:
            persisted_records.append({
                "student_db_id": assignment.student_id,
                "student_id": assignment.student.student_id,
                "student_name": assignment.student.full_name,
                "apartment_id": assignment.bed.room.apartment_id,
                "apartment_code": assignment.bed.room.apartment.number,
                "room_id": assignment.bed.room_id,
                "room_code": assignment.bed.room.name,
                "bed_id": assignment.bed_id,
                "bed_label": assignment.bed.label,
            })

        if results.get("solution_persisted"):
            assignment_records = persisted_records
            report["assignment_source"] = "persisted database allocation"
        else:
            assignment_records = list(results.get("proposed_assignments") or [])
            report["assignment_source"] = "non-persisted solver preview"

        for item in assignment_records:
            student_id = item["student_id"]
            apartment_code = item["apartment_code"]
            report["assignments"].append(item)
            report["assignment_by_student"][student_id] = item
            report["students_by_apartment"][apartment_code].append(student_id)

        all_student_ids = set(student_rows_by_id)
        assigned_student_ids = set(report["assignment_by_student"])
        report["unassigned_students"] = sorted(all_student_ids - assigned_student_ids)

        # Expected solver metrics.
        allowed_status = expected_metrics.get("allowed_solver_status")
        if allowed_status:
            actual_status = results.get("solver_status")
            self.add_check(
                report,
                "Solver status",
                " / ".join(allowed_status),
                actual_status,
                actual_status in allowed_status,
            )

        require_optimal = bool(expected_metrics.get("require_optimal", False)) or (
            results.get("solve_mode") == "optimal-required"
            and results.get("solver_status") in {"OPTIMAL", "FEASIBLE"}
        )
        if require_optimal:
            self.add_check(
                report,
                "Exact optimality proven",
                "YES",
                "YES" if results.get("optimality_proven") else "NO",
                bool(results.get("optimality_proven")),
                (
                    f"status={results.get('solver_status')}, "
                    f"objective={results.get('objective_value')}, "
                    f"bound={results.get('best_objective_bound')}, "
                    f"relative_gap={results.get('relative_gap')}"
                ),
            )

        if "expected_objective_value" in expected_metrics:
            expected_objective = float(expected_metrics["expected_objective_value"])
            actual_objective = results.get("objective_value")
            objective_matches = (
                actual_objective is not None
                and abs(float(actual_objective) - expected_objective) <= 1e-9
            )
            self.add_check(
                report,
                "Expected objective value",
                expected_objective,
                actual_objective,
                objective_matches,
            )

        if "maximum_relative_gap" in expected_metrics:
            maximum_gap = float(expected_metrics["maximum_relative_gap"])
            actual_gap = results.get("relative_gap")
            gap_passed = (
                actual_gap is not None
                and float(actual_gap) <= maximum_gap + 1e-12
            )
            self.add_check(
                report,
                "Maximum relative optimality gap",
                maximum_gap,
                actual_gap,
                gap_passed,
            )

        for key, label in (
            ("successful_assignments", "Successful assignments"),
            ("conflicts", "Conflicts"),
        ):
            if key in expected_metrics:
                actual = results.get(key)
                expected = expected_metrics[key]
                self.add_check(report, label, expected, actual, actual == expected)

        # Result counters must agree with the persisted allocation or preview.
        if results.get("solution_persisted"):
            self.add_check(
                report,
                "Persisted assignments match solver result",
                results.get("successful_assignments"),
                len(persisted_records),
                len(persisted_records) == results.get("successful_assignments"),
            )
        else:
            self.add_check(
                report,
                "Feasible solution kept as preview",
                "not persisted",
                report["assignment_source"],
                not persisted_records,
                (
                    f"Unexpected active DB assignments: {len(persisted_records)}"
                    if persisted_records else ""
                ),
            )

        self.add_check(
            report,
            "Solver conflicts match actual unassigned count",
            results.get("conflicts"),
            len(report["unassigned_students"]),
            len(report["unassigned_students"]) == results.get("conflicts"),
        )

        # Core allocation invariants, applied to persisted data or solver preview.
        student_counts = Counter(a["student_id"] for a in assignment_records)
        bed_counts = Counter(a["bed_id"] for a in assignment_records)
        duplicate_students = sorted(
            student_id for student_id, count in student_counts.items() if count > 1
        )
        duplicate_beds = sorted(
            bed_id for bed_id, count in bed_counts.items() if count > 1
        )
        self.add_check(
            report,
            "No student assigned more than once",
            0,
            len(duplicate_students),
            not duplicate_students,
            f"Duplicate students: {duplicate_students}" if duplicate_students else "",
        )
        self.add_check(
            report,
            "No bed assigned more than once",
            0,
            len(duplicate_beds),
            not duplicate_beds,
            f"Duplicate bed IDs: {duplicate_beds}" if duplicate_beds else "",
        )

        if results.get("solution_persisted"):
            assigned_room_mismatches = [
                a.student.student_id
                for a in persisted_assignment_objects
                if a.student.assigned_room_id != a.bed.room_id
            ]
            self.add_check(
                report,
                "Student.assigned_room agrees with active bed assignment",
                0,
                len(assigned_room_mismatches),
                not assigned_room_mismatches,
                f"Students: {assigned_room_mismatches}" if assigned_room_mismatches else "",
            )

        assignments_by_room = Counter(a["room_code"] for a in assignment_records)
        capacity_violations = []
        for room_code, used in assignments_by_room.items():
            configured_capacity = self.parse_int(
                room_rows_by_code[room_code].get("capacity"), 0
            )
            if used > configured_capacity:
                capacity_violations.append(
                    f"{room_code}: used={used}, capacity={configured_capacity}"
                )
        self.add_check(
            report,
            "Room capacity respected",
            0,
            len(capacity_violations),
            not capacity_violations,
            "; ".join(capacity_violations),
        )

        inactive_room_usage = sorted(
            {
                a["room_code"]
                for a in assignment_records
                if not self.parse_bool(
                    room_rows_by_code[a["room_code"]].get("is_active", "True")
                )
            }
        )
        self.add_check(
            report,
            "Inactive rooms are not used",
            0,
            len(inactive_room_usage),
            not inactive_room_usage,
            f"Rooms: {inactive_room_usage}" if inactive_room_usage else "",
        )

        inactive_apartment_usage = sorted(
            {
                a["apartment_code"]
                for a in assignment_records
                if not self.parse_bool(
                    apartment_rows_by_code[a["apartment_code"]].get(
                        "is_active", "True"
                    )
                )
            }
        )
        self.add_check(
            report,
            "Inactive apartments are not used",
            0,
            len(inactive_apartment_usage),
            not inactive_apartment_usage,
            f"Apartments: {inactive_apartment_usage}"
            if inactive_apartment_usage
            else "",
        )

        gender_violations = []
        reserved_violations = []
        for item in report["assignments"]:
            student_row = student_rows_by_id[item["student_id"]]
            apartment_row = apartment_rows_by_code[item["apartment_code"]]

            apartment_category = apartment_row.get("category", "").strip()
            student_gender = student_row.get("gender", "").strip()
            if apartment_category in {"male", "female"} and (
                apartment_category != student_gender
            ):
                gender_violations.append(
                    f"{item['student_id']}({student_gender}) -> "
                    f"{item['apartment_code']}({apartment_category})"
                )

            is_reserved = self.parse_bool(
                apartment_row.get("is_reserved", "False")
            ) or apartment_row.get("inactive_reason", "").strip() == "reserved"
            if is_reserved and not self.parse_bool(
                student_row.get("is_priority", "False")
            ):
                reserved_violations.append(
                    f"{item['student_id']} -> {item['apartment_code']}"
                )

        self.add_check(
            report,
            "Gender hard rule respected",
            0,
            len(gender_violations),
            not gender_violations,
            "; ".join(gender_violations),
        )
        self.add_check(
            report,
            "Reserved apartments contain priority students only",
            0,
            len(reserved_violations),
            not reserved_violations,
            "; ".join(reserved_violations),
        )

        # Hard priority expectation, when the solver returned a solution.
        if (
            self.is_constraint_hard(constraints_config, "priorityFirst")
            and results.get("solver_status") in {"OPTIMAL", "FEASIBLE"}
        ):
            priority_ids = sorted(
                row["student_id"].strip()
                for row in students_rows
                if self.parse_bool(row.get("is_priority", "False"))
            )
            missing_priority = sorted(set(priority_ids) - assigned_student_ids)
            self.add_check(
                report,
                "Hard-priority students are assigned",
                priority_ids,
                sorted(set(priority_ids) & assigned_student_ids),
                not missing_priority,
                f"Unassigned priority students: {missing_priority}"
                if missing_priority
                else "",
            )

        # Hard ReligiousTogether expectation.
        # This validator mirrors the solver's exact hard-rule semantics:
        # only students marked "religious" impose a restriction.
        if self.is_constraint_hard(constraints_config, "ReligiousTogether"):
            religious_violations = []

            for apartment_code, student_ids in report["students_by_apartment"].items():
                rows = [student_rows_by_id[sid] for sid in student_ids]
                states = [self.religious_restriction_state(row) for row in rows]

                # Religious Jewish: every roommate must also be Jewish+religious.
                if any(state == ("rj",) for state in states):
                    invalid = [
                        row["student_id"]
                        for row in rows
                        if not (
                            self.normalize_religion(row) == "jewish"
                            and self.normalize_strict_preference(row) == "religious"
                        )
                    ]
                    if invalid:
                        religious_violations.append(
                            f"{apartment_code}: religious Jewish mixed with {invalid}"
                        )

                # Religious non-Jewish of religion R:
                # every roommate must have religion R, but need not be religious.
                restricted_religions = {
                    state[1]
                    for state in states
                    if state is not None and state[0] == "religion"
                }

                for religion in restricted_religions:
                    invalid = [
                        row["student_id"]
                        for row in rows
                        if self.normalize_religion(row) != religion
                    ]
                    if invalid:
                        religious_violations.append(
                            f"{apartment_code}: religious {religion} mixed with {invalid}"
                        )

            self.add_check(
                report,
                "Hard ReligiousTogether rule respected",
                0,
                len(religious_violations),
                not religious_violations,
                "; ".join(religious_violations),
            )

        # Hard roommatePositiveOnly expectation.
        request_map = self.collect_roommate_requests(students_rows)
        if self.is_constraint_hard(constraints_config, "roommatePositiveOnly"):
            roommate_hard_violations = []
            seen_pairs = set()
            for source, targets in request_map.items():
                for target, source_positive in targets.items():
                    pair = tuple(sorted((source, target)))
                    if pair in seen_pairs:
                        continue
                    seen_pairs.add(pair)
                    target_positive = request_map.get(target, {}).get(source, False)
                    mutual_request = source in request_map.get(target, {})
                    source_assignment = report["assignment_by_student"].get(source)
                    target_assignment = report["assignment_by_student"].get(target)

                    if source_positive and target_positive:
                        if bool(source_assignment) != bool(target_assignment):
                            roommate_hard_violations.append(
                                f"{source}/{target}: only one assigned"
                            )
                        elif source_assignment and (
                            source_assignment["apartment_code"]
                            != target_assignment["apartment_code"]
                        ):
                            roommate_hard_violations.append(
                                f"{source}/{target}: assigned to different apartments"
                            )
                    elif mutual_request and source_assignment and target_assignment:
                        if (
                            source_assignment["apartment_code"]
                            == target_assignment["apartment_code"]
                        ):
                            roommate_hard_violations.append(
                                f"{source}/{target}: non-mutual-positive pair together"
                            )

            self.add_check(
                report,
                "Hard roommatePositiveOnly rule respected",
                0,
                len(roommate_hard_violations),
                not roommate_hard_violations,
                "; ".join(roommate_hard_violations),
            )

        # Actual roommate-quality counts, independently recomputed.
        mutual_pairs = []
        mutual_together = []
        one_sided_pairs = []
        one_sided_together = []
        seen_pairs = set()
        for source, targets in request_map.items():
            for target in targets:
                pair = tuple(sorted((source, target)))
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                source_requests_target = target in request_map.get(source, {})
                target_requests_source = source in request_map.get(target, {})
                if source_requests_target and target_requests_source:
                    mutual_pairs.append(pair)
                    a1 = report["assignment_by_student"].get(source)
                    a2 = report["assignment_by_student"].get(target)
                    if a1 and a2 and a1["apartment_code"] == a2["apartment_code"]:
                        mutual_together.append(pair)
                else:
                    one_sided_pairs.append(pair)
                    a1 = report["assignment_by_student"].get(source)
                    a2 = report["assignment_by_student"].get(target)
                    if a1 and a2 and a1["apartment_code"] == a2["apartment_code"]:
                        one_sided_together.append(pair)

        report["roommate_quality"] = {
            "mutual_pairs": mutual_pairs,
            "mutual_together": mutual_together,
            "one_sided_pairs": one_sided_pairs,
            "one_sided_together": one_sided_together,
        }

        # Explicit machine-readable allocation expectations.
        self.evaluate_explicit_expectations(
            report=report,
            expectations=allocation_expectations,
            student_rows_by_id=student_rows_by_id,
            apartment_rows_by_code=apartment_rows_by_code,
            mutual_together=mutual_together,
            one_sided_together=one_sided_together,
        )

        return report

    def evaluate_explicit_expectations(
        self,
        report,
        expectations,
        student_rows_by_id,
        apartment_rows_by_code,
        mutual_together,
        one_sided_together,
    ):
        if not expectations:
            return

        assignment_map = report["assignment_by_student"]
        assigned_ids = set(assignment_map)
        unassigned_ids = set(report["unassigned_students"])

        must_assign = set(expectations.get("must_be_assigned", []))
        if must_assign:
            missing = sorted(must_assign - assigned_ids)
            self.add_check(
                report,
                "Required students are assigned",
                sorted(must_assign),
                sorted(must_assign & assigned_ids),
                not missing,
                f"Missing: {missing}" if missing else "",
            )

        must_unassign = set(expectations.get("must_be_unassigned", []))
        if must_unassign:
            incorrectly_assigned = sorted(must_unassign & assigned_ids)
            self.add_check(
                report,
                "Required students are unassigned",
                sorted(must_unassign),
                sorted(must_unassign & unassigned_ids),
                not incorrectly_assigned,
                f"Incorrectly assigned: {incorrectly_assigned}"
                if incorrectly_assigned
                else "",
            )

        if "unassigned_count" in expectations:
            expected = int(expectations["unassigned_count"])
            actual = len(unassigned_ids)
            self.add_check(
                report,
                "Expected unassigned-student count",
                expected,
                actual,
                actual == expected,
            )

        allowed_unassigned = set(expectations.get("unassigned_must_be_subset_of", []))
        if allowed_unassigned:
            disallowed = sorted(unassigned_ids - allowed_unassigned)
            self.add_check(
                report,
                "Unassigned students belong to allowed set",
                sorted(allowed_unassigned),
                sorted(unassigned_ids),
                not disallowed,
                f"Disallowed unassigned students: {disallowed}" if disallowed else "",
            )

        for index, group in enumerate(
            expectations.get("groups_must_share_apartment", []), start=1
        ):
            assignments = [assignment_map.get(student_id) for student_id in group]
            missing = [
                student_id
                for student_id, assignment in zip(group, assignments)
                if assignment is None
            ]
            apartment_codes = {
                assignment["apartment_code"]
                for assignment in assignments
                if assignment is not None
            }
            passed = not missing and len(apartment_codes) == 1
            self.add_check(
                report,
                f"Expected group {index} shares one apartment",
                group,
                sorted(apartment_codes) if apartment_codes else "unassigned",
                passed,
                f"Missing: {missing}" if missing else "",
            )

        for pair in expectations.get("must_share_apartment", []):
            left, right = pair
            a1 = assignment_map.get(left)
            a2 = assignment_map.get(right)
            passed = bool(
                a1
                and a2
                and a1["apartment_code"] == a2["apartment_code"]
            )
            actual = (
                f"{a1['apartment_code']} / {a2['apartment_code']}"
                if a1 and a2
                else "one or both unassigned"
            )
            self.add_check(
                report,
                f"{left} and {right} share an apartment",
                "same apartment",
                actual,
                passed,
            )

        for pair in expectations.get("must_not_share_apartment", []):
            left, right = pair
            a1 = assignment_map.get(left)
            a2 = assignment_map.get(right)
            passed = not (
                a1
                and a2
                and a1["apartment_code"] == a2["apartment_code"]
            )
            actual = (
                f"{a1['apartment_code']} / {a2['apartment_code']}"
                if a1 and a2
                else "one or both unassigned"
            )
            self.add_check(
                report,
                f"{left} and {right} do not share an apartment",
                "different apartments",
                actual,
                passed,
            )

        for student_id, allowed_apartments in expectations.get(
            "student_allowed_apartments", {}
        ).items():
            assignment = assignment_map.get(student_id)
            actual = assignment["apartment_code"] if assignment else "unassigned"
            self.add_check(
                report,
                f"{student_id} is in an allowed apartment",
                allowed_apartments,
                actual,
                bool(assignment and actual in allowed_apartments),
            )

        for student_id, allowed_rooms in expectations.get(
            "student_allowed_rooms", {}
        ).items():
            assignment = assignment_map.get(student_id)
            actual = assignment["room_code"] if assignment else "unassigned"
            self.add_check(
                report,
                f"{student_id} is in an allowed room",
                allowed_rooms,
                actual,
                bool(assignment and actual in allowed_rooms),
            )

        for apartment_code, allowed_students in expectations.get(
            "apartment_allowed_students", {}
        ).items():
            actual_students = set(report["students_by_apartment"].get(apartment_code, []))
            allowed_students = set(allowed_students)
            unexpected = sorted(actual_students - allowed_students)
            self.add_check(
                report,
                f"{apartment_code} contains allowed students only",
                sorted(allowed_students),
                sorted(actual_students),
                not unexpected,
                f"Unexpected: {unexpected}" if unexpected else "",
            )

        for apartment_code, expected_count in expectations.get(
            "apartment_assigned_count", {}
        ).items():
            actual_count = len(report["students_by_apartment"].get(apartment_code, []))
            self.add_check(
                report,
                f"{apartment_code} assigned-student count",
                int(expected_count),
                actual_count,
                actual_count == int(expected_count),
            )

        for rule in expectations.get("group_assignment_count", []):
            group = set(rule["students"])
            expected_assigned = int(rule.get("assigned", len(group)))
            expected_unassigned = int(rule.get("unassigned", len(group) - expected_assigned))
            actual_assigned_ids = sorted(group & assigned_ids)
            actual_unassigned_ids = sorted(group & unassigned_ids)
            passed = (
                len(actual_assigned_ids) == expected_assigned
                and len(actual_unassigned_ids) == expected_unassigned
            )
            self.add_check(
                report,
                rule.get("label", "Expected assignment count for student group"),
                f"assigned={expected_assigned}, unassigned={expected_unassigned}",
                f"assigned={actual_assigned_ids}, unassigned={actual_unassigned_ids}",
                passed,
            )

        minimum_mutual = expectations.get("minimum_mutual_roommate_matches")
        if minimum_mutual is not None:
            actual = len(mutual_together)
            self.add_check(
                report,
                "Minimum mutual roommate pairs together",
                f">= {minimum_mutual}",
                actual,
                actual >= int(minimum_mutual),
                f"Pairs together: {mutual_together}",
            )

        maximum_one_sided = expectations.get("maximum_one_sided_roommate_matches")
        if maximum_one_sided is not None:
            actual = len(one_sided_together)
            self.add_check(
                report,
                "Maximum one-sided roommate pairs together",
                f"<= {maximum_one_sided}",
                actual,
                actual <= int(maximum_one_sided),
                f"Pairs together: {one_sided_together}",
            )

        expected_access_count = expectations.get(
            "expected_accessibility_requirement_count"
        )
        if expected_access_count is not None:
            actual = sum(
                self.parse_bool(row.get("needs_accessibility", "False"))
                for row in student_rows_by_id.values()
            )
            self.add_check(
                report,
                "Accessibility requirements present in input",
                int(expected_access_count),
                actual,
                actual == int(expected_access_count),
            )

    # ------------------------------------------------------------------
    # Reporting
    # ------------------------------------------------------------------

    def format_cell(self, value, width):
        text = str(value)
        if len(text) > width:
            text = text[: width - 3] + "..."
        return text.ljust(width)

    def print_allocation_by_apartment_with_constraints(self, report, students_rows):
        self.stdout.write("")
        self.stdout.write("=" * 100)
        self.stdout.write("ALLOCATION BY APARTMENT WITH STUDENT CONSTRAINTS")
        self.stdout.write("=" * 100)

        student_rows_by_id = {
            row["student_id"].strip(): row
            for row in students_rows
        }

        apartments = defaultdict(list)

        for student_id, assignment in report["assignment_by_student"].items():
            apartments[assignment["apartment_code"]].append(
                (student_id, assignment)
            )

        for apartment_code in sorted(apartments):
            self.stdout.write("")
            self.stdout.write("=" * 100)
            self.stdout.write(f"APARTMENT {apartment_code}")
            self.stdout.write("=" * 100)

            header = (
                f"{'Student':<9}"
                f"{'Gender':<9}"
                f"{'Religion':<16}"
                f"{'Religious Req.':<17}"
                f"{'Priority':<10}"
                f"{'Roommates':<24}"
                f"{'Room':<15}"
            )

            self.stdout.write(header)
            self.stdout.write("-" * 100)

            for student_id, assignment in sorted(
                    apartments[apartment_code],
                    key=lambda x: (x[1]["room_code"], x[0])
            ):
                row = student_rows_by_id[student_id]

                gender = row.get("gender", "").strip() or "-"

                religion = (
                        row.get("requested_religion", "").strip()
                        or row.get("religion", "").strip()
                        or "-"
                )

                religious_request = (
                        row.get("religious_for_placement", "").strip()
                        or row.get("religious_preference", "").strip()
                        or "-"
                )

                priority = (
                    "YES"
                    if self.parse_bool(row.get("is_priority", "False"))
                    else "NO"
                )

                roommate_requests = []
                for index in range(1, 6):
                    roommate_id = row.get(
                        f"roommate_request_student_id_{index}",
                        ""
                    ).strip()

                    if roommate_id:
                        roommate_requests.append(roommate_id)

                roommate_text = (
                    ", ".join(roommate_requests)
                    if roommate_requests
                    else "-"
                )

                self.stdout.write(
                    f"{student_id:<9}"
                    f"{gender:<9}"
                    f"{religion:<16}"
                    f"{religious_request:<17}"
                    f"{priority:<10}"
                    f"{roommate_text:<24}"
                    f"{assignment['room_code']:<15}"
                )

        self.stdout.write("")
        self.stdout.write("=" * 100)
        self.stdout.write("UNASSIGNED STUDENTS")
        self.stdout.write("=" * 100)

        if report["unassigned_students"]:
            for student_id in report["unassigned_students"]:
                row = student_rows_by_id[student_id]

                religion = (
                        row.get("requested_religion", "").strip()
                        or row.get("religion", "").strip()
                        or "-"
                )

                religious_request = (
                        row.get("religious_for_placement", "").strip()
                        or "-"
                )

                self.stdout.write(
                    self.style.WARNING(
                        f"{student_id} | "
                        f"Gender={row.get('gender', '-')} | "
                        f"Religion={religion} | "
                        f"Religious={religious_request}"
                    )
                )
        else:
            self.stdout.write(
                self.style.SUCCESS("No unassigned students.")
            )





    def print_student_constraints_summary(self, report, students_rows):
        self.stdout.write("")
        self.stdout.write("=" * 150)
        self.stdout.write("STUDENT CONSTRAINTS AND ALLOCATION RESULT")
        self.stdout.write("=" * 150)

        header = (
            f"{'Student':<9}"
            f"{'Gender':<9}"
            f"{'Religion':<13}"
            f"{'Religious Req.':<17}"
            f"{'Priority':<10}"
            f"{'Sector':<11}"
            f"{'Roommate Requests':<28}"
            f"{'Status':<12}"
            f"{'Apartment':<12}"
            f"{'Room':<14}"
        )

        self.stdout.write(header)
        self.stdout.write("-" * 150)

        for row in sorted(
                students_rows,
                key=lambda value: value.get("student_id", "")
        ):
            student_id = row.get("student_id", "").strip()

            gender = row.get("gender", "").strip() or "-"

            religion = (
                    row.get("requested_religion", "").strip()
                    or row.get("religion", "").strip()
                    or "-"
            )

            religious_request = (
                    row.get("religious_for_placement", "").strip()
                    or row.get("religious_preference", "").strip()
                    or "-"
            )

            priority = (
                "YES"
                if self.parse_bool(row.get("is_priority", "False"))
                else "NO"
            )

            sector = row.get("placement_sector", "").strip() or "-"

            roommate_requests = []
            for index in range(1, 6):
                roommate_id = row.get(
                    f"roommate_request_student_id_{index}", ""
                ).strip()

                if roommate_id:
                    positive = self.parse_bool(
                        row.get(
                            f"roommate_request_flag_{index}",
                            "False"
                        )
                    )

                    roommate_requests.append(
                        f"{roommate_id}{'(+)' if positive else ''}"
                    )

            roommates_text = (
                ", ".join(roommate_requests)
                if roommate_requests
                else "-"
            )

            assignment = report["assignment_by_student"].get(student_id)

            if assignment:
                status = "ASSIGNED"
                apartment = assignment["apartment_code"]
                room = assignment["room_code"]
            else:
                status = "UNASSIGNED"
                apartment = "-"
                room = "-"

            line = (
                f"{student_id:<9}"
                f"{gender:<9}"
                f"{religion:<13}"
                f"{religious_request:<17}"
                f"{priority:<10}"
                f"{sector:<11}"
                f"{roommates_text[:27]:<28}"
                f"{status:<12}"
                f"{apartment:<12}"
                f"{room:<14}"
            )

            if assignment:
                self.stdout.write(line)
            else:
                self.stdout.write(self.style.WARNING(line))

    def print_expected_vs_actual(self, report):
        self.stdout.write("")
        self.stdout.write("=" * 118)
        self.stdout.write("EXPECTED VS ACTUAL ALLOCATION CHECKS")
        self.stdout.write("=" * 118)
        header = (
            f"{'Check':<48} {'Expected':<24} {'Actual':<24} {'Result':<8}"
        )
        self.stdout.write(header)
        self.stdout.write("-" * 118)

        for check in report["checks"]:
            status = "PASS" if check["passed"] else "FAIL"
            line = (
                f"{self.format_cell(check['name'], 48)} "
                f"{self.format_cell(check['expected'], 24)} "
                f"{self.format_cell(check['actual'], 24)} "
                f"{status:<8}"
            )
            if check["passed"]:
                self.stdout.write(self.style.SUCCESS(line))
            else:
                self.stdout.write(self.style.ERROR(line))
                if check["details"]:
                    self.stdout.write(self.style.ERROR(f"    {check['details']}"))

    def print_actual_allocation(self, report):
        self.stdout.write("")
        self.stdout.write("=" * 78)
        self.stdout.write("ACTUAL ALLOCATION BY APARTMENT AND ROOM")
        self.stdout.write(f"Source: {report.get('assignment_source', 'unknown')}")
        self.stdout.write("=" * 78)

        assignments_by_apartment = defaultdict(list)
        for item in report["assignments"]:
            assignments_by_apartment[item["apartment_code"]].append(item)

        for apartment_code in sorted(assignments_by_apartment):
            self.stdout.write(f"\n{apartment_code}")
            self.stdout.write("-" * len(apartment_code))
            for item in sorted(
                assignments_by_apartment[apartment_code],
                key=lambda value: (value["room_code"], value["student_id"]),
            ):
                self.stdout.write(
                    f"{item['student_id']:<5} | {item['student_name']:<24} | "
                    f"Room: {item['room_code']:<14} | Bed: {item['bed_label']}"
                )

        self.stdout.write("")
        self.stdout.write("=" * 78)
        self.stdout.write("UNASSIGNED STUDENTS")
        self.stdout.write("=" * 78)
        if report["unassigned_students"]:
            for student_id in report["unassigned_students"]:
                self.stdout.write(self.style.WARNING(student_id))
        else:
            self.stdout.write(self.style.SUCCESS("No unassigned students."))

    def print_final_verdict(self, report):
        self.stdout.write("")
        self.stdout.write("=" * 78)
        if report["failures"]:
            self.stdout.write(
                self.style.ERROR(
                    f"FINAL CASE RESULT: FAIL ({len(report['failures'])} failed checks)"
                )
            )
        else:
            self.stdout.write(self.style.SUCCESS("FINAL CASE RESULT: PASS"))
        self.stdout.write("=" * 78)