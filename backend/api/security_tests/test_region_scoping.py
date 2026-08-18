"""
G3-03 / G3-04 / G3-08 / G3-12: cross-region access must never be possible
merely by supplying ?region=<another-region>, for either reads or writes,
and reparenting an inventory object must not cross regions either.
"""

from api.models import Apartment, Building, Room

from .base import SecurityTestCase, make_room


class ReadEndpointsRegionScopingTests(SecurityTestCase):
    """G3-03 / G3-08: statistics/allocation_summary/allocation_results/
    assisted_allocation_queue/get_active_allocation_run."""

    def test_boss_cannot_read_statistics_for_another_region(self):
        client = self.client_for(self.boss_b)
        resp = client.get(f'/api/statistics/?region={self.region_a.id}')
        self.assertEqual(resp.status_code, 403)

    def test_boss_own_region_statistics_still_works(self):
        client = self.client_for(self.boss_a)
        resp = client.get(f'/api/statistics/?region={self.region_a.id}')
        self.assertEqual(resp.status_code, 200)

    def test_central_admin_can_select_any_region_statistics(self):
        client = self.client_for(self.admin)
        resp = client.get(f'/api/statistics/?region={self.region_b.id}')
        self.assertEqual(resp.status_code, 200)

    def test_employee_cannot_override_active_allocation_run_region(self):
        client = self.client_for(self.emp_a)
        resp = client.get(f'/api/allocation/runs/active/?region={self.region_b.id}')
        self.assertEqual(resp.status_code, 403)

    def test_boss_cannot_override_allocation_summary_region(self):
        client = self.client_for(self.boss_a)
        resp = client.get(f'/api/allocation/summary/?region={self.region_b.id}')
        self.assertEqual(resp.status_code, 403)

    def test_boss_cannot_override_assisted_allocation_queue_region(self):
        client = self.client_for(self.boss_a)
        resp = client.get(f'/api/assisted-allocation/queue/?region={self.region_b.id}')
        self.assertEqual(resp.status_code, 403)

    def test_boss_cannot_override_allocation_results_region(self):
        client = self.client_for(self.boss_a)
        resp = client.get(f'/api/allocation/results/?region={self.region_b.id}')
        self.assertEqual(resp.status_code, 403)


class InventoryReadWriteRegionScopingTests(SecurityTestCase):
    """G3-04: Building/Apartment/Room."""

    def test_boss_cannot_read_other_region_buildings_via_query_param(self):
        client = self.client_for(self.boss_a)
        resp = client.get(f'/api/buildings/?region={self.region_b.id}')
        self.assertEqual(resp.status_code, 200)
        rows = resp.data.get('results', resp.data) if isinstance(resp.data, dict) else resp.data
        ids = [b['id'] for b in rows]
        self.assertNotIn(self.building_b.id, ids)

    def test_boss_cannot_write_other_region_building_via_query_param(self):
        client = self.client_for(self.boss_b)
        resp = client.patch(
            f'/api/buildings/{self.building_a.id}/?region={self.region_a.id}',
            {'gender_restriction': 'male'}, format='json',
        )
        # _region_scoped_inventory_queryset() returns an EMPTY queryset for
        # a mismatched ?region= (never the foreign region's data), so
        # get_object() 404s before ever reaching the view body - stronger
        # than a 403 (it doesn't even confirm the object exists).
        self.assertEqual(resp.status_code, 404, resp.content)
        self.building_a.refresh_from_db()
        self.assertEqual(self.building_a.gender_restriction, '')

    def test_boss_cannot_write_other_region_apartment_via_query_param(self):
        client = self.client_for(self.boss_b)
        resp = client.patch(
            f'/api/apartments/{self.apartment_a.id}/?region={self.region_a.id}',
            {'apartment_capacity': 9}, format='json',
        )
        self.assertEqual(resp.status_code, 404, resp.content)

    def test_boss_cannot_write_other_region_room_via_query_param(self):
        client = self.client_for(self.boss_b)
        resp = client.patch(
            f'/api/rooms/{self.room_a.id}/?region={self.region_a.id}',
            {'capacity': 5}, format='json',
        )
        self.assertEqual(resp.status_code, 404, resp.content)
        self.room_a.refresh_from_db()
        self.assertEqual(self.room_a.capacity, 2)

    def test_boss_can_still_edit_own_region_building(self):
        client = self.client_for(self.boss_a)
        resp = client.patch(f'/api/buildings/{self.building_a.id}/', {
            'gender_restriction': 'male',
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_central_admin_can_edit_any_region_building(self):
        client = self.client_for(self.admin)
        resp = client.patch(f'/api/buildings/{self.building_b.id}/', {
            'gender_restriction': 'female',
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)


class InventoryReparentingTests(SecurityTestCase):
    """G3-12: reparenting must never cross regions for a regional manager."""

    def test_boss_cannot_reparent_apartment_into_another_region_building(self):
        client = self.client_for(self.boss_a)
        resp = client.patch(f'/api/apartments/{self.apartment_a.id}/', {
            'building': self.building_b.id,
        }, format='json')
        self.assertEqual(resp.status_code, 403, resp.content)
        self.apartment_a.refresh_from_db()
        self.assertEqual(self.apartment_a.building_id, self.building_a.id)

    def test_boss_cannot_reparent_room_into_another_region_apartment(self):
        client = self.client_for(self.boss_a)
        resp = client.patch(f'/api/rooms/{self.room_a.id}/', {
            'apartment': self.apartment_b.id,
        }, format='json')
        self.assertEqual(resp.status_code, 403, resp.content)
        self.room_a.refresh_from_db()
        self.assertEqual(self.room_a.apartment_id, self.apartment_a.id)

    def test_boss_cannot_reparent_building_into_another_region_dormtype(self):
        client = self.client_for(self.boss_a)
        resp = client.patch(f'/api/buildings/{self.building_a.id}/', {
            'dorm_type': self.dorm_b.id,
        }, format='json')
        self.assertEqual(resp.status_code, 403, resp.content)
        self.building_a.refresh_from_db()
        self.assertEqual(self.building_a.dorm_type_id, self.dorm_a.id)

    def test_central_admin_can_reparent_across_regions(self):
        # Central admin retains full cross-region administrative control -
        # only regional managers are region-locked.
        _, extra_apartment, _ = make_room(self.dorm_a, 9201, '9', room_name='109')
        client = self.client_for(self.admin)
        resp = client.patch(f'/api/apartments/{extra_apartment.id}/', {
            'building': self.building_b.id,
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
