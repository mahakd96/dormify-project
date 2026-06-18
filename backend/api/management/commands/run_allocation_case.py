import csv
import json
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

from allocation.solver import run_improved_ortools_allocation


class Command(BaseCommand):
    help = "Run one allocation test case"

    def add_arguments(self, parser):
        parser.add_argument(
            "case_name",
            type=str,
            help="Name of the test case folder, for example: case_01_balanced_solvable",
        )

    def handle(self, *args, **options):
        case_name = options["case_name"]

        self.print_active_database()
        self.ensure_local_test_database()

        base_dir = Path(settings.BASE_DIR)
        tests_dir = base_dir / "canada_algorithm_tests"
        case_dir = tests_dir / case_name

        self.stdout.write("=" * 70)
        self.stdout.write(f"Running allocation test case: {case_name}")
        self.stdout.write(f"Case path: {case_dir}")
        self.stdout.write("=" * 70)

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

        self.stdout.write(self.style.SUCCESS("Case structure is valid."))
        self.stdout.write("")

        students_path = case_dir / "students.csv"
        apartments_path = case_dir / "apartments.csv"
        rooms_path = case_dir / "rooms.csv"

        students_rows = self.read_csv(students_path)
        apartments_rows = self.read_csv(apartments_path)
        rooms_rows = self.read_csv(rooms_path)

        constraints_config = self.load_constraints_config(case_dir)

        self.stdout.write("=" * 70)
        self.stdout.write("CSV files loaded successfully")
        self.stdout.write("=" * 70)
        self.stdout.write(f"Students rows: {len(students_rows)}")
        self.stdout.write(f"Apartments rows: {len(apartments_rows)}")
        self.stdout.write(f"Rooms rows: {len(rooms_rows)}")
        self.stdout.write("")

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
        self.stdout.write("=" * 70)
        self.stdout.write("Data loaded into LOCAL test DB")
        self.stdout.write("=" * 70)
        self.stdout.write(f"Region: {housing_objects['region'].id}")
        self.stdout.write(f"DormType: {housing_objects['dorm_type'].name}")
        self.stdout.write(f"Building: {housing_objects['building'].number}")
        self.stdout.write(f"Apartments created: {Apartment.objects.count()}")
        self.stdout.write(f"Rooms created: {Room.objects.count()}")
        self.stdout.write(f"Beds created: {Bed.objects.count()}")
        self.stdout.write(f"Students created: {Student.objects.count()}")
        self.stdout.write(
            f"Active assignments before algorithm: "
            f"{BedAssignment.objects.filter(status=BedAssignment.Status.ACTIVE).count()}"
        )
        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Case data loading step passed."))

        self.run_algorithm(constraints_config)

    def print_active_database(self):
        self.stdout.write("=" * 70)
        self.stdout.write("Active database")
        self.stdout.write("=" * 70)
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
                reader = csv.DictReader(file)
                return list(reader)
        except Exception as e:
            raise CommandError(f"Failed to read CSV file {file_path}: {e}")

    def load_constraints_config(self, case_dir):
        json_files = list(case_dir.glob("*.json"))

        default_config = {
            "priorityFirst": {
                "enabled": True,
                "strict": True,
                "critical": True,
                "weight": 10,
            },
            "roommateMatch": {
                "enabled": True,
                "strict": False,
                "critical": False,
                "weight": 8,
            },
            "roommatePositiveOnly": {
                "enabled": True,
                "strict": True,
                "critical": True,
                "weight": 10,
            },
            "sameReligion": {
                "enabled": True,
                "strict": False,
                "critical": False,
                "weight": 5,
            },
            "sectorMatching": {
                "enabled": True,
                "strict": False,
                "critical": False,
                "weight": 5,
            },
            "ReligiousTogether": {
                "enabled": True,
                "strict": False,
                "critical": False,
                "weight": 5,
            },
            "avoidYearMix_1_with_3_4": {
                "enabled": True,
                "strict": False,
                "critical": False,
                "weight": 6,
            },
            "avoidAtudaimWithHasmaha": {
                "enabled": True,
                "strict": False,
                "critical": False,
                "weight": 6,
            },
        }

        if not json_files:
            self.stdout.write(
                self.style.WARNING("No JSON config found. Using default constraints_config.")
            )
            return default_config

        json_path = json_files[0]

        try:
            with open(json_path, mode="r", encoding="utf-8-sig") as file:
                data = json.load(file)
        except Exception as e:
            raise CommandError(f"Failed to read JSON config {json_path}: {e}")

        if isinstance(data, dict):
            if "constraints_config" in data and isinstance(data["constraints_config"], dict):
                self.stdout.write(f"Using constraints_config from: {json_path.name}")
                return data["constraints_config"]

            if "constraints" in data and isinstance(data["constraints"], dict):
                self.stdout.write(f"Using constraints from: {json_path.name}")
                return data["constraints"]

        self.stdout.write(
            self.style.WARNING(
                f"JSON file {json_path.name} found, but no constraints_config/constraints key. "
                "Using default constraints_config."
            )
        )
        return default_config

    def parse_bool(self, value):
        return str(value).strip().lower() in {"true", "1", "yes", "כן"}

    def parse_int(self, value, default=0):
        try:
            if value is None or str(value).strip() == "":
                return default
            return int(float(str(value).strip()))
        except Exception:
            return default

    def parse_decimal(self, value, default="0"):
        try:
            if value is None or str(value).strip() == "":
                return Decimal(default)
            return Decimal(str(value).strip())
        except Exception:
            return Decimal(default)

    def clear_test_data(self):
        self.stdout.write("=" * 70)
        self.stdout.write("Clearing local test DB data")
        self.stdout.write("=" * 70)

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
        self.stdout.write("=" * 70)
        self.stdout.write("Loading housing data into LOCAL test DB")
        self.stdout.write("=" * 70)

        region, _ = Region.objects.get_or_create(
            id="canada_test",
            defaults={"name": "Canada Test Region"},
        )

        dorm_type, _ = DormType.objects.get_or_create(
            code=999,
            defaults={
                "name": "Canada Test Dorm",
                "region": region,
            },
        )

        if dorm_type.region_id != region.id:
            dorm_type.region = region
            dorm_type.save(update_fields=["region"])

        building, _ = Building.objects.get_or_create(
            number=999,
            dorm_type=dorm_type,
            defaults={"is_active": True},
        )

        rooms_by_apartment_code = {}

        for room_row in rooms_rows:
            apartment_code = room_row.get("apartment_code", "").strip()
            if apartment_code:
                rooms_by_apartment_code.setdefault(apartment_code, []).append(room_row)

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
                    f"Invalid apartment category '{category}' for apartment {apartment_code}. "
                    "Expected 'male' or 'female'."
                )

            apartment = Apartment.objects.create(
                building=building,
                number=apartment_code,
                category=category,
                apartment_type=Apartment.ApartmentType.SINGLE,
                room_count=len(apartment_rooms),
                apartment_capacity=apartment_capacity,
                is_active=self.parse_bool(apartment_row.get("is_active", "True")),
                inactive_reason=apartment_row.get("inactive_reason", "").strip(),
            )

            apartment_by_code[apartment_code] = apartment

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
                    f"Room {room_code} references unknown apartment_code: {apartment_code}"
                )

            room = Room.objects.create(
                apartment=apartment,
                name=room_code,
                capacity=self.parse_int(room_row.get("capacity"), 1),
                is_active=self.parse_bool(room_row.get("is_active", "True")),
            )

            rooms_created += 1

            bed_label = room_row.get("bed_label", "").strip() or "Bed 1"

            Bed.objects.create(
                room=room,
                label=bed_label,
            )

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
        self.stdout.write("=" * 70)
        self.stdout.write("Loading students into LOCAL test DB")
        self.stdout.write("=" * 70)

        created_count = 0

        for row in students_rows:
            student_id = row.get("student_id", "").strip()

            if not student_id:
                raise CommandError("student_id is missing in students.csv")

            gender = row.get("gender", "").strip() or Student.Gender.FEMALE

            if gender not in {"male", "female"}:
                raise CommandError(
                    f"Invalid gender '{gender}' for student {student_id}. "
                    "Expected 'male' or 'female'."
                )

            placement_sector = (
                row.get("placement_sector", "").strip()
                or Student.PlacementSector.UNKNOWN
            )

            if placement_sector not in {"jewish", "arab", "other", "unknown"}:
                placement_sector = Student.PlacementSector.UNKNOWN

            requested_religion = (
                row.get("requested_religion", "").strip()
                or row.get("religion", "").strip()
                or Student.Religion.NOT_SPECIFIED
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
                requested_religion.lower(),
                Student.Religion.NOT_SPECIFIED,
            )

            religious = (
                row.get("religious_for_placement", "").strip()
                or row.get("religious_preference", "").strip()
                or Student.Religious.NOT_SPECIFIED
            )

            religious_map = {
                "religious": Student.Religious.RELIGIOUS,
                "no_preference": Student.Religious.NO_PREFERENCE,
                "not_specified": Student.Religious.NOT_SPECIFIED,
                "לא משנה": Student.Religious.NO_PREFERENCE,
                "לא צוין": Student.Religious.NOT_SPECIFIED,
                "": Student.Religious.NOT_SPECIFIED,
            }

            religious = religious_map.get(
                religious.lower(),
                Student.Religious.NOT_SPECIFIED,
            )

            Student.objects.create(
                student_id=student_id,
                first_name=row.get("first_name", "").strip(),
                last_name=row.get("last_name", "").strip(),
                gender=gender,
                is_priority=self.parse_bool(row.get("is_priority", "False")),
                priority_reason=row.get("priority_reason", "").strip(),
                placement_sector=placement_sector,
                requested_religion=requested_religion,
                religious=religious,
                study_points=self.parse_decimal(row.get("academic_points_total", "0")),
                special_status_1=row.get("special_status_1", "").strip(),
                special_status_2=row.get("special_status_2", "").strip(),
                special_status_3=row.get("special_status_3", "").strip(),
                special_status_4=row.get("special_status_4", "").strip(),
                roommate_request_student_id_1=row.get("roommate_request_student_id_1", "").strip(),
                roommate_request_student_id_2=row.get("roommate_request_student_id_2", "").strip(),
                roommate_request_student_id_3=row.get("roommate_request_student_id_3", "").strip(),
                roommate_request_student_id_4=row.get("roommate_request_student_id_4", "").strip(),
                roommate_request_student_id_5=row.get("roommate_request_student_id_5", "").strip(),
                roommate_request_flag_1=self.parse_bool(row.get("roommate_request_flag_1", "False")),
                roommate_request_flag_2=self.parse_bool(row.get("roommate_request_flag_2", "False")),
                roommate_request_flag_3=self.parse_bool(row.get("roommate_request_flag_3", "False")),
                roommate_request_flag_4=self.parse_bool(row.get("roommate_request_flag_4", "False")),
                roommate_request_flag_5=self.parse_bool(row.get("roommate_request_flag_5", "False")),
                category=Student.StudentCategory.NEW,
                accepted_dorm_type=dorm_type,
            )

            created_count += 1

        self.stdout.write(self.style.SUCCESS(f"Students loaded: {created_count}"))

    def run_algorithm(self, constraints_config):
        self.stdout.write("")
        self.stdout.write("=" * 70)
        self.stdout.write("Running allocation algorithm")
        self.stdout.write("=" * 70)

        students_qs = Student.objects.all().order_by("student_id")
        rooms_qs = Room.objects.all().order_by("name")

        self.stdout.write(f"Students sent to solver: {students_qs.count()}")
        self.stdout.write(f"Rooms sent to solver: {rooms_qs.count()}")
        self.stdout.write(f"Beds before solver: {Bed.objects.count()}")

        results = run_improved_ortools_allocation(
            students=students_qs,
            rooms=rooms_qs,
            constraints_config=constraints_config,
        )

        self.stdout.write("")
        self.stdout.write("=" * 70)
        self.stdout.write("Algorithm results")
        self.stdout.write("=" * 70)

        for key, value in results.items():
            self.stdout.write(f"{key}: {value}")

        active_assignments = BedAssignment.objects.filter(
            status=BedAssignment.Status.ACTIVE
        ).select_related(
            "student",
            "bed",
            "bed__room",
            "bed__room__apartment",
        ).order_by("student__student_id")

        assigned_student_ids = set(
            active_assignments.values_list("student__student_id", flat=True)
        )

        all_student_ids = set(Student.objects.values_list("student_id", flat=True))
        unassigned_student_ids = sorted(all_student_ids - assigned_student_ids)

        self.stdout.write("")
        self.stdout.write("=" * 70)
        self.stdout.write("Assignments created")
        self.stdout.write("=" * 70)

        if not active_assignments.exists():
            self.stdout.write(self.style.WARNING("No active assignments were created."))
        else:
            for assignment in active_assignments:
                student = assignment.student
                bed = assignment.bed
                room = bed.room
                apartment = room.apartment

                self.stdout.write(
                    f"{student.student_id} | "
                    f"{student.first_name} {student.last_name} | "
                    f"Apartment: {apartment.number} | "
                    f"Room: {room.name} | "
                    f"Bed: {bed.label}"
                )

        self.stdout.write("")
        self.stdout.write("=" * 70)
        self.stdout.write("Unassigned students")
        self.stdout.write("=" * 70)

        if not unassigned_student_ids:
            self.stdout.write(self.style.SUCCESS("No unassigned students."))
        else:
            for student_id in unassigned_student_ids:
                self.stdout.write(self.style.WARNING(student_id))

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Algorithm run finished."))