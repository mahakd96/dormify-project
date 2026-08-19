"""
Tests for the building-paged hierarchical matching response
(Building -> Apartment -> Room -> Bed), real-bed occupancy rules, the
strict read-only browsing guarantee, and capacity/double-assignment
protection on the write path.

Run against Django's disposable TEST database (created/destroyed as
test_<DB_NAME> - never touches the real `dormify` database):

    python manage.py test api.tests.test_bed_hierarchy
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import (
    User, Region, DormType, Building, Apartment, Room, Bed,
    Student, BedAssignment,
)
from api.tests.matching_test_utils import create_beds_for_room, flatten_bed_options


def _make_user(email, role, region=None):
    user = User(email=email, username=email, role=role, region=region,
                first_name='T', last_name='User')
    user.set_password('testpass123')
    user.save()
    return user


def _make_dorm_type(region, code, name=None):
    return DormType.objects.create(code=code, name=name or f'DT{code}', region=region)


def _make_room(dorm_type, building_number, apartment_number, category,
                apartment_type=Apartment.ApartmentType.SINGLE, room_capacity=2,
                with_beds=True):
    building = Building.objects.create(number=building_number, dorm_type=dorm_type)
    apartment = Apartment.objects.create(
        building=building, number=apartment_number, category=category,
        apartment_type=apartment_type, room_count=1,
    )
    room = Room.objects.create(apartment=apartment, name='101', capacity=room_capacity)
    if with_beds:
        create_beds_for_room(room)
    return building, apartment, room


def _make_student(student_id, gender, housing_type, dorm_type, **extra):
    return Student.objects.create(
        student_id=student_id, first_name='F', last_name='L',
        gender=gender, housing_type=housing_type, accepted_dorm_type=dorm_type,
        **extra,
    )


class BedHierarchyTestBase(TestCase):
    def setUp(self):
        self.region = Region.objects.create(id='canada', name='Canada')
        self.dorm_type = _make_dorm_type(self.region, code=1)
        self.admin = _make_user('admin@test.com', User.Role.CENTRAL_ADMIN)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _student(self, sid='S-MAIN'):
        return _make_student(sid, Student.Gender.MALE, Student.HousingType.SINGLE_MALE, self.dorm_type)

    def _match(self, student, **extra):
        payload = {'student_id': student.id}
        payload.update(extra)
        resp = self.client.post('/api/requests/match-options/', payload, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.data

    def _assign(self, student, room, bed_id=None, expect_status=200):
        payload = {'student_id': student.id, 'room_id': room.id}
        if bed_id is not None:
            payload['bed_id'] = bed_id
        resp = self.client.post('/api/room-assignments/assign/', payload, format='json')
        self.assertEqual(resp.status_code, expect_status, resp.content)
        return resp


class RoomOccupancyRuleTests(BedHierarchyTestBase):
    """Required tests 1-5: real capacity + real BedAssignment occupancy."""

    # 1. Empty one-bed room is selectable.
    def test_empty_one_bed_room_is_selectable(self):
        _, _, room = _make_room(self.dorm_type, 1, '1', Apartment.Category.MALE, room_capacity=1)
        data = self._match(self._student())
        beds = [o for o in flatten_bed_options(data) if o['room_id'] == room.id]
        self.assertEqual(len(beds), 1)
        self.assertTrue(beds[0]['is_selectable'])
        self.assertFalse(beds[0]['is_occupied'])
        self.assertEqual(beds[0]['room_capacity'], 1)
        self.assertEqual(beds[0]['available_beds_count'], 1)

    # 2. Occupied one-bed room is unavailable (full room = hard conflict,
    # excluded from the assignable hierarchy entirely).
    def test_occupied_one_bed_room_is_unavailable(self):
        _, _, room = _make_room(self.dorm_type, 1, '1', Apartment.Category.MALE, room_capacity=1)
        _, _, other_room = _make_room(self.dorm_type, 2, '2', Apartment.Category.MALE, room_capacity=1)
        occupant = self._student('S-OCC')
        self._assign(occupant, room)

        data = self._match(self._student())
        room_ids = {o['room_id'] for o in flatten_bed_options(data)}
        self.assertNotIn(room.id, room_ids)
        self.assertIn(other_room.id, room_ids)

    # 3. Empty two-bed room exposes two distinct available beds.
    def test_empty_two_bed_room_exposes_two_available_beds(self):
        _, _, room = _make_room(self.dorm_type, 1, '1', Apartment.Category.MALE, room_capacity=2)
        data = self._match(self._student())
        beds = [o for o in flatten_bed_options(data) if o['room_id'] == room.id]
        self.assertEqual(len(beds), 2)
        self.assertTrue(all(b['is_selectable'] and not b['is_occupied'] for b in beds))
        self.assertEqual(len({b['bed_id'] for b in beds}), 2)
        self.assertEqual(beds[0]['available_beds_count'], 2)
        self.assertEqual(beds[0]['occupied_beds_count'], 0)

    # 4. Partially occupied two-bed room: only the actually free bed is
    # selectable, the occupied one is shown as occupied, and the room is
    # NOT treated as unavailable.
    def test_partially_occupied_two_bed_room_exposes_only_free_bed(self):
        _, _, room = _make_room(self.dorm_type, 1, '1', Apartment.Category.MALE, room_capacity=2)
        occupant = self._student('S-OCC')
        self._assign(occupant, room)
        occupied_bed_id = BedAssignment.objects.get(student=occupant, status='active').bed_id

        data = self._match(self._student())
        beds = [o for o in flatten_bed_options(data) if o['room_id'] == room.id]
        self.assertEqual(len(beds), 2, 'both real beds stay visible')
        by_id = {b['bed_id']: b for b in beds}
        self.assertTrue(by_id[occupied_bed_id]['is_occupied'])
        self.assertFalse(by_id[occupied_bed_id]['is_selectable'])
        free = [b for b in beds if b['bed_id'] != occupied_bed_id]
        self.assertEqual(len(free), 1)
        self.assertTrue(free[0]['is_selectable'])
        self.assertEqual(beds[0]['occupied_beds_count'], 1)
        self.assertEqual(beds[0]['available_beds_count'], 1)

    # 5. Fully occupied two-bed room is unavailable.
    def test_fully_occupied_two_bed_room_is_unavailable(self):
        _, _, room = _make_room(self.dorm_type, 1, '1', Apartment.Category.MALE, room_capacity=2)
        _, _, other_room = _make_room(self.dorm_type, 2, '2', Apartment.Category.MALE, room_capacity=2)
        self._assign(self._student('S-A'), room)
        self._assign(self._student('S-B'), room)

        data = self._match(self._student())
        room_ids = {o['room_id'] for o in flatten_bed_options(data)}
        self.assertNotIn(room.id, room_ids)
        self.assertIn(other_room.id, room_ids)


class AssignmentProtectionTests(BedHierarchyTestBase):
    """Required tests 6-7: no double bed allocation, no capacity overflow."""

    # 6. The same bed can never be allocated twice - the second caller (the
    # loser of the race; the apartment-level lock serializes true
    # concurrency) is rejected and exactly one active assignment survives.
    def test_same_bed_cannot_be_allocated_twice(self):
        _, _, room = _make_room(self.dorm_type, 1, '1', Apartment.Category.MALE, room_capacity=2)
        target_bed = room.beds.order_by('id').first()

        self._assign(self._student('S-A'), room, bed_id=target_bed.id)
        resp = self._assign(self._student('S-B'), room, bed_id=target_bed.id, expect_status=400)
        self.assertIn('תפוסה', str(resp.data))
        self.assertEqual(
            BedAssignment.objects.filter(bed=target_bed, status='active').count(), 1,
        )

    # 7. Room capacity can never be exceeded - even when surplus Bed rows
    # exist (data anomaly), the configured capacity is authoritative.
    def test_room_capacity_cannot_be_exceeded(self):
        _, _, room = _make_room(self.dorm_type, 1, '1', Apartment.Category.MALE, room_capacity=1)
        surplus_bed = Bed.objects.create(room=room, label='Bed 2')  # anomaly: 2 rows, capacity 1

        self._assign(self._student('S-A'), room)
        # Free bed row exists, but capacity is already reached - both the
        # specific-bed path and the auto-pick path must refuse.
        self._assign(self._student('S-B'), room, bed_id=surplus_bed.id, expect_status=400)
        self._assign(self._student('S-C'), room, expect_status=400)
        self.assertEqual(
            BedAssignment.objects.filter(bed__room=room, status='active').count(), 1,
        )

    # The matching response never offers more beds than capacity either.
    def test_matching_never_offers_more_beds_than_capacity(self):
        _, _, room = _make_room(self.dorm_type, 1, '1', Apartment.Category.MALE, room_capacity=1)
        Bed.objects.create(room=room, label='Bed 2')  # surplus row
        data = self._match(self._student())
        beds = [o for o in flatten_bed_options(data) if o['room_id'] == room.id]
        selectable = [b for b in beds if b['is_selectable']]
        self.assertEqual(len(selectable), 1)
        self.assertEqual(data['total_valid_beds'], 1)


class ReadOnlyBrowsingTests(BedHierarchyTestBase):
    """Browsing/matching must never write; missing Bed rows are reported as
    a data-integrity problem, never silently created."""

    def test_browsing_never_creates_bed_rows(self):
        # A room with capacity but NO Bed rows at all - the old
        # implementation would have materialized rows right here.
        _, _, room = _make_room(self.dorm_type, 1, '1', Apartment.Category.MALE,
                                room_capacity=2, with_beds=False)
        self.assertEqual(Bed.objects.count(), 0)

        data = self._match(self._student())
        data = self._match(self._student('S-2'))  # browse twice for good measure

        self.assertEqual(Bed.objects.count(), 0, 'browsing must not create Bed rows')
        # The room is reported as a data-integrity problem, with zero
        # selectable beds - not silently "fixed" and not silently hidden.
        di = data['data_integrity']
        self.assertEqual(di['rooms_missing_bed_records'], 1)
        self.assertEqual(di['missing_bed_records'], 2)
        room_beds = [o for o in flatten_bed_options(data) if o['room_id'] == room.id]
        self.assertEqual(room_beds, [], 'no fake beds may appear')
        self.assertEqual(data['total_valid_beds'], 0)
        self.assertFalse(data['feasible'])
        self.assertIn('רשומות מיטה', data['reason'])

    def test_feasibility_endpoint_is_also_read_only(self):
        from api.models import StudentRequest
        _, _, room = _make_room(self.dorm_type, 1, '1', Apartment.Category.MALE,
                                room_capacity=2, with_beds=False)
        student = self._student()
        req = StudentRequest.objects.create(
            student=student, request_type='room', reason='r',
            requested_by=self.admin, request_number='REQ-RO-1',
        )
        before = Bed.objects.count()
        resp = self.client.get(f'/api/requests/{req.id}/feasibility/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(Bed.objects.count(), before)

    def test_assignment_to_room_without_bed_rows_fails_with_integrity_error(self):
        _, _, room = _make_room(self.dorm_type, 1, '1', Apartment.Category.MALE,
                                room_capacity=2, with_beds=False)
        resp = self._assign(self._student(), room, expect_status=400)
        self.assertIn('materialize_beds', str(resp.data))
        self.assertEqual(Bed.objects.count(), 0, 'a failed assignment must not create beds')


class BuildingPaginationTests(BedHierarchyTestBase):
    """Pagination unit is the building (by PK); pages append disjointly and
    every page carries complete subtrees."""

    def test_building_pages_are_disjoint_and_complete(self):
        for i in range(12):
            _make_room(self.dorm_type, i + 1, str(i + 1), Apartment.Category.MALE, room_capacity=1)
        student = self._student()

        page1 = self._match(student, limit=5, offset=0)
        self.assertEqual(page1['total_buildings'], 12)
        self.assertEqual(page1['total_apartments'], 12)
        self.assertEqual(page1['total_rooms'], 12)
        self.assertEqual(page1['total_valid_beds'], 12)
        self.assertEqual(len(page1['buildings']), 5)
        self.assertEqual(page1['loaded_buildings'], 5)
        self.assertTrue(page1['has_more'])
        self.assertEqual(page1['next_offset'], 5)

        page2 = self._match(student, limit=5, offset=5)
        page3 = self._match(student, limit=5, offset=10)
        self.assertEqual(len(page2['buildings']), 5)
        self.assertEqual(len(page3['buildings']), 2)
        self.assertFalse(page3['has_more'])
        self.assertIsNone(page3['next_offset'])
        self.assertEqual(page3['loaded_buildings'], 12)

        ids1 = {b['building_id'] for b in page1['buildings']}
        ids2 = {b['building_id'] for b in page2['buildings']}
        ids3 = {b['building_id'] for b in page3['buildings']}
        self.assertEqual(len(ids1 | ids2 | ids3), 12, 'pages must be disjoint and cover everything')

        # Every returned building is complete: counts match its own subtree.
        for b in page1['buildings']:
            self.assertEqual(b['apartment_count'], len(b['apartments']))
            subtree_rooms = sum(len(a['rooms']) for a in b['apartments'])
            self.assertEqual(b['room_count'], subtree_rooms)

    def test_buildings_with_same_number_in_different_dorms_stay_distinct(self):
        other_dorm_type = _make_dorm_type(self.region, code=2)
        _, _, room_a = _make_room(self.dorm_type, 105, '1', Apartment.Category.MALE, room_capacity=1)
        _, _, room_b = _make_room(other_dorm_type, 105, '1', Apartment.Category.MALE, room_capacity=1)

        data = self._match(self._student(), limit=20)
        # Identity is the building PK, never the reusable building number.
        self.assertEqual(data['total_buildings'], 2)
        numbers = [b['building_number'] for b in data['buildings']]
        self.assertEqual(numbers, [105, 105])
        ids = {b['building_id'] for b in data['buildings']}
        self.assertEqual(len(ids), 2)

    # Required test 8 (backend half): every bed is returned inside its full
    # location context so the UI can always show
    # region -> building -> apartment -> room -> bed.
    def test_full_location_context_present_for_every_bed(self):
        _, apartment, room = _make_room(self.dorm_type, 105, '3', Apartment.Category.MALE, room_capacity=2)
        data = self._match(self._student())

        b = data['buildings'][0]
        for key in ('building_id', 'building_number', 'building_name', 'region',
                    'region_name', 'dorm_type', 'dorm_type_id', 'apartment_count',
                    'room_count', 'available_bed_count', 'recommendation_level',
                    'recommendation_label', 'apartments'):
            self.assertIn(key, b)
        self.assertEqual(b['region_name'], 'Canada')

        a = b['apartments'][0]
        for key in ('apartment_id', 'apartment_number', 'apartment_gender',
                    'residents', 'matched_reasons', 'warnings', 'historical_reasons',
                    'available_bed_count', 'rooms'):
            self.assertIn(key, a)
        self.assertEqual(a['apartment_id'], apartment.id)

        r = a['rooms'][0]
        for key in ('room_id', 'room_name', 'capacity', 'occupied_beds_count',
                    'available_beds_count', 'beds'):
            self.assertIn(key, r)
        self.assertEqual(r['room_id'], room.id)

        for bed in r['beds']:
            for key in ('bed_id', 'bed_label', 'is_occupied', 'is_selectable'):
                self.assertIn(key, bed)
