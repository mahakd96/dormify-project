"""
DORMIFY - Serializers
Convert database objects to JSON and vice versa
"""

from django.contrib.auth import authenticate, get_user_model
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from .models import (
    User, Region, Office, StaffProfile, DormType, Building, Apartment, Room, Bed,
    Student, BedAssignment, MovementRequest, Transfer, StudentRequest,
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



# Fields that may only be changed through the availability ("what-if")
# workflow (/api/what-if/availability/simulate/ + /confirm/), which shows an
# impact warning and preserves existing occupants instead of silently
# flipping is_active as a side effect of an ordinary inventory edit.
_INVENTORY_AVAILABILITY_ONLY_FIELDS = {'is_active'}


def _availability_only_field_conflict(instance, data):
    """
    Returns a flat {field, code, message} dict if `data` tries to change
    is_active directly, or None if the change is safe. Deliberately
    returned rather than raised: raising serializers.ValidationError from
    inside a serializer's .validate() gets rewrapped by DRF into the
    standard {field: [errors]} shape (via as_serializer_error), which does
    not match the flat structured-error contract these inventory endpoints
    are required to return. Callers (the ViewSets) check this before
    invoking the serializer at all.
    """
    if instance is None:
        return None
    for field_name in _INVENTORY_AVAILABILITY_ONLY_FIELDS:
        if field_name in data and data[field_name] != getattr(instance, field_name):
            return {
                'field': field_name,
                'code': 'USE_AVAILABILITY_WORKFLOW',
                'message': (
                    'שינוי סטטוס פעיל/לא פעיל מתבצע רק דרך תהליך "שינוי זמינות" '
                    '(/api/what-if/availability/), הכולל אזהרת השפעה על דיירים קיימים.'
                ),
            }
    return None


def check_building_write_conflict(instance, data):
    """Flat structured-error check for Building create/update. See
    _availability_only_field_conflict for why this returns instead of
    raising."""
    conflict = _availability_only_field_conflict(instance, data)
    if conflict:
        return conflict

    new_dorm_type_id = data.get('dorm_type', getattr(instance, 'dorm_type_id', None))
    new_number = data.get('number', getattr(instance, 'number', None))
    if new_dorm_type_id is not None and new_number is not None:
        duplicate_qs = Building.objects.filter(dorm_type_id=new_dorm_type_id, number=new_number)
        if instance is not None:
            duplicate_qs = duplicate_qs.exclude(pk=instance.pk)
        if duplicate_qs.exists():
            return {
                'field': 'number',
                'code': 'DUPLICATE_BUILDING_NUMBER',
                'message': 'כבר קיים בניין עם מספר זה עבור סוג המעונות הנבחר.',
            }

    if instance is not None:
        new_restriction = data.get('gender_restriction', instance.gender_restriction)
        if new_restriction != instance.gender_restriction and new_restriction:
            conflicting = BedAssignment.objects.filter(
                bed__room__apartment__building=instance,
                status=BedAssignment.Status.ACTIVE,
            ).exclude(student__gender=new_restriction).exists()
            if conflicting:
                return {
                    'field': 'gender_restriction',
                    'code': 'ACTIVE_OCCUPANT_CONFLICT',
                    'message': (
                        'לא ניתן להגביל את הבניין למגדר זה — קיימים דיירים פעילים '
                        'שאינם תואמים להגבלה החדשה.'
                    ),
                }

    return None


def check_apartment_write_conflict(instance, data):
    """Flat structured-error check for Apartment create/update."""
    conflict = _availability_only_field_conflict(instance, data)
    if conflict:
        return conflict

    if instance is None:
        return None

    active_assignments = list(
        BedAssignment.objects.filter(
            bed__room__apartment=instance, status=BedAssignment.Status.ACTIVE,
        ).select_related('student')
    )

    new_category = data.get('category', instance.category)
    new_apartment_type = data.get('apartment_type', instance.apartment_type)
    category_or_type_changed = (
        new_category != instance.category or new_apartment_type != instance.apartment_type
    )

    if active_assignments and category_or_type_changed:
        from allocation.solver import _housing_matches_apartment
        from copy import copy

        hypothetical = copy(instance)
        hypothetical.category = new_category
        hypothetical.apartment_type = new_apartment_type

        conflicting = [
            assignment for assignment in active_assignments
            if not _housing_matches_apartment(assignment.student, hypothetical)
        ]
        if conflicting:
            changed_field = 'category' if new_category != instance.category else 'apartment_type'
            return {
                'field': changed_field,
                'code': 'ACTIVE_OCCUPANT_CONFLICT',
                'message': (
                    f'לא ניתן לשנות את סיווג הדירה — {len(conflicting)} דיירים פעילים '
                    'אינם תואמים לקטגוריה/סוג הדיור החדשים. יש לפנות את הדירה תחילה.'
                ),
            }

    new_capacity = data.get('apartment_capacity', instance.apartment_capacity)
    occupant_count = len(active_assignments)
    if new_capacity is not None and new_capacity < occupant_count:
        return {
            'field': 'apartment_capacity',
            'code': 'CAPACITY_BELOW_OCCUPANCY',
            'message': (
                f'לא ניתן להגדיר קיבולת ({new_capacity}) נמוכה ממספר הדיירים '
                f'הפעילים הנוכחי ({occupant_count}).'
            ),
        }

    return None


def check_room_write_conflict(instance, data):
    """Flat structured-error check for Room create/update."""
    conflict = _availability_only_field_conflict(instance, data)
    if conflict:
        return conflict

    if instance is None:
        return None

    new_capacity = data.get('capacity', instance.capacity)
    occupancy = instance.current_occupancy
    if new_capacity < occupancy:
        return {
            'field': 'capacity',
            'code': 'CAPACITY_BELOW_OCCUPANCY',
            'message': (
                f'לא ניתן להגדיר קיבולת ({new_capacity}) נמוכה ממספר הדיירים '
                f'הפעילים הנוכחי ({occupancy}).'
            ),
        }

    return None


class BuildingSerializer(serializers.ModelSerializer):
    """Serialize building data"""

    dorm_type_name = serializers.CharField(source='dorm_type.name', read_only=True)
    dorm_type_code = serializers.IntegerField(source='dorm_type.code', read_only=True)
    region = serializers.CharField(source='dorm_type.region.id', read_only=True)
    region_name = serializers.CharField(source='dorm_type.region.name', read_only=True)
    gender_restriction_display = serializers.CharField(source='get_gender_restriction_display', read_only=True)
    apartment_count = serializers.SerializerMethodField()
    room_count = serializers.SerializerMethodField()
    bed_count = serializers.SerializerMethodField()
    occupied_beds = serializers.SerializerMethodField()
    free_beds = serializers.SerializerMethodField()

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
            'gender_restriction',
            'gender_restriction_display',
            'apartment_count',
            'room_count',
            'bed_count',
            'occupied_beds',
            'free_beds',
        ]

    # apartment_count/room_count/bed_count/occupied_beds are computed at the
    # queryset level (see views._annotate_building_inventory_counts) as
    # correlated-subquery annotations (_apartment_count/_room_count/
    # _bed_count/_occupied_beds), so BuildingViewSet.get_queryset() results
    # carry them with zero extra queries per row (performance baseline
    # finding BLD-01). Each getter here reads that annotation when present
    # (fast path) and falls back to the original per-object query only when
    # it isn't - e.g. a freshly created Building from
    # BuildingViewSet.create(), which serializes a plain unannotated
    # instance returned by serializer.save() rather than one fetched via
    # get_queryset(). The fallback query is byte-for-byte the original
    # get_*_count implementation, so behavior/values are identical either
    # way - only the query count differs.
    def get_apartment_count(self, obj):
        value = getattr(obj, '_apartment_count', None)
        if value is not None:
            return value
        return obj.apartments.filter(is_active=True).count()

    def get_room_count(self, obj):
        value = getattr(obj, '_room_count', None)
        if value is not None:
            return value
        return Room.objects.filter(apartment__building=obj, is_active=True, apartment__is_active=True).count()

    def get_bed_count(self, obj):
        value = getattr(obj, '_bed_count', None)
        if value is not None:
            return value
        return Bed.objects.filter(room__apartment__building=obj, room__is_active=True, room__apartment__is_active=True).count()

    def get_occupied_beds(self, obj):
        value = getattr(obj, '_occupied_beds', None)
        if value is not None:
            return value
        return BedAssignment.objects.filter(
            bed__room__apartment__building=obj, status=BedAssignment.Status.ACTIVE,
        ).values('bed_id').distinct().count()

    def get_free_beds(self, obj):
        return max(self.get_bed_count(obj) - self.get_occupied_beds(obj), 0)


