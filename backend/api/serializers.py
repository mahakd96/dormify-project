"""
DORMIFY - Serializers
Convert database objects to JSON and vice versa
"""

from django.contrib.auth import authenticate, get_user_model
from rest_framework import serializers

from .models import (
    User, Region, Office, StaffProfile, DormType, Building, Apartment, Room, Bed,
    Student, BedAssignment, MovementRequest, Transfer,
    AllocationRun, ImportBatch, RegionInbox
)

User = get_user_model()


# ===========================================
# USER SERIALIZERS
# ===========================================
class UserSerializer(serializers.ModelSerializer):
    """Serialize user data (without password)"""

    role_display = serializers.CharField(source='get_role_display', read_only=True)
    region_name = serializers.CharField(source='region.name', read_only=True)
    full_name = serializers.SerializerMethodField()
    is_central_admin = serializers.BooleanField(read_only=True)
    is_boss = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = [
            'id',
            'email',
            'username',
            'first_name',
            'last_name',
            'full_name',
            'role',
            'role_display',
            'region',
            'region_name',
            'phone',
            'is_active',
            'date_joined',
            'is_central_admin',
            'is_boss',
        ]
        read_only_fields = [
            'id',
            'date_joined',
            'full_name',
            'is_central_admin',
            'is_boss',
        ]

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.email


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
        fields = [
            'email',
            'username',
            'password',
            'first_name',
            'last_name',
            'role',
            'region',
            'phone',
        ]

    def create(self, validated_data):
        user = User.objects.create_user(
            email=validated_data['email'],
            username=validated_data.get('username', validated_data['email']),
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            role=validated_data.get('role', User.Role.EMPLOYEE),
            region=validated_data.get('region'),
            phone=validated_data.get('phone', ''),
        )
        return user


# ===========================================
# REGION / OFFICE / STAFF SERIALIZERS
# ===========================================
class RegionSerializer(serializers.ModelSerializer):
    """Serialize region data"""

    class Meta:
        model = Region
        fields = ['id', 'name']
class DormTypeSerializer(serializers.ModelSerializer):
    region_name = serializers.CharField(source='region.name', read_only=True)

    class Meta:
        model = DormType
        fields = ['id', 'code', 'name', 'region', 'region_name']

class OfficeSerializer(serializers.ModelSerializer):
    """Serialize office data"""

    office_type_display = serializers.CharField(source='get_office_type_display', read_only=True)
    region_name = serializers.CharField(source='region.name', read_only=True)

    class Meta:
        model = Office
        fields = [
            'id',
            'name',
            'office_type',
            'office_type_display',
            'region',
            'region_name',
        ]

    def validate(self, attrs):
        office_type = attrs.get('office_type', getattr(self.instance, 'office_type', None))
        region = attrs.get('region', getattr(self.instance, 'region', None))

        if office_type == Office.OfficeType.REGIONAL and not region:
            raise serializers.ValidationError({
                'region': 'Regional office must have a region.'
            })

        if office_type == Office.OfficeType.CENTRAL and region:
            raise serializers.ValidationError({
                'region': 'Central office should not be linked to a region.'
            })

        return attrs


class StaffProfileSerializer(serializers.ModelSerializer):
    """Serialize staff profile data"""

    user_email = serializers.CharField(source='user.email', read_only=True)
    user_full_name = serializers.SerializerMethodField()
    role_display = serializers.CharField(source='get_role_display', read_only=True)
    office_name = serializers.CharField(source='office.name', read_only=True)

    class Meta:
        model = StaffProfile
        fields = [
            'id',
            'user',
            'user_email',
            'user_full_name',
            'role',
            'role_display',
            'office',
            'office_name',
        ]

    def get_user_full_name(self, obj):
        return obj.user.get_full_name() or obj.user.email


# ===========================================
# DORM / BUILDING SERIALIZERS
# ===========================================
class DormTypeSerializer(serializers.ModelSerializer):
    """Serialize dorm type data"""

    region_name = serializers.CharField(source='region.name', read_only=True)

    class Meta:
        model = DormType
        fields = ['id', 'code', 'name', 'region', 'region_name']


