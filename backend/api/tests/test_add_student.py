"""
Tests for the direct Add Student flow: region enforcement (central admin
picks any region, regional staff is locked to their own), gender/religion
"Other" values, duplicate student_id handling, and the "save and find
matching accommodation" path.

Run against Django's disposable TEST database (created/destroyed as
test_<DB_NAME> - never touches the real `dormify` database):

    docker exec dormify_backend python manage.py test api.tests.test_add_student
"""

from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework import status

from api.models import User, Region, DormType, Building, Apartment, Room, Student


def _make_user(email, role, region=None):
    user = User(email=email, username=email, role=role, region=region,
                first_name='T', last_name='User')
    user.set_password('testpass123')
    user.save()
    return user


def _make_dorm_type(region, code, name=None):
    return DormType.objects.create(code=code, name=name or f'DT{code}', region=region)


def _make_room(dorm_type, building_number, apartment_number, category,
                apartment_type=Apartment.ApartmentType.SINGLE, room_capacity=2):
    building = Building.objects.create(number=building_number, dorm_type=dorm_type)
    apartment = Apartment.objects.create(
        building=building, number=apartment_number, category=category,
        apartment_type=apartment_type, room_count=1,
    )
    room = Room.objects.create(apartment=apartment, name='101', capacity=room_capacity)
    # Matching is read-only over real Bed rows - fixtures materialize them
    # explicitly, like a properly initialized production database.
    from api.tests.matching_test_utils import create_beds_for_room
    create_beds_for_room(room)
    return building, apartment, room


