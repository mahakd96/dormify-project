"""
Shared fixtures for the Group 3 (Authentication/Authorization/Privacy/
Security) regression suite.

Run against Django's disposable TEST database only:

    ENV_FILE=.env.test python manage.py test api.security_tests

Never against Azure - see
project-quality/security/SECURITY_AND_AUTHORIZATION_REPORT.md for the
full verification method.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import User, Region, DormType, Building, Apartment, Room, Student
from api.tests.matching_test_utils import create_beds_for_room

TEST_PASSWORD = 'TestPass123!'


def make_user(email, role, region=None, **extra):
    user = User(
        email=email, username=email, role=role, region=region,
        first_name='T', last_name='User', **extra,
    )
    user.set_password(TEST_PASSWORD)
    user.save()
    return user


def make_room(dorm_type, building_number, apartment_number,
              category=Apartment.Category.MALE,
              apartment_type=Apartment.ApartmentType.SINGLE,
              room_capacity=2, room_name='101'):
    building = Building.objects.create(number=building_number, dorm_type=dorm_type)
    apartment = Apartment.objects.create(
        building=building, number=apartment_number, category=category,
        apartment_type=apartment_type, room_count=1, apartment_capacity=room_capacity,
    )
    room = Room.objects.create(apartment=apartment, name=room_name, capacity=room_capacity)
    create_beds_for_room(room)
    return building, apartment, room


def make_student(dorm_type, student_id, gender=Student.Gender.MALE,
                  housing_type=Student.HousingType.SINGLE_MALE,
                  category=Student.StudentCategory.NEW):
    return Student.objects.create(
        student_id=student_id, first_name='F', last_name='L', gender=gender,
        housing_type=housing_type, category=category, accepted_dorm_type=dorm_type,
    )


class SecurityTestCase(TestCase):
    """
    Two independent regions (each with its own DormType + one sample
    Building/Apartment/Room with real materialized Bed rows), and one user
    per role per region - so any cross-region check compares TWO DIFFERENT
    regional managers, never the same region_boss standing in for both
    sides (per the audit brief: "if tests use multiple regional managers,
    they must belong to different regions").
    """

    def setUp(self):
        self.region_a = Region.objects.create(id='sec_rega', name='Security Region A')
        self.region_b = Region.objects.create(id='sec_regb', name='Security Region B')

        self.dorm_a = DormType.objects.create(code=9101, name='Sec Dorm A', region=self.region_a)
        self.dorm_b = DormType.objects.create(code=9102, name='Sec Dorm B', region=self.region_b)

        self.building_a, self.apartment_a, self.room_a = make_room(self.dorm_a, 9101, '1')
        self.building_b, self.apartment_b, self.room_b = make_room(self.dorm_b, 9102, '1')

        self.admin = make_user('secadmin@test.local', User.Role.CENTRAL_ADMIN)
        self.boss_a = make_user('secbossa@test.local', User.Role.REGION_BOSS, self.region_a)
        self.boss_b = make_user('secbossb@test.local', User.Role.REGION_BOSS, self.region_b)
        self.emp_a = make_user('secempa@test.local', User.Role.EMPLOYEE, self.region_a)
        self.emp_b = make_user('secempb@test.local', User.Role.EMPLOYEE, self.region_b)

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client