class ApartmentSerializer(serializers.ModelSerializer):
    """Serialize apartment data"""

    building_number = serializers.IntegerField(source='building.number', read_only=True)
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    apartment_type_display = serializers.CharField(source='get_apartment_type_display', read_only=True)
    inactive_reason_display = serializers.CharField(source='get_inactive_reason_display', read_only=True)
    region = serializers.CharField(source='region.id', read_only=True)
    region_name = serializers.CharField(source='region.name', read_only=True)
    dorm_type = serializers.CharField(source='dorm_type.name', read_only=True)
    actual_room_count = serializers.SerializerMethodField()
    bed_count = serializers.SerializerMethodField()
    occupied_beds = serializers.SerializerMethodField()
    free_beds = serializers.SerializerMethodField()

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
            'actual_room_count',
            'apartment_capacity',
            'bed_count',
            'occupied_beds',
            'free_beds',
            'is_active',
            'inactive_reason',
            'inactive_reason_display',
            'region',
            'region_name',
            'dorm_type',
        ]

    # actual_room_count/bed_count/occupied_beds are computed at the
    # queryset level (see views._annotate_apartment_inventory_counts) as
    # correlated-subquery annotations (_actual_room_count/_bed_count/
    # _occupied_beds), so ApartmentViewSet.get_queryset() results carry
    # them with zero extra queries per row (performance baseline finding
    # BLD-02). Each getter here reads that annotation when present (fast
    # path) and falls back to the original per-object query only when it
    # isn't - e.g. a freshly created Apartment from
    # ApartmentViewSet.create(), which serializes a plain unannotated
    # instance returned by serializer.save() rather than one fetched via
    # get_queryset(). The fallback query is byte-for-byte the original
    # get_*_count implementation, so behavior/values are identical either
    # way - only the query count differs.
    def get_actual_room_count(self, obj):
        value = getattr(obj, '_actual_room_count', None)
        if value is not None:
            return value
        return obj.rooms.filter(is_active=True).count()

    def get_bed_count(self, obj):
        value = getattr(obj, '_bed_count', None)
        if value is not None:
            return value
        return Bed.objects.filter(room__apartment=obj, room__is_active=True).count()

    def get_occupied_beds(self, obj):
        value = getattr(obj, '_occupied_beds', None)
        if value is not None:
            return value
        return BedAssignment.objects.filter(
            bed__room__apartment=obj, status=BedAssignment.Status.ACTIVE,
        ).values('bed_id').distinct().count()

    def get_free_beds(self, obj):
        return max(self.get_bed_count(obj) - self.get_occupied_beds(obj), 0)


