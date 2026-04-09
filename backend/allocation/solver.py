"""
DORMIFY - Allocation Algorithm
Safe version compatible with current + merged schema
"""

from collections import defaultdict
from django.db import transaction

from backend.api.models import Student, Room, Bed, BedAssignment
try:
    import minizinc  # noqa: F401
    MINIZINC_AVAILABLE = True
except ImportError:
    MINIZINC_AVAILABLE = False
    print("⚠️ MiniZinc not installed. Using fallback algorithm.")


def run_allocation_algorithm(region):
    """
    Run the allocation algorithm for a region.

    Current supported practical rules:
    1. Priority students first
    2. Keep apartment gender consistency when possible
    3. Keep apartment religion consistency when possible
    4. Try to satisfy roommate requests
    5. Assign only to rooms with available capacity/beds

    Returns:
        dict with results
    """

    students = list(
        Student.objects.filter(
            region=region,
            is_active=True,
            assigned_room__isnull=True
        ).order_by('-is_priority', 'last_name', 'first_name')
    )

    rooms = list(
        Room.objects.filter(
            apartment__building__region=region,
            is_active=True,
            apartment__is_active=True,
            apartment__building__is_active=True,
        ).select_related('apartment', 'apartment__building')
    )

    available_rooms = [room for room in rooms if room.available_beds > 0]

    if not students:
        return {
            'students_processed': 0,
            'successful_assignments': 0,
            'roommate_matches': 0,
            'conflicts': 0,
        }

    if not available_rooms:
        return {
            'students_processed': len(students),
            'successful_assignments': 0,
            'roommate_matches': 0,
            'conflicts': len(students),
        }

    if MINIZINC_AVAILABLE:
        return _run_minizinc_allocation(students, available_rooms)

    return _run_fallback_allocation(students, available_rooms)


def _run_minizinc_allocation(students, rooms):
    """
    Placeholder MiniZinc path.
    For now, fallback to greedy algorithm.
    """
    return _run_fallback_allocation(students, rooms)


def _run_fallback_allocation(students, rooms):
    """
    Greedy allocation algorithm compatible with current schema.
    """

    results = {
        'students_processed': len(students),
        'successful_assignments': 0,
        'roommate_matches': 0,
        'conflicts': 0,
    }

    apartment_rooms = _build_apartment_state(rooms)

    priority_students = [s for s in students if s.is_priority]
    regular_students = [s for s in students if not s.is_priority]

    processed = set()

    # 1) Priority students first
    for student in priority_students:
        room = _find_suitable_room(student, apartment_rooms)
        if room:
            _assign_student(student, room, apartment_rooms)
            results['successful_assignments'] += 1
            processed.add(student.student_id)
        else:
            results['conflicts'] += 1
            processed.add(student.student_id)

    # 2) Try roommate matching for regular students
    roommate_map = _build_roommate_map(regular_students)

    for student in regular_students:
        if student.student_id in processed:
            continue

        requested_id = roommate_map.get(student.student_id)
        if not requested_id:
            continue

        roommate = next(
            (
                s for s in regular_students
                if s.student_id == requested_id and s.student_id not in processed
            ),
            None
        )

        if not roommate:
            continue

        mutual = roommate_map.get(roommate.student_id) == student.student_id

        # Only pair if compatible
        if student.gender != roommate.gender:
            continue

        if not _religion_compatible(student.religion, roommate.religion):
            continue

        room = _find_suitable_room_for_pair(student, roommate, apartment_rooms)
        if room:
            _assign_student(student, room, apartment_rooms)
            _assign_student(roommate, room, apartment_rooms)
            results['successful_assignments'] += 2
            if mutual:
                results['roommate_matches'] += 1
            processed.add(student.student_id)
            processed.add(roommate.student_id)

    # 3) Assign remaining students
    for student in regular_students:
        if student.student_id in processed:
            continue

        room = _find_suitable_room(student, apartment_rooms)
        if room:
            _assign_student(student, room, apartment_rooms)
            results['successful_assignments'] += 1
        else:
            results['conflicts'] += 1

        processed.add(student.student_id)

    return results


