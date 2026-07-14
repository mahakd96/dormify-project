"""
Explicit, admin-only setup operation: create the missing Bed rows for rooms
whose configured capacity exceeds their real Bed records.

This is the ONLY place in the system allowed to materialize beds from room
capacity. Browsing/matching (match-options, feasibility, the assignment
picker, pagination, expanding a building) is strictly read-only and reports
such rooms as a data-integrity problem instead of creating rows.

Safe by default: without --apply the command only PRINTS what it would
create (dry run). Nothing is written unless --apply is passed explicitly.

    python manage.py materialize_beds            # dry run - report only
    python manage.py materialize_beds --apply    # actually create the rows
"""

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Count

from api.models import Bed, Room


class Command(BaseCommand):
    help = (
        'Create missing Bed rows from room capacity (data-integrity repair). '
        'Dry run by default; pass --apply to write.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='Actually create the missing Bed rows (default is a dry run).',
        )

    def handle(self, *args, **options):
        apply_changes = options['apply']

        rooms = (
            Room.objects.annotate(bed_records=Count('beds'))
            .select_related('apartment__building')
            .order_by('id')
        )

        missing_total = 0
        rooms_affected = 0
        new_beds = []
        for room in rooms:
            missing = room.capacity - room.bed_records
            if missing <= 0:
                continue
            rooms_affected += 1
            missing_total += missing
            self.stdout.write(
                f'Room {room.id} ("{room.name}", apartment {room.apartment.number}, '
                f'building {room.apartment.building.number}): capacity={room.capacity}, '
                f'bed records={room.bed_records}, missing={missing}'
            )
            for i in range(room.bed_records + 1, room.capacity + 1):
                new_beds.append(Bed(room=room, label=f'Bed {i}'))

        if rooms_affected == 0:
            self.stdout.write(self.style.SUCCESS('All rooms already have Bed rows matching their capacity.'))
            return

        if not apply_changes:
            self.stdout.write(self.style.WARNING(
                f'DRY RUN: {missing_total} Bed row(s) missing across {rooms_affected} room(s). '
                'Re-run with --apply to create them.'
            ))
            return

        with transaction.atomic():
            Bed.objects.bulk_create(new_beds)
        self.stdout.write(self.style.SUCCESS(
            f'Created {len(new_beds)} Bed row(s) across {rooms_affected} room(s).'
        ))
