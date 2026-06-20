"""
Django management command template for running one synthetic allocation case.

Place it under:
api/management/commands/run_synthetic_allocation_case.py

Adapt the model creation section to the real Apartment/Building/DormType schema.

Safe usage:
python manage.py run_synthetic_allocation_case --case path/to/case.json --dry-run --assert-expected
"""

import json

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.models import Student, Room
from api.services.allocation import run_improved_ortools_allocation  # Adapt if needed.


class Command(BaseCommand):
    help = "Run one synthetic dorm-allocation case safely."

    def add_arguments(self, parser):
        parser.add_argument("--case", required=True)
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--assert-expected", action="store_true")

    def _assert_expected_metrics(self, result, expected):
        allowed_status = expected.get("allowed_solver_status", [])
        if allowed_status and result.get("solver_status") not in allowed_status:
            raise CommandError(
                f"Unexpected solver_status: {result.get('solver_status')}; expected one of {allowed_status}"
            )

        for key in ("successful_assignments", "conflicts"):
            if key in expected and result.get(key) != expected[key]:
                raise CommandError(
                    f"Unexpected {key}: {result.get(key)}; expected {expected[key]}"
                )

    def handle(self, *args, **options):
        with open(options["case"], "r", encoding="utf-8") as handle:
            data = json.load(handle)

        with transaction.atomic():
            # TODO: create isolated synthetic records using a unique TEST_CANADA_ prefix:
            # 1. Create/find fake DormType and Building.
            # 2. Create apartments from data["apartments"].
            # 3. Create rooms and beds from data["rooms"].
            # 4. Create students from data["students"].
            # 5. Ensure no real records are selected by the queries below.

            student_ids = [student["student_id"] for student in data["students"]]
            room_codes = [room["room_code"] for room in data["rooms"]]

            students = list(Student.objects.filter(student_id__in=student_ids))
            rooms = list(Room.objects.filter(code__in=room_codes))  # Adapt the room-code field.

            if len(students) != len(student_ids):
                raise CommandError(
                    f"Loaded {len(students)} students but fixture contains {len(student_ids)}"
                )
            if len(rooms) != len(room_codes):
                raise CommandError(
                    f"Loaded {len(rooms)} rooms but fixture contains {len(room_codes)}"
                )

            result = run_improved_ortools_allocation(
                students=students,
                rooms=rooms,
                constraints_config=data["constraints_config"],
            )

            self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))

            if options["assert_expected"]:
                self._assert_expected_metrics(result, data["expected_metrics"])
                self.stdout.write(self.style.SUCCESS("Expected metrics passed."))

            if options["dry_run"]:
                self.stdout.write(self.style.WARNING("Dry run enabled: rolling back all database changes."))
                transaction.set_rollback(True)
