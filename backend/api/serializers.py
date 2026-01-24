"""
DORMIFY - Serializers
Convert database objects to JSON and vice versa
"""

from rest_framework import serializers
from django.contrib.auth import authenticate
from .models import (
    User, Region, Building, Apartment, Room, Student,
    Transfer, AllocationRun, ImportBatch, RegionInbox
)


# ===========================================
# USER SERIALIZERS
# ===========================================
class UserSerializer(serializers.ModelSerializer):
    """Serialize user data (without password)"""

    role_display = serializers.CharField(source='get_role_display', read_only=True)
    region_name = serializers.CharField(source='region.name', read_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'email', 'username', 'first_name', 'last_name',
            'role', 'role_display', 'region', 'region_name', 'phone',
            'is_active', 'date_joined'
        ]
        read_only_fields = ['id', 'date_joined']


class LoginSerializer(serializers.Serializer):
    """Serialize login request"""

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, data):
        email = data.get('email')
        password = data.get('password')

        if email and password:
            user = authenticate(username=email, password=password)
            if not user:
                raise serializers.ValidationError('אימייל או סיסמה שגויים')
            if not user.is_active:
                raise serializers.ValidationError('המשתמש אינו פעיל')
            data['user'] = user
        else:
            raise serializers.ValidationError('נדרש אימייל וסיסמה')

        return data


class RegisterSerializer(serializers.ModelSerializer):
    """Serialize registration request"""

    password = serializers.CharField(write_only=True, min_length=6)

    class Meta:
        model = User
        fields = ['email', 'username', 'password', 'first_name', 'last_name', 'role', 'region']

    def create(self, validated_data):
        user = User.objects.create_user(
            email=validated_data['email'],
            username=validated_data.get('username', validated_data['email']),
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            role=validated_data.get('role', User.Role.EMPLOYEE),
            region=validated_data.get('region')
        )
        return user


# ===========================================
# REGION SERIALIZER
# ===========================================
class RegionSerializer(serializers.ModelSerializer):
    """Serialize region data"""

    buildings_count = serializers.SerializerMethodField()
    students_count = serializers.SerializerMethodField()

    class Meta:
        model = Region
        fields = ['id', 'name', 'name_en', 'description', 'is_active',
                  'buildings_count', 'students_count']

    def get_buildings_count(self, obj):
        return obj.buildings.filter(is_active=True).count()

    def get_students_count(self, obj):
        return obj.students.filter(is_active=True).count()


# ===========================================
# BUILDING SERIALIZER
# ===========================================
class BuildingSerializer(serializers.ModelSerializer):
    """Serialize building data"""

    region_name = serializers.CharField(source='region.name', read_only=True)
    apartments_count = serializers.SerializerMethodField()
    rooms_count = serializers.SerializerMethodField()

    class Meta:
        model = Building
        fields = ['id', 'region', 'region_name', 'name', 'floors',
                  'apartments_per_floor', 'image_url', 'address',
                  'is_active', 'apartments_count', 'rooms_count']

    def get_apartments_count(self, obj):
        return obj.apartments.filter(is_active=True).count()

    def get_rooms_count(self, obj):
        return Room.objects.filter(apartment__building=obj, is_active=True).count()


# ===========================================
# APARTMENT SERIALIZER
# ===========================================
class ApartmentSerializer(serializers.ModelSerializer):
    """Serialize apartment data"""

    building_name = serializers.CharField(source='building.name', read_only=True)
    region_id = serializers.CharField(source='building.region_id', read_only=True)

    class Meta:
        model = Apartment
        fields = ['id', 'building', 'building_name', 'region_id', 'number',
                  'floor', 'room_count', 'is_reserved', 'reserved_reason', 'is_active']


# ===========================================
# ROOM SERIALIZER
# ===========================================
class RoomSerializer(serializers.ModelSerializer):
    """Serialize room data"""

    apartment_number = serializers.IntegerField(source='apartment.number', read_only=True)
    building_name = serializers.CharField(source='building.name', read_only=True)
    region_id = serializers.CharField(source='region.id', read_only=True)
    current_occupancy = serializers.IntegerField(read_only=True)
    available_beds = serializers.IntegerField(read_only=True)
    is_full = serializers.BooleanField(read_only=True)

    class Meta:
        model = Room
        fields = ['id', 'apartment', 'apartment_number', 'building_name',
                  'region_id', 'name', 'capacity', 'current_occupancy',
                  'available_beds', 'is_full', 'is_active']