class RoomSerializer(serializers.ModelSerializer):
    """Serialize room data"""

    apartment_number = serializers.CharField(source='apartment.number', read_only=True)
    building_number = serializers.IntegerField(source='building.number', read_only=True)
    region = serializers.CharField(source='region.id', read_only=True)
    region_name = serializers.CharField(source='region.name', read_only=True)
    number = serializers.CharField(read_only=True)
    current_occupancy = serializers.SerializerMethodField()
    available_beds = serializers.SerializerMethodField()
    is_full = serializers.SerializerMethodField()
    bed_count = serializers.SerializerMethodField()
    has_missing_bed_records = serializers.SerializerMethodField()

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
            'bed_count',
            'current_occupancy',
            'available_beds',
            'is_full',
            'is_active',
            'has_missing_bed_records',
        ]

    # current_occupancy/available_beds/is_full/bed_count/
    # has_missing_bed_records are computed at the queryset level (see
    # views._annotate_room_inventory_counts) as correlated-subquery /
    # Case-expression annotations (_current_occupancy/_available_beds/
    # _is_full/_bed_count/_has_missing_bed_records), so
    # RoomViewSet.get_queryset() results carry them with zero extra
    # queries per row (performance baseline finding BLD-03). Each getter
    # here reads that annotation when present (fast path) and falls back
    # to the original Room model property / query only when it isn't -
    # e.g. a freshly created Room from RoomViewSet.create(), which
    # serializes a plain unannotated instance returned by
    # serializer.save() rather than one fetched via get_queryset(). The
    # fallback path is byte-for-byte the original property/query, so
    # behavior/values are identical either way - only the query count
    # differs. `getattr(..., None) is not None` correctly distinguishes a
    # legitimately-annotated `0`/`False` from "annotation absent", since
    # every annotation is wrapped in Coalesce(...) or a Case with an
    # explicit default - it is never actually NULL when present.
    def get_current_occupancy(self, obj):
        value = getattr(obj, '_current_occupancy', None)
        if value is not None:
            return value
        return obj.current_occupancy

    def get_available_beds(self, obj):
        value = getattr(obj, '_available_beds', None)
        if value is not None:
            return value
        return obj.available_beds

    def get_is_full(self, obj):
        value = getattr(obj, '_is_full', None)
        if value is not None:
            return value
        return obj.is_full

    def get_bed_count(self, obj):
        value = getattr(obj, '_bed_count', None)
        if value is not None:
            return value
        return obj.beds.count()

    def get_has_missing_bed_records(self, obj):
        # Bed rows are only materialized by the admin-only
        # `manage.py materialize_beds` command, never automatically on
        # capacity edits (see ensure_room_beds in views.py) — surfaced here
        # so staff can see the gap instead of it looking like a silent bug.
        value = getattr(obj, '_has_missing_bed_records', None)
        if value is not None:
            return value
        return obj.beds.count() < obj.capacity


