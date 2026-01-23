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
    # 1. CREATE REGIONS
    # ===========================================
    print('📍 Creating regions...')
    regions_data = [
        {'id': 'canada', 'name': 'מעונות קנדה', 'name_en': 'Canada Dorms'},
        {'id': 'mizrah', 'name': 'מעונות מזרח', 'name_en': 'Mizrah Dorms'},
        {'id': 'taub', 'name': 'מעונות טאוב', 'name_en': 'Taub Dorms'},
        {'id': 'sherman', 'name': 'מעונות שרמן', 'name_en': 'Sherman Dorms'},
        {'id': 'einstein', 'name': 'מעונות איינשטיין', 'name_en': 'Einstein Dorms'},
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
        {'email': 'admin@technion.ac.il', 'username': 'admin', 'first_name': 'אברהם', 'last_name': 'כהן', 'role': 'central_admin', 'region': None},
        {'email': 'canada.boss@technion.ac.il', 'username': 'canada_boss', 'first_name': 'שרה', 'last_name': 'לוי', 'role': 'region_boss', 'region': 'canada'},
        {'email': 'canada.emp1@technion.ac.il', 'username': 'canada_emp1', 'first_name': 'דוד', 'last_name': 'ישראלי', 'role': 'employee', 'region': 'canada'},
        {'email': 'mizrah.boss@technion.ac.il', 'username': 'mizrah_boss', 'first_name': 'יוסף', 'last_name': 'חדד', 'role': 'region_boss', 'region': 'mizrah'},
        {'email': 'taub.boss@technion.ac.il', 'username': 'taub_boss', 'first_name': 'משה', 'last_name': 'פרץ', 'role': 'region_boss', 'region': 'taub'},
    ]
    
    for data in users_data:
        region = regions.get(data.pop('region')) if data.get('region') else None
        if not User.objects.filter(email=data['email']).exists():
            user = User.objects.create_user(
                password='123456',
                region=region,
                **data
            )
    print(f'   Created {len(users_data)} users\n')
    
    # ===========================================
    # 3. CREATE BUILDINGS
    # ===========================================
    print('🏢 Creating buildings...')
    buildings_data = [
        {'region': 'canada', 'name': 'בניין 1', 'floors': 5, 'apartments_per_floor': 4},
        {'region': 'canada', 'name': 'בניין 2', 'floors': 5, 'apartments_per_floor': 4},
        {'region': 'canada', 'name': 'בניין 3', 'floors': 4, 'apartments_per_floor': 4},
        {'region': 'mizrah', 'name': 'בניין 1', 'floors': 6, 'apartments_per_floor': 3},
        {'region': 'mizrah', 'name': 'בניין 2', 'floors': 6, 'apartments_per_floor': 3},
        {'region': 'taub', 'name': 'בניין 1', 'floors': 8, 'apartments_per_floor': 4},
        {'region': 'taub', 'name': 'בניין 2', 'floors': 8, 'apartments_per_floor': 4},
        {'region': 'sherman', 'name': 'בניין 1', 'floors': 4, 'apartments_per_floor': 5},
        {'region': 'einstein', 'name': 'בניין 1', 'floors': 5, 'apartments_per_floor': 4},
    ]
    
    buildings = []
    for data in buildings_data:
        region = regions[data.pop('region')]
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
                
                # Create 2 rooms per apartment
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
    # 5. CREATE STUDENTS
    # ===========================================
    print('👨‍🎓 Creating students...')
    
    male_names = ['יוסף', 'דוד', 'משה', 'אברהם', 'יעקב', 'שמעון', 'אלי', 'עומר', 'נועם', 'איתי']
    female_names = ['שרה', 'רחל', 'מירי', 'נועה', 'תמר', 'יעל', 'דנה', 'מאיה', 'שירה', 'ליאור']
    last_names = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אברהם', 'דוד', 'חדד', 'עמר', 'גולן']
    
    region_ids = list(regions.keys())
    student_count = 0
    
    for i in range(200):
        student_id = f'{300000000 + i}'
        
        if Student.objects.filter(student_id=student_id).exists():
            continue
        
        gender = random.choice(['male', 'female'])
        first_name = random.choice(male_names if gender == 'male' else female_names)
        last_name = random.choice(last_names)
        
        religion_rand = random.random()
        if religion_rand < 0.70:
            religion = 'jewish'
        elif religion_rand < 0.85:
            religion = 'muslim'
        elif religion_rand < 0.95:
            religion = 'christian'
        else:
            religion = 'druze'
        
        region_id = random.choice(region_ids)
        
        Student.objects.create(
            student_id=student_id,
            first_name=first_name,
            last_name=last_name,
            email=f'student{i}@campus.technion.ac.il',
            phone=f'05{random.randint(0,9)}{random.randint(1000000,9999999)}',
            gender=gender,
            religion=religion,
            region=regions[region_id],
            roommate_request_id=f'{300000000 + random.randint(0, 199)}' if random.random() < 0.3 else '',
            is_priority=random.random() < 0.03,
            priority_reason='בעיות בריאות / נגישות' if random.random() < 0.03 else ''
        )
        student_count += 1
    
    print(f'   Created {student_count} students\n')
    
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
    print('   Email: admin@technion.ac.il')
    print('   Password: 123456\n')


if __name__ == '__main__':
    seed()
