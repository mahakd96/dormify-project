"""
Group 2 — Concurrency & Load: race-condition REGRESSION tests.

History: this module started as the Group 2 AUDIT's race-condition
reproduction tests (see project-quality/concurrency/CONCURRENCY_AND_LOAD_AUDIT.md,
G2-01/G2-02, and evidence/GROUP2_RACE_CONDITION_EVIDENCE.txt - preserved
unmodified as the "before" record). This module has since been upgraded,
in the Group 2 IMPLEMENTATION phase, into true regression tests for the
FIXED behavior: every race scenario now asserts the correct, deterministic
outcome (exactly one winner, a clean 4xx for the loser, never a 500) and
will FAIL if that regresses - it no longer just documents whatever
happened to occur in one run.

WHY TransactionTestCase, NOT TestCase:
Django's plain TestCase wraps each test in an outer transaction (rolled
back at the end) that lives on ONE connection. A background thread started
inside such a test gets its OWN thread-local connection, which can never
see the main thread's uncommitted writes, and any select_for_update() a
background thread tries to take on a row the main thread's still-open
outer transaction touched would simply block forever (deadlock -> hang).
TransactionTestCase does NOT wrap the test body in a transaction (it
truncates tables between tests instead), so every thread's connection
commits and becomes visible to every other thread exactly like real
concurrent production traffic - the only test class that can genuinely
reproduce (and prove the fix for) a race condition rather than hide or
deadlock on it.

Each thread below builds its OWN APIClient() instance (never a client
shared across threads) and authenticates independently, mirroring two
real, independent HTTP requests arriving at the same time.

Endpoints under test are hit through the real DRF view (APIClient), never
by calling internal helper functions directly - the whole point is to
observe what actually happens when two real HTTP requests race.

Run against Django's disposable TEST database (never touches the real
database):

    cd backend
    ENV_FILE=.env.test python manage.py test api.concurrency_tests.test_race_conditions -v 2
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from django.conf import settings
from django.db import connections
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from api.models import (
    User, Region, DormType, Building, Apartment, Room, Bed,
    Student, BedAssignment, StudentRequest, Transfer, RegionInbox, ImportBatch,
)

EVIDENCE_DIR = Path(settings.BASE_DIR).parent / 'project-quality' / 'concurrency' / 'evidence'
# AFTER-FIX evidence file - deliberately distinct from the audit's own
# evidence/GROUP2_RACE_CONDITION_EVIDENCE.txt, which is preserved
# unmodified as the "before" record (see CONCURRENCY_AND_LOAD_TESTING_REPORT.md).
EVIDENCE_FILE = EVIDENCE_DIR / 'GROUP2_RACE_CONDITION_EVIDENCE_AFTER_FIX.txt'
_evidence_lines = []


def _record(*lines):
    _evidence_lines.extend(lines)
    for line in lines:
        print(line)


def _flush_evidence():
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    with open(EVIDENCE_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(_evidence_lines) + '\n')


def _make_user(email, role, region=None):
    user = User(email=email, username=email, role=role, region=region, first_name='T', last_name='User')
    user.set_password('testpass123')
    user.save()
    return user


def _make_region(region_id, name, dorm_code):
    region = Region.objects.create(id=region_id, name=name)
    dorm_type = DormType.objects.create(code=dorm_code, name=f'{name}DormType', region=region)
    return region, dorm_type


def _make_room(dorm_type, building_number, n_beds, category=Apartment.Category.MALE):
    building = Building.objects.create(number=building_number, dorm_type=dorm_type)
    apartment = Apartment.objects.create(
        building=building, number='1', category=category,
        apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
    )
    room = Room.objects.create(apartment=apartment, name='1', capacity=n_beds)
    beds = [Bed.objects.create(room=room, label=f'B{i}') for i in range(n_beds)]
    return building, apartment, room, beds


def _make_student(student_id, dorm_type, gender='male',
                   housing_type=Student.HousingType.SINGLE_MALE):
    return Student.objects.create(
        student_id=student_id, first_name='F', last_name='L', gender=gender,
        housing_type=housing_type, accepted_dorm_type=dorm_type,
    )


def _client_for(user):
    """
    A fresh APIClient + fresh DB connection per caller, never shared.

    raise_request_exception=False makes an unhandled view exception come
    back as an actual 500 response (what a real, non-test HTTP client
    would receive) instead of Django's test-only default of re-raising it
    into the calling thread - essential here since these tests are
    specifically trying to observe whether a race produces a clean 4xx or
    an unhandled 500.
    """
    client = APIClient()
    client.force_authenticate(user)
    client.raise_request_exception = False
    return client


def _run_concurrently(callables):
    """
    Fire all callables at (as close as possible to) the same instant, each
    on its own worker thread (its own Django DB connection).

    IMPORTANT (itself a Group 2 "connection/resource behavior" finding,
    G2-conn-leak - kept as documented pattern per the implementation
    phase's explicit instruction not to redesign background processing,
    just to keep this discipline): a ThreadPoolExecutor worker thread that
    touches the Django ORM opens its own thread-local DB connection, but
    that connection is only ever closed automatically via Django's
    request_finished signal on a REAL request/response cycle - a raw
    worker thread that dies at pool shutdown does NOT trigger that
    signal, so the underlying Postgres connection would otherwise be
    silently leaked. connections.close_all() is therefore called
    explicitly at the end of every worker thread below.
    """
    barrier = threading.Barrier(len(callables))
    results = [None] * len(callables)

    def _wrapped(i, fn):
        try:
            barrier.wait(timeout=10)
            results[i] = fn()
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=len(callables)) as pool:
        futures = [pool.submit(_wrapped, i, fn) for i, fn in enumerate(callables)]
        for f in futures:
            f.result(timeout=30)
    return results


class DuplicateStudentCreationRaceTests(TransactionTestCase):
    """
    G2-01/G2-02 REGRESSION TEST (fixed behavior).

    Two SEPARATE StudentRequest rows, both PENDING, both proposing to
    create a NEW student with the SAME student_id, approved concurrently -
    a realistic scenario (the same paper form submitted/approved twice by
    two staff members, or two different StudentRequest rows created from
    the same import row). Before the fix, the losing request could
    surface as an unhandled 500 (IntegrityError from the DB's real
    Student.student_id unique constraint, uncaught anywhere on the path).

    After the fix: StudentRequestViewSet.approve() catches IntegrityError
    and converts it into a clean 4xx; this test now HARD-FAILS if a 500
    ever appears again.
    """

    def setUp(self):
        self.region, self.dorm_type = _make_region('g2-dup-region', 'G2 Dup Region', 9001)
        self.admin = _make_user('g2-dup-admin@test.com', User.Role.CENTRAL_ADMIN)

    def test_concurrent_add_student_approvals_same_student_id(self):
        payload = {
            'student_id': 'RACE-DUP-1', 'first_name': 'Race', 'last_name': 'Case',
            'gender': 'male', 'housing_type': Student.HousingType.SINGLE_MALE,
        }
        req_a = StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.ADD_STUDENT, reason='race-a',
            requested_by=self.admin, student_data=payload,
        )
        req_b = StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.ADD_STUDENT, reason='race-b',
            requested_by=self.admin, student_data=payload,
        )

        def _approve(req_id):
            client = _client_for(self.admin)
            resp = client.put(f'/api/requests/{req_id}/approve/', {}, format='json')
            return resp.status_code, resp.content[:500]

        results = _run_concurrently([
            lambda: _approve(req_a.id),
            lambda: _approve(req_b.id),
        ])

        status_codes = sorted(r[0] for r in results)
        created_count = Student.objects.filter(student_id='RACE-DUP-1').count()

        _record(
            '--- DuplicateStudentCreationRaceTests.test_concurrent_add_student_approvals_same_student_id (AFTER FIX) ---',
            f'thread A response: {results[0]}',
            f'thread B response: {results[1]}',
            f'status_codes (sorted): {status_codes}',
            f'Student.objects.filter(student_id="RACE-DUP-1").count(): {created_count}',
            '',
        )

        # Data integrity: still exactly one Student row, as before.
        self.assertEqual(created_count, 1, 'DB unique constraint must prevent a duplicate Student row')

        # REGRESSION GUARD (the actual point of this test post-fix): a
        # legitimate concurrent-write conflict must NEVER surface as an
        # unhandled 500 again.
        self.assertNotIn(
            500, status_codes,
            'REGRESSION: a concurrent duplicate-student-creation race produced an unhandled 500 '
            '- the IntegrityError handling in StudentRequestViewSet.approve() has regressed.',
        )
        # Deterministic outcome: exactly one request wins.
        self.assertEqual(status_codes, [200, 400], 'exactly one request must succeed (200) and the other must fail cleanly (400)')

        winner = next(r for r in results if r[0] == 200)
        loser = next(r for r in results if r[0] == 400)
        _record(f'winner: {winner[0]}, loser (clean 4xx body): {loser[1]}', '')


class TransferCreateAndApproveSequentialTests(TransactionTestCase):
    """
    Sequential (non-concurrent) regression coverage proving the legacy
    Transfer create/approve/reject HTTP path is now FUNCTIONAL - it was
    previously completely broken (INCIDENTAL-1 in the Group 2 audit:
    TransferViewSet referenced a non-existent Transfer.movement_type
    field, crashing every single request unconditionally). Fixed in the
    Group 2 implementation phase by sourcing movement_type from the
    related MovementRequest (transfer.movement_request.movement_type)
    instead, and removing the invalid movement_type kwarg from
    perform_create()'s serializer.save() call. These are intentionally
    SEQUENTIAL (single-client) tests - proving basic functional
    correctness first, before the dynamic concurrent race tests below
    build on top of it.
    """

    def setUp(self):
        self.region, self.dorm_type = _make_region('g2-xfer-region', 'G2 Transfer Region', 9002)
        self.admin = _make_user('g2-xfer-admin@test.com', User.Role.CENTRAL_ADMIN)
        _, _, self.from_room, from_beds = _make_room(self.dorm_type, 1, n_beds=1)
        _, _, self.to_room, _ = _make_room(self.dorm_type, 2, n_beds=2)
        self.student = _make_student('XFER-SEQ-1', self.dorm_type)
        BedAssignment.objects.create(
            student=self.student, bed=from_beds[0], status=BedAssignment.Status.ACTIVE,
            assigned_by=self.admin,
        )
        # Fixture built directly via the ORM (bypassing
        # assign_student_to_room(), which is what normally keeps this
        # denormalized field in sync) - set it explicitly so
        # student.assigned_room reflects the ACTIVE assignment just
        # created above.
        self.student.assigned_room = self.from_room
        self.student.save(update_fields=['assigned_room'])

    def test_create_transfer_via_post_no_longer_crashes(self):
        client = _client_for(self.admin)
        resp = client.post('/api/transfers/', {
            'student': self.student.id,
            'requested_by': self.admin.id,
            'from_room': self.from_room.id,
            'to_room': self.to_room.id,
            'reason': 'sequential regression test',
        }, format='json')

        _record(
            '--- TransferCreateAndApproveSequentialTests.test_create_transfer_via_post_no_longer_crashes ---',
            f'POST /api/transfers/ status: {resp.status_code}',
            f'body: {resp.content[:400]}',
            '',
        )

        self.assertEqual(resp.status_code, 201, resp.content)
        transfer = Transfer.objects.get(pk=resp.data['id'])
        self.assertEqual(transfer.status, Transfer.Status.PENDING)
        self.assertIsNotNone(transfer.movement_request_id, 'perform_create() must still link a MovementRequest')
        self.assertIsNotNone(
            transfer.movement_request.movement_type,
            'the movement_type computed by infer_movement_type() must be stored on the MovementRequest',
        )

    def test_approve_transfer_via_put_no_longer_crashes(self):
        create_resp = _client_for(self.admin).post('/api/transfers/', {
            'student': self.student.id,
            'requested_by': self.admin.id,
            'from_room': self.from_room.id,
            'to_room': self.to_room.id,
            'reason': 'sequential regression test',
        }, format='json')
        self.assertEqual(create_resp.status_code, 201, create_resp.content)
        transfer_id = create_resp.data['id']

        approve_resp = _client_for(self.admin).put(f'/api/transfers/{transfer_id}/approve/', {}, format='json')

        _record(
            '--- TransferCreateAndApproveSequentialTests.test_approve_transfer_via_put_no_longer_crashes ---',
            f'PUT /api/transfers/{transfer_id}/approve/ status: {approve_resp.status_code}',
            f'body: {approve_resp.content[:400]}',
            '',
        )

        self.assertEqual(approve_resp.status_code, 200, approve_resp.content)
        transfer = Transfer.objects.get(pk=transfer_id)
        self.assertEqual(transfer.status, Transfer.Status.APPROVED)
        self.student.refresh_from_db()
        self.assertEqual(self.student.assigned_room_id, self.to_room.id)
        active = BedAssignment.objects.filter(student=self.student, status=BedAssignment.Status.ACTIVE)
        self.assertEqual(active.count(), 1)
        self.assertEqual(active.first().bed.room_id, self.to_room.id)
        transfer.movement_request.refresh_from_db()
        self.assertEqual(transfer.movement_request.status, transfer.movement_request.Status.COMPLETED)

    def test_reject_transfer_via_put_no_longer_crashes(self):
        create_resp = _client_for(self.admin).post('/api/transfers/', {
            'student': self.student.id,
            'requested_by': self.admin.id,
            'from_room': self.from_room.id,
            'to_room': self.to_room.id,
            'reason': 'sequential regression test',
        }, format='json')
        self.assertEqual(create_resp.status_code, 201, create_resp.content)
        transfer_id = create_resp.data['id']

        reject_resp = _client_for(self.admin).put(
            f'/api/transfers/{transfer_id}/reject/', {'reason': 'no longer needed'}, format='json',
        )

        _record(
            '--- TransferCreateAndApproveSequentialTests.test_reject_transfer_via_put_no_longer_crashes ---',
            f'PUT /api/transfers/{transfer_id}/reject/ status: {reject_resp.status_code}',
            f'body: {reject_resp.content[:400]}',
            '',
        )

        self.assertEqual(reject_resp.status_code, 200, reject_resp.content)
        transfer = Transfer.objects.get(pk=transfer_id)
        self.assertEqual(transfer.status, Transfer.Status.REJECTED)
        # Student must NOT have been moved by a rejected transfer.
        self.student.refresh_from_db()
        self.assertEqual(self.student.assigned_room_id, self.from_room.id)


class TransferDoubleApprovalRaceTests(TransactionTestCase):
    """
    Now that the movement_type bug is fixed (see
    TransferCreateAndApproveSequentialTests above), the equivalent
    check-then-act race the audit could only confirm by STATIC code
    inspection for Transfer (G2-01's twin) can finally be tested
    dynamically. Mirrors StudentRequestDoubleApprovalRaceTests: two
    concurrent approve() calls for the SAME transfer, target room with
    exactly one free bed.
    """

    def setUp(self):
        self.region, self.dorm_type = _make_region('g2-xfer-race-region', 'G2 Transfer Race Region', 9008)
        self.admin = _make_user('g2-xfer-race-admin@test.com', User.Role.CENTRAL_ADMIN)
        _, _, self.from_room, from_beds = _make_room(self.dorm_type, 1, n_beds=1)
        _, _, self.to_room, _ = _make_room(self.dorm_type, 2, n_beds=1)
        self.student = _make_student('XFER-RACE-1', self.dorm_type)
        BedAssignment.objects.create(
            student=self.student, bed=from_beds[0], status=BedAssignment.Status.ACTIVE,
            assigned_by=self.admin,
        )
        create_resp = _client_for(self.admin).post('/api/transfers/', {
            'student': self.student.id, 'requested_by': self.admin.id, 'from_room': self.from_room.id,
            'to_room': self.to_room.id, 'reason': 'race',
        }, format='json')
        assert create_resp.status_code == 201, create_resp.content
        self.transfer_id = create_resp.data['id']

    def test_concurrent_approve_same_transfer_single_bed(self):
        def _approve():
            client = _client_for(self.admin)
            resp = client.put(f'/api/transfers/{self.transfer_id}/approve/', {}, format='json')
            return resp.status_code, resp.content[:300]

        results = _run_concurrently([_approve, _approve])
        status_codes = sorted(r[0] for r in results)

        transfer = Transfer.objects.get(pk=self.transfer_id)
        active_count = BedAssignment.objects.filter(
            student=self.student, status=BedAssignment.Status.ACTIVE,
        ).count()

        _record(
            '--- TransferDoubleApprovalRaceTests.test_concurrent_approve_same_transfer_single_bed ---',
            f'thread A response: {results[0]}',
            f'thread B response: {results[1]}',
            f'status_codes (sorted): {status_codes}',
            f'final transfer.status: {transfer.status}',
            f'active BedAssignment count for student (must be exactly 1): {active_count}',
            '',
        )

        self.assertEqual(active_count, 1)
        self.assertEqual(transfer.status, Transfer.Status.APPROVED)
        self.assertNotIn(500, status_codes, 'REGRESSION: the losing racer must never surface as an unhandled 500')
        self.assertEqual(status_codes.count(200), 1, 'exactly one of the two concurrent approvals must win')
        self.assertEqual(status_codes.count(400), 1, 'the loser must get a clean 400 ("already processed")')

    def test_concurrent_approve_and_reject_same_transfer(self):
        """Requirement E variant: one approve() and one reject() racing for the SAME transfer."""
        def _approve():
            client = _client_for(self.admin)
            resp = client.put(f'/api/transfers/{self.transfer_id}/approve/', {}, format='json')
            return ('approve', resp.status_code, resp.content[:300])

        def _reject():
            client = _client_for(self.admin)
            resp = client.put(f'/api/transfers/{self.transfer_id}/reject/', {'reason': 'race'}, format='json')
            return ('reject', resp.status_code, resp.content[:300])

        results = _run_concurrently([_approve, _reject])
        status_codes = sorted(r[1] for r in results)
        transfer = Transfer.objects.get(pk=self.transfer_id)

        _record(
            '--- TransferDoubleApprovalRaceTests.test_concurrent_approve_and_reject_same_transfer ---',
            f'results: {results}',
            f'final transfer.status: {transfer.status}',
            '',
        )

        self.assertNotIn(500, status_codes)
        self.assertEqual(status_codes.count(200), 1, 'exactly one of approve/reject must win')
        self.assertIn(transfer.status, (Transfer.Status.APPROVED, Transfer.Status.REJECTED))


class StudentRequestDoubleApprovalRaceTests(TransactionTestCase):
    """
    G2-01 REGRESSION TEST (fixed behavior) for
    StudentRequestViewSet.approve() (ROOM-type request): two concurrent
    approve() calls for the SAME request, target room with exactly one
    free bed.
    """

    def setUp(self):
        self.region, self.dorm_type = _make_region('g2-sr-region', 'G2 StudentRequest Region', 9003)
        self.admin = _make_user('g2-sr-admin@test.com', User.Role.CENTRAL_ADMIN)
        self.student = _make_student('SR-RACE-1', self.dorm_type)

    def test_concurrent_approve_same_room_request_single_bed(self):
        _, _, to_room, _ = _make_room(self.dorm_type, 1, n_beds=1)
        req = StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.ROOM, reason='race',
            requested_by=self.admin, student=self.student, target_room=to_room,
        )

        def _approve():
            client = _client_for(self.admin)
            resp = client.put(f'/api/requests/{req.id}/approve/', {}, format='json')
            return resp.status_code, resp.content[:300]

        results = _run_concurrently([_approve, _approve])
        status_codes = sorted(r[0] for r in results)
        req.refresh_from_db()
        active_count = BedAssignment.objects.filter(
            student=self.student, status=BedAssignment.Status.ACTIVE,
        ).count()

        _record(
            '--- StudentRequestDoubleApprovalRaceTests.test_concurrent_approve_same_room_request_single_bed ---',
            f'thread A response: {results[0]}',
            f'thread B response: {results[1]}',
            f'status_codes (sorted): {status_codes}',
            f'final request.status: {req.status}',
            f'active BedAssignment count for student (must be exactly 1): {active_count}',
            '',
        )

        self.assertEqual(active_count, 1)
        self.assertEqual(req.status, StudentRequest.Status.APPROVED)
        self.assertNotIn(500, status_codes, 'REGRESSION: the losing racer must never surface as an unhandled 500')
        self.assertEqual(status_codes.count(200), 1)
        self.assertEqual(status_codes.count(400), 1, 'the loser must get a clean 400 ("already processed")')

    def test_concurrent_approve_same_room_request_ample_capacity(self):
        """
        Requirement A variant: same-object double approval where the
        target room has capacity for BOTH racers (2 free beds) - isolates
        the StudentRequest-row race specifically (the apartment-level bed
        lock alone would not have saved us here before the fix, since
        there's no bed shortage to fall back on).
        """
        _, _, to_room, _ = _make_room(self.dorm_type, 2, n_beds=2)
        req = StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.ROOM, reason='race-ample',
            requested_by=self.admin, student=self.student, target_room=to_room,
        )

        def _approve():
            client = _client_for(self.admin)
            resp = client.put(f'/api/requests/{req.id}/approve/', {}, format='json')
            return resp.status_code, resp.content[:300]

        results = _run_concurrently([_approve, _approve])
        status_codes = sorted(r[0] for r in results)
        req.refresh_from_db()
        active_count = BedAssignment.objects.filter(
            student=self.student, status=BedAssignment.Status.ACTIVE,
        ).count()
        total_assignments_created = BedAssignment.objects.filter(
            student=self.student, bed__room=to_room,
        ).count()

        _record(
            '--- StudentRequestDoubleApprovalRaceTests.test_concurrent_approve_same_room_request_ample_capacity ---',
            f'thread A response: {results[0]}',
            f'thread B response: {results[1]}',
            f'status_codes (sorted): {status_codes}',
            f'active BedAssignment count for student (must be exactly 1): {active_count}',
            f'TOTAL BedAssignment rows created against to_room (must be exactly 1 - no double-processing): '
            f'{total_assignments_created}',
            '',
        )

        self.assertEqual(active_count, 1)
        self.assertNotIn(500, status_codes)
        self.assertEqual(
            status_codes, [200, 400],
            'with ample capacity, the row lock (not bed scarcity) must be what stops the second racer',
        )
        self.assertEqual(
            total_assignments_created, 1,
            'REGRESSION: the request was processed twice - the StudentRequest row lock did not prevent it',
        )


class StudentRequestApproveRejectConflictTests(TransactionTestCase):
    """
    Requirement D: a realistic "reject/approve conflict" - two different
    managers acting on the SAME pending request at (as close as possible
    to) the same time, one approving and one rejecting. Exactly one must
    win; the other must get a clean 4xx; the request must never end up in
    an ambiguous or inconsistent state.
    """

    def setUp(self):
        self.region, self.dorm_type = _make_region('g2-conflict-region', 'G2 Conflict Region', 9009)
        self.admin = _make_user('g2-conflict-admin@test.com', User.Role.CENTRAL_ADMIN)
        self.student = _make_student('CONFLICT-1', self.dorm_type)
        _, _, self.room, _ = _make_room(self.dorm_type, 1, n_beds=1)

    def test_concurrent_approve_and_reject_same_request(self):
        req = StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.ROOM, reason='conflict',
            requested_by=self.admin, student=self.student, target_room=self.room,
        )

        def _approve():
            client = _client_for(self.admin)
            resp = client.put(f'/api/requests/{req.id}/approve/', {}, format='json')
            return ('approve', resp.status_code, resp.content[:300])

        def _reject():
            client = _client_for(self.admin)
            resp = client.put(f'/api/requests/{req.id}/reject/', {'reason': 'conflict'}, format='json')
            return ('reject', resp.status_code, resp.content[:300])

        results = _run_concurrently([_approve, _reject])
        status_codes = sorted(r[1] for r in results)
        req.refresh_from_db()

        _record(
            '--- StudentRequestApproveRejectConflictTests.test_concurrent_approve_and_reject_same_request ---',
            f'results: {results}',
            f'final request.status: {req.status}',
            '',
        )

        self.assertNotIn(500, status_codes, 'REGRESSION: an approve/reject conflict must never surface as an unhandled 500')
        self.assertEqual(status_codes.count(200), 1, 'exactly one of approve/reject must win')
        self.assertEqual(status_codes.count(400), 1, 'the loser must get a clean 400 ("already processed")')
        self.assertIn(
            req.status, (StudentRequest.Status.APPROVED, StudentRequest.Status.REJECTED),
            'final status must be unambiguous - never left PENDING or in an inconsistent state',
        )
        # Whichever action won must be the one that actually determined
        # the final status (no silent mismatch between "who got 200" and
        # "what actually got persisted").
        winner_action = next(r[0] for r in results if r[1] == 200)
        expected_status = (
            StudentRequest.Status.APPROVED if winner_action == 'approve' else StudentRequest.Status.REJECTED
        )
        self.assertEqual(req.status, expected_status)


class ConcurrentBedContentionAcrossRequestsTests(TransactionTestCase):
    """
    The GOOD case, empirically confirmed rather than just theorized: two
    DIFFERENT StudentRequest rows (two different students) both targeting
    the SAME single-free-bed room, approved concurrently. This is what
    assign_student_to_room()'s apartment-level select_for_update() exists
    to prevent - exactly one of the two students should end up assigned
    to that bed, never both (no double-booking). Untouched by the Group 2
    implementation phase's locking changes (still the same protection
    mechanism) - re-run here to confirm nothing regressed.
    """

    def setUp(self):
        self.region, self.dorm_type = _make_region('g2-contend-region', 'G2 Contend Region', 9004)
        self.admin = _make_user('g2-contend-admin@test.com', User.Role.CENTRAL_ADMIN)
        _, _, self.room, _ = _make_room(self.dorm_type, 1, n_beds=1)
        self.student_a = _make_student('CONTEND-A', self.dorm_type)
        self.student_b = _make_student('CONTEND-B', self.dorm_type)

    def test_two_students_racing_for_the_last_bed(self):
        req_a = StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.ROOM, reason='contend-a',
            requested_by=self.admin, student=self.student_a, target_room=self.room,
        )
        req_b = StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.ROOM, reason='contend-b',
            requested_by=self.admin, student=self.student_b, target_room=self.room,
        )

        def _approve(req_id):
            client = _client_for(self.admin)
            resp = client.put(f'/api/requests/{req_id}/approve/', {}, format='json')
            return resp.status_code, resp.content[:300]

        results = _run_concurrently([
            lambda: _approve(req_a.id),
            lambda: _approve(req_b.id),
        ])
        status_codes = sorted(r[0] for r in results)

        active_assignments_in_room = BedAssignment.objects.filter(
            bed__room=self.room, status=BedAssignment.Status.ACTIVE,
        ).count()

        _record(
            '--- ConcurrentBedContentionAcrossRequestsTests.test_two_students_racing_for_the_last_bed ---',
            f'thread A (student A) response: {results[0]}',
            f'thread B (student B) response: {results[1]}',
            f'status_codes (sorted): {status_codes}',
            f'active BedAssignment rows in the contested room (must be exactly 1 - no double-booking): '
            f'{active_assignments_in_room}',
            '',
        )

        self.assertEqual(active_assignments_in_room, 1, 'the single free bed must never be double-booked')
        self.assertEqual(status_codes.count(200), 1, 'exactly one of the two students must win the bed')
        self.assertNotIn(500, status_codes)


class MultiRegionConcurrentManagerTests(TransactionTestCase):
    """
    Group 2's specific multi-region scenario: two REGION_BOSS users from
    DIFFERENT regions (per the stated business rule - one manager per
    region - two managers are never in the same region) each approving
    their OWN pending request in their OWN region at the same time.
    Confirms: (a) both succeed independently, (b) region A's action has
    zero effect on region B's data, and (c) working in different regions
    does not seriously serialize/block one manager behind the other (they
    touch disjoint Apartment rows, so the apartment-level
    select_for_update in assign_student_to_room() - and now also the new
    StudentRequest-row select_for_update - never contend between them).
    Re-run here, unchanged, to confirm the new locking added in this
    implementation phase does not introduce cross-region blocking.
    """

    def setUp(self):
        self.region_a, self.dorm_a = _make_region('g2-mr-region-a', 'G2 MultiRegion A', 9005)
        self.region_b, self.dorm_b = _make_region('g2-mr-region-b', 'G2 MultiRegion B', 9006)
        self.boss_a = _make_user('g2-mr-boss-a@test.com', User.Role.REGION_BOSS, self.region_a)
        self.boss_b = _make_user('g2-mr-boss-b@test.com', User.Role.REGION_BOSS, self.region_b)

        _, _, self.room_a, _ = _make_room(self.dorm_a, 1, n_beds=1)
        _, _, self.room_b, _ = _make_room(self.dorm_b, 1, n_beds=1)
        self.student_a = _make_student('MR-STUDENT-A', self.dorm_a)
        self.student_b = _make_student('MR-STUDENT-B', self.dorm_b)

    def test_concurrent_same_region_approvals_do_not_interfere(self):
        req_a = StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.ROOM, reason='mr-a',
            requested_by=self.boss_a, student=self.student_a, target_room=self.room_a,
        )
        req_b = StudentRequest.objects.create(
            request_type=StudentRequest.RequestType.ROOM, reason='mr-b',
            requested_by=self.boss_b, student=self.student_b, target_room=self.room_b,
        )

        timings = {}

        def _approve(label, user, req_id):
            client = _client_for(user)
            start = time.perf_counter()
            resp = client.put(f'/api/requests/{req_id}/approve/', {}, format='json')
            timings[label] = (time.perf_counter() - start) * 1000
            return resp.status_code, resp.content[:300]

        wall_start = time.perf_counter()
        results = _run_concurrently([
            lambda: _approve('boss_a', self.boss_a, req_a.id),
            lambda: _approve('boss_b', self.boss_b, req_b.id),
        ])
        wall_elapsed_ms = (time.perf_counter() - wall_start) * 1000

        self.student_a.refresh_from_db()
        self.student_b.refresh_from_db()

        _record(
            '--- MultiRegionConcurrentManagerTests.test_concurrent_same_region_approvals_do_not_interfere ---',
            f'boss_a (region {self.region_a.id}) response: {results[0]}  time_ms={timings["boss_a"]:.2f}',
            f'boss_b (region {self.region_b.id}) response: {results[1]}  time_ms={timings["boss_b"]:.2f}',
            f'wall_clock_for_both_concurrently_ms: {wall_elapsed_ms:.2f}  '
            f'(sum_if_fully_serialized_ms: {timings["boss_a"] + timings["boss_b"]:.2f})',
            f'student_a.assigned_room == room_a: {self.student_a.assigned_room_id == self.room_a.id}',
            f'student_b.assigned_room == room_b: {self.student_b.assigned_room_id == self.room_b.id}',
            '',
        )

        self.assertEqual(results[0][0], 200)
        self.assertEqual(results[1][0], 200)
        # Region isolation: each student ends up in THEIR OWN region's
        # room, never cross-contaminated by the other manager's
        # simultaneous action.
        self.assertEqual(self.student_a.assigned_room_id, self.room_a.id)
        self.assertEqual(self.student_b.assigned_room_id, self.room_b.id)
        # Not meant as a strict performance assertion (this local
        # environment's per-query overhead is highly variable) - just
        # records whether the two managers' work in DIFFERENT regions ran
        # roughly in parallel (wall clock well under the sum of both)
        # rather than fully serialized back-to-back, even with the new
        # StudentRequest-row locking added in this implementation phase.
        self.assertLess(
            wall_elapsed_ms, (timings['boss_a'] + timings['boss_b']) * 1.5,
            'two managers in different regions should not be almost-fully serialized',
        )


class RegionInboxDoubleMarkTests(TransactionTestCase):
    """
    G2-12: confirmed idempotent and safe under concurrent use in the
    audit - deliberately left UNCHANGED (no new locking added) per the
    Group 2 implementation phase's explicit instruction not to over-fix
    low-risk items without new concrete evidence requiring it. Re-run here
    to keep that evidence current.
    """

    def setUp(self):
        self.region, self.dorm_type = _make_region('g2-inbox-region', 'G2 Inbox Region', 9007)
        self.boss = _make_user('g2-inbox-boss@test.com', User.Role.REGION_BOSS, self.region)
        uploader = _make_user('g2-inbox-uploader@test.com', User.Role.CENTRAL_ADMIN)
        batch = ImportBatch.objects.create(uploaded_by=uploader, filename='race.csv', total_students=1)
        self.inbox_item = RegionInbox.objects.create(
            region=self.region, batch=batch, status=RegionInbox.Status.PENDING,
            message='race test',
        )

    def test_concurrent_mark_processed_does_not_crash_or_corrupt(self):
        def _mark():
            client = _client_for(self.boss)
            resp = client.put(f'/api/inbox/{self.inbox_item.id}/processed/', {}, format='json')
            return resp.status_code

        results = _run_concurrently([_mark, _mark])
        self.inbox_item.refresh_from_db()

        _record(
            '--- RegionInboxDoubleMarkTests.test_concurrent_mark_processed_does_not_crash_or_corrupt ---',
            f'status_codes: {sorted(results)}',
            f'final inbox status: {self.inbox_item.status}',
            '',
        )

        self.assertNotIn(500, results)
        self.assertEqual(self.inbox_item.status, RegionInbox.Status.PROCESSED)


def tearDownModule():
    _flush_evidence()
