"""
Django management command template for running one synthetic allocation case.

Put this file in something like:
api/management/commands/run_synthetic_allocation_case.py

Then adapt model field names if your real Apartment/Building/DormType models differ.

Usage:
python manage.py run_synthetic_allocation_case --case path/to/case.json --dry-run
"""

import json
from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import Student, Room, Bed
# TODO: import your real models if names differ:
# from api.models import Building, Apartment, DormType

from api.services.allocation import run_improved_ortools_allocation  # TODO: adapt import path


class Command(BaseCommand):
    help = "Run synthetic dorm allocation case safely."

    def add_arguments(self, parser):
        parser.add_argument("--case", required=True)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        with open(options["case"], "r", encoding="utf-8") as f:
            data = json.load(f)

        with transaction.atomic():
            # TODO:
            # 1. Create/find fake DormType/Building for CANADA_TEST.
            # 2. Create apartments from data["apartments"].
            # 3. Create rooms from data["rooms"].
            # 4. Create beds, one bed per room.
            # 5. Create students from data["students"].
            #
            # IMPORTANT:
            # Use a unique prefix like TEST_CANADA_ so you can delete easily.

            students = list(Student.objects.filter(student_id__in=[s["student_id"] for s in data["students"]]))
            rooms = list(Room.objects.filter(code__in=[r["room_code"] for r in data["rooms"]]))  # TODO adapt field name

            result = run_improved_ortools_allocation(
                students=students,
                rooms=rooms,
                constraints_config=data["constraints_config"],
            )

            self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))

            if options["dry_run"]:
                self.stdout.write(self.style.WARNING("Dry run enabled: rolling back all DB changes."))
                transaction.set_rollback(True)
