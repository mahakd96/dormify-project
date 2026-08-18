"""
G3-06: Student.assigned_room must not be directly writable.
G3-15: Student records must not be hard-deletable by arbitrary employees.
G3-24 (StudentRequest half): StudentRequest rows must not be hard-deletable.
"""

from api.models import BedAssignment, Student, StudentRequest

from .base import SecurityTestCase, make_student


class AssignedRoomNotDirectlyWritableTests(SecurityTestCase):
    def test_direct_assigned_room_patch_is_ignored(self):
        student = make_student(self.dorm_a, 'SW-STU-1')
        client = self.client_for(self.emp_a)
        resp = client.patch(f'/api/students/{student.id}/', {
            'assigned_room': self.room_a.id,
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        student.refresh_from_db()
        self.assertIsNone(student.assigned_room_id)
        self.assertFalse(BedAssignment.objects.filter(student=student).exists())

    def test_real_assignment_endpoint_still_works(self):
        student = make_student(self.dorm_a, 'SW-STU-2')
        client = self.client_for(self.admin)
        resp = client.post('/api/room-assignments/assign/', {
            'student_id': student.id, 'room_id': self.room_a.id,
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        student.refresh_from_db()
        self.assertEqual(student.assigned_room_id, self.room_a.id)
        self.assertTrue(
            BedAssignment.objects.filter(student=student, status='active').exists()
        )


class StudentHardDeleteLockdownTests(SecurityTestCase):
    def test_employee_cannot_delete_student(self):
        student = make_student(self.dorm_a, 'SW-STU-3')
        client = self.client_for(self.emp_a)
        resp = client.delete(f'/api/students/{student.id}/')
        self.assertIn(resp.status_code, (403, 404, 405))
        self.assertTrue(Student.objects.filter(id=student.id).exists())

    def test_central_admin_cannot_delete_student_either(self):
        # No legitimate "delete a student record" workflow exists at all -
        # DELETE is disabled for every role, not just employees.
        student = make_student(self.dorm_a, 'SW-STU-4')
        client = self.client_for(self.admin)
        resp = client.delete(f'/api/students/{student.id}/')
        self.assertIn(resp.status_code, (403, 404, 405))
        self.assertTrue(Student.objects.filter(id=student.id).exists())

    def test_remove_student_workflow_still_ends_assignment_without_deleting_record(self):
        student = make_student(self.dorm_a, 'SW-STU-5')
        admin_client = self.client_for(self.admin)
        admin_client.post('/api/room-assignments/assign/', {
            'student_id': student.id, 'room_id': self.room_a.id,
        }, format='json')

        req = StudentRequest.objects.create(
            student=student, request_type=StudentRequest.RequestType.REMOVE_STUDENT,
            reason='leaving', requested_by=self.emp_a,
            request_number='REQ-SW-00001',
        )
        resp = admin_client.put(f'/api/requests/{req.id}/approve/', {}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

        student.refresh_from_db()
        self.assertIsNone(student.assigned_room_id)
        # The student record itself survives - only the placement ends.
        self.assertTrue(Student.objects.filter(id=student.id).exists())


class StudentRequestHardDeleteLockdownTests(SecurityTestCase):
    def test_employee_cannot_delete_student_request(self):
        student = make_student(self.dorm_a, 'SW-STU-6')
        req = StudentRequest.objects.create(
            student=student, request_type=StudentRequest.RequestType.ROOM,
            reason='r', requested_by=self.emp_a, source_region=self.region_a,
            request_number='REQ-SW-00002',
        )
        client = self.client_for(self.emp_a)
        resp = client.delete(f'/api/requests/{req.id}/')
        self.assertIn(resp.status_code, (403, 404, 405))
        self.assertTrue(StudentRequest.objects.filter(id=req.id).exists())

    def test_cancel_action_still_works_for_own_pending_request(self):
        student = make_student(self.dorm_a, 'SW-STU-7')
        req = StudentRequest.objects.create(
            student=student, request_type=StudentRequest.RequestType.ROOM,
            reason='r', requested_by=self.emp_a, source_region=self.region_a,
            request_number='REQ-SW-00003',
        )
        client = self.client_for(self.emp_a)
        resp = client.put(f'/api/requests/{req.id}/cancel/')
        self.assertEqual(resp.status_code, 200, resp.content)
        req.refresh_from_db()
        self.assertEqual(req.status, 'cancelled')
