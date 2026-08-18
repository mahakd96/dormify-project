"""
G3-01: unrestricted public staff self-registration must not exist.
"""

from rest_framework.test import APIClient

from api.models import User

from .base import SecurityTestCase


class PublicRegistrationRemovedTests(SecurityTestCase):
    def test_register_endpoint_does_not_exist(self):
        client = APIClient()
        resp = client.post('/api/auth/register/', {
            'email': 'anon@test.local', 'username': 'anon',
            'password': 'AnonPass123!', 'role': 'central_admin',
        }, format='json')
        self.assertIn(resp.status_code, (404, 405))
        self.assertFalse(User.objects.filter(email='anon@test.local').exists())

    def test_anonymous_cannot_create_account_via_staff_users_endpoint(self):
        client = APIClient()
        resp = client.post('/api/staff-users/', {
            'name': 'Anon User', 'email': 'anon2@test.local',
            'password': 'AnonPass123!', 'role': 'central_admin',
        }, format='json')
        self.assertIn(resp.status_code, (401, 403))
        self.assertFalse(User.objects.filter(email='anon2@test.local').exists())

    def test_employee_cannot_create_staff_account(self):
        client = self.client_for(self.emp_a)
        resp = client.post('/api/staff-users/', {
            'name': 'New Guy', 'email': 'newguy@test.local',
            'password': 'NewGuyPass123!', 'role': 'employee',
            'regionId': self.region_a.id,
        }, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(User.objects.filter(email='newguy@test.local').exists())

    def test_central_admin_can_still_create_staff(self):
        # Legitimate path must keep working - this endpoint is the intended
        # replacement for public registration.
        client = self.client_for(self.admin)
        resp = client.post('/api/staff-users/', {
            'name': 'Legit Employee', 'email': 'legit@test.local',
            'password': 'LegitPass123!', 'role': 'employee',
            'regionId': self.region_a.id,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(User.objects.filter(email='legit@test.local', role='employee').exists())
