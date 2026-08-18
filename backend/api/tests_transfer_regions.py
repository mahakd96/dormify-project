"""
Tests for the transfer-scope workflow (same-region / cross-region) and its
role-based region enforcement: central admins may search/approve across
explicitly selected destination regions; regional staff are hard-locked to
their own region in the backend (frontend checks are never trusted).

Run against Django's disposable TEST database (created/destroyed as
test_<DB_NAME> - never touches the real `dormify` database):

    python manage.py test api.tests_transfer_regions
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import (
    User, Region, DormType, Apartment, Building, Room,
    Student, BedAssignment, StudentRequest,
)
from api.matching_test_utils import create_beds_for_room, flatten_bed_options


def _make_user(email, role, region=None):
    user = User(email=email, username=email, role=role, region=region,
                first_name='T', last_name='User')
    user.set_password('testpass123')
    user.save()
    return user


def _make_room(dorm_type, building_number, apartment_number,
               category=Apartment.Category.MALE, room_capacity=2):
    building = Building.objects.create(number=building_number, dorm_type=dorm_type)
    apartment = Apartment.objects.create(
        building=building, number=apartment_number, category=category,
        apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
    )
    room = Room.objects.create(apartment=apartment, name='101', capacity=room_capacity)
    create_beds_for_room(room)
    return building, apartment, room


class TransferRegionTestBase(TestCase):
    def setUp(self):
        self.region_a = Region.objects.create(id='rega', name='Region A')
        self.region_b = Region.objects.create(id='regb', name='Region B')
        self.region_c = Region.objects.create(id='regc', name='Region C')
        self.dorm_a = DormType.objects.create(code=1, name='Dorm A', region=self.region_a)
        self.dorm_b = DormType.objects.create(code=2, name='Dorm B', region=self.region_b)
        self.dorm_c = DormType.objects.create(code=3, name='Dorm C', region=self.region_c)

        _, _, self.room_a1 = _make_room(self.dorm_a, 1, '1')
        _, _, self.room_a2 = _make_room(self.dorm_a, 2, '2')
        _, _, self.room_b1 = _make_room(self.dorm_b, 10, '1')
        _, _, self.room_c1 = _make_room(self.dorm_c, 20, '1')

        self.admin = _make_user('admin@test.com', User.Role.CENTRAL_ADMIN)
        self.boss_a = _make_user('bossa@test.com', User.Role.REGION_BOSS, self.region_a)
        self.employee_a = _make_user('empa@test.com', User.Role.EMPLOYEE, self.region_a)
        self.boss_b = _make_user('bossb@test.com', User.Role.REGION_BOSS, self.region_b)

        self.student = Student.objects.create(
            student_id='S1', first_name='F', last_name='L',
            gender=Student.Gender.MALE, housing_type=Student.HousingType.SINGLE_MALE,
            accepted_dorm_type=self.dorm_a,
        )

        self.admin_client = APIClient()
        self.admin_client.force_authenticate(self.admin)
        # The student physically lives in region A (room_a1).
        resp = self.admin_client.post('/api/room-assignments/assign/', {
            'student_id': self.student.id, 'room_id': self.room_a1.id,
        }, format='json')
        assert resp.status_code == 200, resp.content

    def _client(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def _match(self, client, expect=200, **payload):
        payload.setdefault('student_id', self.student.id)
        resp = client.post('/api/requests/match-options/', payload, format='json')
        self.assertEqual(resp.status_code, expect, resp.content)
        return resp.data

    def _regions_in(self, data):
        return {b['region'] for b in data['buildings']}

    def _make_request(self, scope, destinations=(), request_type='apartment', creator=None):
        req = StudentRequest.objects.create(
            student=self.student, request_type=request_type, reason='r',
            requested_by=creator or self.admin, transfer_scope=scope,
            source_region=self.region_a,
            request_number=f'REQ-T{StudentRequest.objects.count() + 1:05d}',
        )
        if destinations:
            req.destination_regions.set(destinations)
        return req


class MatchOptionsScopeTests(TransferRegionTestBase):
    # 1+2. Central admin same-region: only the student's CURRENT region,
    # chosen automatically - no region selector needed or honored.
    def test_same_region_scope_searches_only_current_region(self):
        data = self._match(self.admin_client, transfer_scope='same_region',
                           region_ids=['regb'])  # even if the client smuggles one, it is ignored
        self.assertEqual(self._regions_in(data), {'rega'})
        self.assertEqual([r['id'] for r in data['search_regions']], ['rega'])
        self.assertEqual(data['transfer_scope'], 'same_region')
        # The student's own current room is excluded from the options.
        self.assertNotIn(self.room_a1.id, {o['room_id'] for o in flatten_bed_options(data)})

    # 3. Central admin cross-region with ONE destination region.
    def test_cross_region_single_destination(self):
        data = self._match(self.admin_client, transfer_scope='cross_region', region_ids=['regb'])
        self.assertEqual(self._regions_in(data), {'regb'})

    # 4+5. Central admin cross-region with MULTIPLE destination regions -
    # results come only from the selected regions, and the student's current
    # region is NOT included implicitly.
    def test_cross_region_multiple_destinations(self):
        data = self._match(self.admin_client, transfer_scope='cross_region',
                           region_ids=['regb', 'regc'])
        self.assertEqual(self._regions_in(data), {'regb', 'regc'})
        self.assertNotIn('rega', self._regions_in(data))
        self.assertEqual({r['id'] for r in data['search_regions']}, {'regb', 'regc'})

    def test_cross_region_requires_at_least_one_destination(self):
        data = self._match(self.admin_client, expect=400, transfer_scope='cross_region')
        self.assertIn('אזור יעד', data['reason'])

    # 14 (backend half). Later pages keep the exact same region scope.
    def test_load_more_pages_keep_selected_regions(self):
        for i in range(12):
            _make_room(self.dorm_b, 100 + i, str(i))
        page2 = self._match(self.admin_client, transfer_scope='cross_region',
                            region_ids=['regb'], limit=5, offset=5)
        self.assertTrue(page2['buildings'])
        self.assertEqual(self._regions_in(page2), {'regb'})


class RegionalUserRestrictionTests(TransferRegionTestBase):
    # 6. Regional staff may match only inside their own region.
    def test_regional_employee_same_region_works(self):
        data = self._match(self._client(self.employee_a), transfer_scope='same_region')
        self.assertEqual(self._regions_in(data), {'rega'})

    # 7+8. Cross-region browsing / foreign region ids => HTTP 403 with a
    # clear JSON error, enforced in the backend.
    def test_regional_employee_cross_region_scope_403(self):
        resp = self._client(self.employee_a).post('/api/requests/match-options/', {
            'student_id': self.student.id, 'transfer_scope': 'cross_region', 'region_ids': ['regb'],
        }, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data['detail'], 'אין לך הרשאה לבצע מעבר לאזור אחר.')

    def test_regional_employee_foreign_region_ids_403(self):
        for payload in (
            {'region_ids': ['regb']},
            {'region_id': 'regb'},
            {'transfer_scope': 'same_region', 'region_ids': ['regb', 'rega']},
        ):
            resp = self._client(self.employee_a).post('/api/requests/match-options/', {
                'student_id': self.student.id, **payload,
            }, format='json')
            self.assertEqual(resp.status_code, 403, payload)
            self.assertEqual(resp.data['detail'], 'אין לך הרשאה לבצע מעבר לאזור אחר.')

    def test_regional_employee_cannot_create_cross_region_request(self):
        resp = self._client(self.employee_a).post('/api/requests/', {
            'student': self.student.id, 'request_type': 'apartment', 'reason': 'r',
            'transfer_scope': 'cross_region', 'destination_regions': ['regb'],
        }, format='json')
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertIn('אין לך הרשאה', str(resp.data))

    def test_regional_employee_cannot_smuggle_destinations_into_same_region_request(self):
        resp = self._client(self.employee_a).post('/api/requests/', {
            'student': self.student.id, 'request_type': 'apartment', 'reason': 'r',
            'transfer_scope': 'same_region', 'destination_regions': ['regb'],
        }, format='json')
        self.assertEqual(resp.status_code, 403, resp.content)


class RequestPersistenceTests(TransferRegionTestBase):
    # 12. The scope, source region, destination regions and assignment
    # snapshot are PERSISTED rows (they survive re-fetch from a fresh
    # session; docker restarts only recycle the process, the data lives in
    # PostgreSQL - the same thing this test proves at the DB level).
    def test_cross_region_request_persists_all_fields(self):
        create = self.admin_client.post('/api/requests/', {
            'student': self.student.id, 'request_type': 'apartment', 'reason': 'move',
            'transfer_scope': 'cross_region', 'destination_regions': ['regb', 'regc'],
        }, format='json')
        self.assertEqual(create.status_code, 201, create.content)
        req_id = create.data['id']

        fresh = APIClient()
        fresh.force_authenticate(self.admin)
        data = fresh.get(f'/api/requests/{req_id}/').data
        self.assertEqual(data['transfer_scope'], 'cross_region')
        self.assertEqual(set(data['destination_regions']), {'regb', 'regc'})
        self.assertEqual(set(data['destination_region_names']), {'Region B', 'Region C'})
        self.assertEqual(data['source_region'], 'rega')
        self.assertEqual(data['source_region_name'], 'Region A')
        snapshot = data['current_assignment_snapshot']
        self.assertTrue(snapshot['assigned'])
        self.assertEqual(snapshot['room_id'], self.room_a1.id)
        self.assertEqual(snapshot['region_id'], 'rega')

        row = StudentRequest.objects.get(pk=req_id)
        self.assertEqual(row.transfer_scope, 'cross_region')
        self.assertEqual(set(row.destination_regions.values_list('id', flat=True)), {'regb', 'regc'})

    def test_same_region_request_defaults_scope_and_source(self):
        create = self.admin_client.post('/api/requests/', {
            'student': self.student.id, 'request_type': 'room', 'reason': 'move',
        }, format='json')
        self.assertEqual(create.status_code, 201, create.content)
        row = StudentRequest.objects.get(pk=create.data['id'])
        self.assertEqual(row.transfer_scope, 'same_region')
        self.assertEqual(row.source_region_id, 'rega')
        self.assertTrue(row.current_assignment_snapshot['assigned'])

    # Feasibility for a STORED request derives its regions from the request
    # itself - never from client parameters.
    def test_feasibility_uses_stored_destination_regions(self):
        req = self._make_request('cross_region', [self.region_b])
        data = self.admin_client.get(f'/api/requests/{req.id}/feasibility/').data
        self.assertEqual(self._regions_in(data), {'regb'})
        self.assertEqual([r['id'] for r in data['search_regions']], ['regb'])

    def test_feasibility_same_region_uses_stored_source(self):
        req = self._make_request('same_region')
        data = self.admin_client.get(f'/api/requests/{req.id}/feasibility/').data
        self.assertEqual(self._regions_in(data), {'rega'})


class ApprovalTests(TransferRegionTestBase):
    # 9. Central admin approves a cross-region transfer; the assignment
    # moves atomically and the final assignment is persisted.
    def test_central_admin_approves_cross_region(self):
        req = self._make_request('cross_region', [self.region_b])
        resp = self.admin_client.put(f'/api/requests/{req.id}/approve/', {
            'target_room': self.room_b1.id,
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

        req.refresh_from_db()
        self.assertEqual(req.status, 'approved')
        self.assertIsNotNone(req.final_assignment_id)
        self.assertEqual(req.final_assignment.bed.room_id, self.room_b1.id)
        self.assertTrue(BedAssignment.objects.filter(
            student=self.student, bed__room=self.room_b1, status='active').exists())
        self.assertFalse(BedAssignment.objects.filter(
            student=self.student, bed__room=self.room_a1, status='active').exists())

    # Approval revalidates the destination against the STORED scope.
    def test_cross_region_approval_rejects_room_outside_selected_regions(self):
        req = self._make_request('cross_region', [self.region_b])
        resp = self.admin_client.put(f'/api/requests/{req.id}/approve/', {
            'target_room': self.room_c1.id,  # region C was never selected
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('אזורי היעד', resp.data['error'])
        req.refresh_from_db()
        self.assertEqual(req.status, 'pending')

    def test_same_region_approval_rejects_room_in_other_region(self):
        req = self._make_request('same_region')
        resp = self.admin_client.put(f'/api/requests/{req.id}/approve/', {
            'target_room': self.room_b1.id,
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        req.refresh_from_db()
        self.assertEqual(req.status, 'pending')

    # 8/10. A regional boss can never approve a cross-region transfer:
    # the DESTINATION region's boss cannot even see the request (404 - the
    # student belongs to another region, nothing is exposed), and the
    # SOURCE region's boss, who can see it, is rejected with 403.
    def test_regional_boss_cannot_approve_cross_region(self):
        req = self._make_request('cross_region', [self.region_b])

        resp_b = self._client(self.boss_b).put(f'/api/requests/{req.id}/approve/', {
            'target_room': self.room_b1.id,
        }, format='json')
        self.assertEqual(resp_b.status_code, 404, resp_b.content)

        # Even towards a room in his OWN region (which he may normally edit),
        # the source-region boss cannot approve a cross-region request.
        resp_a = self._client(self.boss_a).put(f'/api/requests/{req.id}/approve/', {
            'target_room': self.room_a2.id,
        }, format='json')
        self.assertEqual(resp_a.status_code, 403, resp_a.content)
        self.assertEqual(resp_a.data['detail'], 'אין לך הרשאה לבצע מעבר לאזור אחר.')

        req.refresh_from_db()
        self.assertEqual(req.status, 'pending')
        self.assertTrue(BedAssignment.objects.filter(
            student=self.student, bed__room=self.room_a1, status='active').exists())

    # 10. A regional boss CAN approve a valid same-region transfer inside
    # their own region.
    def test_regional_boss_approves_same_region_in_own_region(self):
        req = self._make_request('same_region', creator=self.employee_a)
        resp = self._client(self.boss_a).put(f'/api/requests/{req.id}/approve/', {
            'target_room': self.room_a2.id,
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(BedAssignment.objects.filter(
            student=self.student, bed__room=self.room_a2, status='active').exists())
        req.refresh_from_db()
        self.assertEqual(req.final_assignment.bed.room_id, self.room_a2.id)

    # 11. If the destination assignment fails, the current assignment is
    # untouched and the request is NOT approved.
    def test_failed_destination_preserves_current_assignment(self):
        filler1 = Student.objects.create(
            student_id='F1', first_name='F', last_name='1',
            gender=Student.Gender.MALE, housing_type=Student.HousingType.SINGLE_MALE,
            accepted_dorm_type=self.dorm_b,
        )
        filler2 = Student.objects.create(
            student_id='F2', first_name='F', last_name='2',
            gender=Student.Gender.MALE, housing_type=Student.HousingType.SINGLE_MALE,
            accepted_dorm_type=self.dorm_b,
        )
        for filler in (filler1, filler2):
            r = self.admin_client.post('/api/room-assignments/assign/', {
                'student_id': filler.id, 'room_id': self.room_b1.id,
            }, format='json')
            self.assertEqual(r.status_code, 200, r.content)  # room_b1 now full (capacity 2)

        req = self._make_request('cross_region', [self.region_b])
        resp = self.admin_client.put(f'/api/requests/{req.id}/approve/', {
            'target_room': self.room_b1.id,
        }, format='json')
        self.assertEqual(resp.status_code, 400)

        req.refresh_from_db()
        self.assertEqual(req.status, 'pending', 'request must not be marked approved')
        self.assertIsNone(req.final_assignment_id)
        self.assertTrue(BedAssignment.objects.filter(
            student=self.student, bed__room=self.room_a1, status='active').exists(),
            'the current assignment must survive a failed transfer')


# ---------------------------------------------------------------------------
# /api/requests/transfer-target-regions/ - the region_transfer destination
# picker. Deliberately NOT /api/regions/: RegionViewSet.get_queryset() scopes
# a non-central user to only their own region, which is correct for general
# operational access but would leave a regional employee unable to see any
# other region to request a transfer to (region_transfer creation itself has
# no role/region restriction - see StudentRequestSerializer.validate() - only
# its approval is central-admin-gated).
# ---------------------------------------------------------------------------

class TransferTargetRegionsTests(TransferRegionTestBase):
    def test_regular_regions_endpoint_still_scoped_to_own_region_for_regional_user(self):
        resp = self._client(self.boss_a).get('/api/regions/')
        ids = {r['id'] for r in resp.data}
        self.assertEqual(ids, {self.region_a.id})

    def test_transfer_target_regions_unscoped_for_regional_user(self):
        resp = self._client(self.boss_a).get('/api/requests/transfer-target-regions/')
        self.assertEqual(resp.status_code, 200)
        ids = {r['id'] for r in resp.data}
        self.assertEqual(ids, {self.region_a.id, self.region_b.id, self.region_c.id})
        # Minimal shape only - id + name, nothing operational.
        self.assertEqual(set(resp.data[0].keys()), {'id', 'name'})

    def test_transfer_target_regions_same_for_central_admin(self):
        resp = self._client(self.admin).get('/api/requests/transfer-target-regions/')
        self.assertEqual(resp.status_code, 200)
        ids = {r['id'] for r in resp.data}
        self.assertEqual(ids, {self.region_a.id, self.region_b.id, self.region_c.id})

    def test_transfer_target_regions_requires_authentication(self):
        resp = APIClient().get('/api/requests/transfer-target-regions/')
        self.assertEqual(resp.status_code, 401)

    def test_transfer_target_regions_does_not_grant_cross_region_inventory_access(self):
        # Seeing region B/C's id+name must not translate into any ability
        # to read region B's buildings/rooms - Building/Room scoping is
        # untouched by this endpoint.
        resp = self._client(self.boss_a).get('/api/buildings/')
        building_ids = {b['id'] for b in resp.data}
        # room_b1's building (region B) must not be visible to boss_a.
        b_building_id = self.room_b1.apartment.building_id
        self.assertNotIn(b_building_id, building_ids)


# ---------------------------------------------------------------------------
# region_transfer approval ownership: the DESTINATION region owns the
# incoming-placement decision (it has the inventory, checks availability,
# and approves/rejects) - not the source region the student is leaving.
# The source region keeps read-only visibility (outgoing status) and keeps
# withdrawal authority (a source-side decision), but never approve/reject
# authority over its own outgoing request.
# ---------------------------------------------------------------------------

class RegionTransferApprovalOwnershipTests(TransferRegionTestBase):
    def setUp(self):
        super().setUp()
        self.boss_c = _make_user('bossc@test.com', User.Role.REGION_BOSS, self.region_c)
        # self.student already lives in room_a1 (region A) via a real
        # BedAssignment (set up by the base class) - region A is the
        # SOURCE, region B is the DESTINATION for this transfer.
        self.req = StudentRequest.objects.create(
            student=self.student, request_type='region_transfer', reason='no room in A',
            requested_by=self.employee_a, target_region=self.region_b,
            source_region=self.region_a,
            request_number='REQ-RTOWN00001',
        )

    def test_destination_boss_sees_request_in_list(self):
        resp = self._client(self.boss_b).get('/api/requests/')
        ids = {r['id'] for r in resp.data['results']} if 'results' in resp.data else {r['id'] for r in resp.data}
        self.assertIn(self.req.id, ids)

    def test_source_boss_still_sees_request_in_list(self):
        # Read-only outgoing visibility is preserved for the source region.
        resp = self._client(self.boss_a).get('/api/requests/')
        ids = {r['id'] for r in resp.data['results']} if 'results' in resp.data else {r['id'] for r in resp.data}
        self.assertIn(self.req.id, ids)

    def test_unrelated_boss_cannot_see_request(self):
        resp = self._client(self.boss_c).get('/api/requests/')
        ids = {r['id'] for r in resp.data['results']} if 'results' in resp.data else {r['id'] for r in resp.data}
        self.assertNotIn(self.req.id, ids)

    def test_destination_boss_can_approve(self):
        resp = self._client(self.boss_b).put(f'/api/requests/{self.req.id}/approve/', {
            'target_room': self.room_b1.id,
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.req.refresh_from_db()
        self.assertEqual(self.req.status, 'approved')
        self.student.refresh_from_db()
        self.assertEqual(self.student.assigned_room_id, self.room_b1.id)

    def test_destination_boss_can_reject(self):
        resp = self._client(self.boss_b).put(f'/api/requests/{self.req.id}/reject/', {
            'reason': 'no capacity',
        })
        self.assertEqual(resp.status_code, 200, resp.content)
        self.req.refresh_from_db()
        self.assertEqual(self.req.status, 'rejected')

    def test_source_boss_cannot_approve(self):
        resp = self._client(self.boss_a).put(f'/api/requests/{self.req.id}/approve/', {
            'target_room': self.room_b1.id,
        }, format='json')
        self.assertEqual(resp.status_code, 403)
        self.req.refresh_from_db()
        self.assertEqual(self.req.status, 'pending')

    def test_source_boss_cannot_reject(self):
        resp = self._client(self.boss_a).put(f'/api/requests/{self.req.id}/reject/', {
            'reason': 'changed my mind',
        })
        self.assertEqual(resp.status_code, 403)
        self.req.refresh_from_db()
        self.assertEqual(self.req.status, 'pending')

    def test_unrelated_boss_cannot_approve_or_reject(self):
        # Invisible in get_queryset() -> 404, not 403 (same pattern as
        # every other viewset action gated by get_object()).
        approve = self._client(self.boss_c).put(f'/api/requests/{self.req.id}/approve/', {
            'target_room': self.room_b1.id,
        }, format='json')
        self.assertEqual(approve.status_code, 404)
        reject = self._client(self.boss_c).put(f'/api/requests/{self.req.id}/reject/', {'reason': 'x'})
        self.assertEqual(reject.status_code, 404)

    def test_central_admin_can_approve(self):
        resp = self.admin_client.put(f'/api/requests/{self.req.id}/approve/', {
            'target_room': self.room_b1.id,
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_central_admin_can_reject(self):
        resp = self.admin_client.put(f'/api/requests/{self.req.id}/reject/', {'reason': 'x'})
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_feasibility_checked_against_destination_region_not_source(self):
        resp = self._client(self.boss_b).get(f'/api/requests/{self.req.id}/feasibility/')
        self.assertEqual(resp.status_code, 200)
        region_ids = {r['id'] for r in resp.data['search_regions']}
        self.assertEqual(region_ids, {self.region_b.id})

    def test_source_boss_can_still_cancel_pending_transfer(self):
        # Withdrawal remains a SOURCE-side decision - unaffected by the
        # approve/reject ownership change above.
        resp = self._client(self.boss_a).put(f'/api/requests/{self.req.id}/cancel/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.req.refresh_from_db()
        self.assertEqual(self.req.status, 'cancelled')

    def test_destination_boss_cannot_cancel(self):
        # The destination region owns approve/reject, not withdrawal -
        # cancelling is exclusively a source-side (or requester/central
        # admin) action.
        resp = self._client(self.boss_b).put(f'/api/requests/{self.req.id}/cancel/')
        self.assertEqual(resp.status_code, 403)
        self.req.refresh_from_db()
        self.assertEqual(self.req.status, 'pending')

    def test_requester_can_still_cancel(self):
        resp = self._client(self.employee_a).put(f'/api/requests/{self.req.id}/cancel/')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_unauthenticated_cannot_approve_or_reject(self):
        approve = APIClient().put(f'/api/requests/{self.req.id}/approve/', {
            'target_room': self.room_b1.id,
        }, format='json')
        self.assertEqual(approve.status_code, 401)
        reject = APIClient().put(f'/api/requests/{self.req.id}/reject/', {'reason': 'x'})
        self.assertEqual(reject.status_code, 401)