class BedSerializer(serializers.ModelSerializer):
    """Serialize bed data.

    Beds are only editable at the label level: individual creation/deletion
    and activation/deactivation are not supported by the current schema —
    Bed rows are derived from Room.capacity and materialized exclusively by
    the admin-only `manage.py materialize_beds` command.
    """

    room_name = serializers.CharField(source='room.name', read_only=True)
    apartment_number = serializers.CharField(source='room.apartment.number', read_only=True)
    building_number = serializers.IntegerField(source='room.apartment.building.number', read_only=True)
    is_occupied = serializers.SerializerMethodField()

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
        read_only_fields = ['room']

    # is_occupied is computed at the queryset level (see
    # views._annotate_bed_occupancy) as an Exists(...) annotation
    # (_is_occupied), so BedViewSet.get_queryset() results carry it with
    # zero extra queries per row (performance baseline finding BLD-04).
    # Reads that annotation when present (fast path) and falls back to
    # the original Bed.is_occupied model property only when it isn't -
    # there is no bed-creation endpoint (BedViewSet only supports
    # get/patch/head/options), so the only realistic unannotated case is
    # a Bed instance constructed/fetched some other way; the fallback
    # keeps that path correct regardless. `is not None` correctly
    # distinguishes a legitimately-annotated `False` from "annotation
    # absent", since Exists(...) is a real boolean and never NULL.
    def get_is_occupied(self, obj):
        value = getattr(obj, '_is_occupied', None)
        if value is not None:
            return value
        return obj.is_occupied


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

    current_building = serializers.SerializerMethodField()
    current_apartment = serializers.SerializerMethodField()
    current_room = serializers.SerializerMethodField()
    current_bed = serializers.SerializerMethodField()

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
            'current_building',
            'current_apartment',
            'current_room',
            'current_bed',
        ]

    def get_current_building(self, obj):
        return obj.assigned_room.apartment.building.number if obj.assigned_room else None

    def get_current_apartment(self, obj):
        return obj.assigned_room.apartment.number if obj.assigned_room else None

    def get_current_room(self, obj):
        return obj.assigned_room.name if obj.assigned_room else None

    def get_current_bed(self, obj):
        # Uses the queryset's prefetched 'prefetched_active_assignments'
        # (one extra query total for the whole page) rather than
        # obj.current_bed, whose default property issues a fresh
        # BedAssignment query per student - the list page's N+1 source.
        # Falls back to the property only if a caller passes an object that
        # wasn't built through StudentViewSet's list queryset.
        assignments = getattr(obj, 'prefetched_active_assignments', None)
        if assignments is not None:
            return assignments[0].bed.label if assignments else None
        bed = obj.current_bed
        return bed.label if bed else None

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
    # The student's own (home) region - lets the assign/reassign UI default
    # the region selector without a second round trip through dorm_types.
    region_id = serializers.CharField(source='accepted_dorm_type.region_id', read_only=True, default=None)
    region_name = serializers.CharField(source='accepted_dorm_type.region.name', read_only=True, default=None)

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
            'region_id',
            'region_name',
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
            'accessibility_flag',
            'disability_percent',
            'medical_reason',
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

    def _current_bed_cached(self, obj):
        # Student.current_bed is an uncached @property that runs a fresh
        # BedAssignment query on every access - get_current_bed_id and
        # get_current_bed_label both used to call it independently,
        # issuing the identical query twice per detail/create/update
        # response. Cache the result on the instance for the lifetime of
        # this serialization instead (DRF calls both methods on the same
        # obj), so it runs once. Same underlying query/semantics, just
        # not repeated. (G1-15.)
        if not hasattr(obj, '_cached_current_bed'):
            obj._cached_current_bed = obj.current_bed
        return obj._cached_current_bed

    def get_current_bed_id(self, obj):
        bed = self._current_bed_cached(obj)
        return bed.id if bed else None

    def get_current_bed_label(self, obj):
        bed = self._current_bed_cached(obj)
        return bed.label if bed else None

    def validate(self, attrs):
        """
        housing_type/accepted_dorm_type are only required for students who
        are actually eligible for a dorm assignment (every category except
        LEAVING - leaving students are exempt). This
        runs on both create and update (PATCH), reading whichever of
        housing_type/category/accepted_dorm_type is present in this request
        and falling back to the existing instance value for a partial update.
        """
        instance = self.instance

        def effective(field, default=None):
            if field in attrs:
                return attrs[field]
            if instance is not None:
                return getattr(instance, field)
            return default

        category = effective('category', Student.StudentCategory.NEW)
        is_eligible = category != Student.StudentCategory.LEAVING

        if is_eligible:
            housing_type = effective('housing_type', '')
            if not housing_type:
                raise serializers.ValidationError({
                    'housing_type': ['יש לבחור סוג דיור לפני שניתן לבצע שיבוץ.']
                })

            accepted_dorm_type = effective('accepted_dorm_type', None)
            if not accepted_dorm_type:
                raise serializers.ValidationError({
                    'accepted_dorm_type': ['יש לבחור אזור/סוג מעונות לפני שניתן לבצע שיבוץ.']
                })

        return attrs


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
# STUDENT REQUEST SERIALIZER
# ===========================================
class StudentRequestSerializer(serializers.ModelSerializer):
    """
    Serialize the unified "Requests" workflow (add student, remove student,
    room change, apartment change, other). Backs the /api/requests/ endpoints
    used by the Requests (Transfers) page and the Students page.
    """

    request_type_display = serializers.CharField(source='get_request_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)

    student_name = serializers.SerializerMethodField()
    student_id_number = serializers.CharField(source='student.student_id', read_only=True, default=None)
    student_phone = serializers.CharField(source='student.phone', read_only=True, default=None)

    requested_by_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()

    target_room_name = serializers.CharField(source='target_room.name', read_only=True, default=None)
    target_building_number = serializers.IntegerField(
        source='target_room.apartment.building.number', read_only=True, default=None
    )
    target_apartment_number = serializers.CharField(
        source='target_room.apartment.number', read_only=True, default=None
    )

    swap_with_student_name = serializers.CharField(source='swap_with_student.full_name', read_only=True, default=None)
    swap_with_student_id_number = serializers.CharField(
        source='swap_with_student.student_id', read_only=True, default=None
    )
    target_region_name = serializers.CharField(source='target_region.name', read_only=True, default=None)

    # Transfer scope (same-region / cross-region). The scope and destination
    # regions are writable at creation (validated against the caller's
    # role); source region, assignment snapshot, and the final assignment
    # are computed and persisted server-side only.
    transfer_scope_display = serializers.CharField(
        source='get_transfer_scope_display', read_only=True, default=None
    )
    source_region_name = serializers.CharField(source='source_region.name', read_only=True, default=None)
    destination_regions = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Region.objects.all(), required=False,
    )
    destination_region_names = serializers.SerializerMethodField()
    final_bed_label = serializers.CharField(source='final_assignment.bed.label', read_only=True, default=None)

    current_region = serializers.SerializerMethodField()
    current_building = serializers.SerializerMethodField()
    current_apartment = serializers.SerializerMethodField()
    current_room = serializers.SerializerMethodField()
    current_bed = serializers.SerializerMethodField()
    placement_history = serializers.SerializerMethodField()

    class Meta:
        model = StudentRequest
        fields = [
            'id', 'request_number',
            'request_type', 'request_type_display',
            'reason', 'status', 'status_display',
            'priority', 'priority_display',
            'other_description', 'same_apartment',
            'removal_notes', 'removal_reason',
            'student', 'student_name', 'student_id_number', 'student_phone', 'student_data',
            'target_room', 'target_room_name', 'target_building_number', 'target_apartment_number',
            'swap_with_student', 'swap_with_student_name', 'swap_with_student_id_number',
            'target_region', 'target_region_name',
            'transfer_scope', 'transfer_scope_display',
            'source_region', 'source_region_name',
            'destination_regions', 'destination_region_names',
            'current_assignment_snapshot', 'final_assignment', 'final_bed_label',
            'current_region', 'current_building', 'current_apartment', 'current_room', 'current_bed',
            'placement_history',
            'requested_by', 'requested_by_name',
            'reviewed_by', 'reviewed_by_name', 'reviewed_at', 'rejection_reason',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'request_number', 'status',
            'source_region', 'current_assignment_snapshot', 'final_assignment',
            'requested_by', 'reviewed_by', 'reviewed_at', 'rejection_reason',
            'created_at', 'updated_at',
        ]

    def get_destination_region_names(self, obj):
        return [r.name for r in obj.destination_regions.all()]

    def get_student_name(self, obj):
        if obj.student:
            return obj.student.full_name
        data = obj.student_data or {}
        name = f"{data.get('first_name', '')} {data.get('last_name', '')}".strip()
        return name or None

    def get_requested_by_name(self, obj):
        if not obj.requested_by:
            return None
        return obj.requested_by.get_full_name() or obj.requested_by.email

    def get_reviewed_by_name(self, obj):
        if not obj.reviewed_by:
            return None
        return obj.reviewed_by.get_full_name() or obj.reviewed_by.email

    def _current_room(self, obj):
        if not obj.student_id:
            return None
        return obj.student.assigned_room

    def get_current_region(self, obj):
        room = self._current_room(obj)
        if not room:
            return None
        region = room.region
        return region.name if region else None

    def get_current_building(self, obj):
        room = self._current_room(obj)
        return room.apartment.building.number if room else None

    def get_current_apartment(self, obj):
        room = self._current_room(obj)
        return room.apartment.number if room else None

    def get_current_room(self, obj):
        room = self._current_room(obj)
        return room.name if room else None

    def get_current_bed(self, obj):
        if not obj.student_id:
            return None
        # get_queryset() prefetches at most the one ACTIVE BedAssignment per
        # student as student.prefetched_current_assignment_list (a
        # unique_active_assignment_per_student DB constraint guarantees
        # there is never more than one) - read that first, with zero extra
        # queries. Falls back to the original property (which issues its
        # own query) when the object wasn't built through get_queryset()
        # (e.g. a freshly-created StudentRequest serialized straight from
        # perform_create()), or when the cache was deliberately invalidated
        # after a mutation (see StudentRequestViewSet.approve()).
        prefetched = getattr(obj.student, 'prefetched_current_assignment_list', None)
        if prefetched is not None:
            bed = prefetched[0].bed if prefetched else None
        else:
            bed = obj.student.current_bed
        return bed.label if bed else None

    def get_placement_history(self, obj):
        if not obj.student_id:
            return []
        history = []
        # Same annotation-first-with-fallback pattern as get_current_bed:
        # student.prefetched_placement_history_all holds this student's 10
        # most-recent bed_assignments (any status, DB-bounded via
        # _top10_bed_assignment_history_qs() - see
        # project-quality/performance/GROUP1_PLACEMENT_HISTORY_VERIFICATION.md),
        # already ordered '-assigned_at' and select_related, fetched once
        # regardless of how many StudentRequest rows are on this page. The
        # [:10] slice below is now a defensive no-op (the DB query already
        # returns at most 10) kept for safety and to match the fallback
        # path exactly.
        prefetched = getattr(obj.student, 'prefetched_placement_history_all', None)
        if prefetched is not None:
            assignments = prefetched[:10]
        else:
            assignments = obj.student.bed_assignments.select_related(
                'bed__room__apartment__building',
                'bed__room__apartment__building__dorm_type__region',
            ).order_by('-assigned_at')[:10]
        for a in assignments:
            room = a.bed.room
            history.append({
                'region': room.region.name if room.region else None,
                'building': room.apartment.building.number,
                'apartment': room.apartment.number,
                'room': room.name,
                'status': a.status,
                'assigned_at': a.assigned_at,
                'ended_at': a.ended_at,
            })
        return history

    def validate(self, attrs):
        request_type = attrs.get(
            'request_type', getattr(self.instance, 'request_type', None)
        )
        student = attrs.get('student', getattr(self.instance, 'student', None))
        student_data = attrs.get(
            'student_data', getattr(self.instance, 'student_data', None)
        ) or {}

        needs_existing_student = {
            StudentRequest.RequestType.ROOM,
            StudentRequest.RequestType.APARTMENT,
            StudentRequest.RequestType.REMOVE_STUDENT,
            StudentRequest.RequestType.SWAP,
            StudentRequest.RequestType.REGION_TRANSFER,
        }

        if request_type in needs_existing_student and not student:
            raise serializers.ValidationError({
                'student': 'This request type requires selecting an existing student.'
            })

        if request_type == StudentRequest.RequestType.SWAP:
            swap_with = attrs.get('swap_with_student', getattr(self.instance, 'swap_with_student', None))
            if not swap_with:
                raise serializers.ValidationError({
                    'swap_with_student': 'A swap request requires selecting the other student.'
                })
            if student and swap_with.id == student.id:
                raise serializers.ValidationError({
                    'swap_with_student': 'A student cannot swap with themselves.'
                })

        if request_type == StudentRequest.RequestType.REGION_TRANSFER:
            target_region = attrs.get('target_region', getattr(self.instance, 'target_region', None))
            if not target_region:
                raise serializers.ValidationError({
                    'target_region': 'A region transfer request requires a destination region.'
                })

        if request_type == StudentRequest.RequestType.ADD_STUDENT and not self.instance:
            required = ['student_id', 'first_name', 'last_name', 'gender']
            missing = [f for f in required if not student_data.get(f)]
            if missing:
                raise serializers.ValidationError({
                    'student_data': f"Missing required new-student fields: {', '.join(missing)}"
                })

        # Transfer-scope role rules are enforced HERE (server-side), never by
        # trusting the frontend: only a central admin may create a
        # cross-region transfer or name destination regions, and a
        # cross-region transfer must name at least one destination region.
        if request_type in (StudentRequest.RequestType.ROOM, StudentRequest.RequestType.APARTMENT):
            request = self.context.get('request')
            user = getattr(request, 'user', None)
            scope = attrs.get('transfer_scope')
            destinations = attrs.get('destination_regions') or []
            wants_cross = scope == StudentRequest.TransferScope.CROSS_REGION
            if user is not None and not user.is_central_admin and (wants_cross or destinations):
                raise PermissionDenied('אין לך הרשאה לבצע מעבר לאזור אחר.')
            if wants_cross and not destinations:
                raise serializers.ValidationError(
                    {'destination_regions': 'יש לבחור לפחות אזור יעד אחד עבור מעבר לאזור אחר.'}
                )
            if not wants_cross:
                # Same-region (or legacy unscoped) transfers never carry
                # destination regions.
                attrs['destination_regions'] = []

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