class BuildingSerializer(serializers.ModelSerializer):
    """Serialize building data"""

    dorm_type_name = serializers.CharField(source='dorm_type.name', read_only=True)
    dorm_type_code = serializers.IntegerField(source='dorm_type.code', read_only=True)
    region = serializers.CharField(source='dorm_type.region.id', read_only=True)
    region_name = serializers.CharField(source='dorm_type.region.name', read_only=True)

    class Meta:
        model = Building
        fields = [
            'id',
            'number',
            'dorm_type',
            'dorm_type_name',
            'dorm_type_code',
            'region',
            'region_name',
            'is_active',
        ]


class ApartmentSerializer(serializers.ModelSerializer):
    """Serialize apartment data"""

    building_number = serializers.IntegerField(source='building.number', read_only=True)
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    apartment_type_display = serializers.CharField(source='get_apartment_type_display', read_only=True)
    inactive_reason_display = serializers.CharField(source='get_inactive_reason_display', read_only=True)
    region = serializers.CharField(source='region.id', read_only=True)
    region_name = serializers.CharField(source='region.name', read_only=True)
    dorm_type = serializers.CharField(source='dorm_type.name', read_only=True)

    class Meta:
        model = Apartment
        fields = [
            'id',
            'building',
            'building_number',
            'number',
            'category',
            'category_display',
            'apartment_type',
            'apartment_type_display',
            'room_count',
            'apartment_capacity',
            'is_active',
            'inactive_reason',
            'inactive_reason_display',
            'region',
            'region_name',
            'dorm_type',
        ]


class RoomSerializer(serializers.ModelSerializer):
    """Serialize room data"""

    apartment_number = serializers.CharField(source='apartment.number', read_only=True)
    building_number = serializers.IntegerField(source='building.number', read_only=True)
    region = serializers.CharField(source='region.id', read_only=True)
    region_name = serializers.CharField(source='region.name', read_only=True)
    number = serializers.CharField(read_only=True)
    current_occupancy = serializers.IntegerField(read_only=True)
    available_beds = serializers.IntegerField(read_only=True)
    is_full = serializers.BooleanField(read_only=True)

    class Meta:
        model = Room
        fields = [
            'id',
            'apartment',
            'apartment_number',
            'building_number',
            'region',
            'region_name',
            'name',
            'number',
            'capacity',
            'current_occupancy',
            'available_beds',
            'is_full',
            'is_active',
        ]


class BedSerializer(serializers.ModelSerializer):
    """Serialize bed data"""

    room_name = serializers.CharField(source='room.name', read_only=True)
    apartment_number = serializers.CharField(source='room.apartment.number', read_only=True)
    building_number = serializers.IntegerField(source='room.apartment.building.number', read_only=True)
    is_occupied = serializers.BooleanField(read_only=True)

    class Meta:
        model = Bed
        fields = [
            'id',
            'label',
            'room',
            'room_name',
            'apartment_number',
            'building_number',
            'is_occupied',
        ]


# ===========================================
# STUDENT LIST SERIALIZER
# ===========================================

class StudentListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for students list page"""

    full_name = serializers.CharField(read_only=True)
    gender_display = serializers.CharField(source='get_gender_display', read_only=True)
    requested_religion_display = serializers.CharField(source='get_requested_religion_display', read_only=True)
    category_display = serializers.CharField(source='get_category_display', read_only=True)

    accepted_dorm_type_name = serializers.CharField(source='accepted_dorm_type.name', read_only=True)
    accepted_dorm_type_code = serializers.IntegerField(source='accepted_dorm_type.code', read_only=True)

    is_assigned = serializers.BooleanField(read_only=True)

    class Meta:
        model = Student
        fields = [
            'id',
            'student_id',
            'business_partner_id',
            'first_name',
            'last_name',
            'full_name',
            'email',
            'phone',
            'gender',
            'gender_display',
            'requested_religion',
            'requested_religion_display',
            'category',
            'category_display',
            'housing_type',
            'accepted_dorm_type',
            'accepted_dorm_type_name',
            'accepted_dorm_type_code',
            'is_priority',
            'priority_reason',
            'assigned_room',
            'is_assigned',
        ]

# ===========================================
# STUDENT SERIALIZER
# ===========================================
class StudentSerializer(serializers.ModelSerializer):
    """Serialize student data"""

    full_name = serializers.CharField(read_only=True)
    gender_display = serializers.CharField(source='get_gender_display', read_only=True)
    requested_religion_display = serializers.CharField(source='get_requested_religion_display', read_only=True)
    religious_display = serializers.CharField(source='get_religious_display', read_only=True)
    category_display = serializers.CharField(source='get_category_display', read_only=True)

    accepted_dorm_type_name = serializers.CharField(source='accepted_dorm_type.name', read_only=True)
    accepted_dorm_type_code = serializers.IntegerField(source='accepted_dorm_type.code', read_only=True)

    assigned_room_name = serializers.CharField(source='assigned_room.name', read_only=True)
    assigned_room_id = serializers.IntegerField(source='assigned_room.id', read_only=True)
    assigned_building_number = serializers.IntegerField(
        source='assigned_room.apartment.building.number',
        read_only=True
    )
    assigned_apartment_number = serializers.CharField(
        source='assigned_room.apartment.number',
        read_only=True
    )

    housing_gender = serializers.CharField(read_only=True)
    is_assigned = serializers.BooleanField(read_only=True)

    current_bed_id = serializers.SerializerMethodField()
    current_bed_label = serializers.SerializerMethodField()

    batch_id = serializers.IntegerField(source='batch.id', read_only=True, allow_null=True)

    class Meta:
        model = Student
        fields = [
            'id',
            'student_id',
            'business_partner_id',
            'first_name',
            'last_name',
            'full_name',
            'email',
            'email_secondary',
            'phone',
            'phone_secondary',
            'city',
            'gender',
            'gender_display',
            'requested_religion',
            'requested_religion_display',
            'religious',
            'religious_display',
            'category',
            'category_display',
            'housing_type',
            'housing_gender',
            'allocation_group',
            'accepted_dorm_type',
            'accepted_dorm_type_name',
            'accepted_dorm_type_code',
            'batch',
            'batch_id',
            'roommate_request_1',
            'roommate_request_2',
            'roommate_request_3',
            'roommate_request_4',
            'roommate_request_5',
            'roommate_request_flag_1',
            'roommate_request_flag_2',
            'roommate_request_flag_3',
            'roommate_request_flag_4',
            'roommate_request_flag_5',
            'special_status_1',
            'special_status_2',
            'special_status_3',
            'special_status_4',
            'is_priority',
            'priority_reason',
            'study_points',
            'current_address',
            'current_dorm_type',
            'move_in_date',
            'move_out_date',
            'assigned_room',
            'assigned_room_id',
            'assigned_room_name',
            'assigned_building_number',
            'assigned_apartment_number',
            'is_assigned',
            'current_bed_id',
            'current_bed_label',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'full_name',
            'housing_gender',
            'is_assigned',
            'current_bed_id',
            'current_bed_label',
            'created_at',
            'updated_at',
        ]

    def get_current_bed_id(self, obj):
        bed = obj.current_bed
        return bed.id if bed else None

    def get_current_bed_label(self, obj):
        bed = obj.current_bed
        return bed.label if bed else None


# ===========================================
# BED ASSIGNMENT SERIALIZER
# ===========================================
class BedAssignmentSerializer(serializers.ModelSerializer):
    """Serialize bed assignment data"""

    student_name = serializers.CharField(source='student.full_name', read_only=True)
    student_id_number = serializers.CharField(source='student.student_id', read_only=True)
    bed_label = serializers.CharField(source='bed.label', read_only=True)
    room_name = serializers.CharField(source='bed.room.name', read_only=True)
    apartment_number = serializers.CharField(source='bed.room.apartment.number', read_only=True)
    building_number = serializers.IntegerField(source='bed.room.apartment.building.number', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    assignment_type_display = serializers.CharField(source='get_assignment_type_display', read_only=True)
    assigned_by_name = serializers.SerializerMethodField()

    class Meta:
        model = BedAssignment
        fields = [
            'id',
            'student',
            'student_name',
            'student_id_number',
            'bed',
            'bed_label',
            'room_name',
            'apartment_number',
            'building_number',
            'status',
            'status_display',
            'assignment_type',
            'assignment_type_display',
            'assigned_by',
            'assigned_by_name',
            'assigned_at',
            'ended_at',
        ]
        read_only_fields = ['id', 'assigned_at']

    def get_assigned_by_name(self, obj):
        if not obj.assigned_by:
            return None
        return obj.assigned_by.get_full_name() or obj.assigned_by.email

    def validate(self, attrs):
        instance = self.instance

        student = attrs.get('student', getattr(instance, 'student', None))
        bed = attrs.get('bed', getattr(instance, 'bed', None))
        status = attrs.get('status', getattr(instance, 'status', None))
        ended_at = attrs.get('ended_at', getattr(instance, 'ended_at', None))

        if status == BedAssignment.Status.ACTIVE and ended_at is not None:
            raise serializers.ValidationError({
                'ended_at': 'Active assignment cannot have an ended_at value.'
            })

        if status in [BedAssignment.Status.ENDED, BedAssignment.Status.CANCELLED] and ended_at is None:
            raise serializers.ValidationError({
                'ended_at': 'Ended or cancelled assignment must have ended_at.'
            })

        if status == BedAssignment.Status.ACTIVE and bed is not None:
            qs = BedAssignment.objects.filter(
                bed=bed,
                status=BedAssignment.Status.ACTIVE
            )
            if instance:
                qs = qs.exclude(pk=instance.pk)
            if qs.exists():
                raise serializers.ValidationError({
                    'bed': 'This bed already has an active assignment.'
                })

        if status == BedAssignment.Status.ACTIVE and student is not None:
            qs = BedAssignment.objects.filter(
                student=student,
                status=BedAssignment.Status.ACTIVE
            )
            if instance:
                qs = qs.exclude(pk=instance.pk)
            if qs.exists():
                raise serializers.ValidationError({
                    'student': 'This student already has an active bed assignment.'
                })

        return attrs


# ===========================================
# MOVEMENT REQUEST SERIALIZER
# ===========================================
class MovementRequestSerializer(serializers.ModelSerializer):
    """Serialize movement request data"""

    student_name = serializers.CharField(source='student.full_name', read_only=True)
    from_assignment_id = serializers.IntegerField(source='from_assignment.id', read_only=True)
    from_bed_label = serializers.CharField(source='from_assignment.bed.label', read_only=True)
    to_bed_label = serializers.CharField(source='to_bed.label', read_only=True)
    movement_type_display = serializers.CharField(source='get_movement_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = MovementRequest
        fields = [
            'id',
            'student',
            'student_name',
            'from_assignment',
            'from_assignment_id',
            'from_bed_label',
            'to_bed',
            'to_bed_label',
            'movement_type',
            'movement_type_display',
            'status',
            'status_display',
            'reason',
            'requested_by',
            'requested_by_name',
            'approved_by',
            'approved_by_name',
            'created_at',
            'reviewed_at',
            'completed_at',
        ]
        read_only_fields = ['id', 'created_at']

    def get_requested_by_name(self, obj):
        if not obj.requested_by:
            return None
        return obj.requested_by.get_full_name() or obj.requested_by.email

    def get_approved_by_name(self, obj):
        if not obj.approved_by:
            return None
        return obj.approved_by.get_full_name() or obj.approved_by.email

    def validate(self, attrs):
        instance = self.instance

        status = attrs.get('status', getattr(instance, 'status', None))
        approved_by = attrs.get('approved_by', getattr(instance, 'approved_by', None))
        reviewed_at = attrs.get('reviewed_at', getattr(instance, 'reviewed_at', None))
        completed_at = attrs.get('completed_at', getattr(instance, 'completed_at', None))
        to_bed = attrs.get('to_bed', getattr(instance, 'to_bed', None))

        if status == MovementRequest.Status.PENDING:
            if approved_by is not None or reviewed_at is not None or completed_at is not None:
                raise serializers.ValidationError(
                    'Pending request cannot have approval/completion data.'
                )

        if status == MovementRequest.Status.APPROVED:
            if approved_by is None or reviewed_at is None:
                raise serializers.ValidationError(
                    'Approved request must have approved_by and reviewed_at.'
                )

        if status == MovementRequest.Status.REJECTED:
            if approved_by is None or reviewed_at is None:
                raise serializers.ValidationError(
                    'Rejected request must have approved_by and reviewed_at.'
                )

        if status == MovementRequest.Status.COMPLETED:
            if approved_by is None or reviewed_at is None or completed_at is None:
                raise serializers.ValidationError(
                    'Completed request must have approval and completion timestamps.'
                )

        if status in [MovementRequest.Status.APPROVED, MovementRequest.Status.COMPLETED] and to_bed is None:
            raise serializers.ValidationError({
                'to_bed': 'Approved or completed request must have target bed.'
            })

        return attrs


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
    requested_by_region_name = serializers.CharField(source='requested_by.region.name', read_only=True)

    from_building_number = serializers.IntegerField(source='from_room.apartment.building.number', read_only=True)
    from_apartment_number = serializers.CharField(source='from_room.apartment.number', read_only=True)

    to_building_number = serializers.IntegerField(source='to_room.apartment.building.number', read_only=True)
    to_apartment_number = serializers.CharField(source='to_room.apartment.number', read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Transfer
        fields = [
            'id',
            'student',
            'student_name',
            'student_id_number',

            'from_room',
            'from_room_name',
            'from_building_number',
            'from_apartment_number',

            'to_room',
            'to_room_name',
            'to_building_number',
            'to_apartment_number',

            'reason',
            'status',
            'status_display',

            'requested_by',
            'requested_by_name',
            'requested_by_region_name',

            'reviewed_by',
            'reviewed_by_name',
            'reviewed_at',

            'rejection_reason',
            'movement_request',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_requested_by_name(self, obj):
        return obj.requested_by.get_full_name() or obj.requested_by.email

    def get_reviewed_by_name(self, obj):
        if not obj.reviewed_by:
            return None
        return obj.reviewed_by.get_full_name() or obj.reviewed_by.email

    def validate(self, attrs):
        instance = self.instance

        from_room = attrs.get('from_room', getattr(instance, 'from_room', None))
        to_room = attrs.get('to_room', getattr(instance, 'to_room', None))
        status = attrs.get('status', getattr(instance, 'status', None))
        reviewed_by = attrs.get('reviewed_by', getattr(instance, 'reviewed_by', None))
        reviewed_at = attrs.get('reviewed_at', getattr(instance, 'reviewed_at', None))
        rejection_reason = attrs.get('rejection_reason', getattr(instance, 'rejection_reason', ''))

        if from_room and to_room and from_room == to_room:
            raise serializers.ValidationError({
                'to_room': 'Source room and target room cannot be the same.'
            })

        if status == Transfer.Status.PENDING:
            if reviewed_by is not None or reviewed_at is not None:
                raise serializers.ValidationError(
                    'Pending transfer cannot have review data.'
                )
            if rejection_reason:
                raise serializers.ValidationError(
                    'Pending transfer cannot have rejection_reason.'
                )

        if status == Transfer.Status.APPROVED:
            if reviewed_by is None or reviewed_at is None:
                raise serializers.ValidationError(
                    'Approved transfer must have reviewed_by and reviewed_at.'
                )
            if rejection_reason:
                raise serializers.ValidationError(
                    'Approved transfer cannot have rejection_reason.'
                )

        if status == Transfer.Status.REJECTED:
            if reviewed_by is None or reviewed_at is None:
                raise serializers.ValidationError(
                    'Rejected transfer must have reviewed_by and reviewed_at.'
                )

        return attrs


# ===========================================
# ALLOCATION RUN SERIALIZER
# ===========================================
class AllocationRunSerializer(serializers.ModelSerializer):
    """Serialize allocation run data"""

    region_name = serializers.CharField(source='region.name', read_only=True)
    run_by_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = AllocationRun
        fields = [
            'id',
            'region',
            'region_name',
            'run_by',
            'run_by_name',
            'status',
            'status_display',
            'students_processed',
            'successful_assignments',
            'roommate_matches',
            'conflicts',
            'started_at',
            'completed_at',
            'error_message',
        ]
        read_only_fields = ['id', 'started_at']

    def get_run_by_name(self, obj):
        if not obj.run_by:
            return None
        return obj.run_by.get_full_name() or obj.run_by.email

    def validate(self, attrs):
        instance = self.instance

        status = attrs.get('status', getattr(instance, 'status', None))
        completed_at = attrs.get('completed_at', getattr(instance, 'completed_at', None))
        error_message = attrs.get('error_message', getattr(instance, 'error_message', ''))

        if status == AllocationRun.Status.RUNNING:
            if completed_at is not None:
                raise serializers.ValidationError({
                    'completed_at': 'Running allocation cannot have completed_at.'
                })
            if error_message:
                raise serializers.ValidationError({
                    'error_message': 'Running allocation cannot have error_message.'
                })

        if status == AllocationRun.Status.COMPLETED:
            if completed_at is None:
                raise serializers.ValidationError({
                    'completed_at': 'Completed allocation must have completed_at.'
                })
            if error_message:
                raise serializers.ValidationError({
                    'error_message': 'Completed allocation should not have error_message.'
                })

        if status == AllocationRun.Status.FAILED:
            if completed_at is None:
                raise serializers.ValidationError({
                    'completed_at': 'Failed allocation must have completed_at.'
                })
            if not error_message:
                raise serializers.ValidationError({
                    'error_message': 'Failed allocation should include error_message.'
                })

        return attrs


# ===========================================
# IMPORT BATCH SERIALIZER
# ===========================================
class ImportBatchSerializer(serializers.ModelSerializer):
    """Serialize import batch data"""

    uploaded_by_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    region_breakdown = serializers.SerializerMethodField()

    class Meta:
        model = ImportBatch
        fields = [
            'id',
            'uploaded_by',
            'uploaded_by_name',
            'filename',
            'total_students',
            'status',
            'status_display',
            'error_message',
            'created_at',
            'region_breakdown',
        ]
        read_only_fields = ['id', 'created_at']

    def get_uploaded_by_name(self, obj):
        return obj.uploaded_by.get_full_name() or obj.uploaded_by.email

    def get_region_breakdown(self, obj):
        return [
            {
                'region_id': inbox.region.id,
                'region_name': inbox.region.name,
                'count': inbox.students_count,
                'status': inbox.status,
            }
            for inbox in obj.region_inboxes.select_related('region').all()
        ]

    def validate(self, attrs):
        instance = self.instance

        status = attrs.get('status', getattr(instance, 'status', None))
        error_message = attrs.get('error_message', getattr(instance, 'error_message', ''))

        if status == ImportBatch.Status.PROCESSING and error_message:
            raise serializers.ValidationError({
                'error_message': 'Processing batch cannot have error_message.'
            })

        if status == ImportBatch.Status.COMPLETED and error_message:
            raise serializers.ValidationError({
                'error_message': 'Completed batch should not have error_message.'
            })

        if status == ImportBatch.Status.FAILED and not error_message:
            raise serializers.ValidationError({
                'error_message': 'Failed batch should include error_message.'
            })

        return attrs


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
            'id',
            'region',
            'region_name',
            'batch',
            'batch_filename',
            'batch_created_at',
            'students_count',
            'status',
            'status_display',
            'message',
            'created_at',
            'viewed_at',
            'processed_at',
        ]
        read_only_fields = ['id', 'created_at']

    def validate(self, attrs):
        instance = self.instance

        status = attrs.get('status', getattr(instance, 'status', None))
        viewed_at = attrs.get('viewed_at', getattr(instance, 'viewed_at', None))
        processed_at = attrs.get('processed_at', getattr(instance, 'processed_at', None))

        if status == RegionInbox.Status.PENDING:
            if viewed_at is not None or processed_at is not None:
                raise serializers.ValidationError(
                    'Pending inbox item cannot have viewed_at or processed_at.'
                )

        if status == RegionInbox.Status.VIEWED:
            if viewed_at is None:
                raise serializers.ValidationError({
                    'viewed_at': 'Viewed inbox item must have viewed_at.'
                })

        if status == RegionInbox.Status.PROCESSED:
            if processed_at is None:
                raise serializers.ValidationError({
                    'processed_at': 'Processed inbox item must have processed_at.'
                })

        return attrs