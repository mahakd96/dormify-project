"""
G3-02 / G3-07 / G3-22 / G3-24 (Transfer half): the legacy Transfer API must
not allow generic PATCH/PUT to simulate approve/reject, must enforce region
authorization on create, must apply one consistent authorization rule for
approve()/reject(), and must not be hard-deletable by an arbitrary user.
"""

from api.models import Transfer

from .base import SecurityTestCase, make_room, make_student


class TransferGenericWriteLockdownTests(SecurityTestCase):
    """G3-02."""

    def setUp(self):
        super().setUp()
        self.student = make_student(self.dorm_a, 'TX-STU-1')
        self.building_a2, self.apartment_a2, self.room_a2 = self._extra_room()
        self.transfer = Transfer.objects.create(
            student=self.student, from_room=self.room_a, to_room=self.room_a2,
            requested_by=self.emp_a, status='pending',
        )

    def _extra_room(self):
        return make_room(self.dorm_a, 9201, '2', room_name='102')

    def test_generic_patch_cannot_set_status_directly(self):
        client = self.client_for(self.emp_a)
        resp = client.patch(f'/api/transfers/{self.transfer.id}/', {
            'status': 'approved', 'reviewed_by': self.emp_a.id,
        }, format='json')
        self.assertEqual(resp.status_code, 405, resp.content)
        self.transfer.refresh_from_db()
        self.assertEqual(self.transfer.status, 'pending')

    def test_generic_put_cannot_set_status_directly_even_for_boss(self):
        client = self.client_for(self.boss_a)
        resp = client.put(f'/api/transfers/{self.transfer.id}/', {
            'student': self.student.id, 'from_room': self.room_a.id,
            'to_room': self.room_a2.id, 'status': 'approved',
            'requested_by': self.boss_a.id,
        }, format='json')
        self.assertEqual(resp.status_code, 405, resp.content)
        self.transfer.refresh_from_db()
        self.assertEqual(self.transfer.status, 'pending')

    def test_approve_action_still_works_for_authorized_boss(self):
        client = self.client_for(self.boss_a)
        resp = client.put(f'/api/transfers/{self.transfer.id}/approve/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.transfer.refresh_from_db()
        self.assertEqual(self.transfer.status, 'approved')


class TransferCreateRegionAuthorizationTests(SecurityTestCase):
    """G3-07."""

    def test_employee_cannot_create_transfer_touching_another_region(self):
        student = make_student(self.dorm_a, 'TX-STU-2')
        # Physically place the student in region A first.
        self.client_for(self.admin).post('/api/room-assignments/assign/', {
            'student_id': student.id, 'room_id': self.room_a.id,
        }, format='json')

        client = self.client_for(self.emp_a)
        resp = client.post('/api/transfers/', {
            'student': student.id, 'from_room': self.room_a.id,
            'to_room': self.room_b.id, 'reason': 'cross-region attempt',
        }, format='json')
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertFalse(Transfer.objects.filter(student=student).exists())

    def test_central_admin_can_create_cross_region_transfer(self):
        student = make_student(self.dorm_a, 'TX-STU-3')
        self.client_for(self.admin).post('/api/room-assignments/assign/', {
            'student_id': student.id, 'room_id': self.room_a.id,
        }, format='json')

        client = self.client_for(self.admin)
        resp = client.post('/api/transfers/', {
            'student': student.id, 'from_room': self.room_a.id,
            'to_room': self.room_b.id, 'reason': 'central admin transfer',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_employee_can_create_same_region_transfer(self):
        _, _, room_a2 = make_room(self.dorm_a, 9202, '3', room_name='103')
        student = make_student(self.dorm_a, 'TX-STU-4')
        self.client_for(self.admin).post('/api/room-assignments/assign/', {
            'student_id': student.id, 'room_id': self.room_a.id,
        }, format='json')

        client = self.client_for(self.emp_a)
        resp = client.post('/api/transfers/', {
            'student': student.id, 'from_room': self.room_a.id,
            'to_room': room_a2.id, 'reason': 'same region',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)


class TransferApproveRejectConsistentAuthorizationTests(SecurityTestCase):
    """G3-22: approve() and reject() must use the same authorization rule."""

    def setUp(self):
        super().setUp()
        self.student = make_student(self.dorm_a, 'TX-STU-5')
        self.client_for(self.admin).post('/api/room-assignments/assign/', {
            'student_id': self.student.id, 'room_id': self.room_a.id,
        }, format='json')

    def _make_cross_region_transfer(self):
        return Transfer.objects.create(
            student=self.student, from_room=self.room_a, to_room=self.room_b,
            requested_by=self.admin, status='pending',
        )

    def test_boss_of_only_destination_region_cannot_approve_cross_region(self):
        transfer = self._make_cross_region_transfer()
        client = self.client_for(self.boss_b)
        resp = client.put(f'/api/transfers/{transfer.id}/approve/')
        self.assertEqual(resp.status_code, 403)

    def test_boss_of_only_destination_region_cannot_reject_cross_region_either(self):
        # Before the fix, reject() only checked to_room's region (boss_b
        # WOULD have been allowed here) while approve() required both
        # regions - this test locks in that they now agree.
        transfer = self._make_cross_region_transfer()
        client = self.client_for(self.boss_b)
        resp = client.put(f'/api/transfers/{transfer.id}/reject/', {'reason': 'x'})
        self.assertEqual(resp.status_code, 403)

    def test_central_admin_can_approve_and_reject_cross_region(self):
        transfer = self._make_cross_region_transfer()
        client = self.client_for(self.admin)
        resp = client.put(f'/api/transfers/{transfer.id}/reject/', {'reason': 'x'})
        self.assertEqual(resp.status_code, 200, resp.content)


class TransferHardDeleteLockdownTests(SecurityTestCase):
    """G3-24 (Transfer half)."""

    def test_employee_cannot_delete_transfer(self):
        student = make_student(self.dorm_a, 'TX-STU-6')
        _, _, room_a2 = make_room(self.dorm_a, 9203, '4', room_name='104')
        transfer = Transfer.objects.create(
            student=student, from_room=self.room_a, to_room=room_a2,
            requested_by=self.emp_a, status='pending',
        )
        client = self.client_for(self.emp_a)
        resp = client.delete(f'/api/transfers/{transfer.id}/')
        self.assertIn(resp.status_code, (403, 404, 405))
        self.assertTrue(Transfer.objects.filter(id=transfer.id).exists())
