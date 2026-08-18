"""
G3-18: changing account email requires current-password re-authentication.
"""

from .base import SecurityTestCase, TEST_PASSWORD


class EmailChangeRequiresPasswordTests(SecurityTestCase):
    def test_wrong_password_rejected(self):
        client = self.client_for(self.emp_a)
        resp = client.put('/api/auth/change-email/', {
            'current_email': self.emp_a.email,
            'new_email': 'newemail@test.local',
            'confirm_email': 'newemail@test.local',
            'password': 'totally-wrong-password',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.emp_a.refresh_from_db()
        self.assertNotEqual(self.emp_a.email, 'newemail@test.local')

    def test_missing_password_rejected(self):
        client = self.client_for(self.emp_a)
        resp = client.put('/api/auth/change-email/', {
            'current_email': self.emp_a.email,
            'new_email': 'newemail2@test.local',
            'confirm_email': 'newemail2@test.local',
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_correct_password_allows_change(self):
        client = self.client_for(self.emp_a)
        resp = client.put('/api/auth/change-email/', {
            'current_email': self.emp_a.email,
            'new_email': 'newemail3@test.local',
            'confirm_email': 'newemail3@test.local',
            'password': TEST_PASSWORD,
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.emp_a.refresh_from_db()
        self.assertEqual(self.emp_a.email, 'newemail3@test.local')
