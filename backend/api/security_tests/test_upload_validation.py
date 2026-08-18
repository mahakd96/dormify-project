"""
G3-21: upload validation happens BEFORE expensive parsing and before the
ImportBatch is marked PROCESSING - oversized/malformed files return a
clean 4xx (no pandas/openpyxl stack trace leaked to the client) and the
batch is never left stuck.
"""

from django.core.files.uploadedfile import SimpleUploadedFile

from api.models import ImportBatch

from .base import SecurityTestCase
from .. import views as api_views


def _init_batch(client, kind='main'):
    resp = client.post('/api/upload/batches/init/', {'kind': kind}, format='json')
    assert resp.status_code == 201, resp.content
    return resp.data['batch_id']


class UploadValidationTests(SecurityTestCase):
    def setUp(self):
        super().setUp()
        self.client = self.client_for(self.admin)

    def test_oversized_file_rejected_cleanly_main_import(self):
        batch_id = _init_batch(self.client, 'main')
        oversized = SimpleUploadedFile(
            'roster.xlsx',
            b'0' * (api_views.MAX_UPLOAD_FILE_SIZE_BYTES + 1),
            content_type=(
                'application/vnd.openxmlformats-officedocument'
                '.spreadsheetml.sheet'
            ),
        )
        resp = self.client.post('/api/upload/excel/', {
            'file': oversized, 'batch_id': batch_id,
        }, format='multipart')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertNotIn('traceback', resp.data)

        batch = ImportBatch.objects.get(pk=batch_id)
        # Rejected before the batch ever left PENDING - no stuck PROCESSING.
        self.assertEqual(batch.status, ImportBatch.Status.PENDING)

    def test_malformed_content_rejected_cleanly_main_import(self):
        batch_id = _init_batch(self.client, 'main')
        fake = SimpleUploadedFile(
            'roster.xlsx', b'this is not a real xlsx file at all',
            content_type=(
                'application/vnd.openxmlformats-officedocument'
                '.spreadsheetml.sheet'
            ),
        )
        resp = self.client.post('/api/upload/excel/', {
            'file': fake, 'batch_id': batch_id,
        }, format='multipart')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertNotIn('traceback', resp.data)

        batch = ImportBatch.objects.get(pk=batch_id)
        self.assertEqual(batch.status, ImportBatch.Status.PENDING)

    def test_wrong_extension_rejected_cleanly(self):
        batch_id = _init_batch(self.client, 'main')
        fake = SimpleUploadedFile(
            'roster.exe', b'MZ-not-excel', content_type='application/octet-stream',
        )
        resp = self.client.post('/api/upload/excel/', {
            'file': fake, 'batch_id': batch_id,
        }, format='multipart')
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_empty_file_rejected_cleanly(self):
        batch_id = _init_batch(self.client, 'main')
        empty = SimpleUploadedFile('roster.xlsx', b'', content_type='application/octet-stream')
        resp = self.client.post('/api/upload/excel/', {
            'file': empty, 'batch_id': batch_id,
        }, format='multipart')
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_malformed_content_rejected_cleanly_additions_import(self):
        batch_id = _init_batch(self.client, 'additions')
        fake = SimpleUploadedFile(
            'additions.xlsx', b'not an excel file either',
            content_type=(
                'application/vnd.openxmlformats-officedocument'
                '.spreadsheetml.sheet'
            ),
        )
        resp = self.client.post('/api/upload/additions-excel/', {
            'file': fake, 'batch_id': batch_id,
        }, format='multipart')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertNotIn('traceback', resp.data)

        batch = ImportBatch.objects.get(pk=batch_id)
        self.assertEqual(batch.status, ImportBatch.Status.PENDING)

    def test_non_admin_still_cannot_upload(self):
        client = self.client_for(self.emp_a)
        resp = client.post('/api/upload/excel/', {
            'file': SimpleUploadedFile('roster.xlsx', b'x'),
        }, format='multipart')
        self.assertEqual(resp.status_code, 403)