def _build_apartment_state(rooms):
    """
    Build apartment state and initialize it from already assigned students.
    """
    apartment_rooms = {}

    for room in rooms:
        apt = room.apartment
        apt_id = apt.id

        if apt_id not in apartment_rooms:
            apartment_rooms[apt_id] = {
                'apartment': apt,
                'rooms': [],
                'gender': None,
                'religion': None,
            }

        apartment_rooms[apt_id]['rooms'].append(room)

    # initialize apartment gender/religion from already assigned students
    for apt_id, apt_data in apartment_rooms.items():
        existing_students = Student.objects.filter(
            assigned_room__apartment_id=apt_id,
            is_active=True
        ).exclude(assigned_room__isnull=True)

        first_student = existing_students.first()
        if first_student:
            apt_data['gender'] = first_student.gender
            apt_data['religion'] = first_student.religion

    return apartment_rooms


def _build_roommate_map(students):
    """
    Build roommate map from roommate_request_1..5 fields.
    We take only the first non-empty request as the preferred requested roommate.
    """
    roommate_map = {}

    for s in students:
        requests = [
            getattr(s, 'roommate_request_1', '') or '',
            getattr(s, 'roommate_request_2', '') or '',
            getattr(s, 'roommate_request_3', '') or '',
            getattr(s, 'roommate_request_4', '') or '',
            getattr(s, 'roommate_request_5', '') or '',
        ]
        first_request = next((r.strip() for r in requests if str(r).strip()), None)
        if first_request:
            roommate_map[s.student_id] = first_request

    return roommate_map


def _religion_compatible(r1, r2):
    """
    Compatible if equal, or if one/both are not specified.
    This matches your actual Student.Religion model.
    """
    if not r1 or not r2:
        return True
    if r1 == Student.Religion.NOT_SPECIFIED or r2 == Student.Religion.NOT_SPECIFIED:
        return True
    return r1 == r2


def _find_suitable_room(student, apartment_rooms):
    """
    Find one suitable room for a single student.
    """

    for _, apt_data in apartment_rooms.items():
        apt = apt_data['apartment']

        # reserved apartment only for priority students
        if apt.is_reserved and not student.is_priority:
            continue

        # apartment-level gender consistency
        if apt_data['gender'] and apt_data['gender'] != student.gender:
            continue

        # apartment-level religion consistency
        if apt_data['religion'] and not _religion_compatible(apt_data['religion'], student.religion):
            continue

        for room in apt_data['rooms']:
            if room.available_beds > 0:
                return room

    return None


def _find_suitable_room_for_pair(student1, student2, apartment_rooms):
    """
    Find a room that can fit both students.
    """

    for _, apt_data in apartment_rooms.items():
        apt = apt_data['apartment']

        if apt.is_reserved and not (student1.is_priority or student2.is_priority):
            continue

        if apt_data['gender'] and apt_data['gender'] != student1.gender:
            continue

        if apt_data['religion'] and not _religion_compatible(apt_data['religion'], student1.religion):
            continue

        for room in apt_data['rooms']:
            if room.available_beds >= 2:
                return room

    return None


def _ensure_beds_for_room(room):
    """
    Create beds automatically if room has none.
    This supports merged schema without breaking old room-based flow.
    """
    existing = room.beds.count()
    if existing >= room.capacity:
        return

    for i in range(existing + 1, room.capacity + 1):
        Bed.objects.create(room=room, label=f'Bed {i}')


def _get_free_bed(room):
    _ensure_beds_for_room(room)

    occupied_bed_ids = BedAssignment.objects.filter(
        bed__room=room,
        status=BedAssignment.Status.ACTIVE
    ).values_list('bed_id', flat=True)

    return room.beds.exclude(id__in=occupied_bed_ids).order_by('id').first()


@transaction.atomic
def _assign_student(student, room, apartment_rooms):
    """
    Assign student to room and create bed assignment if Bed model exists/used.
    Keeps Student.assigned_room updated for frontend compatibility.
    """

    student.assigned_room = room
    student.save(update_fields=['assigned_room', 'updated_at'])

    # End any old active bed assignment, just in case
    BedAssignment.objects.filter(
        student=student,
        status=BedAssignment.Status.ACTIVE
    ).update(
        status=BedAssignment.Status.ENDED
    )

    free_bed = _get_free_bed(room)
    if free_bed:
        BedAssignment.objects.create(
            student=student,
            bed=free_bed,
            status=BedAssignment.Status.ACTIVE,
            assignment_type=BedAssignment.AssignmentType.INITIAL,
            assigned_by=None,
        )

    apt_id = room.apartment_id
    if apt_id in apartment_rooms:
        if not apartment_rooms[apt_id]['gender']:
            apartment_rooms[apt_id]['gender'] = student.gender
        if not apartment_rooms[apt_id]['religion']:
            apartment_rooms[apt_id]['religion'] = student.religion