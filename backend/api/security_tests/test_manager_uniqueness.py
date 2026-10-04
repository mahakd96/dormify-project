"""
G3-19: exactly one region_boss per region - duplicate creation is rejected,
including under a concurrency race, at the application level. The DB
partial-unique-constraint backstop (migration 0019) is verified separately
here too, against the LOCAL TEST DATABASE ONLY - never production.
"""

import threading

from django.db import IntegrityError, connection, transaction
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from api.models import Region, User

from .base import SecurityTestCase, TEST_PASSWORD, make_user


class DuplicateRegionalManagerRejectedTests(SecurityTestCase):
    def test_second_region_boss_for_same_region_is_rejected(self):
        # region_a already has self.boss_a.
        client = self.client_for(self.admin)
        resp = client.post('/api/staff-users/', {
            'name': 'Second Boss', 'email': 'secondboss@test.local',
            'password': TEST_PASSWORD, 'role': 'region_boss',
            'regionId': self.region_a.id,
        }, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(
            User.objects.filter(role='region_boss', region=self.region_a).count(), 1
        )

    def test_first_region_boss_for_a_fresh_region_succeeds(self):
        fresh_region = Region.objects.create(id='sec_fresh', name='Fresh Region')
        client = self.client_for(self.admin)
        resp = client.post('/api/staff-users/', {
            'name': 'Fresh Boss', 'email': 'freshboss@test.local',
            'password': TEST_PASSWORD, 'role': 'region_boss',
            'regionId': fresh_region.id,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(
            User.objects.filter(role='region_boss', region=fresh_region).count(), 1
        )

class ConcurrentDuplicateManagerCreationTests(TransactionTestCase):
    """
    A real cross-connection race, so it must be a TransactionTestCase (not
    the rolled-back-transaction TestCase the rest of this suite uses) -
    two genuinely separate DB connections/threads need to actually see each
    other's committed state, which a TestCase's wrapping transaction would
    hide.
    """

    def setUp(self):
        self.region = Region.objects.create(id='sec_race', name='Race Region')
        self.admin = make_user('secrace_admin@test.local', User.Role.CENTRAL_ADMIN)

    def test_concurrent_duplicate_creation_never_yields_two_managers(self):
        results = []

        def attempt(email):
            # Each thread needs its own DB connection - Django connections
            # are not thread-safe to share across threads.
            try:
                api_client = APIClient()
                api_client.force_authenticate(self.admin)
                resp = api_client.post('/api/staff-users/', {
                    'name': 'Race Boss', 'email': email,
                    'password': TEST_PASSWORD, 'role': 'region_boss',
                    'regionId': self.region.id,
                }, format='json')
                results.append(resp.status_code)
            finally:
                connection.close()

        t1 = threading.Thread(target=attempt, args=('race1@test.local',))
        t2 = threading.Thread(target=attempt, args=('race2@test.local',))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        # Exactly one of the two concurrent attempts must have succeeded -
        # select_for_update() on the Region row serializes them so the
        # second always re-checks after the first commits.
        self.assertEqual(sorted(results), [201, 400])
        self.assertEqual(
            User.objects.filter(role='region_boss', region=self.region).count(), 1
        )


class RegionBossPartialUniqueConstraintTests(SecurityTestCase):
    """
    Verifies migration 0019 (unique_region_boss_per_region) against the
    LOCAL TEST DATABASE. This is the DB-level backstop referenced in
    project-quality/security/SECURITY_AND_AUTHORIZATION_REPORT.md -
    confirmed here to actually reject a duplicate at the database layer,
    independent of the application-level check above. Never run against
    production - see that report for why the real database cannot take this
    constraint yet (existing duplicate Gush-Elyon region_boss records).
    """

    def test_db_constraint_rejects_duplicate_region_boss_bypassing_app_layer(self):
        # Goes around the serializer entirely (raw .save()) to prove the
        # DATABASE itself - not just the application check - refuses a
        # second region_boss for the same region.
        second = User(
            email='dbconstraint@test.local', username='dbconstraint@test.local',
            role='region_boss', region=self.region_a,
            first_name='DB', last_name='Constraint',
        )
        second.set_password(TEST_PASSWORD)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                second.save()
