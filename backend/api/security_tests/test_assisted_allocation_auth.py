"""
G3-11: normal in-region ASSIGN stays available to employees; OVERRIDE
(waiving a hard placement rule) requires region_boss or central_admin.
Region isolation (already fixed by partner work) is re-verified too.
"""

from api.models import BedAssignment

from .base import SecurityTestCase, make_student


class AssistedAllocationAssignAuthorizationTests(SecurityTestCase):
    def test_employee_can_assign_in_own_region(self):
        student = make_student(self.dorm_a, 'AA-STU-1')
        bed = self.room_a.beds.first()
        client = self.client_for(self.emp_a)
        resp = client.post(f'/api/assisted-allocation/students/{student.id}/assign/', {
            'bed_id': bed.id,
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(
            BedAssignment.objects.filter(student=student, bed=bed, status='active').exists()
        )

    def test_employee_cannot_assign_in_another_region(self):
        student = make_student(self.dorm_a, 'AA-STU-2')
        bed = self.room_b.beds.first()
        client = self.client_for(self.emp_a)
        resp = client.post(f'/api/assisted-allocation/students/{student.id}/assign/', {
            'bed_id': bed.id,
        }, format='json')
        self.assertEqual(resp.status_code, 403)


class AssistedAllocationOverrideAuthorizationTests(SecurityTestCase):
    def test_employee_cannot_override(self):
        student = make_student(self.dorm_a, 'AA-STU-3')
        bed = self.room_a.beds.first()
        client = self.client_for(self.emp_a)
        resp = client.post(f'/api/assisted-allocation/students/{student.id}/override/', {
            'bed_id': bed.id, 'note': 'employee trying to override',
        }, format='json')
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertFalse(BedAssignment.objects.filter(student=student).exists())

    def test_regional_boss_can_override_in_own_region(self):
        student = make_student(self.dorm_a, 'AA-STU-4')
        bed = self.room_a.beds.first()
        client = self.client_for(self.boss_a)
        resp = client.post(f'/api/assisted-allocation/students/{student.id}/override/', {
            'bed_id': bed.id, 'note': 'boss override with documented reason',
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(
            BedAssignment.objects.filter(student=student, bed=bed, status='active').exists()
        )

    def test_regional_boss_cannot_override_in_another_region(self):
        student = make_student(self.dorm_a, 'AA-STU-5')
        bed = self.room_a.beds.first()
        client = self.client_for(self.boss_b)
        resp = client.post(f'/api/assisted-allocation/students/{student.id}/override/', {
            'bed_id': bed.id, 'note': 'wrong-region boss',
        }, format='json')
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_central_admin_can_override_any_region(self):
        student = make_student(self.dorm_a, 'AA-STU-6')
        bed = self.room_a.beds.first()
        client = self.client_for(self.admin)
        resp = client.post(f'/api/assisted-allocation/students/{student.id}/override/', {
            'bed_id': bed.id, 'note': 'admin override',
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
