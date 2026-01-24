"""
DORMIFY - Seed Database
Run with: python seed.py
"""

import os
import sys
import django
import random

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'dormify.settings')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
django.setup()

from api.models import User, Region, Building, Apartment, Room, Student


def seed():
    print('🌱 Starting database seed...\n')
    
    # ===========================================
    # 1. CREATE REGIONS (matching Excel data)
    # ===========================================
    print('📍 Creating regions...')
    regions_data = [
        {'id': 'canada', 'name': 'מעונות קנדה', 'name_en': 'Canada Dorms'},
        {'id': 'hasmaha', 'name': 'מעונות ההסמכה', 'name_en': 'Hasmaha Dorms'},
        {'id': 'mizrah', 'name': 'מעונות מזרח', 'name_en': 'Mizrah Dorms'},
        {'id': 'mizrach-hadash', 'name': 'מעונות מזרח חדש', 'name_en': 'Mizrach Hadash Dorms'},
        {'id': 'mizrach-yashan', 'name': 'מעונות מזרח ישן', 'name_en': 'Mizrach Yashan Dorms'},
        {'id': 'taub', 'name': 'מעונות טאוב', 'name_en': 'Taub Dorms'},
        {'id': 'sherman', 'name': 'מעונות שרמן', 'name_en': 'Sherman Dorms'},
        {'id': 'einstein', 'name': 'מעונות איינשטיין', 'name_en': 'Einstein Dorms'},
        {'id': 'rifkin', 'name': 'מעונות ריפקין', 'name_en': 'Rifkin Dorms'},
        {'id': 'broshim', 'name': 'מעונות ברושים', 'name_en': 'Broshim Dorms'},
        {'id': 'segal-zutar', 'name': 'מעונות סגל זוטר', 'name_en': 'Segal Zutar Dorms'},
    ]

    regions = {}
    for data in regions_data:
        region, _ = Region.objects.get_or_create(id=data['id'], defaults=data)
        regions[data['id']] = region
    print(f'   Created {len(regions)} regions\n')

    # ===========================================
    # 2. CREATE USERS
    # ===========================================
    print('👥 Creating users...')
    users_data = [
        {'email': 'admin@technion.ac.il', 'username': 'admin', 'first_name': 'אברהם', 'last_name': 'כהן', 'role': 'central_admin', 'region': None, 'password': 'admin123'},
        {'email': 'canada@technion.ac.il', 'username': 'canada_boss', 'first_name': 'שרה', 'last_name': 'לוי', 'role': 'region_boss', 'region': 'canada', 'password': 'test123'},
        {'email': 'canada.emp@technion.ac.il', 'username': 'canada_emp', 'first_name': 'דוד', 'last_name': 'ישראלי', 'role': 'employee', 'region': 'canada', 'password': 'test123'},
        {'email': 'hasmaha@technion.ac.il', 'username': 'hasmaha_boss', 'first_name': 'יוסף', 'last_name': 'חדד', 'role': 'region_boss', 'region': 'hasmaha', 'password': 'test123'},
        {'email': 'mizrah@technion.ac.il', 'username': 'mizrah_boss', 'first_name': 'משה', 'last_name': 'פרץ', 'role': 'region_boss', 'region': 'mizrah', 'password': 'test123'},
    ]

    for data in users_data:
        region_id = data.pop('region')
        password = data.pop('password')
        region = regions.get(region_id) if region_id else None

        if not User.objects.filter(email=data['email']).exists():
            user = User.objects.create_user(
                password=password,
                region=region,
                **data
            )
            print(f'   Created user: {data["email"]} (password: {password})')
    print('')

    # ===========================================
    # 3. CREATE BUILDINGS
    # ===========================================
    print('🏢 Creating buildings...')
    buildings_data = [
        # Canada
        {'region': 'canada', 'name': 'בניין A', 'floors': 5, 'apartments_per_floor': 4},
        {'region': 'canada', 'name': 'בניין B', 'floors': 5, 'apartments_per_floor': 4},
        {'region': 'canada', 'name': 'בניין C', 'floors': 4, 'apartments_per_floor': 4},
        # Hasmaha
        {'region': 'hasmaha', 'name': 'בניין A', 'floors': 6, 'apartments_per_floor': 4},
        {'region': 'hasmaha', 'name': 'בניין B', 'floors': 6, 'apartments_per_floor': 4},
        {'region': 'hasmaha', 'name': 'בניין C', 'floors': 5, 'apartments_per_floor': 4},
        # Mizrah
        {'region': 'mizrah', 'name': 'בניין 1', 'floors': 6, 'apartments_per_floor': 3},
        {'region': 'mizrah', 'name': 'בניין 2', 'floors': 6, 'apartments_per_floor': 3},
    ]

    buildings = []
    for data in buildings_data:
        region = regions.get(data.pop('region'))
        if region:
            building, _ = Building.objects.get_or_create(
                region=region,
                name=data['name'],
                defaults=data
            )
            buildings.append(building)
    print(f'   Created {len(buildings)} buildings\n')

    # ===========================================
    # 4. CREATE APARTMENTS AND ROOMS
    # ===========================================
    print('🏠 Creating apartments and rooms...')
    apt_count = 0
    room_count = 0

    for building in buildings:
        for floor in range(1, building.floors + 1):
            for apt_num in range(1, building.apartments_per_floor + 1):
                number = (floor - 1) * building.apartments_per_floor + apt_num

                apartment, created = Apartment.objects.get_or_create(
                    building=building,
                    number=number,
                    defaults={
                        'floor': floor,
                        'room_count': 2,
                        'is_reserved': random.random() < 0.05
                    }
                )
                if created:
                    apt_count += 1

                # Create 2 rooms per apartment (each with capacity 2)
                for letter in ['A', 'B']:
                    room, created = Room.objects.get_or_create(
                        apartment=apartment,
                        name=f'חדר {letter}',
                        defaults={'capacity': 2}
                    )
                    if created:
                        room_count += 1

    print(f'   Created {apt_count} apartments')
    print(f'   Created {room_count} rooms\n')

    # ===========================================
    # DONE!
    # ===========================================
    print('✅ Database seeded successfully!\n')
    print('📋 Summary:')
    print(f'   - {Region.objects.count()} regions')
    print(f'   - {User.objects.count()} users')
    print(f'   - {Building.objects.count()} buildings')
    print(f'   - {Apartment.objects.count()} apartments')
    print(f'   - {Room.objects.count()} rooms')
    print(f'   - {Student.objects.count()} students')
    print('\n🔐 Login credentials:')
    print('   Central Admin: admin@technion.ac.il / admin123')
    print('   Canada Boss: canada@technion.ac.il / test123')
    print('   Hasmaha Boss: hasmaha@technion.ac.il / test123\n')


if __name__ == '__main__':
    seed()