class AddStudentRegionTests(TestCase):
    def setUp(self):
        self.region_a = Region.objects.create(id='canada', name='Canada')
        self.region_b = Region.objects.create(id='mizrah', name='Mizrah')
        self.dorm_type_a = _make_dorm_type(self.region_a, code=1)
        self.dorm_type_b = _make_dorm_type(self.region_b, code=2)

        self.admin = _make_user('admin@test.com', User.Role.CENTRAL_ADMIN)
        self.boss_a = _make_user('bossa@test.com', User.Role.REGION_BOSS, self.region_a)

    def _payload(self, dorm_type, student_id='S100'):
        return {
            'student_id': student_id, 'first_name': 'New', 'last_name': 'Student',
            'gender': 'male', 'requested_religion': 'not_specified',
            'accepted_dorm_type': dorm_type.id, 'category': 'new',
            # housing_type is a required, employee-chosen field for any
            # non-leaving student (StudentSerializer.validate) - it is never
            # inferred from gender.
            'housing_type': Student.HousingType.SINGLE_MALE,
        }

    # 1 & 2. Central admin can add a student to a chosen region, and to
    # different regions across separate requests.
    def test_central_admin_can_add_student_to_chosen_region(self):
        client = APIClient()
        client.force_authenticate(self.admin)

        resp_a = client.post('/api/students/', self._payload(self.dorm_type_a, 'S100'), format='json')
        self.assertEqual(resp_a.status_code, status.HTTP_201_CREATED, resp_a.content)

        resp_b = client.post('/api/students/', self._payload(self.dorm_type_b, 'S101'), format='json')
        self.assertEqual(resp_b.status_code, status.HTTP_201_CREATED, resp_b.content)

        student_a = Student.objects.get(student_id='S100')
        student_b = Student.objects.get(student_id='S101')
        self.assertEqual(student_a.accepted_dorm_type.region_id, 'canada')
        self.assertEqual(student_b.accepted_dorm_type.region_id, 'mizrah')

    # 3. Regional employee cannot add a student to another region.
    def test_regional_boss_cannot_add_student_to_other_region(self):
        client = APIClient()
        client.force_authenticate(self.boss_a)

        resp = client.post('/api/students/', self._payload(self.dorm_type_b, 'S200'), format='json')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(Student.objects.filter(student_id='S200').exists())

    # 4. Manipulating the payload (sending a dorm type from another region)
    # does not bypass the region restriction - enforced server-side.
    def test_manipulated_region_payload_is_rejected(self):
        client = APIClient()
        client.force_authenticate(self.boss_a)

        payload = self._payload(self.dorm_type_b, 'S201')  # boss_a is region_a, dorm_type_b is region_b
        resp = client.post('/api/students/', payload, format='json')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(Student.objects.filter(student_id='S201').exists())

    def test_regional_boss_can_add_student_to_own_region(self):
        client = APIClient()
        client.force_authenticate(self.boss_a)

        resp = client.post('/api/students/', self._payload(self.dorm_type_a, 'S202'), format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)

    # 5. Duplicate student ID returns a clear field error.
    def test_duplicate_student_id_returns_field_error(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        client.post('/api/students/', self._payload(self.dorm_type_a, 'S400'), format='json')

        resp = client.post('/api/students/', self._payload(self.dorm_type_a, 'S400'), format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('student_id', resp.data)

    # housing_type is never guessed from gender - a female student with no
    # housing_type in the payload must be rejected with a clear field error,
    # not silently defaulted to SINGLE_FEMALE.
    def test_housing_type_is_not_inferred_from_gender(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        payload = self._payload(self.dorm_type_a, 'S500')
        payload['gender'] = 'female'
        del payload['housing_type']

        resp = client.post('/api/students/', payload, format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('housing_type', resp.data)
        self.assertFalse(Student.objects.filter(student_id='S500').exists())

    # 12. "Save and find matching accommodation" - the backend equivalent:
    # a freshly created student (with an explicit, employee-chosen
    # housing_type) gets real matches.
    def test_newly_created_student_gets_real_matching_options(self):
        _make_room(self.dorm_type_a, 1, '1', Apartment.Category.MALE)

        client = APIClient()
        client.force_authenticate(self.admin)
        resp = client.post('/api/students/', self._payload(self.dorm_type_a, 'S600'), format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        student_id = resp.data['id']

        match_resp = client.post('/api/requests/match-options/', {'student_id': student_id}, format='json')
        self.assertEqual(match_resp.status_code, 200)
        self.assertTrue(match_resp.data['feasible'])
        self.assertGreater(match_resp.data['total_valid'], 0)

    # 13. A student remains saved even when no matching accommodation
    # exists for their (validly set) housing_type - honest "no options"
    # rather than a silent guess or a blocked save.
    def test_student_saved_even_without_matching_accommodation(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        payload = self._payload(self.dorm_type_a, 'S700')
        # No family apartments exist in this region - a legitimate "no
        # options" result, distinct from a missing/invalid housing_type.
        payload['housing_type'] = Student.HousingType.FAMILY

        resp = client.post('/api/students/', payload, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        student_id = resp.data['id']
        self.assertTrue(Student.objects.filter(id=student_id).exists())

        match_resp = client.post('/api/requests/match-options/', {'student_id': student_id}, format='json')
        self.assertEqual(match_resp.status_code, 200)
        self.assertFalse(match_resp.data['feasible'])
        self.assertTrue(Student.objects.filter(id=student_id).exists())  # still saved

    # Leaving-category students are exempt from the housing_type/region
    # requirement entirely (mirrors the allocation solver's existing
    # exclusion of leavers).
    def test_leaving_student_does_not_require_housing_type_or_region(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        payload = {
            'student_id': 'S800', 'first_name': 'Leaving', 'last_name': 'Student',
            'gender': 'male', 'requested_religion': 'not_specified',
            'category': 'leaving',
        }
        resp = client.post('/api/students/', payload, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.content)
        student = Student.objects.get(student_id='S800')
        self.assertEqual(student.housing_type, '')
        self.assertIsNone(student.accepted_dorm_type)

    # Blank housing_type is rejected for any non-leaving student, with a
    # clear structured field error.
    def test_blank_housing_type_rejected_on_add_student(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        payload = self._payload(self.dorm_type_a, 'S900')
        payload['housing_type'] = ''

        resp = client.post('/api/students/', payload, format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('housing_type', resp.data)
        self.assertFalse(Student.objects.filter(student_id='S900').exists())

    # Missing accepted_dorm_type (region) produces its own clear field error,
    # independent of housing_type.
    def test_missing_region_rejected_on_add_student(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        payload = self._payload(self.dorm_type_a, 'S901')
        del payload['accepted_dorm_type']

        resp = client.post('/api/students/', payload, format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('accepted_dorm_type', resp.data)
        self.assertFalse(Student.objects.filter(student_id='S901').exists())
