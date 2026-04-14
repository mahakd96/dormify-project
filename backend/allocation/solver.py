from collections import defaultdict
from django.db import transaction

from backend.api.models import Student, Room, Bed, BedAssignment

try:
    from ortools.sat.python import cp_model
    ORTOOLS_AVAILABLE = True
except ImportError:
    ORTOOLS_AVAILABLE = False
from ortools.sat.python import cp_model

def _run_ortools_allocation(students, rooms):

    results = {
        'students_processed': len(students),
        'successful_assignments': 0,
        'roommate_matches': 0,
        'conflicts': 0,
    }

    candidate_beds = []
    room_by_bed = {}

    for room in rooms:
        _ensure_beds_for_room(room)

        free_beds = list(room.beds.exclude(
            id__in=BedAssignment.objects.filter(
                status=BedAssignment.Status.ACTIVE
            ).values_list('bed_id', flat=True)
        ).select_related('room__apartment'))

        for b in free_beds:
            candidate_beds.append(b)
            room_by_bed[b.id] = room

    if not candidate_beds:
        results['conflicts'] = len(students)
        return results

    model = cp_model.CpModel()

    x = {}
    for s in students:
        for b in candidate_beds:
            x[(s.id, b.id)] = model.NewBoolVar(f"x_{s.id}_{b.id}")

    # 1. סטודנט אחד → מיטה אחת
    for s in students:
        model.Add(sum(x[(s.id, b.id)] for b in candidate_beds) <= 1)

    # 2. מיטה אחת → סטודנט אחד
    for b in candidate_beds:
        model.Add(sum(x[(s.id, b.id)] for s in students) <= 1)

    # 3. אילוצים לפי דירה
    for s in students:
        for b in candidate_beds:
            room = room_by_bed[b.id]
            apt = room.apartment

            # reserved
            if apt.is_reserved and not s.is_priority:
                model.Add(x[(s.id, b.id)] == 0)

            # בנות בלבד
            if apt.category == "בנות" and s.gender != Student.Gender.FEMALE:
                model.Add(x[(s.id, b.id)] == 0)

    # 4. פונקציית מטרה
    model.Maximize(
        sum(
            x[(s.id, b.id)] * (100 + (20 if s.is_priority else 0))
            for s in students
            for b in candidate_beds
        )
    )

    solver = cp_model.CpSolver()
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        results['conflicts'] = len(students)
        return results

    assigned = set()

    for s in students:
        for b in candidate_beds:
            if solver.Value(x[(s.id, b.id)]) == 1:
                room = room_by_bed[b.id]

                _assign_student(s, room, {})

                assigned.add(s.id)
                results['successful_assignments'] += 1

    results['conflicts'] = len(students) - len(assigned)
    return results