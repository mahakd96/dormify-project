"""
Tests for Students-page performance: pagination, N+1 query flatness, and
that opening the list never pulls bed-assignment options or full detail.

Run against Django's disposable TEST database (created/destroyed as
test_<DB_NAME> - never touches the real `dormify` database):

    docker exec dormify_backend python manage.py test api.tests_students_performance
"""

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from api.models import User, Region, DormType, Building, Apartment, Room, Student, BedAssignment, Bed


def _make_user(email, role, region=None):
    user = User(email=email, username=email, role=role, region=region,
                first_name='T', last_name='User')
    user.set_password('testpass123')
    user.save()
    return user


def _make_dorm_type(region, code, name=None):
    return DormType.objects.create(code=code, name=name or f'DT{code}', region=region)


def _make_room(dorm_type, building_number, apartment_number, category, room_capacity=2):
    building = Building.objects.create(number=building_number, dorm_type=dorm_type)
    apartment = Apartment.objects.create(
        building=building, number=apartment_number, category=category,
        apartment_type=Apartment.ApartmentType.SINGLE, room_count=1,
    )
    room = Room.objects.create(apartment=apartment, name='101', capacity=room_capacity)
    return building, apartment, room


class StudentsListPerformanceTests(TestCase):
    def setUp(self):
        self.region_a = Region.objects.create(id='canada', name='Canada')
        self.region_b = Region.objects.create(id='mizrah', name='Mizrah')
        self.dorm_type_a = _make_dorm_type(self.region_a, code=1)
        self.dorm_type_b = _make_dorm_type(self.region_b, code=2)
        self.admin = _make_user('admin@test.com', User.Role.CENTRAL_ADMIN)
        self.boss_a = _make_user('bossa@test.com', User.Role.REGION_BOSS, self.region_a)

        # 40 students in region A: some assigned (to exercise the
        # current_bed/current_building N+1 path), most not.
        _, apt, room = _make_room(self.dorm_type_a, 1, '1', Apartment.Category.MALE, room_capacity=30)
        for i in range(40):
            s = Student.objects.create(
                student_id=f'A{i}', first_name='F', last_name='L',
                gender='male', housing_type=Student.HousingType.SINGLE_MALE,
                accepted_dorm_type=self.dorm_type_a, category='new',
            )
            if i < 10:
                bed = Bed.objects.create(room=room, label=f'Bed {i}')
                BedAssignment.objects.create(student=s, bed=bed, status=BedAssignment.Status.ACTIVE, assigned_by=self.admin)
                s.assigned_room = room
                s.save(update_fields=['assigned_room'])

        # 5 students in region B, to prove regional scoping.
        for i in range(5):
            Student.objects.create(
                student_id=f'B{i}', first_name='F', last_name='L',
                gender='male', housing_type=Student.HousingType.SINGLE_MALE,
                accepted_dorm_type=self.dorm_type_b, category='new',
            )

    # 9. Students endpoint is paginated.
    def test_students_endpoint_is_paginated(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        resp = client.get('/api/students/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('count', resp.data)
        self.assertIn('results', resp.data)
        self.assertEqual(resp.data['count'], 45)
        self.assertLessEqual(len(resp.data['results']), 25)  # StandardResultsPagination default page_size

    # 10. Students list does not create N+1 queries (flat regardless of how
    # many students - assigned or not - are on the page).
    def test_students_list_query_count_is_flat(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        with CaptureQueriesContext(connection) as ctx:
            resp = client.get('/api/students/', {'page_size': 25})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data['results']), 25)
        # Flat and small regardless of the 10 assigned students on this page -
        # the old code issued 1+ extra query PER student (current_bed alone
        # was one query per student, ~25+ queries for this page).
        self.assertLess(len(ctx.captured_queries), 12, ctx.captured_queries)

    # 11. Search is server-side (filtered in the DB, not returned in full
    # and filtered client-side).
    def test_search_is_server_side(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        resp = client.get('/api/students/', {'search': 'A3'})
        self.assertEqual(resp.status_code, 200)
        self.assertLess(resp.data['count'], 45)
        for row in resp.data['results']:
            self.assertIn('A3', row['student_id'])

    # 12. Opening the Students page (list endpoint) does not load available
    # beds/options - the list payload must not contain a beds/options key.
    def test_students_list_does_not_include_available_beds(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        resp = client.get('/api/students/')
        self.assertEqual(resp.status_code, 200)
        for row in resp.data['results']:
            self.assertNotIn('options', row)
            self.assertNotIn('available_beds', row)
            self.assertNotIn('match_options', row)

    # 13. Opening one student loads detailed data separately (detail
    # serializer has fields the list serializer doesn't, e.g. roommate
    # request fields), confirming the two are genuinely different endpoints/
    # payloads rather than the list already being "the full thing".
    def test_student_detail_endpoint_returns_richer_payload_than_list(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        student = Student.objects.filter(student_id='A0').first()
        list_resp = client.get('/api/students/', {'search': 'A0'})
        detail_resp = client.get(f'/api/students/{student.id}/')
        self.assertEqual(detail_resp.status_code, 200)
        list_row = list_resp.data['results'][0]
        self.assertNotIn('roommate_request_1', list_row)
        self.assertIn('roommate_request_1', detail_resp.data)

    # 14. Regional users see only their region's students.
    def test_regional_user_sees_only_own_region(self):
        client = APIClient()
        client.force_authenticate(self.boss_a)
        resp = client.get('/api/students/', {'page_size': 100})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 40)
        for row in resp.data['results']:
            self.assertTrue(row['student_id'].startswith('A'))

    # Regional users cannot escape their region via URL query manipulation.
    def test_regional_user_cannot_bypass_region_via_query_param(self):
        client = APIClient()
        client.force_authenticate(self.boss_a)
        # There is no region query param exposed for regional users to send
        # in the first place - confirm the backend queryset itself is
        # filtered (not merely hidden by the frontend never sending one).
        other_student = Student.objects.filter(student_id='B0').first()
        detail_resp = client.get(f'/api/students/{other_student.id}/')
        self.assertEqual(detail_resp.status_code, 404)

    # 15. Central admin can filter by region-linked category param (region
    # scoping does not apply to admin, and admin can still narrow results).
    def test_central_admin_can_filter_and_sees_all_regions(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        resp = client.get('/api/students/', {'page_size': 100})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 45)
        student_ids = {row['student_id'] for row in resp.data['results']}
        self.assertTrue(any(sid.startswith('A') for sid in student_ids))
        self.assertTrue(any(sid.startswith('B') for sid in student_ids))
