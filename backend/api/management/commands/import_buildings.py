"""
Django Management Command - Import Buildings from Excel
Usage: python manage.py import_buildings /path/to/file.xlsx
"""
import pandas as pd
from django.core.management.base import BaseCommand

SHEET_TO_REGION = {
    'גוש תחתון': {'region_id': 'gush-tachton', 'region_name': 'מעונות גוש תחתון', 'dorm_code': 1},
    'קנדה':      {'region_id': 'canada',        'region_name': 'מעונות קנדה',       'dorm_code': 2},
    'ברושים':    {'region_id': 'broshim',       'region_name': 'מעונות ברושים',      'dorm_code': 3},
    'מזרח':      {'region_id': 'mizrah',        'region_name': 'מעונות מזרח',        'dorm_code': 4},
    'גוש עליון': {'region_id': 'gush-elyon',   'region_name': 'מעונות גוש עליון',   'dorm_code': 5},
    'סגל זוטר':  {'region_id': 'segal-zutar',  'region_name': 'מעונות סגל זוטר',    'dorm_code': 6},
}


class Command(BaseCommand):
    help = 'Import buildings, apartments and rooms from Excel file'

    def add_arguments(self, parser):
        parser.add_argument('excel_path', type=str, help='Path to Excel file inside container')

    def handle(self, *args, **options):
        from api.models import Region, DormType, Building, Apartment, Room, Bed

        excel_path = options['excel_path']
        self.stdout.write(f'📂 Reading file: {excel_path}')

        xl = pd.ExcelFile(excel_path)
        self.stdout.write(f'📋 Sheets: {xl.sheet_names}')

        total_buildings = total_apartments = total_rooms = total_beds = 0

        for sheet_name in xl.sheet_names:
            if sheet_name not in SHEET_TO_REGION:
                self.stdout.write(f'  ⚠️  Skipping: {sheet_name}')
                continue

            info = SHEET_TO_REGION[sheet_name]
            self.stdout.write(f'\n🏢 Processing: {sheet_name}')

            region, _ = Region.objects.get_or_create(
                id=info['region_id'],
                defaults={'name': info['region_name']}
            )
            dorm_type, _ = DormType.objects.get_or_create(
                code=info['dorm_code'],
                defaults={'name': info['region_name'], 'region': region}
            )

            raw_df = pd.read_excel(xl, sheet_name=sheet_name, header=None)
            header_row = None
            for idx, row in raw_df.iterrows():
                if 'בניין' in [str(v) for v in row.values]:
                    header_row = idx
                    break

            if header_row is None:
                self.stdout.write(f'  ❌ No header row found')
                continue

            df = pd.read_excel(xl, sheet_name=sheet_name, header=header_row)
            df.columns = [str(c).strip() for c in df.columns]
            df = df[df['בניין'].notna()]

            self.stdout.write(f'  📊 Rows: {len(df)}')

            for _, row in df.iterrows():
                try:
                    building_num = int(float(str(row.get('בניין', '')).strip()))
                except (ValueError, TypeError):
                    continue

                room_id = str(row.get('מזהה חדר', '')).strip()
                if not room_id or room_id == 'nan':
                    continue

                parts = room_id.split('/')
                if len(parts) == 3:
                    apt_num, room_num = parts[1], parts[2]
                elif len(parts) == 2:
                    apt_num, room_num = parts[1], '1'
                else:
                    apt_num = str(row.get('דירה', '1'))
                    room_num = str(row.get('חדר', '1'))

                apt_type_raw = str(row.get('סוג דירה', '')).strip()
                population = str(row.get('אוכלוסיה', '')).strip()

                category = 'female' if 'בנות' in apt_type_raw or 'בנות' in population else 'male'

                if 'משפחה' in apt_type_raw or 'משפחות' in apt_type_raw:
                    apartment_type = 'family'
                elif 'זוגות' in apt_type_raw or 'זוגות' in population:
                    apartment_type = 'couple'
                else:
                    apartment_type = 'single'

                building, created = Building.objects.get_or_create(
                    number=building_num,
                    defaults={'dorm_type': dorm_type, 'is_active': True}
                )
                if created:
                    total_buildings += 1

                apartment, created = Apartment.objects.get_or_create(
                    building=building,
                    number=str(apt_num),
                    defaults={
                        'category': category,
                        'apartment_type': apartment_type,
                        'room_count': 2,
                        'apartment_capacity': 2,
                        'is_active': True,
                    }
                )
                if created:
                    total_apartments += 1

                room, created = Room.objects.get_or_create(
                    apartment=apartment,
                    name=str(room_num),
                    defaults={'capacity': 1, 'is_active': True}
                )
                if created:
                    total_rooms += 1
                    Bed.objects.get_or_create(room=room, label='Bed 1')
                    total_beds += 1

            self.stdout.write(f'  ✅ Done: {sheet_name}')

        self.stdout.write(self.style.SUCCESS(
            f'\n🎉 Import Complete!'
            f'\n   🏢 Buildings:  {total_buildings}'
            f'\n   🏠 Apartments: {total_apartments}'
            f'\n   🚪 Rooms:      {total_rooms}'
            f'\n   🛏️  Beds:       {total_beds}'
        ))