# ===========================================
# STUDENT SERIALIZER
# ===========================================
class StudentSerializer(serializers.ModelSerializer):
    """Serialize student data"""

    full_name = serializers.CharField(read_only=True)
    gender_display = serializers.CharField(source='get_gender_display', read_only=True)
    religion_display = serializers.CharField(source='get_religion_display', read_only=True)
    nationality_display = serializers.CharField(source='get_nationality_display', read_only=True)
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    region_name = serializers.CharField(source='region.name', read_only=True)
    room_name = serializers.CharField(source='assigned_room.name', read_only=True)
    is_assigned = serializers.BooleanField(read_only=True)
    batch_id = serializers.IntegerField(source='batch.id', read_only=True, allow_null=True)

    class Meta:
        model = Student
        fields = [
            'id', 'student_id', 'business_partner_id', 'first_name', 'last_name', 'full_name',
            'email', 'email_secondary', 'phone', 'phone_secondary', 'city',
            'gender', 'gender_display', 'religion', 'religion_display',
            'nationality', 'nationality_display', 'category', 'category_display',
            'housing_type', 'allocation_group',
            'region', 'region_name', 'batch_id',
            'roommate_request_1', 'roommate_request_2', 'roommate_request_3',
            'roommate_request_4', 'roommate_request_5',
            'is_priority', 'priority_reason', 'disability_percentage', 'medical_approval',
            'current_address', 'current_region_name', 'decision_status',
            'assigned_room', 'room_name', 'is_assigned', 'is_active', 'created_at'
        ]
        read_only_fields = ['id', 'created_at']


# ===========================================
# TRANSFER SERIALIZER
# ===========================================
class TransferSerializer(serializers.ModelSerializer):
    """Serialize transfer request data"""

    student_name = serializers.CharField(source='student.full_name', read_only=True)
    student_id_number = serializers.CharField(source='student.student_id', read_only=True)
    from_room_name = serializers.CharField(source='from_room.name', read_only=True)
    to_room_name = serializers.CharField(source='to_room.name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    requested_by_name = serializers.CharField(source='requested_by.get_full_name', read_only=True)
    reviewed_by_name = serializers.CharField(source='reviewed_by.get_full_name', read_only=True)

    class Meta:
        model = Transfer
        fields = [
            'id', 'student', 'student_name', 'student_id_number',
            'from_room', 'from_room_name', 'to_room', 'to_room_name',
            'reason', 'status', 'status_display', 'requested_by',
            'requested_by_name', 'reviewed_by', 'reviewed_by_name',
            'reviewed_at', 'rejection_reason', 'created_at'
        ]
        read_only_fields = ['id', 'requested_by', 'reviewed_by', 'reviewed_at', 'created_at']


# ===========================================
# ALLOCATION RUN SERIALIZER
# ===========================================
class AllocationRunSerializer(serializers.ModelSerializer):
    """Serialize allocation run data"""

    region_name = serializers.CharField(source='region.name', read_only=True)
    run_by_name = serializers.CharField(source='run_by.get_full_name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = AllocationRun
        fields = [
            'id', 'region', 'region_name', 'run_by', 'run_by_name',
            'status', 'status_display', 'students_processed',
            'successful_assignments', 'roommate_matches', 'conflicts',
            'started_at', 'completed_at', 'error_message', 'batch'
        ]


# ===========================================
# IMPORT BATCH SERIALIZER
# ===========================================
class ImportBatchSerializer(serializers.ModelSerializer):
    """Serialize import batch data"""

    uploaded_by_name = serializers.CharField(source='uploaded_by.get_full_name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    region_breakdown = serializers.SerializerMethodField()

    class Meta:
        model = ImportBatch
        fields = [
            'id', 'uploaded_by', 'uploaded_by_name', 'filename',
            'total_students', 'status', 'status_display',
            'error_message', 'created_at', 'region_breakdown'
        ]

    def get_region_breakdown(self, obj):
        """Get breakdown of students by region for this batch"""
        from django.db.models import Count
        breakdown = obj.region_inboxes.values(
            'region__id', 'region__name'
        ).annotate(count=Count('id'))
        return [
            {
                'region_id': item['region__id'],
                'region_name': item['region__name'],
                'count': RegionInbox.objects.filter(
                    batch=obj, region_id=item['region__id']
                ).first().students_count if RegionInbox.objects.filter(
                    batch=obj, region_id=item['region__id']
                ).exists() else 0
            }
            for item in breakdown
        ]


# ===========================================
# REGION INBOX SERIALIZER
# ===========================================
class RegionInboxSerializer(serializers.ModelSerializer):
    """Serialize region inbox data"""

    region_name = serializers.CharField(source='region.name', read_only=True)
    batch_filename = serializers.CharField(source='batch.filename', read_only=True)
    batch_created_at = serializers.DateTimeField(source='batch.created_at', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = RegionInbox
        fields = [
            'id', 'region', 'region_name', 'batch', 'batch_filename',
            'batch_created_at', 'students_count', 'status', 'status_display',
            'message', 'created_at', 'viewed_at', 'processed_at'
        ]