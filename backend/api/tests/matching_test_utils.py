"""
Shared helpers for tests that exercise the building-paged matching service.

Matching/browsing is strictly READ-ONLY: it returns only real Bed rows and
never materializes beds from room capacity (that is the explicit admin-only
`manage.py materialize_beds` operation). Test fixtures therefore create Bed
rows explicitly, exactly like a properly initialized production database.
"""

from api.models import Bed


def create_beds_for_room(room):
    """Fixture equivalent of `manage.py materialize_beds` for one room."""
    existing = room.beds.count()
    return [
        Bed.objects.create(room=room, label=f'Bed {i}')
        for i in range(existing + 1, room.capacity + 1)
    ]


def flatten_bed_options(data):
    """
    Walk the hierarchical response (buildings -> apartments -> rooms -> beds)
    into flat per-bed dicts so ordering/content assertions stay concise.
    Flattening preserves the server's ordering: buildings in ranked order,
    apartments in ranked order within each building.
    """
    out = []
    for b in data.get('buildings', []):
        for a in b.get('apartments', []):
            for r in a.get('rooms', []):
                for bed in r.get('beds', []):
                    out.append({
                        'building_id': b['building_id'],
                        'building': b['building_number'],
                        'region_name': b['region_name'],
                        'dorm_type': b['dorm_type'],
                        'apartment_id': a['apartment_id'],
                        'apartment': a['apartment_number'],
                        'match_level': a['match_level'],
                        'recommendation_level': a['recommendation_level'],
                        'recommendation_label': a['recommendation_label'],
                        'matched_reasons': a['matched_reasons'],
                        'warnings': a['warnings'],
                        'historical_reasons': a['historical_reasons'],
                        'room_id': r['room_id'],
                        'room': r['room_name'],
                        'room_capacity': r['capacity'],
                        'occupied_beds_count': r['occupied_beds_count'],
                        'available_beds_count': r['available_beds_count'],
                        'bed_id': bed['bed_id'],
                        'bed_label': bed['bed_label'],
                        'is_occupied': bed['is_occupied'],
                        'is_selectable': bed['is_selectable'],
                    })
    return out


def assert_no_score_keys(node, path='response'):
    """Recursively assert no score/percentage key ever reaches the client."""
    forbidden = {'score', 'match_score', 'percentage', 'match_percentage'}
    if isinstance(node, dict):
        for key, value in node.items():
            assert str(key).lower() not in forbidden, f'{path}.{key} exposes a score'
            assert_no_score_keys(value, f'{path}.{key}')
    elif isinstance(node, (list, tuple)):
        for i, item in enumerate(node):
            assert_no_score_keys(item, f'{path}[{i}]')
