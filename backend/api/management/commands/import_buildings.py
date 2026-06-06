"""
DORMIFY - Import Buildings from Excel
Each row in Excel = one bed in one room in one apartment
Structure: Building -> Apartment -> Room (per bed) -> Bed
"""
import pandas as pd
from django.core.management.base import BaseCommand

SHEET_TO_REGION = {
    'גוש תחתון': {'region_id': 'gush-tachton', 'region_name': 'מעונות גוש תחתון', 'dorm_code': 1},
    'קנדה':      {'region_id': 'canada',        'region_name': 'מעונות קנדה',       'dorm_code': 2},
    'ברושים':    {'region_id': 'broshim',       'region_name': 'מעונות ברושים',     'dorm_code': 3},
    'מזרח':      {'region_id': 'mizrah',        'region_name': 'מעונות מזרח',       'dorm_code': 4},
    'גוש עליון': {'region_id': 'gush-elyon',   'region_name': 'מעונות גוש עליון',  'dorm_code': 5},
    'סגל זוטר':  {'region_id': 'segal-zutar',  'region_name': 'מעונות סגל זוטר',   'dorm_code': 6},
}


class Command(BaseCommand):
    help = 'Import buildings from Excel - each row = one bed in one room'

    def add_arguments(self, parser):
        parser.add_argument('excel_path', type=str)

    def handle(self, *args, **options):
        from api.models import Region, DormType, Building, Apartment, Room, Bed

        excel_path = options['excel_path']
        self.stdout.write(f'📂 Reading: {excel_path}')

        xl = pd.ExcelFile(excel_path)

        total_buildings = total_apartments = total_rooms = total_beds = 0

        for sheet_name in xl.sheet_names:
            if sheet_name not in SHEET_TO_REGION:
                self.stdout.write(f'  ⚠️  Skipping: {sheet_name}')
                continue

            info = SHEET_TO_REGION[sheet_name]
            self.stdout.write(f'\n🏢 Processing: {sheet_name}')

            # Read with header at row 3 (index 3)
            df = pd.read_excel(xl, sheet_name=sheet_name, header=3)
            df.columns = [str(c).strip() for c in df.columns]

            # Drop rows where בניין is empty
            df = df[df['בניין'].notna()]
            df = df[df['בניין'].astype(str).str.strip() != '']
            df = df[df['בניין'].astype(str).str.strip() != 'nan']

            self.stdout.write(f'  📊 Valid rows: {len(df)}')

            if len(df) == 0:
                continue

            # Get or create Region & DormType
            region, _ = Region.objects.get_or_create(
                id=info['region_id'],
                defaults={'name': info['region_name']}
            )
            dorm_type, _ = DormType.objects.get_or_create(
                code=info['dorm_code'],
                defaults={'name': info['region_name'], 'region': region}
            )

            # Parse each row
            # מזהה חדר format: building/apartment/room
            # Each row = one bed in that room
            # Multiple rows with same building/apartment/room = multiple beds in same room

            # Structure: {building: {apt: {room: {beds, category, apt_type}}}}
            data = {}

            for _, row in df.iterrows():
                try:
                    building_num = int(float(str(row.get('בניין', '')).strip()))
                except (ValueError, TypeError):
                    continue

                room_id = str(row.get('מזהה חדר', '')).strip()
                if not room_id or room_id == 'nan':
                    continue

                # Parse מזהה חדר: building/apartment/room
                parts = room_id.split('/')
                if len(parts) >= 3:
                    apt_num = parts[1]
                    room_num = parts[2]
                elif len(parts) == 2:
                    apt_num = parts[1]
                    room_num = '1'
                else:
                    continue

                # Category & type
                population = str(row.get('אוכלוסיה', '')).strip()
                apt_type_raw = str(row.get('סוג דירה', '')).strip()

                category = 'female' if 'בנות' in population or 'בנות' in apt_type_raw else 'male'

                if 'משפחה' in population or 'משפחות' in population:
                    apartment_type = 'family'
                elif 'זוגות' in population:
                    apartment_type = 'couple'
                else:
                    apartment_type = 'single'

                # Build nested structure
                if building_num not in data:
                    data[building_num] = {}
                if apt_num not in data[building_num]:
                    data[building_num][apt_num] = {
                        'rooms': {},
                        'category': category,
                        'apartment_type': apartment_type,
                    }
                if room_num not in data[building_num][apt_num]['rooms']:
                    data[building_num][apt_num]['rooms'][room_num] = 0

                # Each row = one bed in this room
                data[building_num][apt_num]['rooms'][room_num] += 1

            # Create DB records
            for building_num, apts in data.items():
                # Building
                building, created = Building.objects.get_or_create(
                    number=building_num,
                    defaults={'dorm_type': dorm_type, 'is_active': True}
                )
                if not created and not building.dorm_type:
                    building.dorm_type = dorm_type
                    building.save()
                if created:
                    total_buildings += 1

                for apt_num, apt_data in apts.items():
                    rooms_data = apt_data['rooms']
                    room_count = len(rooms_data)
                    # apartment_capacity = total beds across all rooms
                    apartment_capacity = sum(rooms_data.values())

                    # Apartment
                    apartment, created = Apartment.objects.get_or_create(
                        building=building,
                        number=str(apt_num),
                        defaults={
                            'category': apt_data['category'],
                            'apartment_type': apt_data['apartment_type'],
                            'room_count': room_count,
                            'apartment_capacity': apartment_capacity,
                            'is_active': True,
                        }
                    )
                    if not created:
                        if apartment.apartment_capacity != apartment_capacity or apartment.room_count != room_count:
                            apartment.apartment_capacity = apartment_capacity
                            apartment.room_count = room_count
                            apartment.save()
                    else:
                        total_apartments += 1

                    # Create ONE room per room_num (not one room per apartment!)
                    for room_num, bed_count in rooms_data.items():
                        room, created = Room.objects.get_or_create(
                            apartment=apartment,
                            name=str(room_num),
                            defaults={
                                'capacity': bed_count,
                                'is_active': True
                            }
                        )
                        if not created:
                            if room.capacity != bed_count:
                                room.capacity = bed_count
                                room.save()
                        else:
                            total_rooms += 1

                        # Create beds for this room
                        existing_beds = set(room.beds.values_list('label', flat=True))
                        new_beds = {f'Bed {i+1}' for i in range(bed_count)}

                        # Remove extra beds
                        for old_label in existing_beds - new_beds:
                            room.beds.filter(label=old_label).delete()

                        # Add missing beds
                        for bed_label in new_beds - existing_beds:
                            Bed.objects.create(room=room, label=bed_label)
                            total_beds += 1

            self.stdout.write(f'  ✅ {sheet_name} done')

        self.stdout.write(self.style.SUCCESS(
            f'\n🎉 Import Complete!'
            f'\n   🏢 Buildings:  {total_buildings}'
            f'\n   🏠 Apartments: {total_apartments}'
            f'\n   🚪 Rooms:      {total_rooms}'
            f'\n   🛏️  Beds:       {total_beds}'
        ))