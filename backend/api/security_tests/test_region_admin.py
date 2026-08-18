"""
G3-05: Region and DormType administrative writes must be central-admin only.
Read access remains available to regional staff (scoped to their own
region), unchanged.
"""

from api.models import DormType, Region

from .base import SecurityTestCase


class RegionDormTypeWriteLockdownTests(SecurityTestCase):
    def test_employee_cannot_create_region(self):
        client = self.client_for(self.emp_a)
        resp = client.post('/api/regions/', {'id': 'hacked', 'name': 'Hacked'}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(Region.objects.filter(id='hacked').exists())

    def test_boss_cannot_create_region(self):
        client = self.client_for(self.boss_a)
        resp = client.post('/api/regions/', {'id': 'hacked2', 'name': 'Hacked2'}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(Region.objects.filter(id='hacked2').exists())

    def test_employee_cannot_update_own_region(self):
        client = self.client_for(self.emp_a)
        resp = client.patch(f'/api/regions/{self.region_a.id}/', {'name': 'Renamed'}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.region_a.refresh_from_db()
        self.assertNotEqual(self.region_a.name, 'Renamed')

    def test_employee_cannot_create_dormtype(self):
        client = self.client_for(self.emp_a)
        resp = client.post('/api/dorm-types/', {
            'code': 9999, 'name': 'HackedDorm', 'region': self.region_a.id,
        }, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(DormType.objects.filter(name='HackedDorm').exists())

    def test_central_admin_can_create_region_and_dormtype(self):
        client = self.client_for(self.admin)
        resp = client.post('/api/regions/', {'id': 'legit_region', 'name': 'Legit'}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)

        resp2 = client.post('/api/dorm-types/', {
            'code': 8888, 'name': 'LegitDorm', 'region': 'legit_region',
        }, format='json')
        self.assertEqual(resp2.status_code, 201, resp2.content)

    def test_regional_staff_can_still_read_own_region(self):
        client = self.client_for(self.emp_a)
        resp = client.get('/api/regions/')
        self.assertEqual(resp.status_code, 200)
        ids = {r['id'] for r in resp.data} if isinstance(resp.data, list) else {
            r['id'] for r in resp.data.get('results', [])
        }
        self.assertEqual(ids, {self.region_a.id})
