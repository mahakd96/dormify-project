from decimal import Decimal, InvalidOperation
import os
import re
import threading
from collections import defaultdict
import traceback
import pandas as pd

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import api_view, permission_classes, action, throttle_classes
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.pagination import PageNumberPagination
from rest_framework_simplejwt.tokens import RefreshToken, AccessToken
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.exceptions import PermissionDenied as DRFPermissionDenied

from django.conf import settings as django_settings

from .throttling import (
    LoginRateThrottle, SensitiveAccountActionRateThrottle,
    TokenRefreshRateThrottle, LogoutRateThrottle,
)

from django.utils import timezone
from django.db import transaction, IntegrityError
from django.http import HttpResponse
from django.db.models import (
    Q, Count, Sum, Prefetch, OuterRef, Subquery, IntegerField, Case, When, Value, F, BooleanField, Exists,
    ProtectedError,
)
from django.db.models.expressions import RawSQL
from django.db.models.functions import Coalesce, Greatest
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import connection

from .models import (
    User, Region, Office, StaffProfile, DormType, Building, Apartment, Room, Bed,
    Student, BedAssignment, MovementRequest, Transfer, StudentRequest,
    AllocationRun, ImportBatch, RegionInbox, AssistedAllocationAudit
)
from .serializers import (
    UserSerializer, LoginSerializer,
    RegionSerializer, DormTypeSerializer, BuildingSerializer, ApartmentSerializer,
    RoomSerializer, BedSerializer, StudentSerializer, StudentListSerializer, TransferSerializer,
    StudentRequestSerializer,
    AllocationRunSerializer, ImportBatchSerializer, RegionInboxSerializer,
    check_building_write_conflict, check_apartment_write_conflict, check_room_write_conflict,
)


class StandardResultsPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100

# =========================
# Auth Views
# =========================

# =========================
# Auth Views
# =========================

def _set_refresh_cookie(response, refresh_token_str):
    """
    G3-14/G3-16/G3-17: the refresh token lives ONLY in an HttpOnly cookie -
    it is never present in a JSON response body, so frontend JS can never
    read or persist it (closing G3-17's localStorage exposure for the
    refresh token specifically). Secure/SameSite/Path/Domain all come from
    dormify.settings (see the JWT_REFRESH_COOKIE_* block there for the
    DEBUG-gated rationale).
    """
    response.set_cookie(
        django_settings.JWT_REFRESH_COOKIE_NAME,
        refresh_token_str,
        max_age=int(api_settings.REFRESH_TOKEN_LIFETIME.total_seconds()),
        httponly=True,
        secure=django_settings.JWT_REFRESH_COOKIE_SECURE,
        samesite=django_settings.JWT_REFRESH_COOKIE_SAMESITE,
        path=django_settings.JWT_REFRESH_COOKIE_PATH,
        domain=django_settings.JWT_REFRESH_COOKIE_DOMAIN,
    )


def _clear_refresh_cookie(response):
    response.delete_cookie(
        django_settings.JWT_REFRESH_COOKIE_NAME,
        path=django_settings.JWT_REFRESH_COOKIE_PATH,
        domain=django_settings.JWT_REFRESH_COOKIE_DOMAIN,
        samesite=django_settings.JWT_REFRESH_COOKIE_SAMESITE,
    )


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([LoginRateThrottle])
def login_view(request):
    serializer = LoginSerializer(data=request.data)

    if serializer.is_valid():
        user = serializer.validated_data['user']
        refresh = RefreshToken.for_user(user)

        response = Response({
            'message': 'התחברות בוצעה בהצלחה',
            'messageEn': 'Login successful',
            'user': UserSerializer(user).data,
            # Access token only - the refresh token goes out as an
            # HttpOnly cookie below, never in the body (G3-17).
            'access': str(refresh.access_token),
        })
        _set_refresh_cookie(response, str(refresh))
        return response

    return Response({
        'error': serializer.errors,
        'errorHe': 'אימייל או סיסמה שגויים'
    }, status=status.HTTP_401_UNAUTHORIZED)


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([TokenRefreshRateThrottle])
def refresh_view(request):
    """
    G3-14/G3-16: reads the refresh token from the HttpOnly cookie (never
    from the request body - frontend JS never has access to the raw
    token), rotates it via SimpleJWT's own TokenRefreshSerializer (which
    respects ROTATE_REFRESH_TOKENS/BLACKLIST_AFTER_ROTATION - the old
    refresh token is blacklisted the moment a new one is issued), and
    returns a fresh short-lived access token. Also returns the caller's
    profile so the frontend can restore a full session (access token +
    user) from this single call on page reload, without a second request
    to /api/auth/me/.
    """
    raw_refresh = request.COOKIES.get(django_settings.JWT_REFRESH_COOKIE_NAME)
    if not raw_refresh:
        return Response({'error': 'לא נמצא טוקן רענון'}, status=status.HTTP_401_UNAUTHORIZED)

    serializer = TokenRefreshSerializer(data={'refresh': raw_refresh})
    try:
        serializer.is_valid(raise_exception=True)
    except (TokenError, DRFValidationError):
        response = Response({'error': 'טוקן רענון לא תקין או פג תוקף'}, status=status.HTTP_401_UNAUTHORIZED)
        _clear_refresh_cookie(response)
        return response

    data = serializer.validated_data
    new_access = data['access']

    try:
        user_id = AccessToken(new_access)['user_id']
        user = User.objects.get(pk=user_id)
        user_data = UserSerializer(user).data
    except (TokenError, User.DoesNotExist):
        user_data = None

    response = Response({'access': new_access, 'user': user_data})

    new_refresh = data.get('refresh')
    if new_refresh:
        _set_refresh_cookie(response, new_refresh)

    return response


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([LogoutRateThrottle])
def logout_view(request):
    """
    G3-14: actually revokes the refresh token server-side (blacklists it,
    now that rest_framework_simplejwt.token_blacklist is installed) instead
    of only clearing client-side storage. Deliberately AllowAny rather than
    IsAuthenticated: the whole point is to be able to kill a long-lived
    refresh cookie even if the short-lived access token has already
    expired - requiring a currently-valid access token to log out would
    leave exactly that case unable to revoke anything. A missing/already-
    invalid refresh cookie still returns success; logout is idempotent.
    """
    raw_refresh = request.COOKIES.get(django_settings.JWT_REFRESH_COOKIE_NAME)
    if raw_refresh:
        try:
            RefreshToken(raw_refresh).blacklist()
        except TokenError:
            pass

    response = Response({'success': True, 'message': 'התנתקת בהצלחה'})
    _clear_refresh_cookie(response)
    return response


# G3-01: unrestricted public staff self-registration removed. Dormify is an
# internal staff-management system - the only authorized way to create a
# staff account is the role/region-validated accounts.views.
# StaffUserListCreateView (/api/staff-users/), which enforces business rules
# 2-4 (central admin manages anyone, a regional manager may only create
# employees in their own region, an employee cannot create staff at all).
# No frontend code called /auth/register/ (verified: no "register" reference
# anywhere under src/), so removing it is safe. The route below intentionally
# does not exist any more; see tests in api/security_tests/test_registration.py.


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_view(request):
    return Response({
        'user': UserSerializer(request.user).data
    })

@api_view(['PUT', 'POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([SensitiveAccountActionRateThrottle])
def change_password_view(request):
    user = request.user

    current_password = request.data.get('current_password')
    new_password = request.data.get('new_password')
    confirm_password = request.data.get('confirm_password')

    if not current_password or not new_password or not confirm_password:
        return Response({
            'success': False,
            'error': 'יש למלא את כל השדות'
        }, status=status.HTTP_400_BAD_REQUEST)

    if not user.check_password(current_password):
        return Response({
            'success': False,
            'error': 'הסיסמה הנוכחית אינה נכונה'
        }, status=status.HTTP_400_BAD_REQUEST)

    if new_password != confirm_password:
        return Response({
            'success': False,
            'error': 'הסיסמאות החדשות אינן תואמות'
        }, status=status.HTTP_400_BAD_REQUEST)

    if len(new_password) < 8:
        return Response({
            'success': False,
            'error': 'הסיסמה החדשה חייבת להכיל לפחות 8 תווים'
        }, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(new_password)
    user.save()

    return Response({
        'success': True,
        'message': 'הסיסמה עודכנה בהצלחה'
    }, status=status.HTTP_200_OK)

@api_view(['PUT', 'POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([SensitiveAccountActionRateThrottle])
def change_email_view(request):
    user = request.user

    current_email = request.data.get('current_email')
    new_email = request.data.get('new_email')
    confirm_email = request.data.get('confirm_email')
    # G3-18: email is not a secret - matching it alone (as this endpoint
    # used to require) proves nothing an attacker with a hijacked session
    # doesn't already know. Reuses the exact same check_password() call
    # change_password_view already uses above, so changing account email
    # requires the same proof of identity changing the password does.
    password = request.data.get('password')

    if not current_email or not new_email or not confirm_email or not password:
        return Response({
            'success': False,
            'error': 'יש למלא את כל השדות'
        }, status=status.HTTP_400_BAD_REQUEST)

    if not user.check_password(password):
        return Response({
            'success': False,
            'error': 'הסיסמה שגויה'
        }, status=status.HTTP_400_BAD_REQUEST)

    if not user.email or user.email.lower() != current_email.lower():
        return Response({
            'success': False,
            'error': 'האימייל הנוכחי אינו תואם לחשבון'
        }, status=status.HTTP_400_BAD_REQUEST)

    if new_email.lower() != confirm_email.lower():
        return Response({
            'success': False,
            'error': 'כתובות האימייל אינן תואמות'
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        validate_email(new_email)
    except ValidationError:
        return Response({
            'success': False,
            'error': 'כתובת האימייל החדשה אינה תקינה'
        }, status=status.HTTP_400_BAD_REQUEST)

    if User.objects.filter(email__iexact=new_email).exclude(id=user.id).exists():
        return Response({
            'success': False,
            'error': 'כתובת האימייל כבר קיימת במערכת'
        }, status=status.HTTP_400_BAD_REQUEST)

    user.email = new_email

    # אצלכם לפי הנתונים שראינו קודם, username הוא בדרך כלל האימייל.
    # לכן נעדכן גם אותו כדי שהתחברות עם האימייל החדש תמשיך לעבוד.
    if hasattr(user, 'username'):
        user.username = new_email

    user.save()

    return Response({
        'success': True,
        'message': 'האימייל עודכן בהצלחה',
        'user': UserSerializer(user).data
    }, status=status.HTTP_200_OK)

# =========================
# Permissions / Helpers
# =========================

class IsCentralAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_central_admin


class IsBoss(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_boss


def filter_by_region(queryset, user, region_field='region'):
    if user.is_central_admin:
        return queryset
    if not user.region:
        return queryset.none()
    return queryset.filter(**{region_field: user.region})


def _get_model_field_names(model_cls):
    return {f.name for f in model_cls._meta.fields}


def _resolve_region(region_value):
    if region_value in (None, '', 'null', 'undefined'):
        return None

    try:
        return Region.objects.get(pk=region_value)
    except (Region.DoesNotExist, ValueError, TypeError):
        pass

    try:
        return Region.objects.get(name=region_value)
    except Region.DoesNotExist:
        pass

    try:
        return Region.objects.get(name__iexact=str(region_value).strip())
    except Region.DoesNotExist:
        pass

    return None


def resolve_scoped_region(user, region_value, *, allow_central_all=True):
    """
    Centralized, single-source-of-truth ?region= resolution for every
    region-scoped read endpoint (G3-03/G3-04/G3-08: statistics,
    allocation_summary, allocation_results, assisted_allocation_queue,
    get_active_allocation_run, and the Building/Apartment/Room viewsets'
    get_queryset()). Returns (region, error_response):

    - central_admin: may explicitly select any region via region_value
      (global-administration workflows are intentionally allowed to do
      this); omitting it returns (None, None) meaning "no region filter"
      when allow_central_all=True, or a clean 400 ("a region is required")
      when the caller's endpoint always needs exactly one region.

    - region_boss / employee: NEVER get a foreign region, regardless of
      what ?region= names. If region_value is empty, they're scoped to
      their own user.region. If region_value is supplied and does not
      match their own region, this returns a clean 403 - it deliberately
      does NOT silently substitute their own region for a mismatched
      request, so a caller can never mistake the response for data about
      the region they actually asked for.

    A user with no region assigned (and who isn't central_admin) always
    gets a clean 400, matching the existing behavior at every call site
    this replaces.
    """
    if user.is_central_admin:
        if region_value:
            region = _resolve_region(region_value)
            if not region:
                return None, Response({'error': 'אזור לא נמצא'}, status=status.HTTP_404_NOT_FOUND)
            return region, None
        if allow_central_all:
            return None, None
        return None, Response({'error': 'נדרש לבחור אזור'}, status=status.HTTP_400_BAD_REQUEST)

    if not user.region_id:
        return None, Response({'error': 'המשתמש אינו משויך לאזור'}, status=status.HTTP_400_BAD_REQUEST)

    if region_value:
        requested = _resolve_region(region_value)
        if not requested or requested.id != user.region_id:
            return None, Response({'error': 'אין הרשאה לאזור זה'}, status=status.HTTP_403_FORBIDDEN)

    return user.region, None


HARD_ALLOCATION_CONSTRAINTS = {
    'sameGender',
    'priorityFirst',
    'roommatePositiveOnly',
    'ReligiousTogether',
}

SOFT_ALLOCATION_CONSTRAINTS = {
    'sameReligion': 6,
    'roommateMatch': 8,
    'sectorMatching': 7,
    'avoidYearMix_1_with_3_4': 4,
    'avoidAtudaimWithHasmaha': 4,
}


def normalize_allocation_constraints(raw_config):
    """
    Normalize the frontend allocation configuration before passing it to
    the solver. Hard constraints are always active and weightless, while
    optimization preferences remain optional and weighted.
    """
    if not isinstance(raw_config, dict):
        raw_config = {}

    normalized = {}

    for key in HARD_ALLOCATION_CONSTRAINTS:
        normalized[key] = {
            'enabled': True,
            'strict': True,
            'critical': True,
            'weight': 0,
        }

    for key, default_weight in SOFT_ALLOCATION_CONSTRAINTS.items():
        raw_value = raw_config.get(key, {})
        if not isinstance(raw_value, dict):
            raw_value = {}

        enabled = bool(raw_value.get('enabled', True))

        try:
            weight = int(raw_value.get('weight', default_weight))
        except (TypeError, ValueError):
            weight = default_weight

        normalized[key] = {
            'enabled': enabled,
            'strict': False,
            'critical': False,
            'weight': max(0, min(weight, 10)),
        }

    return normalized


def ensure_room_beds(room: Room):
    """
    Materialize missing Bed rows for a room from its configured capacity.

    EXPLICIT SETUP ONLY: this writes to the database and therefore must
    never be called from any read/browse path (match-options, feasibility,
    the assignment picker, pagination) nor from the regular assignment flow.
    Its only legitimate caller is the admin-only management command
    `manage.py materialize_beds` (and test fixtures). Read paths report a
    capacity/Bed-row mismatch as a data-integrity problem instead.
    """
    existing = room.beds.count()
    if existing >= room.capacity:
        return

    for i in range(existing + 1, room.capacity + 1):
        Bed.objects.create(room=room, label=f'Bed {i}')


_MISSING_BED_RECORDS_MSG = (
    'בחדר זה קיימת קיבולת פנויה אך חסרות רשומות מיטה במסד הנתונים (בעיית נתונים). '
    'יש להריץ את פעולת האתחול הייעודית (manage.py materialize_beds) לפני שיבוץ.'
)


def get_free_bed(room: Room):
    """
    First actually-free REAL bed in the room, or None when the room is at
    capacity. Never creates Bed rows: a room with free capacity but no free
    real Bed row raises a data-integrity ValueError instead (materializing
    beds is an explicit admin operation, see ensure_room_beds).
    """
    if not room.is_active:
        return None
    if not room.apartment.is_active:
        return None
    if not room.apartment.building.is_active:
        return None

    occupied_bed_ids = set(BedAssignment.objects.filter(
        bed__room=room,
        status=BedAssignment.Status.ACTIVE
    ).values_list('bed_id', flat=True))

    # Capacity is authoritative: even if surplus Bed rows exist, the room
    # never accepts more active residents than its configured capacity.
    if len(occupied_bed_ids) >= room.capacity:
        return None

    free = room.beds.exclude(id__in=occupied_bed_ids).order_by('id').first()
    if free is None:
        raise ValueError(_MISSING_BED_RECORDS_MSG)
    return free


def get_specific_free_bed(room: Room, bed_id):
    """
    Resolve a specific bed the caller selected (e.g. from the per-bed
    matching UI) and verify it is still free right now. Raises ValueError
    (mirrors get_free_bed's None-on-no-capacity contract at the call site)
    if the bed doesn't belong to this room or was taken in the meantime -
    the caller must always re-validate the exact bed server-side rather
    than trusting whatever the client last saw. Never creates Bed rows.
    """
    if not room.is_active or not room.apartment.is_active or not room.apartment.building.is_active:
        raise ValueError('החדר אינו פעיל')

    try:
        bed = room.beds.get(pk=bed_id)
    except Bed.DoesNotExist:
        raise ValueError('המיטה שנבחרה אינה שייכת לחדר זה')

    if BedAssignment.objects.filter(bed=bed, status=BedAssignment.Status.ACTIVE).exists():
        raise ValueError('המיטה שנבחרה כבר תפוסה - נא לבחור מיטה אחרת')

    # The room's configured capacity can never be exceeded, even when more
    # Bed rows than capacity exist (data anomaly).
    active_in_room = BedAssignment.objects.filter(
        bed__room=room, status=BedAssignment.Status.ACTIVE,
    ).count()
    if active_in_room >= room.capacity:
        raise ValueError('החדר בתפוסה מלאה - לא ניתן לחרוג מקיבולת החדר')

    return bed


def end_active_bed_assignments(student: Student):
    BedAssignment.objects.filter(
        student=student,
        status=BedAssignment.Status.ACTIVE
    ).update(
        status=BedAssignment.Status.ENDED,
        ended_at=timezone.now()
    )


def _active_apartment_assignments(apartment, exclude_student_id=None):
    queryset = BedAssignment.objects.filter(
        status=BedAssignment.Status.ACTIVE,
        bed__room__apartment=apartment,
    ).select_related('student')

    if exclude_student_id is not None:
        queryset = queryset.exclude(student_id=exclude_student_id)

    return queryset


def _z_compatibility(housing_type):
    """
    Single source of truth for Z1-Z4 apartment_type/category compatibility,
    shared by validate_apartment_assignment (write-path, authoritative,
    always re-checked live) and the read-path batch matching engine below
    (which must not re-implement this policy table separately).
    """
    return {
        Student.HousingType.SINGLE_MALE: (
            Apartment.ApartmentType.SINGLE,
            Apartment.Category.MALE,
        ),
        Student.HousingType.SINGLE_FEMALE: (
            Apartment.ApartmentType.SINGLE,
            Apartment.Category.FEMALE,
        ),
        Student.HousingType.COUPLE: (
            Apartment.ApartmentType.COUPLE,
            Apartment.Category.MIXED,
        ),
        Student.HousingType.FAMILY: (
            Apartment.ApartmentType.FAMILY,
            Apartment.Category.MIXED,
        ),
    }.get(housing_type)


def validate_apartment_assignment(student: Student, room: Room):
    """
    Validate Z1/Z2/Z3/Z4/Z6 compatibility.

    Z1 -> single apartment + male category
    Z2 -> single apartment + female category
    Z3 -> couple apartment + mixed category
    Z4 -> family apartment + mixed category
    Z6 -> any active couple-layout apartment, independent of gender/category,
          but the complete apartment is reserved exclusively for that student.
    """
    apartment = room.apartment

    if not room.is_active:
        raise ValueError('The selected room is inactive.')

    if not apartment.is_active:
        reason = (
            apartment.get_inactive_reason_display()
            if apartment.inactive_reason
            else 'inactive'
        )
        raise ValueError(f'Apartment is inactive: {reason}')

    if not apartment.building.is_active:
        raise ValueError('The selected building is inactive.')

    other_active_assignments = _active_apartment_assignments(
        apartment,
        exclude_student_id=student.id,
    )

    if student.housing_type == Student.HousingType.SINGLE_IN_APARTMENT:
        if apartment.apartment_type != Apartment.ApartmentType.COUPLE:
            raise ValueError(
                'Z6 requires a couple-layout apartment.'
            )

        if other_active_assignments.exists():
            raise ValueError(
                'Z6 requires exclusive use of the complete apartment.'
            )

        # Z6 apartments are neutral before placement. Their stored male/female/
        # mixed category does not restrict which Z6 student may receive them.
        return

    # Nobody else may enter an apartment already reserved by an active Z6
    # resident, even when another room/bed in that apartment appears empty.
    if other_active_assignments.filter(
        student__housing_type=Student.HousingType.SINGLE_IN_APARTMENT
    ).exists():
        raise ValueError(
            'This apartment is reserved exclusively for a Z6 resident.'
        )

    expected = _z_compatibility(student.housing_type)
    if expected is None:
        raise ValueError(
            'The student has no supported housing type '
            '(expected Z1, Z2, Z3, Z4, or Z6).'
        )

    expected_type, expected_category = expected

    if apartment.apartment_type != expected_type:
        raise ValueError(
            'Housing type mismatch: '
            f'student requires apartment_type={expected_type}, '
            f'but apartment has apartment_type={apartment.apartment_type}.'
        )

    if apartment.category != expected_category:
        raise ValueError(
            'Housing category mismatch: '
            f'student requires category={expected_category}, '
            f'but apartment has category={apartment.category}.'
        )

    # Z3/Z4 exclusivity: a Student record with COUPLE/FAMILY housing type
    # represents one COMPLETE application (the applicant and their
    # partner/family, who are not tracked as separate Student records) —
    # never one member of a shared household. An apartment already holding
    # any other active assignment is unavailable, unconditionally; there is
    # no second Student record that may ever join it.
    if student.housing_type in (
        Student.HousingType.COUPLE,
        Student.HousingType.FAMILY,
    ) and other_active_assignments.exists():
        raise ValueError(
            'This apartment already has an active assignment. Exclusive '
            'couple/family apartments may only be assigned to one Student '
            'record.'
        )


def assign_student_to_room(
    student: Student,
    room: Room,
    assigned_by: User,
    assignment_type=BedAssignment.AssignmentType.MANUAL,
    bed_id=None,
    skip_validation=False,
):
    """
    skip_validation: staff-authorized manual override only (Assisted
    Allocation "manual override" action). Skips the
    validate_apartment_assignment(...) compatibility check below - every
    other safety step (apartment lock, bed re-verification under lock,
    full_clean uniqueness constraints, denormalized assigned_room update)
    still runs unchanged, so an override can never double-book a bed or
    exceed room capacity. Callers passing True must have already computed
    and confirmed the violated rules with
    allocation.manual_placement.evaluate_manual_override.
    """
    # Lock the apartment while validating and assigning so two concurrent
    # requests cannot violate Z6 apartment exclusivity.
    with transaction.atomic():
        locked_apartment = Apartment.objects.select_for_update().get(
            pk=room.apartment_id
        )
        locked_room = Room.objects.select_related(
            'apartment',
            'apartment__building',
        ).get(pk=room.pk)
        locked_room.apartment = locked_apartment

        if not skip_validation:
            validate_apartment_assignment(student, locked_room)

        # A caller may target a specific bed (e.g. the per-bed matching UI) -
        # it is always re-verified free here, under the apartment lock,
        # regardless of what the client last saw. Without an explicit
        # bed_id, fall back to "any free bed in the room".
        if bed_id is not None:
            free_bed = get_specific_free_bed(locked_room, bed_id)
        else:
            free_bed = get_free_bed(locked_room)
        if not free_bed:
            raise ValueError('No available bed in selected room.')

        end_active_bed_assignments(student)

        assignment = BedAssignment(
            student=student,
            bed=free_bed,
            status=BedAssignment.Status.ACTIVE,
            assignment_type=assignment_type,
            assigned_by=assigned_by
        )
        assignment.full_clean()
        assignment.save()

        student.assigned_room = locked_room
        student_fields = _get_model_field_names(Student)
        update_fields = ['assigned_room']
        if 'updated_at' in student_fields:
            update_fields.append('updated_at')
        student.save(update_fields=update_fields)

    return assignment

def infer_movement_type(from_room: Room, to_room: Room):
    if not from_room or not to_room:
        return MovementRequest.MovementType.INTERNAL

    from_region = (
        from_room.apartment.building.dorm_type.region
        if from_room and from_room.apartment and from_room.apartment.building
        else None
    )
    to_region = (
        to_room.apartment.building.dorm_type.region
        if to_room and to_room.apartment and to_room.apartment.building
        else None
    )

    if from_region and to_region and from_region != to_region:
        return MovementRequest.MovementType.REGION_CHANGE

    from_dorm_type = (
        from_room.apartment.building.dorm_type_id
        if from_room and from_room.apartment and from_room.apartment.building
        else None
    )
    to_dorm_type = (
        to_room.apartment.building.dorm_type_id
        if to_room and to_room.apartment and to_room.apartment.building
        else None
    )

    if from_dorm_type != to_dorm_type:
        return MovementRequest.MovementType.DORM_TYPE_CHANGE

    return MovementRequest.MovementType.INTERNAL


def user_can_approve_transfer(user: User, transfer: Transfer):
    if user.is_central_admin:
        return True

    if not user.is_boss or not user.region:
        return False

    same_from_region = transfer.from_room.apartment.building.dorm_type.region == user.region
    same_to_region = transfer.to_room.apartment.building.dorm_type.region == user.region

    return same_from_region and same_to_region


# =========================
# ViewSets
# =========================

class RegionViewSet(viewsets.ModelViewSet):
    serializer_class = RegionSerializer
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        # G3-05: Region is a system-level definition, not operational data -
        # any authenticated regional/employee user may still read it
        # (scoped to their own region below), but creating/editing/deleting
        # a region is a central-admin-only action.
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [IsAuthenticated(), IsCentralAdmin()]
        return [IsAuthenticated()]

    def get_queryset(self):
        queryset = Region.objects.all()
        user = self.request.user

        if user.is_central_admin:
            return queryset

        if not user.region_id:
            return queryset.none()

        return queryset.filter(pk=user.region_id)

class DormTypeViewSet(viewsets.ModelViewSet):
    serializer_class = DormTypeSerializer
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        # G3-05: same rule as RegionViewSet above - DormType is a
        # system-level definition, central-admin-only to write.
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [IsAuthenticated(), IsCentralAdmin()]
        return [IsAuthenticated()]

    def get_queryset(self):
        queryset = DormType.objects.select_related('region').all()
        user = self.request.user

        if user.is_central_admin:
            return queryset

        if not user.region_id:
            return queryset.none()

        return queryset.filter(region_id=user.region_id)

def _parse_is_active_filter(request, default='true'):
    """
    Shared 'Active status: all / active / inactive' query-param parsing for
    the inventory viewsets. Returns True, False, or None (meaning: no
    is_active filter, i.e. 'all'). Defaults to True (active-only) so
    existing callers that never pass this param keep their current
    behavior unchanged.
    """
    raw = (request.query_params.get('is_active') or default or '').strip().lower()
    if raw in ('all', ''):
        return None
    if raw in ('true', '1', 'active'):
        return True
    if raw in ('false', '0', 'inactive'):
        return False
    return None


def _region_scoped_inventory_queryset(user, queryset, region_value, region_field):
    """
    Shared read-path region filtering for Building/Apartment/Room
    get_queryset() (G3-04). Mirrors resolve_scoped_region()'s authorization
    semantics but returns a queryset rather than a Response, since
    ModelViewSet.get_queryset() cannot itself return an HTTP response:

    - central_admin: may filter by any region via region_value, or see
      everything with none supplied.
    - region_boss / employee: a ?region= that is not their own always
      yields queryset.none() - never the requested foreign region's data,
      and never their own region silently substituted for a request that
      named someone else's. Since get_object() (used by
      retrieve/update/destroy) is built from this same queryset, a
      mismatched ?region= can never be used to pull a foreign-region
      object into scope for a write either - closing the exact bug where
      supplying the *target's own real region* string used to make
      get_object() succeed regardless of the caller's own region.

    `region_field` is the relation path to Region from this model (e.g.
    'dorm_type__region' for Building) - `f'{region_field}_id'` is valid
    Django ORM syntax for the id shortcut on the terminal FK hop.
    """
    if user.is_central_admin:
        if region_value:
            region = _resolve_region(region_value)
            if not region:
                return queryset.none()
            return queryset.filter(**{region_field: region})
        return queryset

    if not user.region_id:
        return queryset.none()

    if region_value:
        requested = _resolve_region(region_value)
        if not requested or requested.id != user.region_id:
            return queryset.none()

    return queryset.filter(**{f'{region_field}_id': user.region_id})


def _inventory_create_permission_error():
    return Response(
        {'error': 'רק מנהל אזור או מנהל מרכזי יכולים ליצור או לערוך פריטי מלאי'},
        status=status.HTTP_403_FORBIDDEN,
    )


def _annotate_building_inventory_counts(queryset):
    """
    Queryset-level replacement for the per-row queries BuildingSerializer's
    apartment_count/room_count/bed_count/occupied_beds SerializerMethodFields
    used to run once per building (see performance baseline finding BLD-01:
    ~6 extra SQL queries per building row, confirmed in
    project-quality/performance/BUILDINGS_BASELINE_SUMMARY.md).

    Each count is computed as an independent correlated subquery (Subquery +
    OuterRef grouped by the target FK), not a plain Count() annotation on a
    joined relation. This deliberately avoids the classic Django
    multi-Count() JOIN-multiplication trap, where combining several
    Count()/Sum() annotations on different related paths in one annotate()
    call can silently multiply/inflate every count by the size of the other
    joined relations. Each subquery here is independently grouped and
    evaluated per building, so results are mathematically identical to
    running each of the original four queries once per building - just
    computed inside the single list/detail query instead of once per row.

    Filtering semantics are preserved exactly, matching
    BuildingSerializer.get_apartment_count/get_room_count/get_bed_count/
    get_occupied_beds field-for-field:
    - apartment_count: active apartments only.
    - room_count: active rooms AND active parent apartment.
    - bed_count: beds under an active room AND active apartment (Bed itself
      has no is_active field).
    - occupied_beds: distinct beds with an ACTIVE BedAssignment -
      deliberately NOT filtered by room/apartment is_active, exactly like
      the original get_occupied_beds (a bed can still show as "occupied"
      after its room/apartment is deactivated; free_beds already clamps to
      0 for that case in the serializer, same as before).

    Coalesce(..., 0) makes a building with zero matches yield 0 instead of
    NULL, matching the original .count() behavior (which returns 0, never
    None).
    """
    apartment_count_sq = Apartment.objects.filter(
        building=OuterRef('pk'), is_active=True,
    ).order_by().values('building').annotate(c=Count('id')).values('c')

    room_count_sq = Room.objects.filter(
        apartment__building=OuterRef('pk'), is_active=True, apartment__is_active=True,
    ).order_by().values('apartment__building').annotate(c=Count('id')).values('c')

    bed_count_sq = Bed.objects.filter(
        room__apartment__building=OuterRef('pk'), room__is_active=True, room__apartment__is_active=True,
    ).order_by().values('room__apartment__building').annotate(c=Count('id')).values('c')

    occupied_beds_sq = BedAssignment.objects.filter(
        bed__room__apartment__building=OuterRef('pk'), status=BedAssignment.Status.ACTIVE,
    ).order_by().values('bed__room__apartment__building').annotate(c=Count('bed_id', distinct=True)).values('c')

    return queryset.annotate(
        _apartment_count=Coalesce(Subquery(apartment_count_sq, output_field=IntegerField()), 0),
        _room_count=Coalesce(Subquery(room_count_sq, output_field=IntegerField()), 0),
        _bed_count=Coalesce(Subquery(bed_count_sq, output_field=IntegerField()), 0),
        _occupied_beds=Coalesce(Subquery(occupied_beds_sq, output_field=IntegerField()), 0),
    )


class BuildingViewSet(viewsets.ModelViewSet):
    serializer_class = BuildingSerializer
    permission_classes = [IsAuthenticated]
    # No PUT (full-replace semantics don't fit the partial edit-drawer UI)
    # and no DELETE — buildings are never hard-deleted through this API,
    # only deactivated via the availability workflow (see
    # _reject_direct_availability_change / what_if_availability_confirm).
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        queryset = _annotate_building_inventory_counts(
            Building.objects.select_related(
                'dorm_type',
                'dorm_type__region',
            )
        )
        is_active = _parse_is_active_filter(self.request)
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active)

        user = self.request.user
        region_value = self.request.query_params.get('region')
        return _region_scoped_inventory_queryset(user, queryset, region_value, 'dorm_type__region')

    def create(self, request, *args, **kwargs):
        if not request.user.is_boss:
            return _inventory_create_permission_error()

        if not request.user.is_central_admin:
            dorm_type = DormType.objects.filter(
                pk=request.data.get('dorm_type')
            ).select_related('region').first()
            if not dorm_type or dorm_type.region_id != request.user.region_id:
                return Response(
                    {'error': 'ניתן ליצור בניין רק בתוך סוג מעונות באזור המשויך למשתמש'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        conflict = check_building_write_conflict(None, request.data)
        if conflict:
            return Response(conflict, status=status.HTTP_400_BAD_REQUEST)

        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        # Editing a building (e.g. gender_restriction) is a boss-level
        # action; ordinary employees may only view. get_queryset() above
        # already scopes region_boss users to their own region, so a boss
        # editing a building outside their region gets a 404 from
        # get_object() below rather than reaching this check.
        if not request.user.is_boss:
            return Response(
                {'error': 'רק מנהל אזור או מנהל מרכזי יכול לערוך בניין'},
                status=status.HTTP_403_FORBIDDEN,
            )

        instance = self.get_object()

        # G3-04: explicitly re-validate the OBJECT'S REAL region against
        # the caller's own region - never rely solely on get_queryset()
        # (which is itself query-param-influenced) as the authorization
        # check for a write. Belt-and-braces alongside the
        # _region_scoped_inventory_queryset() fix above.
        if not request.user.is_central_admin:
            real_region_id = instance.dorm_type.region_id if instance.dorm_type else None
            if real_region_id != request.user.region_id:
                return Response(
                    {'error': 'אין הרשאה לערוך בניין באזור זה'},
                    status=status.HTTP_403_FORBIDDEN,
                )

            # G3-12: reparenting - a PATCH that changes dorm_type must not
            # move this building into a DormType belonging to another
            # region. Only relevant when 'dorm_type' is actually present in
            # the request body (a normal edit that omits it is unaffected).
            new_dorm_type_id = request.data.get('dorm_type')
            if new_dorm_type_id is not None and str(new_dorm_type_id) != str(instance.dorm_type_id):
                new_dorm_type = DormType.objects.filter(pk=new_dorm_type_id).select_related('region').first()
                if not new_dorm_type or new_dorm_type.region_id != request.user.region_id:
                    return Response(
                        {'error': 'לא ניתן להעביר בניין לסוג מעונות מחוץ לאזור המשויך למשתמש'},
                        status=status.HTTP_403_FORBIDDEN,
                    )

        with transaction.atomic():
            # Lock this building's row AND every apartment in it before
            # re-checking occupancy: a building-level gender_restriction
            # change affects every apartment underneath it, and
            # assign_student_to_room locks the specific apartment it writes
            # to (select_for_update on that Apartment pk) - locking every
            # apartment here means any concurrent assignment into ANY of
            # them blocks until this transaction commits/rolls back, so the
            # "was empty when the recommendation was generated" check below
            # can never go stale between the read and the actual save
            # (e.g. a "שינוי הגדרה" suggestion built while the building was
            # empty, applied moments after another employee filled a bed).
            locked_instance = Building.objects.select_for_update().get(pk=instance.pk)
            # order_by() clears Apartment's default ordering (['building',
            # 'number']) before locking: Django resolves an FK in default
            # ordering through the related model's own Meta.ordering
            # (Building -> ['dorm_type', 'number']), which pulls in a LEFT
            # OUTER JOIN to the nullable DormType FK - Postgres refuses
            # FOR UPDATE on the nullable side of an outer join. .get() (used
            # everywhere else in this file) sidesteps this by stripping
            # ordering internally; a plain .filter() list does not.
            list(Apartment.objects.select_for_update().filter(building=locked_instance).order_by())

            conflict = check_building_write_conflict(locked_instance, request.data)
            if conflict:
                return Response(conflict, status=status.HTTP_400_BAD_REQUEST)

            previous_restriction = locked_instance.gender_restriction
            response = super().update(request, *args, **kwargs)
            if response.status_code == 200:
                locked_instance.refresh_from_db(fields=['gender_restriction'])
                if locked_instance.gender_restriction != previous_restriction:
                    AssistedAllocationAudit.objects.create(
                        action_type=AssistedAllocationAudit.ActionType.CONFIG_CHANGE,
                        actor=request.user,
                        building=locked_instance,
                        previous_state={'gender_restriction': previous_restriction},
                        new_state={'gender_restriction': locked_instance.gender_restriction},
                    )
        return response

    @action(detail=True, methods=['get'])
    def apartments(self, request, pk=None):
        building = self.get_object()
        apartments = building.apartments.filter(is_active=True).select_related('building')

        category = request.query_params.get('category')
        if category:
            apartments = apartments.filter(category=category)

        apartment_type = request.query_params.get('apartment_type')
        if apartment_type:
            apartments = apartments.filter(apartment_type=apartment_type)

        serializer = ApartmentSerializer(apartments, many=True)
        return Response({'apartments': serializer.data})

    @action(detail=True, methods=['get'])
    def rooms(self, request, pk=None):
        building = self.get_object()
        rooms = Room.objects.filter(
            apartment__building=building,
            is_active=True,
            apartment__is_active=True,
            apartment__building__is_active=True,
        ).select_related(
            'apartment',
            'apartment__building',
            'apartment__building__dorm_type',
            'apartment__building__dorm_type__region',
        )

        available_only = request.query_params.get('available', 'false') == 'true'
        if available_only:
            rooms = [room for room in rooms if not room.is_full]

        serializer = RoomSerializer(rooms, many=True)
        return Response({'rooms': serializer.data})

    @action(detail=True, methods=['post'], url_path='bulk-create-inventory')
    def bulk_create_inventory(self, request, pk=None):
        """
        Transactionally create many Apartments - each with its own Rooms and
        materialized Beds - under this Building in a single call. Backend
        counterpart of the Building Setup Wizard's apartment/room
        configuration-group step, so staff never have to create a dozen
        near-identical apartments one at a time.

        Reuses ApartmentSerializer/RoomSerializer for validation exactly
        like the single-object create endpoints above, and the same
        `f'Bed {i}'` materialization convention used everywhere else in the
        codebase (manage.py materialize_beds, allocation.solver
        ._ensure_beds_for_room) - so the result is indistinguishable from
        manually created inventory.

        Expected body:
        {
          "apartment_groups": [
            {
              "category": "female", "apartment_type": "single",
              "apartment_capacity": 3,
              "numbers": ["101", "102", ...],
              "room_groups": [{"capacity": 1, "count": 3}]
            },
            ...
          ]
        }
        Apartment numbers are generated/edited client-side (Apartment.number
        is free-text with no format constraint - see model) and submitted
        explicitly, never guessed server-side.
        """
        if not request.user.is_boss:
            return _inventory_create_permission_error()

        building = self.get_object()

        if not request.user.is_central_admin:
            region_id = building.dorm_type.region_id if building.dorm_type else None
            if region_id != request.user.region_id:
                return Response(
                    {'error': 'ניתן ליצור מלאי רק בבניין באזור המשויך למשתמש'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        groups = request.data.get('apartment_groups')
        if not isinstance(groups, list) or not groups:
            return Response(
                {'error': 'apartment_groups must be a non-empty list.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        all_numbers = []
        for group_index, group in enumerate(groups):
            if not isinstance(group, dict):
                return Response(
                    {'error': f'apartment_groups[{group_index}] must be an object.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            numbers = group.get('numbers')
            if not isinstance(numbers, list) or not numbers:
                return Response(
                    {'error': f'apartment_groups[{group_index}].numbers must be a non-empty list.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            room_groups = group.get('room_groups')
            if not isinstance(room_groups, list) or not room_groups:
                return Response(
                    {'error': f'apartment_groups[{group_index}].room_groups must be a non-empty list.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            for rg_index, room_group in enumerate(room_groups):
                capacity = room_group.get('capacity') if isinstance(room_group, dict) else None
                count = room_group.get('count') if isinstance(room_group, dict) else None
                if not isinstance(capacity, int) or capacity < 1:
                    return Response(
                        {'error': f'apartment_groups[{group_index}].room_groups[{rg_index}].capacity must be a positive integer.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if not isinstance(count, int) or count < 1:
                    return Response(
                        {'error': f'apartment_groups[{group_index}].room_groups[{rg_index}].count must be a positive integer.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            all_numbers.extend(str(n) for n in numbers)

        if len(all_numbers) != len(set(all_numbers)):
            return Response(
                {
                    'error': 'Apartment numbers must be unique within this request.',
                    'code': 'DUPLICATE_APARTMENT_NUMBER',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        existing = set(
            Apartment.objects.filter(
                building=building, number__in=all_numbers
            ).values_list('number', flat=True)
        )
        if existing:
            return Response(
                {
                    'error': 'One or more apartment numbers already exist in this building.',
                    'code': 'DUPLICATE_APARTMENT_NUMBER',
                    'conflicting_numbers': sorted(existing),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        created_apartments = 0
        created_rooms = 0
        created_beds = 0

        try:
            with transaction.atomic():
                for group in groups:
                    room_groups = group['room_groups']
                    total_room_count = sum(rg['count'] for rg in room_groups)

                    for number in group['numbers']:
                        apartment_data = {
                            'building': building.id,
                            'number': str(number),
                            'category': group.get('category'),
                            'apartment_type': group.get('apartment_type'),
                            'room_count': total_room_count,
                            'apartment_capacity': group.get('apartment_capacity'),
                        }
                        conflict = check_apartment_write_conflict(None, apartment_data)
                        if conflict:
                            raise DRFValidationError(conflict)

                        apartment_serializer = ApartmentSerializer(data=apartment_data)
                        apartment_serializer.is_valid(raise_exception=True)
                        apartment = apartment_serializer.save()
                        created_apartments += 1

                        room_sequence = 0
                        for room_group in room_groups:
                            for _ in range(room_group['count']):
                                room_sequence += 1
                                room_data = {
                                    'apartment': apartment.id,
                                    'name': str(room_sequence),
                                    'capacity': room_group['capacity'],
                                }
                                conflict = check_room_write_conflict(None, room_data)
                                if conflict:
                                    raise DRFValidationError(conflict)

                                room_serializer = RoomSerializer(data=room_data)
                                room_serializer.is_valid(raise_exception=True)
                                room = room_serializer.save()
                                created_rooms += 1

                                beds = [
                                    Bed(room=room, label=f'Bed {bed_index}')
                                    for bed_index in range(1, room_group['capacity'] + 1)
                                ]
                                Bed.objects.bulk_create(beds)
                                created_beds += len(beds)
        except DRFValidationError as exc:
            return Response(
                {
                    'error': 'Bulk inventory creation failed; no changes were made.',
                    'detail': exc.detail,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:
            traceback.print_exc()
            return Response(
                {'error': str(exc), 'error_type': exc.__class__.__name__},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({
            'success': True,
            'building_id': building.id,
            'created_apartments': created_apartments,
            'created_rooms': created_rooms,
            'created_beds': created_beds,
        }, status=status.HTTP_201_CREATED)


def _annotate_apartment_inventory_counts(queryset):
    """
    Queryset-level replacement for the per-row queries ApartmentSerializer's
    actual_room_count/bed_count/occupied_beds SerializerMethodFields used to
    run once per apartment (see performance baseline finding BLD-02: ~5
    extra SQL queries per apartment row, confirmed in
    project-quality/performance/APARTMENTS_BASELINE_SUMMARY.md).

    Same technique as _annotate_building_inventory_counts (BLD-01, already
    fixed): each count is an independent correlated subquery (Subquery +
    OuterRef grouped by the target FK), not a plain Count() annotation on a
    joined relation - this avoids the classic Django multi-Count()
    JOIN-multiplication trap where combining several Count() annotations on
    different related paths in one annotate() call can silently
    multiply/inflate every count by the size of the other joined relations.
    Each subquery here is independently grouped and evaluated per
    apartment, so results are mathematically identical to running each of
    the original three queries once per apartment - just computed inside
    the single list/detail query instead of once per row.

    Filtering semantics are preserved exactly, matching
    ApartmentSerializer.get_actual_room_count/get_bed_count/
    get_occupied_beds field-for-field:
    - actual_room_count: active rooms only.
    - bed_count: beds under an active room (Bed itself has no is_active
      field).
    - occupied_beds: distinct beds with an ACTIVE BedAssignment -
      deliberately NOT filtered by room is_active, exactly like the
      original get_occupied_beds (a bed can still show as "occupied" after
      its room is deactivated; free_beds already clamps to 0 for that case
      in the serializer, same as before).

    Coalesce(..., 0) makes an apartment with zero matches yield 0 instead
    of NULL, matching the original .count() behavior (which returns 0,
    never None).
    """
    room_count_sq = Room.objects.filter(
        apartment=OuterRef('pk'), is_active=True,
    ).order_by().values('apartment').annotate(c=Count('id')).values('c')

    bed_count_sq = Bed.objects.filter(
        room__apartment=OuterRef('pk'), room__is_active=True,
    ).order_by().values('room__apartment').annotate(c=Count('id')).values('c')

    occupied_beds_sq = BedAssignment.objects.filter(
        bed__room__apartment=OuterRef('pk'), status=BedAssignment.Status.ACTIVE,
    ).order_by().values('bed__room__apartment').annotate(c=Count('bed_id', distinct=True)).values('c')

    return queryset.annotate(
        _actual_room_count=Coalesce(Subquery(room_count_sq, output_field=IntegerField()), 0),
        _bed_count=Coalesce(Subquery(bed_count_sq, output_field=IntegerField()), 0),
        _occupied_beds=Coalesce(Subquery(occupied_beds_sq, output_field=IntegerField()), 0),
    )


class ApartmentViewSet(viewsets.ModelViewSet):
    serializer_class = ApartmentSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        queryset = _annotate_apartment_inventory_counts(
            Apartment.objects.select_related(
                'building',
                'building__dorm_type',
                'building__dorm_type__region'
            ).all()
        )

        is_active = _parse_is_active_filter(self.request, default='all')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active)

        building_id = self.request.query_params.get('building')
        if building_id:
            queryset = queryset.filter(building_id=building_id)

        user = self.request.user
        region_value = self.request.query_params.get('region')
        # G3-04: centralized region scoping (see
        # _region_scoped_inventory_queryset) - a mismatched ?region= for a
        # region_boss/employee yields no results, never the foreign
        # region's apartments (and, since get_object() is built from this
        # same queryset, never a foreign apartment to write to either).
        queryset = _region_scoped_inventory_queryset(user, queryset, region_value, 'building__dorm_type__region')

        return queryset.order_by(
            'building__number',
            'number'
        )

    def create(self, request, *args, **kwargs):
        if not request.user.is_boss:
            return _inventory_create_permission_error()

        if not request.user.is_central_admin:
            building = Building.objects.filter(
                pk=request.data.get('building')
            ).select_related('dorm_type__region').first()
            if not building or not building.dorm_type or building.dorm_type.region_id != request.user.region_id:
                return Response(
                    {'error': 'ניתן ליצור דירה רק בבניין באזור המשויך למשתמש'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        conflict = check_apartment_write_conflict(None, request.data)
        if conflict:
            return Response(conflict, status=status.HTTP_400_BAD_REQUEST)

        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not request.user.is_boss:
            return Response(
                {'error': 'רק מנהל אזור או מנהל מרכזי יכול לערוך דירה'},
                status=status.HTTP_403_FORBIDDEN,
            )

        instance = self.get_object()

        # G3-04/G3-12: explicitly re-validate the OBJECT'S REAL region
        # (never rely solely on get_queryset()), and if this PATCH
        # reparents the apartment to a different building, validate that
        # NEW building's region too - a regional manager must never move an
        # apartment into a building belonging to another region.
        if not request.user.is_central_admin:
            real_region_id = (
                instance.building.dorm_type.region_id
                if instance.building and instance.building.dorm_type else None
            )
            if real_region_id != request.user.region_id:
                return Response(
                    {'error': 'אין הרשאה לערוך דירה באזור זה'},
                    status=status.HTTP_403_FORBIDDEN,
                )

            new_building_id = request.data.get('building')
            if new_building_id is not None and str(new_building_id) != str(instance.building_id):
                new_building = Building.objects.filter(pk=new_building_id).select_related('dorm_type').first()
                new_building_region_id = (
                    new_building.dorm_type.region_id
                    if new_building and new_building.dorm_type else None
                )
                if new_building_region_id != request.user.region_id:
                    return Response(
                        {'error': 'לא ניתן להעביר דירה לבניין מחוץ לאזור המשויך למשתמש'},
                        status=status.HTTP_403_FORBIDDEN,
                    )

        with transaction.atomic():
            # Lock this apartment's row before re-checking occupancy:
            # assign_student_to_room locks the same Apartment pk via
            # select_for_update before creating a BedAssignment, so holding
            # this lock for the duration of the check+write means the two
            # can never interleave - a concurrent assignment either fully
            # commits before this check reads it, or blocks until this
            # transaction is done. This closes the race where a "שינוי
            # הגדרה" recommendation was generated while the apartment was
            # empty, but another employee assigned a student into it a
            # moment before this request was confirmed.
            locked_instance = Apartment.objects.select_for_update().get(pk=instance.pk)
            conflict = check_apartment_write_conflict(locked_instance, request.data)
            if conflict:
                return Response(conflict, status=status.HTTP_400_BAD_REQUEST)

            previous_state = {
                'category': locked_instance.category,
                'apartment_type': locked_instance.apartment_type,
            }
            response = super().update(request, *args, **kwargs)
            if response.status_code == 200:
                locked_instance.refresh_from_db(fields=['category', 'apartment_type'])
                new_state = {
                    'category': locked_instance.category,
                    'apartment_type': locked_instance.apartment_type,
                }
                if new_state != previous_state:
                    AssistedAllocationAudit.objects.create(
                        action_type=AssistedAllocationAudit.ActionType.CONFIG_CHANGE,
                        actor=request.user,
                        apartment=locked_instance,
                        building=locked_instance.building,
                        previous_state=previous_state,
                        new_state=new_state,
                    )
        return response


def _annotate_room_inventory_counts(queryset):
    """
    Queryset-level replacement for the per-row queries RoomSerializer's
    current_occupancy/available_beds/is_full/bed_count/
    has_missing_bed_records fields used to run per room (see performance
    baseline finding BLD-03: ~7 extra SQL queries per active room row,
    confirmed in project-quality/performance/ROOMS_BASELINE_SUMMARY.md).

    Same technique as _annotate_building_inventory_counts (BLD-01) /
    _annotate_apartment_inventory_counts (BLD-02): the raw counts are
    independent correlated subqueries (Subquery + OuterRef grouped by the
    target FK), not plain Count() annotations combined in one annotate()
    call - avoiding JOIN multiplication. The derived boolean/clamped
    fields (_available_beds, _is_full, _has_missing_bed_records) are then
    computed from those already-annotated columns via Case/When/F
    expressions in a second/third .annotate() step on the same queryset -
    still one SQL statement, still zero extra round trips per row.

    Filtering semantics preserved exactly, matching
    RoomSerializer.current_occupancy/available_beds/is_full/bed_count/
    has_missing_bed_records - and the Room model properties they're
    sourced from - field-for-field:
    - current_occupancy: count of ACTIVE BedAssignments for this room,
      regardless of the room's own is_active (Room.current_occupancy has
      no is_active check).
    - bed_count: total Bed rows for this room (Bed has no is_active
      field).
    - available_beds: 0 if the room is inactive (short-circuit, matches
      Room.available_beds exactly); otherwise
      max(bed_count - distinct_occupied_bed_count, 0).
    - is_full: True if the room is inactive OR available_beds <= 0
      (matches Room.is_full). This collapses to just "available_beds <= 0"
      here, because available_beds is already forced to 0 for inactive
      rooms by the rule above - making that comparison True in both the
      "inactive" and the "active but full" case, exactly like the
      original two-branch property.
    - has_missing_bed_records: bed_count < capacity (matches
      RoomSerializer.get_has_missing_bed_records exactly - no is_active
      dependency there either).
    """
    bed_count_sq = Bed.objects.filter(
        room=OuterRef('pk'),
    ).order_by().values('room').annotate(c=Count('id')).values('c')

    current_occupancy_sq = BedAssignment.objects.filter(
        bed__room=OuterRef('pk'), status=BedAssignment.Status.ACTIVE,
    ).order_by().values('bed__room').annotate(c=Count('id')).values('c')

    # Deliberately a SEPARATE subquery from current_occupancy_sq, mirroring
    # the original code exactly: Room.current_occupancy uses a plain
    # .count() of ACTIVE assignments, while Room.available_beds computes
    # "used" beds via a distinct bed_id count - two differently-written
    # queries that are numerically guaranteed equal only because of the
    # unique_active_assignment_per_bed DB constraint (at most one ACTIVE
    # assignment per bed). Keeping them as distinct annotations preserves
    # that original structure literally rather than assuming the
    # equivalence.
    used_beds_distinct_sq = BedAssignment.objects.filter(
        bed__room=OuterRef('pk'), status=BedAssignment.Status.ACTIVE,
    ).order_by().values('bed__room').annotate(c=Count('bed_id', distinct=True)).values('c')

    queryset = queryset.annotate(
        _bed_count=Coalesce(Subquery(bed_count_sq, output_field=IntegerField()), 0),
        _current_occupancy=Coalesce(Subquery(current_occupancy_sq, output_field=IntegerField()), 0),
        _used_beds_distinct=Coalesce(Subquery(used_beds_distinct_sq, output_field=IntegerField()), 0),
    )
    queryset = queryset.annotate(
        _available_beds=Case(
            When(is_active=False, then=Value(0)),
            default=Greatest(F('_bed_count') - F('_used_beds_distinct'), Value(0)),
            output_field=IntegerField(),
        ),
    )
    queryset = queryset.annotate(
        _is_full=Case(
            When(_available_beds__lte=0, then=Value(True)),
            default=Value(False),
            output_field=BooleanField(),
        ),
        _has_missing_bed_records=Case(
            When(_bed_count__lt=F('capacity'), then=Value(True)),
            default=Value(False),
            output_field=BooleanField(),
        ),
    )
    return queryset


class RoomViewSet(viewsets.ModelViewSet):
    serializer_class = RoomSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        queryset = _annotate_room_inventory_counts(
            Room.objects.select_related(
                'apartment',
                'apartment__building',
                'apartment__building__dorm_type',
                'apartment__building__dorm_type__region'
            ).all()
        )

        is_active = _parse_is_active_filter(self.request, default='all')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active)

        apartment_id = self.request.query_params.get('apartment')
        if apartment_id:
            queryset = queryset.filter(apartment_id=apartment_id)

        building_id = self.request.query_params.get('building')
        if building_id:
            queryset = queryset.filter(apartment__building_id=building_id)

        user = self.request.user
        region_value = self.request.query_params.get('region')
        # G3-04: centralized region scoping (see
        # _region_scoped_inventory_queryset) - see BuildingViewSet/
        # ApartmentViewSet above for the full rationale.
        queryset = _region_scoped_inventory_queryset(
            user, queryset, region_value, 'apartment__building__dorm_type__region'
        )

        return queryset.order_by(
            'apartment__building__number',
            'apartment__number',
            'name'
        )

    def create(self, request, *args, **kwargs):
        if not request.user.is_boss:
            return _inventory_create_permission_error()

        if not request.user.is_central_admin:
            apartment = Apartment.objects.filter(
                pk=request.data.get('apartment')
            ).select_related('building__dorm_type__region').first()
            region_id = (
                apartment.building.dorm_type.region_id
                if apartment and apartment.building and apartment.building.dorm_type
                else None
            )
            if not apartment or region_id != request.user.region_id:
                return Response(
                    {'error': 'ניתן ליצור חדר רק בדירה באזור המשויך למשתמש'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        conflict = check_room_write_conflict(None, request.data)
        if conflict:
            return Response(conflict, status=status.HTTP_400_BAD_REQUEST)

        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not request.user.is_boss:
            return Response(
                {'error': 'רק מנהל אזור או מנהל מרכזי יכול לערוך חדר'},
                status=status.HTTP_403_FORBIDDEN,
            )

        instance = self.get_object()

        # G3-04/G3-12: explicitly re-validate the OBJECT'S REAL region, and
        # if this PATCH reparents the room to a different apartment,
        # validate that NEW apartment's region too.
        if not request.user.is_central_admin:
            real_region = _room_region(instance)
            real_region_id = real_region.id if real_region else None
            if real_region_id != request.user.region_id:
                return Response(
                    {'error': 'אין הרשאה לערוך חדר באזור זה'},
                    status=status.HTTP_403_FORBIDDEN,
                )

            new_apartment_id = request.data.get('apartment')
            if new_apartment_id is not None and str(new_apartment_id) != str(instance.apartment_id):
                new_apartment = Apartment.objects.filter(pk=new_apartment_id).select_related(
                    'building__dorm_type'
                ).first()
                new_region_id = (
                    new_apartment.building.dorm_type.region_id
                    if new_apartment and new_apartment.building and new_apartment.building.dorm_type
                    else None
                )
                if new_region_id != request.user.region_id:
                    return Response(
                        {'error': 'לא ניתן להעביר חדר לדירה מחוץ לאזור המשויך למשתמש'},
                        status=status.HTTP_403_FORBIDDEN,
                    )

        conflict = check_room_write_conflict(instance, request.data)
        if conflict:
            return Response(conflict, status=status.HTTP_400_BAD_REQUEST)

        return super().update(request, *args, **kwargs)


def _annotate_bed_occupancy(queryset):
    """
    Queryset-level replacement for the per-row query BedSerializer's
    is_occupied field used to run once per bed (see performance baseline
    finding BLD-04: ~1 extra SQL query per bed row, confirmed in
    project-quality/performance/BEDS_BASELINE_SUMMARY.md).

    Unlike Buildings/Apartments/Rooms (BLD-01/02/03), this is a single
    boolean check, not a count - Exists(...) is the natural fit rather
    than a Subquery+Coalesce count. Exists() compiles to a correlated
    `EXISTS (SELECT 1 FROM ... WHERE ...)` subquery per row, computed
    inside the same single SQL statement as the list/detail query, with no
    JOIN-multiplication risk (there is nothing else being annotated here
    to multiply against).

    Filtering semantics match Bed.is_occupied exactly:
    `self.assignments.filter(status=ACTIVE).exists()`.
    """
    active_assignment_exists = BedAssignment.objects.filter(
        bed=OuterRef('pk'), status=BedAssignment.Status.ACTIVE,
    )
    return queryset.annotate(_is_occupied=Exists(active_assignment_exists))


class BedViewSet(viewsets.ModelViewSet):
    """
    Read-only browsing plus label-only editing. Individual bed
    creation/deletion and activation/deactivation are intentionally not
    supported: Bed rows are derived from Room.capacity and materialized
    exclusively by the admin-only `manage.py materialize_beds` command
    (see ensure_room_beds), so exposing free-form bed CRUD here would risk
    silently desynchronizing bed rows from room capacity.
    """
    serializer_class = BedSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_queryset(self):
        queryset = _annotate_bed_occupancy(
            Bed.objects.select_related(
                'room',
                'room__apartment',
                'room__apartment__building',
                'room__apartment__building__dorm_type',
                'room__apartment__building__dorm_type__region',
            ).all()
        )

        room_id = self.request.query_params.get('room')
        if room_id:
            queryset = queryset.filter(room_id=room_id)

        apartment_id = self.request.query_params.get('apartment')
        if apartment_id:
            queryset = queryset.filter(room__apartment_id=apartment_id)

        user = self.request.user
        if not user.is_central_admin:
            if not user.region_id:
                return queryset.none()
            queryset = queryset.filter(
                room__apartment__building__dorm_type__region=user.region
            )

        return queryset.order_by(
            'room__apartment__building__number',
            'room__apartment__number',
            'room__name',
            'label',
        )

    def update(self, request, *args, **kwargs):
        if not request.user.is_boss:
            return Response(
                {'error': 'רק מנהל אזור או מנהל מרכזי יכול לערוך תווית מיטה'},
                status=status.HTTP_403_FORBIDDEN,
            )
        allowed_fields = {'label'}
        extra_fields = set(request.data.keys()) - allowed_fields
        if extra_fields:
            return Response(
                {
                    'field': next(iter(extra_fields)),
                    'code': 'FIELD_NOT_EDITABLE',
                    'message': 'ניתן לערוך רק את תווית המיטה — שדות אחרים אינם נתמכים לעריכה ברמת המיטה.',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().update(request, *args, **kwargs)


class StudentViewSet(viewsets.ModelViewSet):
    serializer_class = StudentSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsPagination
    # G3-15: Student records must never be hard-deletable through generic
    # CRUD - there is no legitimate "delete a student record" workflow in
    # this codebase (the existing REMOVE_STUDENT StudentRequest workflow
    # ends the active BedAssignment and clears assigned_room, it never
    # deletes the Student row - see StudentRequestViewSet.approve()). No
    # 'delete' is intentionally listed here rather than inventing a new
    # broad delete privilege.
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_serializer_class(self):

        if self.action == 'list':
            return StudentListSerializer
        return StudentSerializer

    def get_queryset(self):
        queryset = Student.objects.select_related(
            'accepted_dorm_type',
            'accepted_dorm_type__region',
            'assigned_room',
            'assigned_room__apartment',
            'assigned_room__apartment__building',
        )
        if self.action == 'list':
            # The list serializer's current_bed field must never issue a
            # per-student BedAssignment query (obj.current_bed's default
            # property does exactly that) - prefetch each student's one
            # active assignment (+ its bed) in a single extra query instead.
            # Scoped to action='list' only: the detail serializer reads the
            # same current_bed property, which is fine as a single query on
            # one object when opening a single student.
            queryset = queryset.prefetch_related(
                Prefetch(
                    'bed_assignments',
                    queryset=BedAssignment.objects.filter(
                        status=BedAssignment.Status.ACTIVE
                    ).select_related('bed'),
                    to_attr='prefetched_active_assignments',
                )
            )
        else:
            # StudentSerializer.batch_id (source='batch.id') is only read
            # outside the list action (StudentListSerializer has no batch
            # field) - added here only, so the list query's JOIN shape is
            # completely unchanged. Previously a lazy per-response query
            # on every detail/create/update.
            # (project-quality/performance/GROUP1_BACKEND_PERFORMANCE_AUDIT.md, G1-16.)
            queryset = queryset.select_related('batch')

        user = self.request.user
        region_value = self.request.query_params.get('region')

        if user.is_central_admin or user.is_boss:
            if region_value:
                region = _resolve_region(region_value)
                if not region:
                    return queryset.none()
                queryset = queryset.filter(accepted_dorm_type__region=region)
            elif not user.is_central_admin:
                if not user.region_id:
                    return queryset.none()
                queryset = queryset.filter(
                    accepted_dorm_type__region_id=user.region_id
                )
        else:
            if not user.region_id:
                return queryset.none()
            queryset = queryset.filter(
                accepted_dorm_type__region_id=user.region_id
            )
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(first_name__icontains=search) |
                Q(last_name__icontains=search) |
                Q(student_id__icontains=search) |
                Q(business_partner_id__icontains=search)
            )

        # Multi-value filter params: accepts repeated params AND comma-joined
        # values (?gender=male,female or ?gender=male&gender=female). 'all'
        # and empties are dropped. Values are validated against model
        # choices / cast where applicable - invalid input filters nothing
        # extra rather than erroring.
        def _csv_params(name):
            values = []
            for chunk in self.request.query_params.getlist(name):
                values.extend(
                    v.strip() for v in str(chunk).split(',')
                    if v.strip() and v.strip() != 'all'
                )
            return values

        def _int_params(name):
            out = []
            for v in _csv_params(name):
                try:
                    out.append(int(v))
                except (TypeError, ValueError):
                    pass
            return out

        genders = [v for v in _csv_params('gender') if v in Student.Gender.values]
        if genders:
            queryset = queryset.filter(gender__in=genders)

        religions = [v for v in _csv_params('requested_religion') if v in Student.Religion.values]
        if religions:
            queryset = queryset.filter(requested_religion__in=religions)

        religious = self.request.query_params.get('religious')
        if religious and religious != 'all':
            queryset = queryset.filter(religious=religious)

        placement_sector = self.request.query_params.get('placement_sector')
        if placement_sector and placement_sector != 'all':
            queryset = queryset.filter(placement_sector=placement_sector)

        # Location filters (FiltersDrawer). Region PKs are slugs; the rest
        # are integer PKs. Regional users are already hard-scoped above.
        regions = _csv_params('region')
        if regions:
            queryset = queryset.filter(accepted_dorm_type__region_id__in=regions)

        dorm_types = _int_params('dorm_type')
        if dorm_types:
            queryset = queryset.filter(accepted_dorm_type_id__in=dorm_types)

        buildings = _int_params('building')
        if buildings:
            queryset = queryset.filter(assigned_room__apartment__building_id__in=buildings)

        apartments = _int_params('apartment')
        if apartments:
            queryset = queryset.filter(assigned_room__apartment_id__in=apartments)

        rooms = _int_params('room')
        if rooms:
            queryset = queryset.filter(assigned_room_id__in=rooms)

        status_filter = self.request.query_params.get('status')
        if status_filter == 'assigned':
            queryset = queryset.filter(assigned_room__isnull=False)
        elif status_filter == 'unassigned':
            queryset = queryset.filter(assigned_room__isnull=True)
        elif status_filter == 'priority':
            queryset = queryset.filter(is_priority=True)

        has_roommate = self.request.query_params.get('has_roommate_request')
        if has_roommate in ('yes', 'no'):
            roommate_q = (
                Q(roommate_request_1__gt='') | Q(roommate_request_2__gt='') |
                Q(roommate_request_3__gt='') | Q(roommate_request_4__gt='') |
                Q(roommate_request_5__gt='')
            )
            queryset = queryset.filter(roommate_q) if has_roommate == 'yes' else queryset.exclude(roommate_q)

        category = self.request.query_params.get('category')
        if category and category != 'all':
            queryset = queryset.filter(category=category)

        return queryset

    def _check_student_region_authorization(self, user, dorm_type):
        """
        §1: central admins may add/edit a student in any region (via their
        choice of accepted_dorm_type, which carries the region); regional
        staff may only add/edit students within their own region - a
        manipulated request naming a dorm type from another region is
        rejected outright here, not merely hidden in the UI.
        """
        if not user.is_central_admin:
            if not user.region_id:
                raise DRFPermissionDenied('אין לך אזור מוגדר - לא ניתן להוסיף/לערוך סטודנטים')
            if dorm_type and dorm_type.region_id and dorm_type.region_id != user.region_id:
                raise DRFPermissionDenied('אינך מורשה לשייך סטודנט לאזור זה')

    def perform_create(self, serializer):
        user = self.request.user
        dorm_type = serializer.validated_data.get('accepted_dorm_type')
        self._check_student_region_authorization(user, dorm_type)
        # housing_type is never guessed from gender - the serializer already
        # requires an explicit, employee-chosen value for any student
        # eligible for assignment (every category except LEAVING).
        serializer.save()

    def perform_update(self, serializer):
        user = self.request.user
        dorm_type = serializer.validated_data.get(
            'accepted_dorm_type', serializer.instance.accepted_dorm_type
        )
        self._check_student_region_authorization(user, dorm_type)
        serializer.save()

    @action(detail=False, methods=['get'])
    def counts(self, request):
        queryset = self.get_queryset()
        by_category = dict(
            queryset.values_list('category').annotate(n=Count('id'))
        )
        return Response({
            'all': queryset.count(),
            'continuing': by_category.get(Student.StudentCategory.CONTINUING, 0),
            'new': by_category.get(Student.StudentCategory.NEW, 0),
            'transfer': by_category.get(Student.StudentCategory.TRANSFER, 0),
            'leaving': by_category.get(Student.StudentCategory.LEAVING, 0),
        })

    @action(detail=False, methods=['get'], url_path='filter-options')
    def filter_options(self, request):
        user = request.user
        regions = Region.objects.all()
        buildings = Building.objects.select_related('dorm_type').all()
        dorm_types = DormType.objects.select_related('region').all()
        apartments = Apartment.objects.select_related('building').all()
        rooms = Room.objects.select_related('apartment').all()

        if not user.is_central_admin and user.region_id:
            regions = regions.filter(id=user.region_id)
            buildings = buildings.filter(dorm_type__region_id=user.region_id)
            dorm_types = dorm_types.filter(region_id=user.region_id)
            apartments = apartments.filter(building__dorm_type__region_id=user.region_id)
            rooms = rooms.filter(apartment__building__dorm_type__region_id=user.region_id)

        religions = [
            {'id': choice_value, 'name': str(choice_label)}
            for choice_value, choice_label in Student.Religion.choices
        ]

        # Single source of truth for the canonical housing-type values -
        # Add/Edit Student must offer exactly these 5 choices (Z1/Z2/Z3/Z4/Z6),
        # never a hardcoded frontend copy that can drift from the model.
        housing_types = [
            {'id': choice_value, 'name': str(choice_label)}
            for choice_value, choice_label in Student.HousingType.choices
        ]

        return Response({
            'is_central_admin': user.is_central_admin,
            'regions': [{'id': r.id, 'name': r.name} for r in regions],
            'buildings': [{'id': b.id, 'name': str(b.number)} for b in buildings],
            # 'dorm_types' is the key every frontend consumer (FiltersDrawer,
            # StudentsPage's Add Student form) actually reads - it was
            # previously returned as 'dormTypes' here, which meant the dorm
            # type dropdown was always empty and any form requiring it as a
            # required field (e.g. Add Student) could never be submitted.
            'dorm_types': [
                {'id': d.id, 'name': d.name, 'region_id': d.region_id, 'region_name': d.region.name if d.region else None}
                for d in dorm_types
            ],
            'apartments': [{'id': a.id, 'name': a.number} for a in apartments],
            'rooms': [{'id': r.id, 'name': r.name} for r in rooms],
            'religions': religions,
            'housing_types': housing_types,
        })


class TransferViewSet(viewsets.ModelViewSet):
    serializer_class = TransferSerializer
    permission_classes = [IsAuthenticated]
    # G3-24: Transfer rows are workflow/audit history - 'delete' is
    # intentionally absent so no authenticated user can erase a transfer
    # record through generic CRUD. 'put'/'patch' stay listed (the
    # approve()/reject() actions below need PUT on their own sub-URLs), but
    # update()/partial_update() to the base '/transfers/<pk>/' resource are
    # overridden below to refuse writes (G3-02).
    http_method_names = ['get', 'post', 'put', 'patch', 'head', 'options']

    def get_queryset(self):
        queryset = Transfer.objects.select_related(
            'student',
            'from_room', 'from_room__apartment', 'from_room__apartment__building',
            'to_room', 'to_room__apartment', 'to_room__apartment__building',
            'requested_by', 'requested_by__region', 'reviewed_by',
        )

        if not self.request.user.is_central_admin:
            queryset = queryset.filter(
                Q(from_room__apartment__building__dorm_type__region=self.request.user.region) |
                Q(to_room__apartment__building__dorm_type__region=self.request.user.region)
            )

        status_filter = self.request.query_params.get('status')
        if status_filter and status_filter != 'all':
            queryset = queryset.filter(status=status_filter)

        return queryset.order_by('-created_at')

    def update(self, request, *args, **kwargs):
        # G3-02: the legacy generic update endpoint must never be usable to
        # set status/reviewed_by/reviewed_at/rejection_reason directly,
        # bypassing user_can_approve_transfer(), the room-availability
        # check, or the BedAssignment creation that approve()/reject()
        # perform. All transitions must go through those dedicated actions.
        # (TransferSerializer also marks those fields read_only as a second
        # layer of defense - this blocks the endpoint outright.)
        return Response(
            {'error': 'לא ניתן לערוך בקשת העברה ישירות - יש להשתמש בפעולות אישור/דחייה.'},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    def perform_create(self, serializer):
        student = serializer.validated_data['student']
        from_room = serializer.validated_data.get('from_room') or student.assigned_room
        to_room = serializer.validated_data['to_room']

        if not from_room:
            raise DRFValidationError('הסטודנט אינו משויך כרגע לחדר מקור')

        # G3-07: a non-central-admin may only create a (same-region) legacy
        # Transfer wholly inside their own region - never for a student/room
        # belonging to another region. Cross-region movement has its own,
        # explicitly-authorized path (StudentRequestViewSet's
        # region_transfer workflow); this endpoint was never meant to cross
        # regions and must not silently allow it.
        user = self.request.user
        if not user.is_central_admin:
            if not user.region_id:
                raise DRFPermissionDenied('אין לך אזור מוגדר - לא ניתן ליצור בקשת העברה')
            from_region = getattr(getattr(getattr(from_room, 'apartment', None), 'building', None), 'dorm_type', None)
            from_region_id = from_region.region_id if from_region else None
            to_region = getattr(getattr(getattr(to_room, 'apartment', None), 'building', None), 'dorm_type', None)
            to_region_id = to_region.region_id if to_region else None
            if from_region_id != user.region_id or to_region_id != user.region_id:
                raise DRFPermissionDenied('אינך מורשה ליצור בקשת העברה עבור אזור זה')

        validate_apartment_assignment(student, to_room)
        movement_type = infer_movement_type(from_room, to_room)

        with transaction.atomic():
            try:
                target_bed = get_free_bed(to_room)
            except ValueError as exc:
                # Data-integrity case (capacity free but no real Bed rows) -
                # surfaced as a validation error, never silently "fixed".
                raise DRFValidationError(str(exc))
            if not target_bed:
                raise DRFValidationError('אין מיטה פנויה בחדר היעד')

            # NOTE (G2 implementation, Transfer.movement_type bug):
            # Transfer has no movement_type field of its own - it is
            # only ever stored on the related MovementRequest created
            # just below (transfer.movement_request.movement_type).
            # Passing movement_type=... into serializer.save() here used
            # to raise TypeError: Transfer() got unexpected keyword
            # arguments: 'movement_type', crashing every single Transfer
            # creation unconditionally (confirmed via direct
            # reproduction: Transfer(movement_type='room') raises
            # TypeError). See
            # project-quality/concurrency/GROUP2_CONCURRENCY_LOAD_AUDIT.md
            # (INCIDENTAL-1) and
            # GROUP2_CONCURRENCY_LOAD_IMPLEMENTATION_REPORT.md.
            transfer = serializer.save(
                requested_by=self.request.user,
                from_room=from_room,
            )

            movement_request = MovementRequest(
                student=student,
                from_assignment=student.current_assignment,
                to_bed=target_bed,
                movement_type=movement_type,
                status=MovementRequest.Status.PENDING,
                reason=transfer.reason,
                requested_by=self.request.user
            )
            movement_request.full_clean()
            movement_request.save()

            transfer.movement_request = movement_request
            transfer_fields = _get_model_field_names(Transfer)
            update_fields = ['movement_request']
            if 'updated_at' in transfer_fields:
                update_fields.append('updated_at')
            transfer.save(update_fields=update_fields)

    @action(detail=True, methods=['put'])
    def approve(self, request, pk=None):
        if not request.user.is_boss:
            return Response({
                'error': 'רק מנהל יכול לאשר בקשות'
            }, status=status.HTTP_403_FORBIDDEN)

        transfer = self.get_object()

        if transfer.status != Transfer.Status.PENDING:
            return Response({
                'error': 'הבקשה כבר טופלה'
            }, status=status.HTTP_400_BAD_REQUEST)

        if not user_can_approve_transfer(request.user, transfer):
            return Response({
                'error': 'אין הרשאה לאשר בקשה זו'
            }, status=status.HTTP_403_FORBIDDEN)

        if transfer.to_room.is_full:
            return Response({
                'error': 'החדר היעד מלא'
            }, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                # G2-01-equivalent fix (Transfer race): the PENDING check
                # above is a fast, unlocked pre-check for the common
                # (non-racing) case - it can go stale between then and
                # here. select_for_update() re-fetches and locks THIS
                # SAME ROW; status is re-verified under that lock, which
                # is the authoritative check a second, concurrent
                # approve() call for the SAME transfer cannot slip past
                # (it blocks on this select_for_update() until the
                # winning request's transaction commits, then sees the
                # already-updated status).
                locked_transfer = Transfer.objects.select_for_update().get(pk=transfer.pk)
                if locked_transfer.status != Transfer.Status.PENDING:
                    return Response({
                        'error': 'הבקשה כבר טופלה'
                    }, status=status.HTTP_400_BAD_REQUEST)

                transfer.status = Transfer.Status.APPROVED
                transfer.reviewed_by = request.user
                transfer.reviewed_at = timezone.now()
                transfer.save()

                student = transfer.student
                # movement_type lives on the related MovementRequest, not
                # on Transfer itself (see perform_create() above) - falls
                # back to the regular TRANSFER assignment type when there
                # is no linked MovementRequest, matching this fallback's
                # original intent for any non-PHASE2 movement_type.
                movement_type = (
                    transfer.movement_request.movement_type
                    if transfer.movement_request_id else None
                )
                assignment_type = (
                    BedAssignment.AssignmentType.PHASE2
                    if movement_type == MovementRequest.MovementType.PHASE2
                    else BedAssignment.AssignmentType.TRANSFER
                )

                new_assignment = assign_student_to_room(
                    student=student,
                    room=transfer.to_room,
                    assigned_by=request.user,
                    assignment_type=assignment_type
                )

                if transfer.movement_request:
                    transfer.movement_request.to_bed = new_assignment.bed
                    transfer.movement_request.status = MovementRequest.Status.COMPLETED
                    transfer.movement_request.approved_by = request.user
                    transfer.movement_request.reviewed_at = timezone.now()
                    transfer.movement_request.completed_at = timezone.now()
                    transfer.movement_request.full_clean()
                    transfer.movement_request.save()

            return Response({
                'message': 'הבקשה אושרה בהצלחה',
                'transfer': TransferSerializer(transfer).data
            })

        except (ValueError, ValidationError) as e:
            return Response({
                'error': str(e)
            }, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            # Defensive backstop (G2-02-equivalent): a legitimate
            # concurrent-write conflict surfaces as a clean 4xx, never an
            # unhandled 500.
            return Response({
                'error': 'הבקשה כבר טופלה או שהתרחשה התנגשות נתונים - נא לרענן ולנסות שוב.'
            }, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['put'])
    def reject(self, request, pk=None):
        if not request.user.is_boss:
            return Response({
                'error': 'רק מנהל יכול לדחות בקשות'
            }, status=status.HTTP_403_FORBIDDEN)

        transfer = self.get_object()

        if transfer.status != Transfer.Status.PENDING:
            return Response({
                'error': 'הבקשה כבר טופלה'
            }, status=status.HTTP_400_BAD_REQUEST)

        # G3-22: reject() must use the exact same authorization rule as
        # approve() - previously this checked only to_room's region while
        # approve() required both from_room and to_room to match the boss's
        # region, two inconsistent ad-hoc policies for the same decision.
        if not user_can_approve_transfer(request.user, transfer):
            return Response({
                'error': 'אין הרשאה לדחות בקשה זו'
            }, status=status.HTTP_403_FORBIDDEN)

        with transaction.atomic():
            # Same lock-and-recheck pattern as approve() above - also
            # closes a pre-existing gap where reject() previously had NO
            # transaction.atomic() at all, so a failure between
            # transfer.save() and movement_request.save() could leave
            # inconsistent state.
            locked_transfer = Transfer.objects.select_for_update().get(pk=transfer.pk)
            if locked_transfer.status != Transfer.Status.PENDING:
                return Response({
                    'error': 'הבקשה כבר טופלה'
                }, status=status.HTTP_400_BAD_REQUEST)

            transfer.status = Transfer.Status.REJECTED
            transfer.reviewed_by = request.user
            transfer.reviewed_at = timezone.now()
            transfer.rejection_reason = request.data.get('reason', '')
            transfer.save()

            if transfer.movement_request:
                transfer.movement_request.status = MovementRequest.Status.REJECTED
                transfer.movement_request.approved_by = request.user
                transfer.movement_request.reviewed_at = timezone.now()
                transfer.movement_request.completed_at = None
                transfer.movement_request.full_clean()
                transfer.movement_request.save()

        return Response({
            'message': 'הבקשה נדחתה',
            'transfer': TransferSerializer(transfer).data
        })


# =========================
# Student Requests (add/remove student, room/apartment change, other)
# =========================

def _religion_group(religion):
    if religion == Student.Religion.Jewish:
        return 'jewish'
    if religion in (Student.Religion.Muslim, Student.Religion.Christian, Student.Religion.Druze):
        return 'arab'
    return 'unknown'


def _sector_group(placement_sector):
    """
    Coarse jewish/arab/other/unknown placement-sector bucket, independent of
    the finer-grained religion field - mirrors the allocation solver's
    sectorMatching signal (allocation/solver.py:_get_student_sector).
    placement_sector is a field staff set explicitly for placement purposes
    and can be more/less complete than requested_religion, so it is scored
    as its own distinct warning rather than folded into the religion check.
    """
    if placement_sector == Student.PlacementSector.JEWISH:
        return 'jewish'
    if placement_sector == Student.PlacementSector.ARAB:
        return 'arab'
    if placement_sector == Student.PlacementSector.OTHER:
        return 'other'
    return 'unknown'


def _year_group(study_points):
    """
    Coarse academic-year bucket used only to avoid mixing first-years with
    3rd/4th-years in the same apartment - mirrors the allocation solver's
    avoidYearMix signal (allocation/solver.py:_get_student_year_group).
    Missing/unset study_points is 'other' (unknown), never 0 - it must not
    be silently treated as a real, matchable year1 value.
    """
    if study_points is None or study_points == '':
        return 'other'
    try:
        points = float(study_points)
    except (TypeError, ValueError):
        return 'other'
    if 0 <= points <= 40:
        return 'year1'
    if points >= 60:
        return 'year3_4'
    return 'other'


def _student_transfer_history(student):
    """
    Real, stored historical signal (Transfer records) for this student -
    never invented, never inferred from unrelated behavior. Returns the set
    of dorm_type ids the student has previously *requested to move to*
    (any Transfer status - even a rejected/pending request shows real
    interest) and the set they've previously *requested to move away from*.
    Both are used only to explain an option, never to gate/exclude it.
    """
    if student is None or not getattr(student, 'pk', None):
        return {'requested_to': set(), 'requested_away_from': set()}

    transfers = Transfer.objects.filter(student=student).select_related(
        'to_room__apartment__building__dorm_type',
        'from_room__apartment__building__dorm_type',
    )
    requested_to = set()
    requested_away_from = set()
    for t in transfers:
        to_dorm_type_id = (
            t.to_room.apartment.building.dorm_type_id if t.to_room and t.to_room.apartment.building else None
        )
        from_dorm_type_id = (
            t.from_room.apartment.building.dorm_type_id if t.from_room and t.from_room.apartment.building else None
        )
        if to_dorm_type_id:
            requested_to.add(to_dorm_type_id)
        if from_dorm_type_id:
            requested_away_from.add(from_dorm_type_id)
    return {'requested_to': requested_to, 'requested_away_from': requested_away_from}


def _infer_housing_type(student_data):
    """Best-effort mapping from the Add-Student wizard's loose dorm_type hint
    ('couples' / 'single') + gender into a real Student.HousingType value."""
    dorm_hint = (student_data.get('dorm_type') or student_data.get('housing_type') or '').strip().lower()
    gender = student_data.get('gender')

    if dorm_hint in ('couples', 'couple', 'זוגות'):
        return Student.HousingType.COUPLE
    if dorm_hint in ('single', 'בודדים', 'רווקים', 'רווקות', 'רווקים/ות בדירה'):
        return Student.HousingType.SINGLE_FEMALE if gender == 'female' else Student.HousingType.SINGLE_MALE

    if gender == 'female':
        return Student.HousingType.SINGLE_FEMALE
    if gender == 'male':
        return Student.HousingType.SINGLE_MALE
    return ''


# ---------------------------------------------------------------------------
# Central match-scoring configuration - single source of truth for §3.
#
# These weights mirror the *relative* importance already established by the
# allocation solver's SOFT_ALLOCATION_CONSTRAINTS (allocation/solver.py):
# roommateMatch=8 is its strongest soft signal, followed by
# sectorMatching=7, sameReligion=6, and avoidYearMix=4 (its weakest default
# soft signal). The solver has no existing weight split for "mutual" vs
# "one-sided" roommate requests specifically - its fixtures (e.g.
# case_02_soft_tradeoff_one_sided_bad_roommate) only establish that a
# one-sided request is a weaker signal than a mutual one. That split is
# therefore defined explicitly here, once, rather than as a magic number
# inside the scoring loop.
# ---------------------------------------------------------------------------
MATCH_SCORE_WEIGHTS = {
    'base': 50,
    'roommate_match_mutual': 35,
    'roommate_match_one_sided': 15,
    'roommate_future_capacity': 10,
    'preferred_dormitory': 14,
    'empty_apartment': 15,
    'religion_compatible': 10,
    'religion_conflict_penalty': -15,
    'sector_compatible': 12,
    'sector_conflict_penalty': -18,
    'year_mix_penalty': -8,
    'city_match': 8,
    'priority_student_bonus': 5,
    'history_bonus': 4,
}
BEST_MATCH_SCORE_THRESHOLD = 70
# The numeric score above is sort/threshold plumbing ONLY - it is never sent
# to the frontend. Every reason attached to an option (matched/warning/
# historical) is a (code, label) pair from this table, so the UI can render
# "why", never a percentage. recommendation_level is the only thing the
# client sees for ranking, mapped from match_level (itself derived from the
# score) via RECOMMENDATION_LEVEL_MAP below.
REASON_LABELS = {
    'mutual_roommate_request': 'בקשת שותפים הדדית',
    'roommate_already_here': 'השותף המבוקש כבר משובץ בדירה זו',
    'roommate_future_capacity': 'בדירה קיימות שתי מיטות פנויות עבור שני השותפים',
    'preferred_dormitory': 'המעון נמצא בעדיפות הסטודנט',
    'empty_apartment': 'דירה ריקה - ללא סיכון התאמה',
    'religion_match': 'התאמה דתית/עדתית',
    'religion_conflict': 'בדירה יש דיירים מקבוצה דתית שונה',
    'sector_match': 'התאמת סקטור שיבוץ',
    'sector_conflict': 'בדירה יש דיירים מסקטור שיבוץ שונה',
    'year_mix_conflict': 'ערבוב שנתונים בדירה (שנה א׳ עם שנה ג׳-ד׳)',
    'city_match': 'התאמת עיר מגורים',
    'priority_student': 'סטודנט/ית בעדיפות',
    'roommate_incompatible_hard_rule': 'השותף המבוקש נמצא בדירה זו, אך קיים חוסר התאמה בדרישות חובה',
    'previously_requested_dormitory': 'הסטודנט/ית ביקש/ה בעבר מעון זה',
    'previously_transferred_away': 'הסטודנט/ית ביקש/ה בעבר לעבור ממעון זה',
}

RECOMMENDATION_LEVEL_MAP = {
    'best_match': ('best', 'ההתאמה המומלצת ביותר', 4),
    'empty': ('good', 'התאמה טובה', 3),
    'valid': ('valid', 'אפשרות תקינה', 2),
    'warning': ('warning', 'אפשרות עם אזהרות', 1),
    'conflict': ('unavailable', 'לא זמין', 0),
}


def _reason(code):
    return {'code': code, 'label': REASON_LABELS[code]}


# Assisted Allocation's own 3-tier classification (find_matching_room_options
# assisted_mode=True) - distinct from the 5-level recommendation_level/
# match_level scheme above, which stays unchanged for the Students/Transfers
# pages that also call find_matching_room_options. 'possible' covers what
# match_level calls 'valid' and 'warning' (a soft, non-blocking mismatch -
# e.g. sector/year-mix - is still a directly assignable candidate, just a
# lower-ranked one); 'override_required' is its own tier because that bed is
# NOT directly assignable - it requires the explicit override flow.
ASSISTED_STATUS_LABELS = {
    'recommended': 'מומלץ',
    'possible': 'אפשרי',
    'override_required': 'דורש חריגה',
}
ASSISTED_STATUS_SORT_RANK = {'recommended': 0, 'possible': 1, 'override_required': 2}

MAX_CONFLICT_EXAMPLES = 5
MAX_CONFLICT_BUFFER = 50
# Rooms whose only problem is "no free bed" are a far more useful diagnostic
# sample than rooms that are also the wrong gender/housing type for this
# student - a female student looking at "male apartment 1 is full" learns
# nothing. _conflict_priority ranks type/gender-mismatched rooms last so the
# sample favors "same category as the student, just full" whenever any exist.
_TYPE_OR_GENDER_MISMATCH_REASONS = {
    'אי-התאמת סוג הדירה לסוג הדיור של הסטודנט',
    'אי-התאמת מגדר/קטגוריית הדירה',
    'לסטודנט אין סוג דיור נתמך לשיבוץ',
    'הדירה שמורה בלעדית לדייר/ת בשיבוץ רווקים/ות בדירה',
    'נדרשת דירת זוגות עבור שיבוץ מסוג רווקים/ות בדירה',
}


def _conflict_priority(conflicts):
    has_type_or_gender_mismatch = any(c in _TYPE_OR_GENDER_MISMATCH_REASONS for c in conflicts)
    return (has_type_or_gender_mismatch, len(conflicts))


def _classify_match_level(score, warnings, conflicts, is_empty=False):
    """Single source of truth for match_level, used both when tallying
    filter-chip counts over every valid bed and when building the display
    dict for the handful actually returned - keeps the two in sync.

    'empty' is its own top-level category (a zero-resident apartment carries
    no compatibility risk at all - safer than any occupied "best_match")
    rather than folding into 'best_match' as before, where a plain empty
    apartment with no other bonus (no roommate/city/priority match) scored
    exactly 65 - below BEST_MATCH_SCORE_THRESHOLD - and was silently
    downgraded to 'valid'."""
    if conflicts:
        return 'conflict'
    if is_empty:
        return 'empty'
    if score >= BEST_MATCH_SCORE_THRESHOLD and not warnings:
        return 'best_match'
    if warnings:
        return 'warning'
    return 'valid'


def _student_assignment_blocker(student):
    """
    Single student-level reason this student cannot be matched to *any*
    room at all, checked once before scanning candidate rooms. Without this,
    a student missing housing_type/region would have the exact same
    conflict reason repeated on every single candidate room in the result
    set (e.g. hundreds of rows all saying "no supported housing type") -
    this returns one (field, message) pair instead so the caller can show a
    single blocking message.
    """
    if student.category == Student.StudentCategory.LEAVING:
        return 'category', 'הסטודנט/ית בקטגוריית עוזבים ואינו/ה זכאי/ת לשיבוץ.'
    if not student.housing_type or student.housing_type not in Student.HousingType.values:
        return 'housing_type', 'לא ניתן לבצע שיבוץ: חסר סוג דיור בפרטי הסטודנט.'
    if not student.accepted_dorm_type_id:
        return 'region', 'לא ניתן לבצע שיבוץ: חסר אזור/סוג מעונות בפרטי הסטודנט.'
    return None


def _room_conflicts(student, room, apartment, residents, available_beds):
    """
    Hard-constraint (CONFLICT) reasons for a candidate room, computed only
    from already-fetched data - no DB queries. Mirrors
    validate_apartment_assignment's policy via the shared _z_compatibility
    table so the two never drift apart, but returns every violation reason
    instead of raising on the first one, since the matching engine has to
    classify every candidate room, not just validate a single chosen one.
    """
    reasons = []

    if not room.is_active:
        reasons.append('החדר אינו פעיל')
    if not apartment.is_active:
        reason = apartment.get_inactive_reason_display() if apartment.inactive_reason else 'לא פעילה'
        reasons.append(f'הדירה אינה פעילה ({reason})')
    if not apartment.building.is_active:
        reasons.append('הבניין אינו פעיל')

    if available_beds <= 0:
        reasons.append('אין מיטות פנויות בחדר - תפוסה מלאה')

    other_residents = [r for r in residents if r['id'] != getattr(student, 'id', None)]

    if student.housing_type == Student.HousingType.SINGLE_IN_APARTMENT:
        if apartment.apartment_type != Apartment.ApartmentType.COUPLE:
            reasons.append('נדרשת דירת זוגות עבור שיבוץ מסוג רווקים/ות בדירה')
        if other_residents:
            reasons.append('הדירה תפוסה - נדרשת דירה ריקה לחלוטין')
        return reasons

    if any(r['housing_type'] == Student.HousingType.SINGLE_IN_APARTMENT for r in other_residents):
        reasons.append('הדירה שמורה בלעדית לדייר/ת בשיבוץ רווקים/ות בדירה')

    expected = _z_compatibility(student.housing_type)
    if expected is None:
        reasons.append('לסטודנט אין סוג דיור נתמך לשיבוץ')
    else:
        from allocation.solver import _effective_apartment_category

        expected_type, expected_category = expected
        if apartment.apartment_type != expected_type:
            reasons.append('אי-התאמת סוג הדירה לסוג הדיור של הסטודנט')
        # Effective category: a building-wide gender_restriction (shared-
        # facility buildings) overrides a possibly wrong/conflicting
        # individual apartment category - mirrors
        # allocation.manual_placement.evaluate_manual_override so browsing
        # and the override-confirmation dialog never disagree about which
        # rooms are gender-compatible.
        if _effective_apartment_category(apartment) != expected_category:
            reasons.append('אי-התאמת מגדר/קטגוריית הדירה')

    return reasons


def _room_candidate_queryset(user, region_id=None, region_ids=None):
    """
    Region-scoped, active-only candidate rooms. `region_id` (single) or
    `region_ids` (cross-region transfer: one or more destination regions)
    let a central admin explicitly target regions; a regional user is
    always confined to their own region regardless of what is passed in,
    so a client can never widen its own scope by sending region ids.
    """
    queryset = Room.objects.select_related(
        'apartment',
        'apartment__building',
        'apartment__building__dorm_type',
        'apartment__building__dorm_type__region',
    ).filter(
        is_active=True,
        apartment__is_active=True,
        apartment__building__is_active=True,
    )

    if user.is_central_admin:
        if region_ids:
            queryset = queryset.filter(apartment__building__dorm_type__region_id__in=region_ids)
        elif region_id:
            queryset = queryset.filter(apartment__building__dorm_type__region_id=region_id)
    else:
        if not user.region_id:
            return queryset.none()
        queryset = queryset.filter(apartment__building__dorm_type__region_id=user.region_id)

    return queryset


def find_matching_room_options(
    user, student=None, student_data=None, same_apartment=None,
    region_id=None, region_ids=None, limit=10, offset=0, explain_conflicts_if_empty=True,
    assisted_mode=False,
):
    """
    Real, currently-available placement options for a student (existing, or
    a not-yet-created student described by student_data), returned as a
    building-paged hierarchy:

        buildings[] -> apartments[] -> rooms[] -> beds[]

    This is the single reusable matching service - assign, reassign,
    room/apartment requests and add-student allocation all call this instead
    of re-implementing matching logic.

    READ-ONLY GUARANTEE: browsing/matching never writes to the database.
    Only real, existing Bed rows are ever offered as selectable; a room
    whose configured capacity says "free" but that has no free real Bed row
    contributes zero selectable beds and is reported under `data_integrity`
    in the response instead of triggering any row creation. Materializing
    Bed rows from room capacity is an explicit, admin-only operation
    (manage.py materialize_beds) and is never run from here.

    PAGINATION UNIT IS THE BUILDING (by primary key, never by the reusable
    building *number*): `offset`/`limit` count buildings, and every building
    on the returned page carries its complete apartment/room/bed subtree, so
    the client can always expand exactly what it received - there are no
    partial parents. Buildings are ordered by their best apartment's
    (roommate_tier, score); the tier implements the required roommate
    ranking lexicographically, so no combination of soft preferences can
    ever outrank a higher roommate tier:

        3 - mutual roommate request, roommate already assigned here
        2 - one-sided roommate request, roommate already assigned here
        1 - mutual roommate request, roommate unassigned anywhere, and this
            apartment has free capacity for both students
        0 - no roommate signal (score refines: preferred dormitory, then
            the other soft preferences)

    Hard constraints (gender/housing type/capacity/active flags/region
    scoping via the queryset) always exclude a room entirely - they are
    never outrankable by any preference.

    Occupancy is always computed from the real active BedAssignment rows
    (never from the Room record alone), so a two-bed room with one occupied
    bed is "one free", not "full", and only the actually-free bed is
    selectable.

    The numeric score is internal plumbing only - the response never
    contains a score or percentage, only recommendation_level/label (fixed
    tiers) plus matched_reasons/warnings/historical_reasons as {code,label}
    pairs.

    assisted_mode: used only by the Assisted Allocation workbench
    (assisted_allocation_recommendations). When True:
      - candidates are hard-restricted to the student's own
        accepted_dorm_type (never merely the region) - staying inside the
        dorm type the student was actually accepted to is a business rule,
        not a preference, so it is enforced unconditionally here (including
        for is_priority students - unlike the automatic solver's own
        _should_enforce_accepted_dorm_type bypass, which is intentionally
        left untouched for automatic runs). A student with no
        accepted_dorm_type_id yields zero candidates rather than an
        unrestricted region-wide scan.
      - each apartment additionally carries assisted_status
        ('recommended' | 'possible' | 'override_required') and
        override_violations - the same {code,label,overridable,consequence}
        shape allocation.manual_placement.evaluate_manual_override returns,
        computed from the residents/data already fetched here (no extra
        queries) so a bed needing a documented override is visibly
        distinguished from a normal recommendation instead of only
        surfacing at assign-time.
    """
    student_data = student_data or {}
    current_room = None

    if student is not None and student.pk:
        current_room = student.assigned_room
    elif student is None:
        student = Student(
            gender=student_data.get('gender') or '',
            housing_type=student_data.get('housing_type') or _infer_housing_type(student_data),
            requested_religion=(
                student_data.get('requested_religion')
                or student_data.get('religion')
                or Student.Religion.NOT_SPECIFIED
            ),
            city=student_data.get('city', ''),
            is_priority=bool(student_data.get('is_priority')),
        )

    current_apartment_id = current_room.apartment_id if current_room else None

    rooms_qs = _room_candidate_queryset(user, region_id=region_id, region_ids=region_ids)
    if current_room:
        rooms_qs = rooms_qs.exclude(id=current_room.id)
    if same_apartment is True and current_apartment_id:
        rooms_qs = rooms_qs.filter(apartment_id=current_apartment_id)
    elif same_apartment is False and current_apartment_id:
        rooms_qs = rooms_qs.exclude(apartment_id=current_apartment_id)

    if assisted_mode:
        accepted_dorm_type_id = getattr(student, 'accepted_dorm_type_id', None)
        if not accepted_dorm_type_id:
            rooms_qs = rooms_qs.none()
        else:
            rooms_qs = rooms_qs.filter(apartment__building__dorm_type_id=accepted_dorm_type_id)

    rooms = list(rooms_qs.prefetch_related('beds'))  # query #1 (Room + select_related chain), query #2 (beds prefetch)
    apartment_ids = {r.apartment_id for r in rooms}

    resident_assignments = BedAssignment.objects.filter(
        status=BedAssignment.Status.ACTIVE,
        bed__room__apartment_id__in=apartment_ids,
    ).select_related('student', 'bed__room')  # query #3 - every resident of every candidate apartment, in one shot

    residents_by_apartment = defaultdict(list)
    occupied_bed_ids_by_room = defaultdict(set)
    occupant_name_by_bed_id = {}
    for a in resident_assignments:
        occupied_bed_ids_by_room[a.bed.room_id].add(a.bed_id)
        rs = a.student
        occupant_name_by_bed_id[a.bed_id] = rs.full_name
        rs_roommate_ids = {
            rs.roommate_request_student_id_1, rs.roommate_request_student_id_2,
            rs.roommate_request_student_id_3, rs.roommate_request_student_id_4,
            rs.roommate_request_student_id_5,
        }
        rs_roommate_ids.discard(''); rs_roommate_ids.discard(None)
        residents_by_apartment[a.bed.room.apartment_id].append({
            'id': rs.id,
            'student_id': rs.student_id,
            'full_name': rs.full_name,
            'city': rs.city,
            'religion': rs.requested_religion,
            'religion_display': rs.get_requested_religion_display(),
            'religious': rs.religious,
            'placement_sector': rs.placement_sector,
            'sector_display': rs.get_placement_sector_display(),
            'study_points': rs.study_points,
            'housing_type': rs.housing_type,
            'roommate_ids': rs_roommate_ids,
            'room_name': a.bed.room.name,
        })

    roommate_ids = {
        student_data.get('roommate_request_student_id_1'),
        getattr(student, 'roommate_request_student_id_1', None),
        getattr(student, 'roommate_request_student_id_2', None),
        getattr(student, 'roommate_request_student_id_3', None),
        getattr(student, 'roommate_request_student_id_4', None),
        getattr(student, 'roommate_request_student_id_5', None),
    }
    roommate_ids.discard(None)
    roommate_ids.discard('')
    student_own_id = getattr(student, 'student_id', None)
    student_city = (student.city or '').strip().lower()
    student_group = _religion_group(student.requested_religion)
    student_sector = _sector_group(getattr(student, 'placement_sector', None))
    student_year_group = _year_group(getattr(student, 'study_points', None))
    history = _student_transfer_history(student)
    preferred_dorm_type_id = getattr(student, 'accepted_dorm_type_id', None)

    # Ranking case "mutual request + capacity for both" requires knowing
    # whether an UNASSIGNED requested roommate requested this student back -
    # their stored lists are fetched once (bounded: at most 5 ids).
    requested_roommate_lists = {}
    if roommate_ids:
        for rm in Student.objects.filter(student_id__in=roommate_ids):  # query #4 (<=5 rows)
            ids = {
                rm.roommate_request_student_id_1, rm.roommate_request_student_id_2,
                rm.roommate_request_student_id_3, rm.roommate_request_student_id_4,
                rm.roommate_request_student_id_5,
            }
            ids.discard(None); ids.discard('')
            requested_roommate_lists[rm.student_id] = ids

    assigned_requested_roommate_ids = {
        r['student_id']
        for residents in residents_by_apartment.values()
        for r in residents
        if r['student_id'] in roommate_ids
    }
    has_unassigned_mutual_roommate = bool(student_own_id) and any(
        rm_id not in assigned_requested_roommate_ids and student_own_id in their_ids
        for rm_id, their_ids in requested_roommate_lists.items()
    )

    apartment_dorm_type_ids = {}
    for room in rooms:
        apartment_dorm_type_ids[room.apartment_id] = room.apartment.building.dorm_type_id

    def _score_apartment(apartment_id, other_residents, apartment_free_selectable):
        """
        One score per APARTMENT - all rooms in an apartment share the same
        residents, hence the same warnings/reasons/score. Returns
        (roommate_tier, score, warnings, matched_preferences, historical).
        The tier ranks the roommate cases lexicographically; the score only
        refines ordering within a tier and picks the recommendation level.
        Neither is ever exposed to the client as a number.
        """
        warnings = []
        matched_preferences = []
        historical_reasons = []
        score = MATCH_SCORE_WEIGHTS['base']
        tier = 0

        mutual = one_sided = False
        for r in other_residents:
            if r['student_id'] in roommate_ids:
                one_sided = True
                if student_own_id and student_own_id in r.get('roommate_ids', set()):
                    mutual = True
        if mutual:
            tier = 3
            score += MATCH_SCORE_WEIGHTS['roommate_match_mutual']
            matched_preferences.append(_reason('mutual_roommate_request'))
            matched_preferences.append(_reason('roommate_already_here'))
        elif one_sided:
            tier = 2
            score += MATCH_SCORE_WEIGHTS['roommate_match_one_sided']
            matched_preferences.append(_reason('roommate_already_here'))
        elif has_unassigned_mutual_roommate and apartment_free_selectable >= 2:
            # Mutual request, roommate not assigned anywhere yet, and this
            # apartment really has two free REAL beds - both students fit.
            tier = 1
            score += MATCH_SCORE_WEIGHTS['roommate_future_capacity']
            matched_preferences.append(_reason('roommate_future_capacity'))

        if preferred_dorm_type_id and apartment_dorm_type_ids.get(apartment_id) == preferred_dorm_type_id:
            # The dormitory the student was accepted to is their explicit
            # dormitory preference - ranks above the remaining soft
            # preferences but below every roommate tier.
            score += MATCH_SCORE_WEIGHTS['preferred_dormitory']
            matched_preferences.append(_reason('preferred_dormitory'))

        if not other_residents:
            score += MATCH_SCORE_WEIGHTS['empty_apartment']
            matched_preferences.append(_reason('empty_apartment'))
        else:
            if student_group != 'unknown':
                mismatch = any(_religion_group(r['religion']) not in (student_group, 'unknown') for r in other_residents)
                if mismatch:
                    warnings.append(_reason('religion_conflict'))
                    score += MATCH_SCORE_WEIGHTS['religion_conflict_penalty']
                else:
                    score += MATCH_SCORE_WEIGHTS['religion_compatible']
                    matched_preferences.append(_reason('religion_match'))

            # sectorMatching - a coarser, separately-maintained placement
            # field (staff may set it even when requested_religion is
            # blank), so it is its own warning rather than reusing the
            # religion-group check above.
            if student_sector != 'unknown':
                sector_mismatch = any(
                    _sector_group(r['placement_sector']) not in (student_sector, 'unknown')
                    for r in other_residents
                )
                if sector_mismatch:
                    warnings.append(_reason('sector_conflict'))
                    score += MATCH_SCORE_WEIGHTS['sector_conflict_penalty']
                else:
                    score += MATCH_SCORE_WEIGHTS['sector_compatible']
                    matched_preferences.append(_reason('sector_match'))

            # avoidYearMix - flag only the specific year1-with-year3_4
            # combination (mirrors the solver); "other"/unknown academic
            # standing never triggers this warning.
            if student_year_group in ('year1', 'year3_4'):
                year_mismatch = any(
                    {_year_group(r['study_points']), student_year_group} == {'year1', 'year3_4'}
                    for r in other_residents
                )
                if year_mismatch:
                    warnings.append(_reason('year_mix_conflict'))
                    score += MATCH_SCORE_WEIGHTS['year_mix_penalty']

        if student_city and any((r['city'] or '').strip().lower() == student_city for r in other_residents):
            score += MATCH_SCORE_WEIGHTS['city_match']
            matched_preferences.append(_reason('city_match'))

        if getattr(student, 'is_priority', False):
            score += MATCH_SCORE_WEIGHTS['priority_student_bonus']
            matched_preferences.append(_reason('priority_student'))

        # Real stored history only (Transfer records) - never invented, and
        # never based on identity/behavior unrelated to housing requests.
        dorm_type_id = apartment_dorm_type_ids.get(apartment_id)
        if dorm_type_id:
            if dorm_type_id in history['requested_to']:
                score += MATCH_SCORE_WEIGHTS['history_bonus']
                historical_reasons.append(_reason('previously_requested_dormitory'))
            if dorm_type_id in history['requested_away_from']:
                historical_reasons.append(_reason('previously_transferred_away'))

        return tier, max(0, min(100, score)), warnings, matched_preferences, historical_reasons

    def _public_residents(other_residents):
        # roommate_ids is internal matching detail (a set, and other
        # students' private request lists) - never serialized to the client.
        # religious (observance level) is internal matching detail used only
        # to compute religion_conflict/override_violations server-side.
        _internal_keys = {'roommate_ids', 'religious'}
        return [{k: v for k, v in r.items() if k not in _internal_keys} for r in other_residents]

    # ---- pass 1: hard constraints + real-bed availability per room -------
    valid_rooms_by_apartment = defaultdict(list)
    conflict_rooms = []  # (room, apartment, residents, capacity_free, conflicts)
    apartment_selectable_free = defaultdict(int)
    integrity_rooms_missing = 0
    integrity_missing_beds = 0
    integrity_rooms_extra = 0

    for room in rooms:
        apartment = room.apartment
        occupied_ids = occupied_bed_ids_by_room.get(room.id, set())
        occupied_count = len(occupied_ids)
        capacity_free = max(room.capacity - occupied_count, 0)
        residents = residents_by_apartment.get(apartment.id, [])
        conflicts = _room_conflicts(student, room, apartment, residents, capacity_free)

        if conflicts:
            # Hard-conflict rooms are never part of the normal result set.
            # They are only surfaced (disabled, clearly marked) as a short
            # explanation when there is nothing valid to show at all.
            if explain_conflicts_if_empty and len(conflict_rooms) < MAX_CONFLICT_BUFFER:
                conflict_rooms.append((room, apartment, residents, capacity_free, conflicts))
            continue

        real_beds = sorted(room.beds.all(), key=lambda b: b.id)  # from the prefetch - no query
        free_real = [b for b in real_beds if b.id not in occupied_ids]
        # Never offer more beds than the room's configured capacity allows,
        # and never offer a bed that does not exist as a real row.
        selectable = free_real[:capacity_free]
        selectable_ids = {b.id for b in selectable}
        missing = max(capacity_free - len(free_real), 0)
        if missing:
            integrity_rooms_missing += 1
            integrity_missing_beds += missing
        if len(free_real) > len(selectable):
            integrity_rooms_extra += 1

        apartment_selectable_free[apartment.id] += len(selectable)
        valid_rooms_by_apartment[apartment.id].append({
            'room': room,
            'occupied_ids': occupied_ids,
            'occupied_count': occupied_count,
            'capacity_free': capacity_free,
            'real_beds': real_beds,
            'selectable_ids': selectable_ids,
            'missing': missing,
        })

    # ---- pass 2: score each apartment once, aggregate into buildings -----
    buildings_by_id = {}
    level_counts = {'best_match': 0, 'empty': 0, 'valid': 0, 'warning': 0, 'conflict': 0}
    assisted_status_counts = {'recommended': 0, 'possible': 0, 'override_required': 0}
    fully_empty_count = 0
    roommate_match_count = 0
    total_apartments = 0
    total_rooms = 0
    total_valid_beds = 0

    if assisted_mode:
        from types import SimpleNamespace

        from allocation.manual_placement import (
            OVERRIDE_VIOLATION_CONSEQUENCE, religion_conflict_for_candidate,
        )
        from allocation.solver import _get_student_priority, _has_anier_special_status

    for apartment_id, room_entries in valid_rooms_by_apartment.items():
        apartment = room_entries[0]['room'].apartment
        building = apartment.building
        residents = residents_by_apartment.get(apartment_id, [])
        other_residents = [r for r in residents if r['id'] != getattr(student, 'id', None)]
        apt_selectable = apartment_selectable_free.get(apartment_id, 0)

        tier, score, warnings, matched_preferences, historical_reasons = _score_apartment(
            apartment_id, other_residents, apt_selectable
        )
        is_empty = not other_residents
        match_level = _classify_match_level(score, warnings, [], is_empty=is_empty)
        rec_level, rec_label, rec_rank = RECOMMENDATION_LEVEL_MAP[match_level]

        level_counts[match_level] += apt_selectable
        if is_empty:
            fully_empty_count += apt_selectable
        if tier >= 2:
            roommate_match_count += apt_selectable

        override_violations = []
        if assisted_mode:
            # preferred_dormitory is guaranteed true for every candidate here
            # (the queryset is already hard-restricted to the accepted dorm
            # type) - showing it on every single card would be redundant,
            # not informative.
            matched_preferences = [r for r in matched_preferences if r['code'] != 'preferred_dormitory']

            resident_ns = [
                SimpleNamespace(requested_religion=r['religion'], religious=r.get('religious', ''))
                for r in other_residents
            ]
            if religion_conflict_for_candidate(student, resident_ns):
                override_violations.append({
                    'code': 'religion', 'label': 'אין התאמה דתית לדיירים הקיימים',
                    'overridable': True, 'consequence': OVERRIDE_VIOLATION_CONSEQUENCE['religion'],
                })
                # Superseded by the precise violation above - the coarser
                # group-level warning would just repeat the same fact with
                # different wording.
                warnings = [w for w in warnings if w['code'] != 'religion_conflict']
            if apartment.inactive_reason == Apartment.InactiveReason.RESERVED and not (
                _get_student_priority(student) or _has_anier_special_status(student)
            ):
                override_violations.append({
                    'code': 'reserved', 'label': 'הדירה שמורה',
                    'overridable': True, 'consequence': OVERRIDE_VIOLATION_CONSEQUENCE['reserved'],
                })

            if override_violations:
                assisted_status = 'override_required'
            elif match_level in ('best_match', 'empty'):
                assisted_status = 'recommended'
            else:
                assisted_status = 'possible'
            assisted_status_label = ASSISTED_STATUS_LABELS[assisted_status]

        rooms_payload = []
        apt_capacity_free = 0
        apt_missing = 0
        for entry in sorted(room_entries, key=lambda e: str(e['room'].name)):
            room = entry['room']
            apt_capacity_free += entry['capacity_free']
            apt_missing += entry['missing']
            rooms_payload.append({
                'room_id': room.id,
                'room_name': room.name,
                'capacity': room.capacity,
                'occupied_beds_count': entry['occupied_count'],
                'available_beds_count': len(entry['selectable_ids']),
                'capacity_free_count': entry['capacity_free'],
                'missing_bed_records': entry['missing'],
                'beds': [
                    {
                        'bed_id': b.id,
                        'bed_label': b.label,
                        'is_occupied': b.id in entry['occupied_ids'],
                        'occupant_name': occupant_name_by_bed_id.get(b.id),
                        'is_selectable': b.id in entry['selectable_ids'],
                    }
                    for b in entry['real_beds']
                ],
            })

        apartment_payload = {
            'apartment_id': apartment.id,
            'apartment_number': apartment.number,
            'apartment_gender': apartment.category,
            'apartment_type': apartment.apartment_type,
            'residents': _public_residents(other_residents),
            'match_level': match_level,
            'recommendation_level': rec_level,
            'recommendation_label': rec_label,
            'recommendation_rank': rec_rank,
            'matched_reasons': matched_preferences,
            'warnings': warnings,
            'historical_reasons': historical_reasons,
            'available_bed_count': apt_selectable,
            'capacity_free_count': apt_capacity_free,
            'missing_bed_records': apt_missing,
            'room_count': len(rooms_payload),
            'has_roommate_match': tier >= 2,
            'rooms': rooms_payload,
            '_sort_key': (-tier, -score, -rec_rank, str(apartment.number)),
        }
        if assisted_mode:
            apartment_payload['assisted_status'] = assisted_status
            apartment_payload['assisted_status_label'] = assisted_status_label
            apartment_payload['override_violations'] = override_violations
            # Status always outranks score: an override-required apartment
            # must never sort above a plain recommended/possible one just
            # because a roommate match happens to raise its score.
            apartment_payload['_sort_key'] = (
                ASSISTED_STATUS_SORT_RANK[assisted_status], -tier, -score, -rec_rank, str(apartment.number),
            )

        b = buildings_by_id.get(building.id)
        if b is None:
            dorm_type = building.dorm_type
            region = dorm_type.region if dorm_type else None
            b = buildings_by_id[building.id] = {
                'building_id': building.id,
                'building_number': building.number,
                'building_name': (
                    f'בניין {building.number}' if building.number is not None
                    else f'בניין (מזהה {building.id})'
                ),
                'region': region.id if region else None,
                'region_name': region.name if region else None,
                'dorm_type': dorm_type.name if dorm_type else None,
                'dorm_type_id': dorm_type.id if dorm_type else None,
                'apartment_count': 0,
                'room_count': 0,
                'available_bed_count': 0,
                'capacity_free_count': 0,
                'missing_bed_records': 0,
                'recommendation_level': rec_level,
                'recommendation_label': rec_label,
                'recommendation_rank': rec_rank,
                'has_roommate_match': False,
                'top_reasons': [],
                'recommended_bed_count': 0,
                'roommate_bed_count': 0,
                'warning_free_bed_count': 0,
                'apartments': [],
                # Sentinel guaranteed lower than any real apt_key so the
                # first apartment always wins the update below. Assisted
                # mode's apt_key leads with -ASSISTED_STATUS_SORT_RANK
                # (0 down to -2), so a plain (-1, -1) is NOT low enough - an
                # override_required-only building's rank (-2) would never
                # beat it and _best_key would stay a 2-tuple, breaking the
                # 3-tuple sort key read below.
                '_best_key': (-1, -1) if not assisted_mode else (-999, -1, -1),
            }
            if assisted_mode:
                b['assisted_status'] = assisted_status
                b['assisted_status_label'] = assisted_status_label
                b['assisted_counts'] = {'recommended': 0, 'possible': 0, 'override_required': 0}

        b['apartment_count'] += 1
        b['room_count'] += len(rooms_payload)
        b['available_bed_count'] += apt_selectable
        b['capacity_free_count'] += apt_capacity_free
        b['missing_bed_records'] += apt_missing
        b['has_roommate_match'] = b['has_roommate_match'] or tier >= 2
        if match_level in ('best_match', 'empty'):
            b['recommended_bed_count'] += apt_selectable
        if tier >= 2:
            b['roommate_bed_count'] += apt_selectable
        if match_level in ('best_match', 'empty', 'valid'):
            b['warning_free_bed_count'] += apt_selectable
        b['apartments'].append(apartment_payload)
        if assisted_mode:
            b['assisted_counts'][assisted_status] += apt_selectable
            assisted_status_counts[assisted_status] += apt_selectable

        apt_key = (-ASSISTED_STATUS_SORT_RANK[assisted_status], tier, score) if assisted_mode else (tier, score)
        if apt_key > tuple(b['_best_key']):
            b['_best_key'] = apt_key
            b['recommendation_level'] = rec_level
            b['recommendation_label'] = rec_label
            b['recommendation_rank'] = rec_rank
            b['top_reasons'] = matched_preferences[:3]
            if assisted_mode:
                b['assisted_status'] = assisted_status
                b['assisted_status_label'] = assisted_status_label

        total_apartments += 1
        total_rooms += len(rooms_payload)
        total_valid_beds += apt_selectable

    # Distinct-PK totals by construction: buildings_by_id is keyed by
    # Building.pk, and each apartment/room is visited exactly once.
    ordered_buildings = sorted(
        buildings_by_id.values(),
        key=lambda b: (
            -b['_best_key'][0], -b['_best_key'][1],
            b['building_number'] if b['building_number'] is not None else 10 ** 9,
            b['building_id'],
        ) if not assisted_mode else (
            -b['_best_key'][0], -b['_best_key'][1], -b['_best_key'][2],
            b['building_number'] if b['building_number'] is not None else 10 ** 9,
            b['building_id'],
        ),
    )

    total_buildings = len(ordered_buildings)
    if limit:
        page_buildings = ordered_buildings[offset:offset + limit]
    else:
        page_buildings = ordered_buildings[offset:]
    loaded_buildings = offset + len(page_buildings)
    has_more = loaded_buildings < total_buildings
    next_offset = loaded_buildings if has_more else None

    for b in page_buildings:
        b['apartments'].sort(key=lambda a: a['_sort_key'])
        for a in b['apartments']:
            a.pop('_sort_key', None)
        b.pop('_best_key', None)

    conflict_examples = []
    if not buildings_by_id and explain_conflicts_if_empty:
        # Rank so the sample favors rooms that match the student's own
        # housing type/gender and are merely full, over rooms rejected for
        # an unrelated reason (e.g. wrong gender).
        conflict_rooms.sort(key=lambda t: _conflict_priority(t[4]))
        expected = _z_compatibility(student.housing_type)
        for room, apartment, residents, capacity_free, conflicts in conflict_rooms[:MAX_CONFLICT_EXAMPLES]:
            other_residents = [r for r in residents if r['id'] != getattr(student, 'id', None)]
            _tier, _score, warnings, matched_preferences, historical_reasons = _score_apartment(
                apartment.id, other_residents, apartment_selectable_free.get(apartment.id, 0)
            )
            # A requested roommate who does live in this exact apartment,
            # but the apartment itself hard-fails one of the student's own
            # constraints - say so explicitly instead of silently going
            # quiet about why "the roommate's apartment" isn't recommended.
            if roommate_ids and any(r['student_id'] in roommate_ids for r in other_residents):
                conflicts = conflicts + [REASON_LABELS['roommate_incompatible_hard_rule']]
            conflict_examples.append({
                'building': apartment.building.number,
                'building_id': apartment.building_id,
                'apartment': apartment.number,
                'apartment_id': apartment.id,
                'room': room.name,
                'room_id': room.id,
                'region_name': (
                    apartment.building.dorm_type.region.name
                    if apartment.building.dorm_type and apartment.building.dorm_type.region else None
                ),
                'conflicts': conflicts,
                'warnings': warnings,
                'matched_reasons': matched_preferences,
                'historical_reasons': historical_reasons,
                'residents': _public_residents(other_residents),
                'diagnostic': {
                    'student_housing_type': student.housing_type,
                    'student_housing_type_display': student.get_housing_type_display() if student.housing_type else None,
                    'required_apartment_type': expected[0] if expected else None,
                    'required_apartment_category': expected[1] if expected else None,
                    'room_apartment_type': apartment.apartment_type,
                    'room_apartment_category': apartment.category,
                    'room_capacity': room.capacity,
                    'bed_record_count': len(room.beds.all()),
                    'active_assignment_count': len(occupied_bed_ids_by_room.get(room.id, set())),
                    'available_beds_calculated': capacity_free,
                    'failed_hard_constraints': conflicts,
                },
            })

    return {
        'buildings': page_buildings,
        'loaded_buildings': loaded_buildings,
        'total_buildings': total_buildings,
        'total_apartments': total_apartments,
        'total_rooms': total_rooms,
        'total_valid_beds': total_valid_beds,
        # Legacy alias: 'total_valid' has always meant "free beds" - kept so
        # existing readers keep working while they migrate to the explicit
        # 'total_valid_beds'.
        'total_valid': total_valid_beds,
        'limit': limit,
        'offset': offset,
        'has_more': has_more,
        'next_offset': next_offset,
        'conflict_examples': conflict_examples,
        # Real, exact counts per filter chip, computed over every SELECTABLE
        # bed (real Bed rows only) - never approximated from just one page.
        'counts': {
            'all': total_valid_beds,
            'best_match': level_counts['best_match'],
            'empty': level_counts['empty'],
            'warning_free': level_counts['best_match'] + level_counts['empty'] + level_counts['valid'],
            'with_warnings': level_counts['warning'],
            'with_roommate': roommate_match_count,
            'fully_empty': fully_empty_count,
        },
        # Rooms whose configured capacity exceeds their real Bed rows (or
        # vice versa). Reported, never silently "fixed" - materializing
        # missing rows is manage.py materialize_beds, an explicit admin
        # operation.
        'data_integrity': {
            'rooms_missing_bed_records': integrity_rooms_missing,
            'missing_bed_records': integrity_missing_beds,
            'rooms_with_extra_bed_records': integrity_rooms_extra,
        },
        **({'assisted_status_counts': assisted_status_counts} if assisted_mode else {}),
    }


def _create_student_from_request_data(data):
    """
    G2-02 note: the exists()-then-create() below is still a check-then-act
    shape - two concurrent ADD_STUDENT approvals proposing the same new
    student_id can both pass this exists() check before either commits.
    That race is intentionally NOT closed here with a lock (there is no
    row to lock - the student doesn't exist yet); Student.student_id's
    real DB-level unique=True constraint is the actual backstop, and the
    resulting IntegrityError from student.save() below is caught by the
    caller (StudentRequestViewSet.approve()'s except IntegrityError
    clause) and converted into a clean 4xx - see
    project-quality/concurrency/GROUP2_CONCURRENCY_LOAD_IMPLEMENTATION_REPORT.md.
    """
    if not data:
        raise ValueError('לא סופקו פרטי סטודנט חדש עבור בקשה זו.')

    required = ['student_id', 'first_name', 'last_name', 'gender']
    missing = [f for f in required if not data.get(f)]
    if missing:
        raise ValueError(f"חסרים שדות חובה עבור סטודנט חדש: {', '.join(missing)}")

    if Student.objects.filter(student_id=data['student_id']).exists():
        raise ValueError(f"סטודנט עם ת.ז {data['student_id']} כבר קיים במערכת.")

    student = Student(
        student_id=data['student_id'],
        first_name=data['first_name'],
        last_name=data['last_name'],
        email=data.get('email', ''),
        phone=data.get('phone', ''),
        city=data.get('city', ''),
        gender=data.get('gender'),
        requested_religion=data.get('requested_religion') or data.get('religion') or Student.Religion.NOT_SPECIFIED,
        housing_type=data.get('housing_type') or _infer_housing_type(data),
        category=Student.StudentCategory.NEW,
    )
    student.full_clean()
    student.save()
    return student


def _user_can_review_request(user, req):
    if user.is_central_admin:
        return True
    if not user.is_boss or not user.region_id:
        return False

    # region_transfer is reviewed/approved by the DESTINATION region, not
    # wherever the student currently lives: the destination region owns the
    # incoming-placement decision (it has the inventory, checks
    # availability, and either accepts or declines the student). This is
    # the opposite of every other request type below, where "the region"
    # is the student's own/target room's region - deliberately checked
    # FIRST and separately so a region_transfer never falls through to the
    # generic accepted_dorm_type branch (which would incorrectly grant the
    # SOURCE region review authority over its own outgoing request).
    if req.request_type == StudentRequest.RequestType.REGION_TRANSFER:
        return bool(req.target_region_id) and req.target_region_id == user.region_id

    if req.student_id and req.student.accepted_dorm_type_id:
        return req.student.accepted_dorm_type.region_id == user.region_id

    if req.target_room_id:
        region = _room_region(req.target_room)
        return bool(region) and region.id == user.region_id

    # New add_student requests with no student/target room assigned yet:
    # any boss may review, region is enforced once a target room is chosen.
    return True


def _user_can_cancel_request(user, req):
    """
    Non-requester fallback authority for StudentRequestViewSet.cancel().

    Withdrawal is a SOURCE-side decision (the requesting side changing its
    mind before anyone reviews it) - deliberately NOT the same population
    as _user_can_review_request(), which for region_transfer now means the
    DESTINATION region (they own approve/reject, see above). A source-
    region boss must still be able to withdraw a transfer their own region
    asked for, even though they can no longer approve/reject it themselves.
    For every other request type this is identical to review authority -
    there is no separate source/destination split to preserve.
    """
    if user.is_central_admin:
        return True
    if not user.is_boss or not user.region_id:
        return False
    if req.request_type == StudentRequest.RequestType.REGION_TRANSFER:
        source_id = req.source_region_id or _student_current_region_id(req.student)
        return bool(source_id) and source_id == user.region_id
    return _user_can_review_request(user, req)


def _student_current_region_id(student):
    """
    The region the student physically lives in RIGHT NOW (their assigned
    room's region), falling back to their accepted region when unassigned.
    This - not the accepted region - is what "the current region" means for
    a same-region transfer.
    """
    if student is None:
        return None
    room = getattr(student, 'assigned_room', None)
    if room is not None:
        try:
            return room.apartment.building.dorm_type.region_id
        except AttributeError:
            pass
    return student.accepted_dorm_type.region_id if student.accepted_dorm_type_id else None


def _assignment_snapshot(student):
    """
    JSON snapshot of the student's live assignment, persisted on the request
    at creation time so the original placement remains known even after the
    student is later moved.
    """
    if student is None or not student.assigned_room_id:
        return {'assigned': False}
    room = student.assigned_room
    bed = student.current_bed
    region = _room_region(room)
    active = student.bed_assignments.filter(status=BedAssignment.Status.ACTIVE).first()
    return {
        'assigned': True,
        'assignment_id': active.id if active else None,
        'region_id': region.id if region else None,
        'region_name': region.name if region else None,
        'building_id': room.apartment.building_id,
        'building_number': room.apartment.building.number,
        'apartment_id': room.apartment_id,
        'apartment_number': room.apartment.number,
        'room_id': room.id,
        'room_name': room.name,
        'bed_id': bed.id if bed else None,
        'bed_label': bed.label if bed else None,
    }


def _top10_bed_assignment_history_qs():
    """
    BedAssignment queryset bounded to each student's 10 most-recent rows
    (by assigned_at desc, id desc as a deterministic tiebreak), used as the
    queryset for the placement_history Prefetch below.

    Verified (project-quality/performance/GROUP1_PLACEMENT_HISTORY_VERIFICATION.md):
    prefetching this relation with an ordinary (unbounded) queryset and
    slicing to [:10] in Python - the original Group 1 fix - stays flat at 5
    queries per page, but loads ALL of every relevant student's historical
    BedAssignment rows into the app server (measured 10x overfetch at 100
    rows/student; grows unboundedly with each student's lifetime history,
    not with page size). Django's ORM cannot filter on a Window()
    annotation directly ("Window is disallowed in the filter clause"), so a
    plain .annotate(rank=Window(RowNumber(), ...)).filter(rank__lte=10)
    isn't possible - a small raw ROW_NUMBER() subquery, referenced via
    pk__in=RawSQL(...), is the standard/smallest way to express a bounded
    "top N per group" query. Prefetch() then appends its own
    student_id__in=[...] filter on top of this (restricting to only the
    students on the current page), so the query stays a single flat
    statement, correct, and bounded to exactly 10 rows/student.
    """
    table = BedAssignment._meta.db_table
    top10_ids_sql = (
        f'SELECT id FROM ('
        f'SELECT id, ROW_NUMBER() OVER ('
        f'PARTITION BY student_id ORDER BY assigned_at DESC, id DESC'
        f') AS rn FROM {table}'
        f') ranked WHERE rn <= 10'
    )
    return BedAssignment.objects.filter(
        pk__in=RawSQL(top10_ids_sql, ()),
    ).select_related(
        'bed__room__apartment__building',
        'bed__room__apartment__building__dorm_type__region',
    ).order_by('-assigned_at', '-id')


class StudentRequestViewSet(viewsets.ModelViewSet):
    serializer_class = StudentRequestSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsPagination
    # G3-24: StudentRequest rows are workflow/audit history - the
    # legitimate way for a requester to withdraw their own still-pending
    # request is the cancel() action below (role/ownership/status
    # checked there), never a generic DELETE that erases the record.
    http_method_names = ['get', 'post', 'put', 'patch', 'head', 'options']

    def get_queryset(self):
        queryset = StudentRequest.objects.select_related(
            'student',
            'student__assigned_room__apartment__building__dorm_type__region',
            'student__accepted_dorm_type__region',
            'target_room__apartment__building__dorm_type__region',
            'swap_with_student', 'target_region',
            'requested_by', 'requested_by__region', 'reviewed_by',
            'source_region',
        ).prefetch_related(
            # destination_regions is read twice per row by
            # StudentRequestSerializer (the declared PrimaryKeyRelatedField
            # AND get_destination_region_names()) - a plain
            # prefetch_related here means Django's M2M prefetch cache
            # satisfies both .all() calls from one query instead of two per
            # row, with zero serializer code change (both call sites do a
            # bare .all(), which transparently reads the prefetch cache).
            'destination_regions',
            # current_bed and placement_history each used to run their own
            # BedAssignment query per row (see
            # project-quality/performance/GROUP1_BACKEND_PERFORMANCE_AUDIT.md,
            # G1-09). They need DIFFERENT slices of the same
            # student.bed_assignments relation (current_bed: at most the
            # one ACTIVE assignment; placement_history: the most recent 10
            # regardless of status) - two separate Prefetch() objects on
            # the same lookup path, distinguished by to_attr, so Django
            # runs exactly one query per slice (flat, not per-row) instead
            # of collapsing them into one query that couldn't serve both
            # shapes correctly.
            Prefetch(
                'student__bed_assignments',
                queryset=BedAssignment.objects.filter(
                    status=BedAssignment.Status.ACTIVE,
                ).select_related('bed', 'bed__room'),
                to_attr='prefetched_current_assignment_list',
            ),
            Prefetch(
                'student__bed_assignments',
                queryset=_top10_bed_assignment_history_qs(),
                to_attr='prefetched_placement_history_all',
            ),
        )

        user = self.request.user
        if not user.is_central_admin:
            # A regional user's own region always wins - a region_id sent by
            # the client is never trusted/consulted here.
            if not user.region_id:
                queryset = queryset.filter(requested_by=user)
            else:
                queryset = queryset.filter(
                    Q(requested_by__region_id=user.region_id) |
                    Q(student__accepted_dorm_type__region_id=user.region_id) |
                    Q(target_room__apartment__building__dorm_type__region_id=user.region_id) |
                    # A region_transfer's DESTINATION region must be able to
                    # see (list/retrieve) the incoming request - it owns
                    # approve/reject (see _user_can_review_request()). The
                    # source-side Q()s above already keep it visible to the
                    # requester's/student's own region too - both sides see
                    # it, only the destination side (or central admin) can
                    # act on it.
                    Q(target_region_id=user.region_id)
                )
        else:
            # Central admins may explicitly narrow to one region (Requests
            # page region selector); "all regions" is the default (no filter).
            region_filter = self.request.query_params.get('region')
            if region_filter and region_filter != 'all':
                queryset = queryset.filter(
                    Q(requested_by__region_id=region_filter) |
                    Q(student__accepted_dorm_type__region_id=region_filter) |
                    Q(target_room__apartment__building__dorm_type__region_id=region_filter)
                )

        status_filter = self.request.query_params.get('status')
        if status_filter and status_filter != 'all':
            queryset = queryset.filter(status=status_filter)

        request_type_filter = self.request.query_params.get('request_type')
        if request_type_filter and request_type_filter != 'all':
            queryset = queryset.filter(request_type=request_type_filter)

        student_filter = self.request.query_params.get('student')
        if student_filter:
            queryset = queryset.filter(student_id=student_filter)

        date_from = self.request.query_params.get('date_from')
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        date_to = self.request.query_params.get('date_to')
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(request_number__icontains=search) |
                Q(student__first_name__icontains=search) |
                Q(student__last_name__icontains=search) |
                Q(student__student_id__icontains=search) |
                Q(student_data__student_id__icontains=search)
            )

        return queryset.distinct().order_by('-created_at')

    def perform_create(self, serializer):
        instance = serializer.save(requested_by=self.request.user)
        if not instance.request_number:
            instance.request_number = f"REQ-{instance.id:06d}"
            instance.save(update_fields=['request_number'])

        # Transfer requests persist their region context server-side (never
        # trusted from the client): scope default, the source region the
        # student lives in right now, and a snapshot of the current
        # assignment - so the request stays meaningful after refreshes,
        # restarts, and even after the student is eventually moved.
        if instance.request_type in (StudentRequest.RequestType.ROOM, StudentRequest.RequestType.APARTMENT) \
                and instance.student_id:
            changed = []
            if not instance.transfer_scope:
                instance.transfer_scope = StudentRequest.TransferScope.SAME_REGION
                changed.append('transfer_scope')
            if not instance.source_region_id:
                source = _student_current_region_id(instance.student)
                if source:
                    instance.source_region_id = source
                    changed.append('source_region')
            if instance.current_assignment_snapshot is None:
                instance.current_assignment_snapshot = _assignment_snapshot(instance.student)
                changed.append('current_assignment_snapshot')
            if changed:
                instance.save(update_fields=changed)

        # region_transfer requests get the same source_region/
        # current_assignment_snapshot persistence as ROOM/APARTMENT above -
        # a permanent audit record of where the request started, even after
        # the student is later moved or the request is long resolved - but
        # deliberately NOT transfer_scope, which belongs only to the ROOM/
        # APARTMENT same-region/cross-region system and has no meaning for
        # region_transfer (see StudentRequest.transfer_scope help_text).
        if instance.request_type == StudentRequest.RequestType.REGION_TRANSFER and instance.student_id:
            changed = []
            if not instance.source_region_id:
                source = _student_current_region_id(instance.student)
                if source:
                    instance.source_region_id = source
                    changed.append('source_region')
            if instance.current_assignment_snapshot is None:
                instance.current_assignment_snapshot = _assignment_snapshot(instance.student)
                changed.append('current_assignment_snapshot')
            if changed:
                instance.save(update_fields=changed)

    def destroy(self, request, *args, **kwargs):
        if not request.user.is_boss:
            return Response(
                {'error': 'רק מנהל יכול למחוק בקשות'},
                status=status.HTTP_403_FORBIDDEN,
            )

        req = self.get_object()

        if req.status not in (
                StudentRequest.Status.PENDING,
                StudentRequest.Status.REJECTED,
                StudentRequest.Status.CANCELLED,
        ):
            return Response(
                {'error': 'ניתן למחוק רק בקשה ממתינה, שנדחתה או שבוטלה'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        req.delete()

        return Response(
            {'message': 'הבקשה נמחקה בהצלחה'},
            status=status.HTTP_200_OK,
        )

    @staticmethod
    def _pagination_params(source):
        # limit/offset count BUILDINGS (the pagination unit of
        # find_matching_room_options), not beds - one page of 10 buildings
        # already carries its complete apartment/room/bed subtree.
        try:
            limit = int(source.get('limit', 10))
        except (TypeError, ValueError):
            limit = 10
        try:
            offset = int(source.get('offset', 0))
        except (TypeError, ValueError):
            offset = 0
        return max(1, min(limit, 20)), max(0, offset)

    @staticmethod
    def _empty_match_payload(limit, offset):
        """Zero-result shell in the exact shape of find_matching_room_options."""
        return {
            'buildings': [], 'loaded_buildings': 0,
            'total_buildings': 0, 'total_apartments': 0, 'total_rooms': 0,
            'total_valid_beds': 0, 'total_valid': 0,
            'limit': limit, 'offset': offset,
            'has_more': False, 'next_offset': None,
            'conflict_examples': [], 'counts': None, 'data_integrity': None,
        }

    @staticmethod
    def _match_reason(result, fallback):
        """Human reason for an infeasible result, surfacing a Bed-record
        data-integrity problem explicitly instead of a generic 'nothing
        found'."""
        if result['total_valid_beds'] > 0:
            return ''
        di = result.get('data_integrity') or {}
        if di.get('missing_bed_records'):
            return (
                fallback +
                ' שים לב: קיימים חדרים עם קיבולת פנויה אך ללא רשומות מיטה במסד הנתונים '
                '(בעיית נתונים) - נדרשת פעולת אתחול מיטות ייעודית (manage.py materialize_beds).'
            )
        return fallback

    @action(detail=False, methods=['get'], url_path='transfer-target-regions')
    def transfer_target_regions(self, request):
        """
        Regions a region_transfer request may legally name as target_region.

        Deliberately NOT RegionViewSet: that endpoint scopes a non-central
        user to only their own region (RegionViewSet.get_queryset()), which
        is correct for general operational access but wrong here -
        StudentRequestSerializer.validate() places no role/region
        restriction on who may create a region_transfer request or which
        region they may name (only StudentRequestViewSet.approve() is
        central-admin-gated for it). A regional employee legitimately
        needs to see every OTHER region's name/id to request a transfer
        there, without that grant giving them any access to that region's
        buildings/rooms/students - this action returns only id+name (via
        the same minimal RegionSerializer RegionViewSet already uses), the
        same shape the frontend's normal regions list has always used.

        Excluding the student's own current region is left to the caller
        (the Assisted Allocation transfer dialog already does this using
        the student's own region_id from the student-detail endpoint) -
        this action has no student in scope to exclude one correctly, and
        returning the full list keeps this endpoint reusable by any future
        target_region UI without baking in one caller's exclusion rule.
        """
        return Response(RegionSerializer(Region.objects.all().order_by('name'), many=True).data)

    @action(detail=False, methods=['post'], url_path='match-options')
    def match_options(self, request):
        student = None
        student_value = request.data.get('student_id') or request.data.get('student')

        if student_value:
            try:
                student = Student.objects.select_related(
                    'assigned_room__apartment__building__dorm_type__region',
                    'accepted_dorm_type__region',
                ).get(pk=student_value)
            except (Student.DoesNotExist, ValueError, TypeError):
                return Response(
                    {'feasible': False, 'buildings': [], 'reason': 'הסטודנט לא נמצא'},
                    status=status.HTTP_404_NOT_FOUND
                )

            if not request.user.is_central_admin:
                # A student with no accepted_dorm_type at all has no region
                # to check against - that's a missing-data problem (surfaced
                # below by _student_assignment_blocker), not an
                # authorization problem, so it must not be misreported as
                # "no permission for this region".
                if student.accepted_dorm_type_id:
                    region_id = student.accepted_dorm_type.region_id
                    if not request.user.region_id or region_id != request.user.region_id:
                        return Response(
                            {'feasible': False, 'buildings': [], 'reason': 'אין הרשאה לאזור זה'},
                            status=status.HTTP_403_FORBIDDEN
                        )

        limit, offset = self._pagination_params(request.data)

        if student:
            blocker = _student_assignment_blocker(student)
            if blocker:
                blocking_field, message = blocker
                return Response({
                    'feasible': False,
                    'reason': message,
                    'blocking_field': blocking_field,
                    **self._empty_match_payload(limit, offset),
                })

        student_data = request.data.get('student_data') or {}
        same_apartment = request.data.get('same_apartment', None)

        transfer_scope = request.data.get('transfer_scope') or None
        raw_region_ids = request.data.get('region_ids')
        if raw_region_ids is None:
            raw_region_ids = []
        elif not isinstance(raw_region_ids, (list, tuple)):
            raw_region_ids = [raw_region_ids]
        raw_region_ids = [r for r in raw_region_ids if r]

        # Backend-enforced role rules (frontend role checks are never
        # trusted): a regional user may not browse or perform a cross-region
        # transfer, nor smuggle a foreign region id into the search.
        if not request.user.is_central_admin:
            foreign_multi = [r for r in raw_region_ids if str(r) != str(request.user.region_id)]
            single = request.data.get('region_id')
            foreign_single = single and str(single) != str(request.user.region_id)
            if transfer_scope == StudentRequest.TransferScope.CROSS_REGION or foreign_multi or foreign_single:
                return Response(
                    {'detail': 'אין לך הרשאה לבצע מעבר לאזור אחר.'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        # A region override is only ever honored for central admins - a
        # regional user's own region always wins inside _room_candidate_queryset,
        # regardless of what region ids a direct API call might send.
        region_id = request.data.get('region_id') if request.user.is_central_admin else None
        region_ids = None
        if transfer_scope == StudentRequest.TransferScope.CROSS_REGION:
            # Central-admin-only (regional users were rejected above). Search
            # ONLY the explicitly selected destination regions - the
            # student's current region is never included implicitly.
            if not raw_region_ids:
                return Response(
                    {'feasible': False, 'reason': 'יש לבחור לפחות אזור יעד אחד עבור מעבר לאזור אחר.',
                     **self._empty_match_payload(limit, offset)},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            region_ids = raw_region_ids
            region_id = None
        elif transfer_scope == StudentRequest.TransferScope.SAME_REGION:
            # The student's CURRENT region is used automatically - the
            # region selector is neither needed nor honored in this mode.
            current_region = _student_current_region_id(student)
            region_ids = [current_region] if current_region else None
            region_id = None
        elif not region_id and student and student.accepted_dorm_type_id:
            # Legacy default (assign/reassign flows without a transfer
            # scope): the student's own accepted region rather than a
            # nationwide scan. An explicit region_id always overrides.
            region_id = student.accepted_dorm_type.region_id

        result = find_matching_room_options(
            request.user, student=student, student_data=student_data,
            same_apartment=same_apartment, region_id=region_id, region_ids=region_ids,
            limit=limit, offset=offset,
        )
        searched = region_ids or ([region_id] if region_id else [])
        return Response({
            'feasible': result['total_valid_beds'] > 0,
            'reason': self._match_reason(result, 'לא נמצאו מיטות פנויות מתאימות עבור סטודנט זה.'),
            'transfer_scope': transfer_scope,
            'search_regions': [
                {'id': r.id, 'name': r.name} for r in Region.objects.filter(id__in=searched)
            ],
            **result,
        })

    @action(detail=True, methods=['get'])
    def feasibility(self, request, pk=None):
        req = self.get_object()
        limit, offset = self._pagination_params(request.query_params)

        if req.student:
            blocker = _student_assignment_blocker(req.student)
            if blocker:
                blocking_field, message = blocker
                return Response({
                    'feasible': False,
                    'reason': message,
                    'blocking_field': blocking_field,
                    **self._empty_match_payload(limit, offset),
                })

        # Region scope comes from what is PERSISTED on the request - never
        # from client-sent parameters: same-region searches the stored
        # source region (falling back to the student's current region);
        # cross-region searches exactly the stored destination regions.
        # Regional users remain hard-scoped to their own region inside
        # _room_candidate_queryset regardless of these values.
        region_ids = None
        if req.request_type in (StudentRequest.RequestType.ROOM, StudentRequest.RequestType.APARTMENT):
            if req.transfer_scope == StudentRequest.TransferScope.CROSS_REGION:
                region_ids = list(req.destination_regions.values_list('id', flat=True)) or None
            else:
                source = req.source_region_id or _student_current_region_id(req.student)
                region_ids = [source] if source else None
        elif req.request_type == StudentRequest.RequestType.REGION_TRANSFER and req.target_region_id:
            region_ids = [req.target_region_id]

        result = find_matching_room_options(
            request.user,
            student=req.student,
            student_data=req.student_data,
            same_apartment=req.same_apartment,
            region_ids=region_ids,
            limit=limit, offset=offset,
        )
        return Response({
            'feasible': result['total_valid_beds'] > 0,
            'reason': self._match_reason(result, 'לא נמצאו מיטות פנויות מתאימות עבור בקשה זו.'),
            'transfer_scope': req.transfer_scope,
            'search_regions': [
                {'id': r.id, 'name': r.name} for r in Region.objects.filter(id__in=region_ids or [])
            ],
            **result,
        })

    @action(detail=True, methods=['put'])
    def approve(self, request, pk=None):
        if not request.user.is_boss:
            return Response({'error': 'רק מנהל יכול לאשר בקשות'}, status=status.HTTP_403_FORBIDDEN)

        req = self.get_object()
        if req.status != StudentRequest.Status.PENDING:
            return Response({'error': 'הבקשה כבר טופלה'}, status=status.HTTP_400_BAD_REQUEST)

        if not _user_can_review_request(request.user, req):
            return Response({'error': 'אין הרשאה לאשר בקשה זו'}, status=status.HTTP_403_FORBIDDEN)

        target_room_id = request.data.get('target_room') or request.data.get('room_id')
        target_room = None
        if target_room_id:
            try:
                target_room = Room.objects.select_related(
                    'apartment', 'apartment__building',
                    'apartment__building__dorm_type', 'apartment__building__dorm_type__region',
                ).get(pk=target_room_id)
            except Room.DoesNotExist:
                return Response({'error': 'החדר שנבחר לא נמצא'}, status=status.HTTP_404_NOT_FOUND)

            if not _user_can_edit_room(request.user, target_room):
                return Response({'error': 'אין הרשאה לערוך חדר באזור זה'}, status=status.HTTP_403_FORBIDDEN)

        bed_id = request.data.get('bed_id')

        try:
            with transaction.atomic():
                # G2-01 fix: the PENDING check above is a fast, unlocked
                # pre-check for the common (non-racing) case - it can go
                # stale between then and here. select_for_update()
                # re-fetches and locks THIS SAME ROW; status is
                # re-verified under that lock, which is the authoritative
                # check a second, concurrent approve() call for the SAME
                # request cannot slip past (it blocks on this
                # select_for_update() until the winning request's
                # transaction commits, then sees the already-updated
                # status). req itself (from get_queryset(), with all its
                # select_related/prefetch chains) is deliberately left
                # untouched and reused below for the response - only this
                # lightweight locked copy is used for the status recheck.
                locked_req = StudentRequest.objects.select_for_update().get(pk=req.pk)
                if locked_req.status != StudentRequest.Status.PENDING:
                    return Response({'error': 'הבקשה כבר טופלה'}, status=status.HTTP_400_BAD_REQUEST)

                if req.request_type in (StudentRequest.RequestType.ROOM, StudentRequest.RequestType.APARTMENT):
                    if not req.student:
                        raise ValueError('לא נבחר סטודנט עבור בקשה זו')
                    room = target_room or req.target_room
                    if not room:
                        raise ValueError('יש לבחור חדר יעד לפני האישור')

                    # The stored transfer scope is authoritative at approval
                    # time too - the destination room is revalidated against
                    # it, and cross-region approval stays central-admin-only.
                    room_region = _room_region(room)
                    room_region_id = room_region.id if room_region else None
                    if req.transfer_scope == StudentRequest.TransferScope.CROSS_REGION:
                        if not request.user.is_central_admin:
                            raise PermissionError('אין לך הרשאה לבצע מעבר לאזור אחר.')
                        allowed_regions = set(req.destination_regions.values_list('id', flat=True))
                        if allowed_regions and room_region_id not in allowed_regions:
                            raise ValueError('החדר שנבחר אינו באזורי היעד שנבחרו בבקשה')
                    elif req.transfer_scope == StudentRequest.TransferScope.SAME_REGION:
                        source_id = req.source_region_id or _student_current_region_id(req.student)
                        if source_id and room_region_id and room_region_id != source_id:
                            raise ValueError('החדר שנבחר אינו באזור הנוכחי של הסטודנט (מעבר בתוך האזור)')

                    new_assignment = assign_student_to_room(
                        student=req.student, room=room, assigned_by=request.user,
                        assignment_type=BedAssignment.AssignmentType.TRANSFER, bed_id=bed_id,
                    )
                    req.target_room = room
                    req.final_assignment = new_assignment

                elif req.request_type == StudentRequest.RequestType.ADD_STUDENT:
                    if not req.student:
                        req.student = _create_student_from_request_data(req.student_data)
                    if target_room:
                        req.final_assignment = assign_student_to_room(
                            student=req.student, room=target_room, assigned_by=request.user,
                            assignment_type=BedAssignment.AssignmentType.MANUAL, bed_id=bed_id,
                        )
                        req.target_room = target_room

                elif req.request_type == StudentRequest.RequestType.REMOVE_STUDENT:
                    if not req.student:
                        raise ValueError('לא נבחר סטודנט עבור בקשה זו')
                    current = req.student.bed_assignments.filter(status=BedAssignment.Status.ACTIVE).first()
                    if current:
                        current.status = BedAssignment.Status.ENDED
                        current.ended_at = timezone.now()
                        current.save(update_fields=['status', 'ended_at'])
                    req.student.assigned_room = None
                    req.student.save(update_fields=['assigned_room'])

                elif req.request_type == StudentRequest.RequestType.SWAP:
                    if not req.student or not req.swap_with_student:
                        raise ValueError('בקשת החילוף חסרה סטודנט או שותף לחילוף')
                    _execute_swap(req.student, req.swap_with_student, request.user)

                elif req.request_type == StudentRequest.RequestType.REGION_TRANSFER:
                    # Approval authority for region_transfer is the
                    # DESTINATION region (or central admin) - already
                    # enforced by _user_can_review_request() above, plus
                    # _user_can_edit_room() below on whatever target_room
                    # the approver picks. No extra central-admin-only gate
                    # here: that used to be the ONLY way in (destination-
                    # region approval didn't exist yet); now it would just
                    # incorrectly re-block the destination region's own
                    # boss from approving their own incoming transfer.
                    if not req.student:
                        raise ValueError('לא נבחר סטודנט עבור בקשה זו')
                    room = target_room or req.target_room
                    if not room:
                        raise ValueError('יש לבחור חדר יעד באזור היעד לפני האישור')
                    destination_region = _room_region(room)
                    if req.target_region_id and destination_region and req.target_region_id != destination_region.id:
                        raise ValueError('החדר שנבחר אינו באזור היעד שביקש הבקשה')
                    req.final_assignment = assign_student_to_room(
                        student=req.student, room=room, assigned_by=request.user,
                        assignment_type=BedAssignment.AssignmentType.TRANSFER, bed_id=bed_id,
                    )
                    req.target_room = room

                # 'other' requests are administrative only - no system action required.

                req.status = StudentRequest.Status.APPROVED
                req.reviewed_by = request.user
                req.reviewed_at = timezone.now()
                req.save()

        except PermissionError as e:
            return Response({'detail': str(e), 'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
        except (ValueError, ValidationError) as e:
            message = '; '.join(e.messages) if isinstance(e, ValidationError) and hasattr(e, 'messages') else str(e)
            return Response({'error': message}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            # G2-02 fix: _create_student_from_request_data() (below) does
            # a check-then-create on Student.student_id - the DB's real
            # unique constraint is the final backstop against a duplicate
            # row, but without this handler a legitimate concurrent-write
            # conflict (two different ADD_STUDENT requests racing to
            # create the same new student_id) surfaced as an unhandled
            # 500 instead of a clean, deterministic 4xx. The
            # transaction.atomic() block above has already rolled back
            # any partial write from this attempt.
            return Response({
                'error': 'הבקשה לא אושרה עקב התנגשות נתונים - ייתכן שסטודנט עם ת.ז זו כבר נוצר או שהבקשה כבר טופלה. נא לרענן ולנסות שוב.',
            }, status=status.HTTP_400_BAD_REQUEST)

        # req.student may have just gained/lost a BedAssignment above (new
        # assignment, ended assignment, or a swap) - req itself came from
        # get_queryset(), so req.student may still be carrying the
        # PRE-approval prefetched_current_assignment_list/
        # prefetched_placement_history_all caches (see get_queryset()).
        # Drop them so the response below reflects what was just
        # committed, not a stale pre-approval snapshot - the serializer's
        # getattr(..., None) fallback then re-queries fresh, exactly like
        # the original (pre-optimization) behavior always did.
        if req.student_id:
            for cache_attr in ('prefetched_current_assignment_list', 'prefetched_placement_history_all'):
                if hasattr(req.student, cache_attr):
                    delattr(req.student, cache_attr)

        return Response({
            'message': 'הבקשה אושרה בהצלחה',
            'request': StudentRequestSerializer(req).data,
        })

    @action(detail=True, methods=['put'])
    def reject(self, request, pk=None):
        if not request.user.is_boss:
            return Response({'error': 'רק מנהל יכול לדחות בקשות'}, status=status.HTTP_403_FORBIDDEN)

        req = self.get_object()
        if req.status != StudentRequest.Status.PENDING:
            return Response({'error': 'הבקשה כבר טופלה'}, status=status.HTTP_400_BAD_REQUEST)

        if not _user_can_review_request(request.user, req):
            return Response({'error': 'אין הרשאה לדחות בקשה זו'}, status=status.HTTP_403_FORBIDDEN)

        with transaction.atomic():
            # Same lock-and-recheck pattern as approve() above - also
            # closes a pre-existing gap where reject() previously had NO
            # transaction.atomic() at all.
            locked_req = StudentRequest.objects.select_for_update().get(pk=req.pk)
            if locked_req.status != StudentRequest.Status.PENDING:
                return Response({'error': 'הבקשה כבר טופלה'}, status=status.HTTP_400_BAD_REQUEST)

            req.status = StudentRequest.Status.REJECTED
            req.reviewed_by = request.user
            req.reviewed_at = timezone.now()
            req.rejection_reason = request.data.get('reason', '')
            req.save()

        return Response({
            'message': 'הבקשה נדחתה',
            'request': StudentRequestSerializer(req).data,
        })

    @action(detail=True, methods=['put'])
    def cancel(self, request, pk=None):
        """
        Withdraw the caller's own still-pending request - distinct from
        reject(): REJECTED means a reviewer considered and declined the
        request; CANCELLED means the requesting side changed its mind
        before any reviewer acted. Used today by the Assisted Allocation
        "בהעברה" panel's "ביטול בקשת העברה" action on a pending
        region_transfer request, but left generic (any pending
        StudentRequest) rather than request_type-gated, matching how
        approve()/reject() are already generic actions on this viewset.
        """
        req = self.get_object()
        if req.status != StudentRequest.Status.PENDING:
            return Response({'error': 'ניתן לבטל רק בקשה הממתינה לאישור'}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        is_requester = req.requested_by_id == user.id
        if not is_requester and not _user_can_cancel_request(user, req):
            return Response({'error': 'אין הרשאה לבטל בקשה זו'}, status=status.HTTP_403_FORBIDDEN)

        with transaction.atomic():
            # Same lock-and-recheck pattern as approve()/reject() above.
            locked_req = StudentRequest.objects.select_for_update().get(pk=req.pk)
            if locked_req.status != StudentRequest.Status.PENDING:
                return Response({'error': 'ניתן לבטל רק בקשה הממתינה לאישור'}, status=status.HTTP_400_BAD_REQUEST)

            req.status = StudentRequest.Status.CANCELLED
            req.reviewed_by = user
            req.reviewed_at = timezone.now()
            req.save()

        return Response({
            'message': 'בקשת ההעברה בוטלה',
            'request': StudentRequestSerializer(req).data,
        })


# =========================
# Allocation
# =========================

def _run_diagnostics_payload(result):
    if not isinstance(result, dict):
        return {
            'warnings': [],
            'anier_building_179_diagnostics': {},
            'solver_status': None,
            'optimality_proven': False,
            'objective_value': None,
            'best_objective_bound': None,
            'absolute_gap': None,
            'relative_gap': None,
        }
    return {
        'warnings': result.get('warnings', []),
        'anier_building_179_diagnostics': result.get('anier_building_179_diagnostics', {}),
        'solver_status': result.get('solver_status'),
        'optimality_proven': bool(result.get('optimality_proven', False)),
        'objective_value': result.get('objective_value'),
        'best_objective_bound': result.get('best_objective_bound'),
        'absolute_gap': result.get('absolute_gap'),
        'relative_gap': result.get('relative_gap'),
    }


def _exclude_non_solver_students(students_qs):
    """
    Shared solver-input population filter, used identically by both the
    sync (run_allocation) and async (_execute_allocation_background)
    allocation entry points so the two paths cannot silently drift apart.

    Both exclusions are unconditional. category and accessibility_flag are
    permanent fields on the Student model (not optional/dynamic ones), so
    this must never be gated behind a field-existence check — doing so
    would risk silently skipping the accessibility exclusion if that check
    were ever wrong, which is unacceptable for a safety-relevant filter.

      - LEAVING-category students are never sent to the solver.
      - accessibility_flag=True students are imported and saved normally,
        but must never reach the OR-Tools solver — the dorm office
        allocates them manually. This is independent of is_priority (see
        priority_fields_from_special_statuses in the Excel import code);
        exclusion here is a read-time queryset filter only, so it never
        clears or rewrites is_priority/priority_reason/special_status_*/
        accessibility metadata on the Student row itself.
    """
    return students_qs.exclude(
        category=Student.StudentCategory.LEAVING,
    ).exclude(
        accessibility_flag=True,
    )


def _population_summary_for_region(region, *, sent_to_solver_student_ids=None):
    """
    Distinct-count population breakdown explaining why the number of
    students sent to the solver is smaller than the number imported for
    this region — always scoped to this region's Student rows only, never
    a global Student count, and never scoped to a different
    region/upload.

    imported_students   — every Student row accepted into a dorm type in
                           this region (the full "received" population).
    excluded_accessibility / excluded_leaving — counts within that same
                           population; a student in both counts once
                           towards excluded_overlap, so excluded_total is
                           the DISTINCT union, not a naive sum.
    sent_to_solver / sent_to_solver_student_ids — when the caller already
                           knows the exact solver-input population for a
                           specific run (the real `students` queryset),
                           pass their ids in and this reports that exact
                           set. Otherwise (a pre-run preview, before any
                           AllocationRun exists) this derives the same
                           population run_allocation/_execute_allocation_
                           background would build by default: eligible
                           (non-leaving, non-accessibility) and not yet
                           assigned.

    sent_to_solver_student_ids is kept in the returned dict (not just the
    count) so it can be persisted on AllocationRun.diagnostics and later
    used to reconstruct "which of these specific students are still
    unassigned" for the results page and the retry-unassigned workflow —
    without needing a new model field or migration.
    """
    population_qs = Student.objects.filter(accepted_dorm_type__region=region)
    imported_students = population_qs.count()

    excluded_accessibility = population_qs.filter(accessibility_flag=True).count()
    excluded_leaving = population_qs.filter(category=Student.StudentCategory.LEAVING).count()
    excluded_overlap = population_qs.filter(
        accessibility_flag=True,
        category=Student.StudentCategory.LEAVING,
    ).count()
    excluded_total = excluded_accessibility + excluded_leaving - excluded_overlap

    if sent_to_solver_student_ids is None:
        eligible_qs = _exclude_non_solver_students(population_qs).filter(
            assigned_room__isnull=True,
        )
        sent_to_solver_student_ids = list(eligible_qs.values_list('id', flat=True))
    else:
        sent_to_solver_student_ids = list(sent_to_solver_student_ids)

    return {
        'imported_students': imported_students,
        'excluded_accessibility': excluded_accessibility,
        'excluded_leaving': excluded_leaving,
        'excluded_overlap': excluded_overlap,
        'excluded_total': excluded_total,
        'sent_to_solver': len(sent_to_solver_student_ids),
        'sent_to_solver_student_ids': sent_to_solver_student_ids,
    }


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def run_allocation(request):
    refresh_db_connection()

    print(">>> ENTERED run_allocation", request.data, flush=True)

    if not (request.user.is_boss or request.user.is_central_admin):
        return Response({
            'error': 'רק מנהל אזור או מנהל מרכזי יכולים להריץ שיבוץ'
        }, status=status.HTTP_403_FORBIDDEN)

    region_value = (
        request.data.get('region')
        or request.data.get('region_id')
        or request.data.get('region_name')
    )

    if not region_value:
        if request.user.is_central_admin:
            return Response({
                'error': 'נדרש לבחור אזור'
            }, status=status.HTTP_400_BAD_REQUEST)

        if not request.user.region:
            return Response({
                'error': 'המשתמש אינו משויך לאזור'
            }, status=status.HTTP_400_BAD_REQUEST)

        region = request.user.region
    else:
        region = _resolve_region(region_value)
        if not region:
            return Response({
                'error': 'אזור לא נמצא'
            }, status=status.HTTP_404_NOT_FOUND)

    if not request.user.is_central_admin:
        if not request.user.region or request.user.region != region:
            return Response({
                'error': 'אין הרשאה להריץ שיבוץ עבור אזור זה'
            }, status=status.HTTP_403_FORBIDDEN)

    constraints_config = normalize_allocation_constraints(
        request.data.get('constraints')
    )
    allocation_run = None

    try:
        from allocation.solver import (
            run_improved_ortools_allocation,
            EMPTY_ANIER_BUILDING_179_DIAGNOSTICS,
        )

        # Duplicate-run protection. The row lock prevents two requests from
        # creating RUNNING allocation jobs for the same region at the same time.
        with transaction.atomic():
            Region.objects.select_for_update().get(pk=region.pk)
            active_run = AllocationRun.objects.filter(
                region=region,
                status=AllocationRun.Status.RUNNING,
            ).order_by('-started_at').first()

            if active_run is not None:
                return Response({
                    'success': False,
                    'error': 'כבר רץ שיבוץ עבור אזור זה. נא להמתין לסיום ההרצה הקיימת.',
                    'error_code': 'ALLOCATION_ALREADY_RUNNING',
                    'region': region.id,
                    'run': AllocationRunSerializer(active_run).data,
                }, status=status.HTTP_409_CONFLICT)

            allocation_run = AllocationRun.objects.create(
                region=region,
                run_by=request.user,
                status=AllocationRun.Status.RUNNING
            )

        student_fields = _get_model_field_names(Student)
        print(
            f">>> ALLOCATION_RUN_CREATED run_id={allocation_run.id} region={region.id} user={request.user.email}",
            flush=True,
        )

        # Base population for the selected region.
        # Important: leavers should never be sent to the allocation solver.
        students_base = Student.objects.filter(
            accepted_dorm_type__region=region
        ).select_related(
            'accepted_dorm_type',
            'accepted_dorm_type__region'
        )
        students_base = _exclude_non_solver_students(students_base)

        students_total_in_region = students_base.count()
        students = students_base

        # Default solver scope: allocate only students who are not already assigned.
        # You may pass {"include_assigned": true} only for debugging/rebuilding full allocations.
        include_assigned = request.data.get('include_assigned') is True

        if not include_assigned:
            if 'assigned_bed' in student_fields:
                students = students.filter(assigned_bed__isnull=True)
            elif 'assigned_room' in student_fields:
                students = students.filter(assigned_room__isnull=True)

        # Optional narrow scope if the frontend wants to allocate only new/transfer students.
        allocation_scope = request.data.get('allocation_scope')
        if allocation_scope == 'new_transfer_only' and 'category' in student_fields:
            students = students.filter(
                category__in=[
                    Student.StudentCategory.NEW,
                    Student.StudentCategory.TRANSFER,
                ]
            )

        rooms = Room.objects.filter(
            apartment__building__dorm_type__region=region,
            is_active=True,
            apartment__is_active=True,
            apartment__building__is_active=True
        ).select_related(
            'apartment',
            'apartment__building',
            'apartment__building__dorm_type'
        ).prefetch_related('beds')

        # Count before running the solver, so we do not need another DB query after a long solver run.
        students_count = students.count()
        rooms_count = rooms.count()

        # Capture the selected population before the solver updates assignments.
        # The response table must describe this run, not every historical
        # active assignment in the region.
        run_student_ids = list(students.values_list('id', flat=True))

        # Population summary: why students_count (sent to the solver) is
        # smaller than the region's full imported population — scoped to
        # this region/run only, never a global Student count.
        population_summary = _population_summary_for_region(
            region, sent_to_solver_student_ids=run_student_ids,
        )

        print(
            ">>> ALLOCATION_INPUT "
            f"run_id={allocation_run.id} "
            f"region={region.id} "
            f"scope={allocation_scope or 'all_unassigned_non_leaving'} "
            f"include_assigned={include_assigned} "
            f"students_total_in_region={students_total_in_region} "
            f"students_sent_to_solver={students_count} "
            f"rooms_sent_to_solver={rooms_count}",
            flush=True,
        )

        if students_count == 0:
            allocation_run.status = AllocationRun.Status.COMPLETED
            allocation_run.students_processed = 0
            allocation_run.successful_assignments = 0
            allocation_run.roommate_matches = 0
            allocation_run.conflicts = 0
            allocation_run.completed_at = timezone.now()
            allocation_run.error_message = ''
            allocation_run.diagnostics = {
                'warnings': [],
                'anier_building_179_diagnostics': dict(EMPTY_ANIER_BUILDING_179_DIAGNOSTICS),
                'population_summary': {**population_summary, 'assigned': 0, 'unassigned': 0},
            }

            refresh_db_connection()
            allocation_run.save()

            return Response({
                'success': True,
                'message': 'לא נמצאו סטודנטים זמינים לשיבוץ באזור זה',
                'result': {
                    'students_total_in_region': students_total_in_region,
                    'students_available_for_allocation': 0,
                    'students_processed': 0,
                    'successful_assignments': 0,
                    'roommate_matches': 0,
                    'mutual_roommate_matches': 0,
                    'one_sided_roommate_matches': 0,
                    'conflicts': 0,
                    'solver_status': 'NO_STUDENTS',
                    'objective_value': None,
                    'wall_time': None,
                    'warnings': [],
                    'students_with_no_feasible_beds': [],
                    'anier_building_179_diagnostics': dict(EMPTY_ANIER_BUILDING_179_DIAGNOSTICS),
                    'population_summary': {**population_summary, 'assigned': 0, 'unassigned': 0},
                    'assignments': [],
                    'run': AllocationRunSerializer(allocation_run).data
                }
            }, status=status.HTTP_200_OK)

        if rooms_count == 0:
            allocation_run.status = AllocationRun.Status.FAILED
            allocation_run.error_message = 'לא נמצאו חדרים פעילים באזור זה'
            allocation_run.completed_at = timezone.now()

            refresh_db_connection()
            allocation_run.save()

            return Response({
                'success': False,
                'error': 'לא נמצאו חדרים פעילים באזור זה'
            }, status=status.HTTP_400_BAD_REQUEST)

        print(
            f">>> BEFORE_SOLVER run_id={allocation_run.id} region={region.id} students={students_count} rooms={rooms_count}",
            flush=True,
        )

        result = run_improved_ortools_allocation(
            students=students,
            rooms=rooms,
            constraints_config=constraints_config,
            enable_group_capacity_cuts=True,
        ) or {}

        print(
            f">>> AFTER_SOLVER run_id={allocation_run.id} region={region.id} result_type={type(result).__name__}",
            flush=True,
        )

        print(">>> SOLVER RAW RESULT TYPE:", type(result), flush=True)

        if isinstance(result, dict):
            assignments_value = result.get("assignments", [])
            conflicts_value = result.get("conflicts", 0)
            no_feasible_value = result.get("students_with_no_feasible_beds", [])

            print(">>> SOLVER RAW RESULT KEYS:", list(result.keys()), flush=True)
            print(">>> SOLVER students_processed:", result.get("students_processed"), flush=True)
            print(">>> SOLVER successful_assignments:", result.get("successful_assignments"), flush=True)
            print(">>> SOLVER conflicts:", conflicts_value, flush=True)
            print(">>> SOLVER solver_status:", result.get("solver_status"), flush=True)
            print(">>> SOLVER objective_value:", result.get("objective_value"), flush=True)
            print(">>> SOLVER wall_time:", result.get("wall_time"), flush=True)
            print(">>> SOLVER warnings:", result.get("warnings", []), flush=True)

            print(
                ">>> SOLVER assignments len:",
                len(assignments_value) if isinstance(assignments_value, list) else "not-list",
                flush=True
            )

            print(
                ">>> SOLVER students_with_no_feasible_beds len:",
                len(no_feasible_value) if isinstance(no_feasible_value, list) else "not-list",
                flush=True
            )

            print(
                ">>> SOLVER students_with_no_feasible_beds sample:",
                no_feasible_value[:10] if isinstance(no_feasible_value, list) else no_feasible_value,
                flush=True
            )
        else:
            print(">>> SOLVER RAW RESULT:", result, flush=True)

        if not isinstance(result, dict):
            raise ValueError(f'Unexpected solver result type: {type(result).__name__}')

        roommate_matches = result.get('roommate_matches')
        if roommate_matches is None:
            roommate_matches = (
                result.get('mutual_roommate_matches', 0)
                + result.get('one_sided_roommate_matches', 0)
            )

        allocation_run.status = AllocationRun.Status.COMPLETED
        allocation_run.students_processed = result.get('students_processed', students_count)
        allocation_run.successful_assignments = result.get('successful_assignments', 0)
        allocation_run.roommate_matches = roommate_matches
        allocation_run.conflicts = result.get('conflicts', 0)
        allocation_run.completed_at = timezone.now()
        population_summary = {
            **population_summary,
            'assigned': result.get('successful_assignments', 0),
            'unassigned': result.get('conflicts', 0),
        }
        allocation_run.diagnostics = {
            **_run_diagnostics_payload(result),
            'population_summary': population_summary,
        }

        # After a long solver run, reuse a healthy Neon connection and
        # reconnect only if Django reports that the connection is unusable.
        refresh_db_connection()
        allocation_run.save()

        # ============================================================
        # Build assignment table rows from DB for the frontend results
        # ============================================================
        assignment_rows = []

        refresh_db_connection()

        active_assignments = BedAssignment.objects.filter(
            status=BedAssignment.Status.ACTIVE,
            student_id__in=run_student_ids,
            bed__room__apartment__building__dorm_type__region=region,
        ).select_related(
            'student',
            'student__accepted_dorm_type',
            'bed',
            'bed__room',
            'bed__room__apartment',
            'bed__room__apartment__building',
            'bed__room__apartment__building__dorm_type',
            'bed__room__apartment__building__dorm_type__region',
        ).order_by(
            'bed__room__apartment__building__number',
            'bed__room__apartment__number',
            'bed__room__name',
            'bed__label'
        )

        for assignment in active_assignments:
            student = assignment.student
            bed = assignment.bed
            room = bed.room
            apartment = room.apartment
            building = apartment.building
            dorm_type = building.dorm_type
            assignment_region = dorm_type.region if dorm_type else None

            assignment_rows.append({
                'student_id': student.student_id,
                'student_name': student.full_name,
                'full_name': student.full_name,
                'first_name': student.first_name,
                'last_name': student.last_name,

                'gender': student.gender,
                'requested_religion': student.requested_religion,
                'religion': student.requested_religion,
                'religious': student.religious,
                'placement_sector': student.placement_sector,
                'sector': student.placement_sector,

                'building': building.number,
                'building_number': building.number,
                'apartment': apartment.number,
                'apartment_number': apartment.number,
                'room': room.name,
                'room_name': room.name,
                'bed': bed.label,
                'bed_label': bed.label,

                'dorm_type': dorm_type.name if dorm_type else '',
                'region': assignment_region.name if assignment_region else '',
                'region_id': assignment_region.id if assignment_region else '',

                'assignment_type': assignment.assignment_type,
                'assignment_status': assignment.status,
                'assigned_at': assignment.assigned_at.isoformat() if assignment.assigned_at else '',
            })

        print(">>> RESPONSE assignment_rows len:", len(assignment_rows), flush=True)

        return Response({
            'success': True,
            'message': 'השיבוץ הושלם בהצלחה',
            'result': {
                'students_total_in_region': students_total_in_region,
                'students_available_for_allocation': students_count,
                'students_processed': result.get('students_processed', students_count),
                'successful_assignments': result.get('successful_assignments', 0),
                'roommate_matches': roommate_matches,
                'mutual_roommate_matches': result.get('mutual_roommate_matches', 0),
                'one_sided_roommate_matches': result.get('one_sided_roommate_matches', 0),
                'conflicts': result.get('conflicts', 0),
                'solver_status': result.get('solver_status'),
                'objective_value': result.get('objective_value'),
                'wall_time': result.get('wall_time'),
                'warnings': result.get('warnings', []),
                'students_with_no_feasible_beds': result.get('students_with_no_feasible_beds', []),
                'anier_building_179_diagnostics': result.get('anier_building_179_diagnostics', {}),
                'population_summary': population_summary,
                'assignments': assignment_rows,
                'run': AllocationRunSerializer(allocation_run).data
            }
        }, status=status.HTTP_200_OK)

    except Exception as e:
        traceback.print_exc()

        if allocation_run is not None:
            try:
                allocation_run.status = AllocationRun.Status.FAILED
                allocation_run.error_message = str(e)
                allocation_run.completed_at = timezone.now()

                refresh_db_connection()
                allocation_run.save()
            except Exception:
                traceback.print_exc()

        return Response({
            'success': False,
            'error': f'שגיאה בהרצת השיבוץ: {str(e)}',
            'error_type': e.__class__.__name__,
            'traceback': traceback.format_exc(),
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def retry_unassigned_allocation_run(request, run_id):
    """
    "נסה לשבץ שוב את הסטודנטים שלא שובצו" — a narrowly-scoped, explicit
    retry: run the solver only for the specific students that the chosen
    completed run sent to the solver and left unassigned, against
    whatever inventory is currently available. This is NOT a general
    "run allocation again" — it never touches students already
    successfully assigned (by this run or any other), and it refuses to
    run at all if it cannot identify the exact original population.

    Required behavior (all enforced below):
      - only students from THIS run's original solver-input population,
        who do not currently have an active BedAssignment, are selected;
      - every previously successful assignment (from this run or any
        other) is left completely untouched — this view never deletes or
        updates an existing active BedAssignment for anyone outside the
        retried population;
      - a new AllocationRun is created, traceable to the original via
        diagnostics.retry_of_run_id (no schema change — reuses the
        existing JSONField, avoiding a migration for a purely
        supplementary link);
      - accessibility/leaving exclusion is re-applied defensively, in
        case a student's status changed since the original run;
      - no duplicate active assignment can be created — the same DB-level
        uniqueness/locking already used by run_improved_ortools_allocation
        applies here identically, since this calls the same function.
    """
    if not (request.user.is_boss or request.user.is_central_admin):
        return Response({
            'error': 'רק מנהל אזור או מנהל מרכזי יכולים להריץ שיבוץ'
        }, status=status.HTTP_403_FORBIDDEN)

    try:
        original_run = AllocationRun.objects.select_related('region').get(pk=run_id)
    except AllocationRun.DoesNotExist:
        return Response({'error': 'הרצה לא נמצאה'}, status=status.HTTP_404_NOT_FOUND)

    region = original_run.region

    if not request.user.is_central_admin:
        if not request.user.region or request.user.region != region:
            return Response({
                'error': 'אין הרשאה להריץ שיבוץ עבור אזור זה'
            }, status=status.HTTP_403_FORBIDDEN)

    if original_run.status != AllocationRun.Status.COMPLETED:
        return Response({
            'success': False,
            'error': 'ניתן לנסות שוב רק הרצה שהושלמה',
            'error_code': 'RUN_NOT_COMPLETED',
        }, status=status.HTTP_400_BAD_REQUEST)

    original_summary = (original_run.diagnostics or {}).get('population_summary') or {}
    original_student_ids = original_summary.get('sent_to_solver_student_ids')

    if not original_student_ids:
        return Response({
            'success': False,
            'error': (
                'להרצה זו אין נתוני אוכלוסייה שמורים (הרצה ישנה מלפני תכונה זו) — '
                'לא ניתן לנסות שוב באופן בטוח בלי לדעת בדיוק אילו סטודנטים נשלחו '
                'לשיבוץ במקור. יש להריץ שיבוץ מלא חדש במקום.'
            ),
            'error_code': 'MISSING_ORIGINAL_POPULATION',
        }, status=status.HTTP_400_BAD_REQUEST)

    # Defensive re-check: only students who are (a) still part of the
    # original candidate set, (b) still not accessibility/leaving, and
    # (c) still without an active assignment. Preserves every existing
    # assignment untouched — this is purely a read-time filter.
    retry_students_qs = _exclude_non_solver_students(
        Student.objects.filter(id__in=original_student_ids)
    ).filter(assigned_room__isnull=True).select_related(
        'accepted_dorm_type', 'accepted_dorm_type__region',
    )
    retry_student_ids = list(retry_students_qs.values_list('id', flat=True))

    if not retry_student_ids:
        return Response({
            'success': True,
            'message': 'כל הסטודנטים מהרצה זו כבר משובצים — אין מה לנסות שוב',
            'result': {
                'retry_of_run_id': original_run.id,
                'retried_student_count': 0,
                'successful_assignments': 0,
                'conflicts': 0,
                'assignments': [],
            },
        }, status=status.HTTP_200_OK)

    with transaction.atomic():
        Region.objects.select_for_update().get(pk=region.pk)
        active_run = AllocationRun.objects.filter(
            region=region,
            status=AllocationRun.Status.RUNNING,
        ).order_by('-started_at').first()

        if active_run is not None:
            return Response({
                'success': False,
                'error': 'כבר רץ שיבוץ עבור אזור זה. נא להמתין לסיום ההרצה הקיימת.',
                'error_code': 'ALLOCATION_ALREADY_RUNNING',
                'region': region.id,
                'run': AllocationRunSerializer(active_run).data,
            }, status=status.HTTP_409_CONFLICT)

        retry_run = AllocationRun.objects.create(
            region=region,
            run_by=request.user,
            status=AllocationRun.Status.RUNNING,
        )

    try:
        from allocation.solver import run_improved_ortools_allocation

        rooms = Room.objects.filter(
            apartment__building__dorm_type__region=region,
            is_active=True,
            apartment__is_active=True,
            apartment__building__is_active=True,
        ).select_related(
            'apartment', 'apartment__building', 'apartment__building__dorm_type',
        ).prefetch_related('beds')

        constraints_config = normalize_allocation_constraints(
            request.data.get('constraints')
        )

        result = run_improved_ortools_allocation(
            students=retry_students_qs,
            rooms=rooms,
            constraints_config=constraints_config,
            allocation_run_id=retry_run.id,
            enable_group_capacity_cuts=True,
        ) or {}

        roommate_matches = result.get('roommate_matches')
        if roommate_matches is None:
            roommate_matches = (
                result.get('mutual_roommate_matches', 0)
                + result.get('one_sided_roommate_matches', 0)
            )

        population_summary = {
            'imported_students': len(retry_student_ids),
            'excluded_accessibility': 0,
            'excluded_leaving': 0,
            'excluded_overlap': 0,
            'excluded_total': 0,
            'sent_to_solver': len(retry_student_ids),
            'sent_to_solver_student_ids': retry_student_ids,
            'assigned': result.get('successful_assignments', 0),
            'unassigned': result.get('conflicts', 0),
        }

        retry_run.status = AllocationRun.Status.COMPLETED
        retry_run.students_processed = result.get('students_processed', len(retry_student_ids))
        retry_run.successful_assignments = result.get('successful_assignments', 0)
        retry_run.roommate_matches = roommate_matches
        retry_run.conflicts = result.get('conflicts', 0)
        retry_run.completed_at = timezone.now()
        retry_run.diagnostics = {
            **_run_diagnostics_payload(result),
            'population_summary': population_summary,
            'retry_of_run_id': original_run.id,
        }
        refresh_db_connection()
        retry_run.save()

        assignment_rows = _build_assignment_rows_for_run(retry_run)

        return Response({
            'success': True,
            'message': 'ניסיון השיבוץ החוזר הושלם',
            'result': {
                'retry_of_run_id': original_run.id,
                'retried_student_count': len(retry_student_ids),
                'students_processed': result.get('students_processed', len(retry_student_ids)),
                'successful_assignments': result.get('successful_assignments', 0),
                'roommate_matches': roommate_matches,
                'conflicts': result.get('conflicts', 0),
                'solver_status': result.get('solver_status'),
                'warnings': result.get('warnings', []),
                'students_with_no_feasible_beds': result.get('students_with_no_feasible_beds', []),
                'anier_building_179_diagnostics': result.get('anier_building_179_diagnostics', {}),
                'population_summary': population_summary,
                'assignments': assignment_rows,
                'run': AllocationRunSerializer(retry_run).data,
            },
        }, status=status.HTTP_200_OK)

    except Exception as e:
        traceback.print_exc()
        try:
            retry_run.status = AllocationRun.Status.FAILED
            retry_run.error_message = str(e)
            retry_run.completed_at = timezone.now()
            refresh_db_connection()
            retry_run.save()
        except Exception:
            traceback.print_exc()

        return Response({
            'success': False,
            'error': f'שגיאה בניסיון השיבוץ החוזר: {str(e)}',
            'error_type': e.__class__.__name__,
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# =========================
# Allocation lifecycle helpers
# =========================

def _build_assignment_rows_for_run(run):
    """Build the assignment table rows for a completed allocation run."""
    active_assignments = BedAssignment.objects.filter(
        allocation_run=run,
        status=BedAssignment.Status.ACTIVE,
    ).select_related(
        'student',
        'student__accepted_dorm_type',
        'bed',
        'bed__room',
        'bed__room__apartment',
        'bed__room__apartment__building',
        'bed__room__apartment__building__dorm_type',
        'bed__room__apartment__building__dorm_type__region',
    ).order_by(
        'bed__room__apartment__building__number',
        'bed__room__apartment__number',
        'bed__room__name',
        'bed__label',
    )

    rows = []
    for assignment in active_assignments:
        student = assignment.student
        bed = assignment.bed
        room = bed.room
        apartment = room.apartment
        building = apartment.building
        dorm_type = building.dorm_type
        assignment_region = dorm_type.region if dorm_type else None

        rows.append({
            'student_id': student.student_id,
            'student_name': student.full_name,
            'full_name': student.full_name,
            'first_name': student.first_name,
            'last_name': student.last_name,
            'gender': student.gender,
            'requested_religion': student.requested_religion,
            'religion': student.requested_religion,
            'religious': student.religious,
            'placement_sector': student.placement_sector,
            'sector': student.placement_sector,
            'building': building.number,
            'building_number': building.number,
            'apartment': apartment.number,
            'apartment_number': apartment.number,
            'room': room.name,
            'room_name': room.name,
            'bed': bed.label,
            'bed_label': bed.label,
            'dorm_type': dorm_type.name if dorm_type else '',
            'region': assignment_region.name if assignment_region else '',
            'region_id': assignment_region.id if assignment_region else '',
            'assignment_type': assignment.assignment_type,
            'assignment_status': assignment.status,
            'assigned_at': assignment.assigned_at.isoformat() if assignment.assigned_at else '',
        })
    return rows


def _cleanup_run_assignments(run_id, mark_status):
    """
    Atomically cancel ACTIVE BedAssignments created by this run, restore
    student records, and set the run to the given terminal status.
    Returns the count of cancelled assignments.
    """
    from django.db import close_old_connections
    close_old_connections()

    with transaction.atomic():
        now = timezone.now()

        assignments_qs = BedAssignment.objects.filter(
            allocation_run_id=run_id,
            status=BedAssignment.Status.ACTIVE,
        )

        student_ids = list(assignments_qs.values_list('student_id', flat=True))
        deleted_count = assignments_qs.count()

        assignments_qs.update(
            status=BedAssignment.Status.CANCELLED,
            ended_at=now,
        )

        if student_ids:
            Student.objects.filter(id__in=student_ids).update(assigned_room=None)

        AllocationRun.objects.filter(pk=run_id).update(
            status=mark_status,
            completed_at=now,
        )

    return deleted_count


def _execute_allocation_background(allocation_run_id, region_id, constraints_config,
                                    include_assigned, allocation_scope, max_seconds=None):
    """
    Run the allocation solver in a background thread so the HTTP response
    can return the run_id immediately.  The thread updates AllocationRun
    status as it progresses and checks for cancellation_requested (and,
    as of the Stop & Save feature, stop_and_save_requested - see the
    post-solve branch below and _run_stop_watcher/_LiveSolutionCallback
    in allocation/solver.py for how a stop request actually interrupts
    CP-SAT instead of only being noticed after it finishes naturally).
    """
    from django.db import close_old_connections, connection as db_conn

    def _run():
        try:
            close_old_connections()

            region = Region.objects.get(pk=region_id)
            current_status = AllocationRun.objects.filter(
                pk=allocation_run_id
            ).values_list('status', flat=True).first()

            if current_status == AllocationRun.Status.CANCELLATION_REQUESTED:
                AllocationRun.objects.filter(pk=allocation_run_id).update(
                    status=AllocationRun.Status.STOPPED,
                    completed_at=timezone.now(),
                )
                return

            AllocationRun.objects.filter(pk=allocation_run_id).update(
                status=AllocationRun.Status.RUNNING,
            )

            student_fields = _get_model_field_names(Student)

            students_base = Student.objects.filter(
                accepted_dorm_type__region=region
            ).select_related('accepted_dorm_type', 'accepted_dorm_type__region')
            students_base = _exclude_non_solver_students(students_base)

            students_total_in_region = students_base.count()
            students = students_base

            if not include_assigned:
                if 'assigned_bed' in student_fields:
                    students = students.filter(assigned_bed__isnull=True)
                elif 'assigned_room' in student_fields:
                    students = students.filter(assigned_room__isnull=True)

            if allocation_scope == 'new_transfer_only' and 'category' in student_fields:
                students = students.filter(
                    category__in=[
                        Student.StudentCategory.NEW,
                        Student.StudentCategory.TRANSFER,
                    ]
                )

            rooms = Room.objects.filter(
                apartment__building__dorm_type__region=region,
                is_active=True,
                apartment__is_active=True,
                apartment__building__is_active=True,
            ).select_related(
                'apartment',
                'apartment__building',
                'apartment__building__dorm_type',
            ).prefetch_related('beds')

            # Capture the exact solver-input population before the solver
            # runs, so the population summary and any later retry-
            # unassigned request can trace exactly who this run considered
            # — not a re-derived, possibly-drifted approximation.
            run_student_ids = list(students.values_list('id', flat=True))
            population_summary = _population_summary_for_region(
                region, sent_to_solver_student_ids=run_student_ids,
            )

            students_count = students.count()
            rooms_count = rooms.count()

            from allocation.solver import (
                run_improved_ortools_allocation,
                EMPTY_ANIER_BUILDING_179_DIAGNOSTICS,
            )

            empty_diagnostics = {
                'warnings': [],
                'anier_building_179_diagnostics': dict(EMPTY_ANIER_BUILDING_179_DIAGNOSTICS),
                'population_summary': {**population_summary, 'assigned': 0, 'unassigned': 0},
            }

            if students_count == 0:
                AllocationRun.objects.filter(pk=allocation_run_id).update(
                    status=AllocationRun.Status.COMPLETED,
                    students_processed=0,
                    successful_assignments=0,
                    roommate_matches=0,
                    conflicts=0,
                    completed_at=timezone.now(),
                    diagnostics=empty_diagnostics,
                )
                return

            if rooms_count == 0:
                AllocationRun.objects.filter(pk=allocation_run_id).update(
                    status=AllocationRun.Status.FAILED,
                    error_message='לא נמצאו חדרים פעילים באזור זה',
                    completed_at=timezone.now(),
                    diagnostics=empty_diagnostics,
                )
                return

            close_old_connections()

            result = run_improved_ortools_allocation(
                students=students,
                rooms=rooms,
                constraints_config=constraints_config,
                allocation_run_id=allocation_run_id,
                max_seconds=max_seconds,
                enable_group_capacity_cuts=True,
            ) or {}

            AllocationRun.objects.filter(pk=allocation_run_id).update(
                diagnostics={
                    **_run_diagnostics_payload(result),
                    'population_summary': {
                        **population_summary,
                        'assigned': result.get('successful_assignments', 0),
                        'unassigned': result.get('conflicts', 0),
                    },
                },
            )

            # Check for a stop request noticed while the solver was
            # running. Both CANCELLATION_REQUESTED and
            # STOP_AND_SAVE_REQUESTED already triggered a real
            # solver.StopSearch() well before this point (see
            # _run_stop_watcher / _LiveSolutionCallback in
            # allocation/solver.py) - this check only decides what to DO
            # with whatever result the (possibly early-stopped) solve
            # produced: Cancel always discards it; Stop & Save keeps it
            # if - and only if - best-effort persistence already saved a
            # FEASIBLE/OPTIMAL result (unchanged solver.py logic; if
            # nothing was feasible yet, nothing was persisted, so there
            # is nothing to clean up).
            post_status = AllocationRun.objects.filter(
                pk=allocation_run_id
            ).values_list('status', flat=True).first()

            if post_status == AllocationRun.Status.CANCELLATION_REQUESTED:
                _cleanup_run_assignments(
                    allocation_run_id,
                    mark_status=AllocationRun.Status.STOPPED,
                )
                AllocationRun.objects.filter(pk=allocation_run_id).update(live_snapshot=None)
                return

            stopped_early_by_user = post_status == AllocationRun.Status.STOP_AND_SAVE_REQUESTED

            if stopped_early_by_user and not result.get('solution_persisted'):
                AllocationRun.objects.filter(pk=allocation_run_id).update(
                    status=AllocationRun.Status.STOPPED,
                    completed_at=timezone.now(),
                    live_snapshot=None,
                    diagnostics={
                        'warnings': [],
                        'anier_building_179_diagnostics': dict(EMPTY_ANIER_BUILDING_179_DIAGNOSTICS),
                        'stop_reason': 'no_feasible_solution_before_stop',
                    },
                )
                return

            roommate_matches = result.get('roommate_matches')
            if roommate_matches is None:
                roommate_matches = (
                    result.get('mutual_roommate_matches', 0)
                    + result.get('one_sided_roommate_matches', 0)
                )

            update_fields = {
                'status': AllocationRun.Status.COMPLETED,
                'students_processed': result.get('students_processed', students_count),
                'successful_assignments': result.get('successful_assignments', 0),
                'roommate_matches': roommate_matches,
                'conflicts': result.get('conflicts', 0),
                'completed_at': timezone.now(),
                'live_snapshot': None,
            }
            if stopped_early_by_user:
                # Same diagnostics shape already written above, plus the
                # one extra marker - so a stop-and-save result is
                # indistinguishable from a natural completion except for
                # this flag (used by the frontend to show "not proven
                # optimal, stopped early" instead of a plain success).
                update_fields['diagnostics'] = {
                    **_run_diagnostics_payload(result),
                    'population_summary': {
                        **population_summary,
                        'assigned': result.get('successful_assignments', 0),
                        'unassigned': result.get('conflicts', 0),
                    },
                    'stopped_early_by_user': True,
                }

            AllocationRun.objects.filter(pk=allocation_run_id).update(**update_fields)

            print(
                f">>> ASYNC_ALLOCATION_DONE run_id={allocation_run_id} "
                f"assignments={result.get('successful_assignments', 0)}",
                flush=True,
            )

        except Exception as exc:
            traceback.print_exc()
            try:
                AllocationRun.objects.filter(pk=allocation_run_id).update(
                    status=AllocationRun.Status.FAILED,
                    error_message=str(exc)[:5000],
                    completed_at=timezone.now(),
                    live_snapshot=None,
                )
            except Exception:
                traceback.print_exc()
        finally:
            try:
                db_conn.close()
            except Exception:
                pass

    t = threading.Thread(target=_run, daemon=True)
    t.start()


# =========================
# New async allocation views
# =========================

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def start_allocation_run(request):
    """
    Async allocation start.  Creates AllocationRun immediately (202) and
    runs the solver in a background thread.  The caller polls
    GET /api/allocation/runs/<run_id>/ for status and results.
    """
    refresh_db_connection()

    if not (request.user.is_boss or request.user.is_central_admin):
        return Response(
            {'error': 'רק מנהל אזור או מנהל מרכזי יכולים להריץ שיבוץ'},
            status=status.HTTP_403_FORBIDDEN,
        )

    region_value = (
        request.data.get('region')
        or request.data.get('region_id')
        or request.data.get('region_name')
    )

    if not region_value:
        if request.user.is_central_admin:
            return Response({'error': 'נדרש לבחור אזור'}, status=status.HTTP_400_BAD_REQUEST)
        if not request.user.region:
            return Response({'error': 'המשתמש אינו משויך לאזור'}, status=status.HTTP_400_BAD_REQUEST)
        region = request.user.region
    else:
        region = _resolve_region(region_value)
        if not region:
            return Response({'error': 'אזור לא נמצא'}, status=status.HTTP_404_NOT_FOUND)

    if not request.user.is_central_admin:
        if not request.user.region or request.user.region != region:
            return Response(
                {'error': 'אין הרשאה להריץ שיבוץ עבור אזור זה'},
                status=status.HTTP_403_FORBIDDEN,
            )

    constraints_config = normalize_allocation_constraints(request.data.get('constraints'))
    include_assigned = request.data.get('include_assigned') is True
    allocation_scope = request.data.get('allocation_scope')

    from allocation.solver import (
        MIN_USER_SOLVER_TIME_SECONDS,
        MAX_USER_SOLVER_TIME_SECONDS,
        DEFAULT_SOLVER_TIME_SECONDS,
    )

    # "Maximum search duration" (זמן חיפוש מרבי) chosen by the operator
    # before starting the run - a MAXIMUM, not a target: if CP-SAT proves
    # OPTIMAL earlier, it still finishes immediately (unchanged solver
    # behavior, solver.py:max_time_in_seconds). Validated here (view
    # layer) AND again, independently, inside run_improved_ortools_allocation
    # itself - so a malformed/bypassed request can never hand CP-SAT an
    # unreasonable duration even if this check were ever skipped.
    max_solver_seconds_raw = request.data.get('max_solver_seconds')
    if max_solver_seconds_raw in (None, ''):
        max_solver_seconds = DEFAULT_SOLVER_TIME_SECONDS
    else:
        try:
            max_solver_seconds = float(max_solver_seconds_raw)
        except (TypeError, ValueError):
            return Response(
                {'error': 'זמן חיפוש מרבי חייב להיות מספר'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (MIN_USER_SOLVER_TIME_SECONDS <= max_solver_seconds <= MAX_USER_SOLVER_TIME_SECONDS):
            return Response(
                {
                    'error': (
                        f'זמן חיפוש מרבי חייב להיות בין {MIN_USER_SOLVER_TIME_SECONDS} '
                        f'ל-{MAX_USER_SOLVER_TIME_SECONDS} שניות'
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

    with transaction.atomic():
        Region.objects.select_for_update().get(pk=region.pk)

        active_run = AllocationRun.objects.filter(
            region=region,
            status__in=[
                AllocationRun.Status.QUEUED,
                AllocationRun.Status.RUNNING,
                AllocationRun.Status.CANCELLATION_REQUESTED,
                AllocationRun.Status.STOP_AND_SAVE_REQUESTED,
            ],
        ).order_by('-started_at').first()

        if active_run is not None:
            return Response({
                'success': False,
                'error': 'כבר רץ שיבוץ עבור אזור זה. נא להמתין לסיום ההרצה הקיימת.',
                'error_code': 'ALLOCATION_ALREADY_RUNNING',
                'region': region.id,
                'run_id': active_run.id,
                'run': AllocationRunSerializer(active_run).data,
            }, status=status.HTTP_409_CONFLICT)

        allocation_run = AllocationRun.objects.create(
            region=region,
            run_by=request.user,
            status=AllocationRun.Status.QUEUED,
            max_search_seconds=int(max_solver_seconds),
        )

    print(
        f">>> ASYNC_ALLOCATION_START run_id={allocation_run.id} "
        f"region={region.id} user={request.user.email} "
        f"max_solver_seconds={max_solver_seconds}",
        flush=True,
    )

    _execute_allocation_background(
        allocation_run_id=allocation_run.id,
        region_id=region.id,
        constraints_config=constraints_config,
        include_assigned=include_assigned,
        allocation_scope=allocation_scope,
        max_seconds=max_solver_seconds,
    )

    return Response({
        'success': True,
        'message': 'השיבוץ החל. עקבו אחר ההתקדמות.',
        'run_id': allocation_run.id,
        'run': AllocationRunSerializer(allocation_run).data,
    }, status=status.HTTP_202_ACCEPTED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_allocation_run_detail(request, run_id):
    """
    Return the current status of an allocation run plus assignment rows
    once the run is COMPLETED.
    """
    try:
        run = AllocationRun.objects.select_related('region', 'run_by').get(pk=run_id)
    except AllocationRun.DoesNotExist:
        return Response({'error': 'הרצה לא נמצאה'}, status=status.HTTP_404_NOT_FOUND)

    if not request.user.is_central_admin:
        if request.user.region != run.region:
            return Response({'error': 'אין גישה להרצה זו'}, status=status.HTTP_403_FORBIDDEN)

    run_data = AllocationRunSerializer(run).data

    assignment_rows = []
    if run.status == AllocationRun.Status.COMPLETED:
        refresh_db_connection()
        assignment_rows = _build_assignment_rows_for_run(run)

    # Diagnostics (warnings, Building-179/ANIR counters) are persisted on
    # AllocationRun.diagnostics by both the sync and async allocation
    # entry points, so this survives worker restarts and is visible
    # across workers — unlike an in-memory store. Falls back to an
    # empty/zeroed structure for a run that predates this field (JSONField
    # default=dict already covers that at the DB level) or is still in
    # progress.
    from allocation.solver import EMPTY_ANIER_BUILDING_179_DIAGNOSTICS
    run_diagnostics = run.diagnostics or {}

    return Response({
        'run': run_data,
        'assignments': assignment_rows,
        'successful_assignments': run.successful_assignments,
        'roommate_matches': run.roommate_matches,
        'conflicts': run.conflicts,
        'warnings': run_diagnostics.get('warnings', []),
        'anier_building_179_diagnostics': run_diagnostics.get(
            'anier_building_179_diagnostics',
            dict(EMPTY_ANIER_BUILDING_179_DIAGNOSTICS),
        ),
        # 799 processed = 782 assigned + 17 unassigned, and the
        # imported/excluded breakdown behind it — authoritative for THIS
        # run specifically, as persisted at solve time (see
        # _population_summary_for_region).
        'population_summary': run_diagnostics.get('population_summary', {}),
        # solver_status/optimality_proven are already computed by the
        # solver for every run (see _run_diagnostics_payload); surfacing
        # them here lets the frontend show "stopped early, not proven
        # optimal" for a Stop & Save result without any new backend
        # computation. stopped_early_by_user is only ever set True by the
        # Stop & Save finalize branch in _execute_allocation_background.
        'solver_status': run_diagnostics.get('solver_status'),
        'optimality_proven': bool(run_diagnostics.get('optimality_proven', False)),
        'stopped_early_by_user': bool(run_diagnostics.get('stopped_early_by_user', False)),
    }, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_allocation_run_preview(request, run_id):
    """
    Return the current best-feasible-solution-so-far snapshot for a
    RUNNING allocation run, WITHOUT touching the solver or the DB
    assignment tables - "צפה בתוצאה הנוכחית" (View Current Result).

    Deliberately a separate, heavier endpoint from
    get_allocation_run_detail: normal 3s status polling stays
    lightweight (it already is - that endpoint never returns assignment
    rows for a non-COMPLETED run), and this richer preview is only
    fetched when the operator explicitly asks to see it.

    Tries the in-process live_registry first (instant, zero DB cost when
    this process is the one running the solve); falls back to
    AllocationRun.live_snapshot (a throttled, cross-process-safe copy -
    see _LiveSolutionCallback in allocation/solver.py) when nothing is
    registered here, e.g. a different worker process is running the
    solve. Returns {'available': False} - not 404/500 - when no feasible
    solution has been found yet; that is an expected, normal state while
    a run is still searching for its first solution.
    """
    try:
        run = AllocationRun.objects.select_related('region').get(pk=run_id)
    except AllocationRun.DoesNotExist:
        return Response({'error': 'הרצה לא נמצאה'}, status=status.HTTP_404_NOT_FOUND)

    if not request.user.is_central_admin:
        if request.user.region != run.region:
            return Response({'error': 'אין גישה להרצה זו'}, status=status.HTTP_403_FORBIDDEN)

    from allocation import live_registry

    snapshot = live_registry.get(run_id) or run.live_snapshot

    if not snapshot:
        return Response({'available': False, 'snapshot': None}, status=status.HTTP_200_OK)

    return Response({'available': True, 'snapshot': snapshot}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def stop_allocation_run(request, run_id):
    """
    Request cancellation (discard) of an in-progress allocation run -
    the "בטל הרצה" action. Distinct from stop_and_save_allocation_run
    ("עצור ושמור תוצאה"), which keeps the best feasible result found so
    far instead of discarding it. Idempotent: safe to call more than
    once.
    """
    if not (request.user.is_boss or request.user.is_central_admin):
        return Response({'error': 'אין הרשאה לעצור שיבוץ'}, status=status.HTTP_403_FORBIDDEN)

    try:
        with transaction.atomic():
            run = AllocationRun.objects.select_for_update().get(pk=run_id)

            if not request.user.is_central_admin:
                if request.user.region != run.region:
                    return Response(
                        {'error': 'אין הרשאה לעצור הרצה זו'},
                        status=status.HTTP_403_FORBIDDEN,
                    )

            terminal = {
                AllocationRun.Status.STOPPED,
                AllocationRun.Status.COMPLETED,
                AllocationRun.Status.FAILED,
                AllocationRun.Status.DELETED,
                AllocationRun.Status.APPROVED,
            }

            if run.status in terminal:
                return Response({
                    'error': 'הרצה זו כבר הסתיימה',
                    'status': run.status,
                }, status=status.HTTP_409_CONFLICT)

            if run.status == AllocationRun.Status.CANCELLATION_REQUESTED:
                return Response({
                    'message': 'בקשת עצירה כבר נשלחה',
                    'run_id': run_id,
                    'status': run.status,
                }, status=status.HTTP_200_OK)

            if run.status == AllocationRun.Status.STOP_AND_SAVE_REQUESTED:
                # Race protection: a Stop & Save request already won the
                # row lock first - do not silently override it with a
                # discard.
                return Response({
                    'error': 'כבר התבקשה עצירה עם שמירת תוצאה עבור הרצה זו',
                    'run_id': run_id,
                    'status': run.status,
                }, status=status.HTTP_409_CONFLICT)

            AllocationRun.objects.filter(pk=run_id).update(
                status=AllocationRun.Status.CANCELLATION_REQUESTED,
            )

    except AllocationRun.DoesNotExist:
        return Response({'error': 'הרצה לא נמצאה'}, status=status.HTTP_404_NOT_FOUND)

    # Best-effort same-process fast path: if the solver for this run
    # happens to be running in this exact process, interrupt it
    # immediately instead of waiting for _run_stop_watcher's next poll
    # tick. Harmless no-op otherwise (cross-process case) - the DB flag
    # just written above is what _run_stop_watcher/_LiveSolutionCallback
    # actually rely on to notice the request everywhere else.
    from allocation import live_registry
    live_registry.request_stop_search(run_id)

    return Response({
        'message': 'בקשת עצירה נשלחה. השיבוץ ייעצר בהקדם והנתונים החלקיים יימחקו.',
        'run_id': run_id,
    }, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def stop_and_save_allocation_run(request, run_id):
    """
    Request an early stop that KEEPS the best feasible result found so
    far - the "עצור ושמור תוצאה" action. Distinct from
    stop_allocation_run ("בטל הרצה"), which discards any partial work.

    Interrupts the running CpSolver via StopSearch() (same-process fast
    path here, plus the always-running _run_stop_watcher inside the
    solve itself regardless of process - see allocation/solver.py), then
    lets the existing best-effort persistence logic in
    run_improved_ortools_allocation decide the outcome exactly as it
    always has: a FEASIBLE or OPTIMAL result is persisted via the
    unchanged transaction.atomic/select_for_update/bulk_create/
    bulk_update block; UNKNOWN (no incumbent found yet) persists
    nothing. See _execute_allocation_background's post-solve branch for
    how the run is finalized either way. Idempotent: safe to call more
    than once.
    """
    if not (request.user.is_boss or request.user.is_central_admin):
        return Response({'error': 'אין הרשאה לעצור שיבוץ'}, status=status.HTTP_403_FORBIDDEN)

    try:
        with transaction.atomic():
            run = AllocationRun.objects.select_for_update().get(pk=run_id)

            if not request.user.is_central_admin:
                if request.user.region != run.region:
                    return Response(
                        {'error': 'אין הרשאה לעצור הרצה זו'},
                        status=status.HTTP_403_FORBIDDEN,
                    )

            terminal = {
                AllocationRun.Status.STOPPED,
                AllocationRun.Status.COMPLETED,
                AllocationRun.Status.FAILED,
                AllocationRun.Status.DELETED,
                AllocationRun.Status.APPROVED,
            }

            if run.status in terminal:
                return Response({
                    'error': 'הרצה זו כבר הסתיימה',
                    'status': run.status,
                }, status=status.HTTP_409_CONFLICT)

            if run.status == AllocationRun.Status.STOP_AND_SAVE_REQUESTED:
                return Response({
                    'message': 'בקשת עצירה ושמירה כבר נשלחה',
                    'run_id': run_id,
                    'status': run.status,
                }, status=status.HTTP_200_OK)

            if run.status == AllocationRun.Status.CANCELLATION_REQUESTED:
                # Race protection: a Cancel request already won the row
                # lock first - do not resurrect the run into a
                # save-on-stop path underneath it.
                return Response({
                    'error': 'כבר התבקש ביטול הרצה זו',
                    'run_id': run_id,
                    'status': run.status,
                }, status=status.HTTP_409_CONFLICT)

            AllocationRun.objects.filter(pk=run_id).update(
                status=AllocationRun.Status.STOP_AND_SAVE_REQUESTED,
            )

    except AllocationRun.DoesNotExist:
        return Response({'error': 'הרצה לא נמצאה'}, status=status.HTTP_404_NOT_FOUND)

    from allocation import live_registry
    live_registry.request_stop_search(run_id)

    return Response({
        'message': 'בקשת עצירה עם שמירת תוצאה נשלחה. הפתרון הטוב ביותר שנמצא יישמר.',
        'run_id': run_id,
    }, status=status.HTTP_200_OK)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def delete_allocation_run(request, run_id):
    """
    Delete the draft results of a COMPLETED (not APPROVED) allocation run.
    Cancels all BedAssignments created by that run and restores students.
    Returns 409 if the run is already approved.
    """
    if not (request.user.is_boss or request.user.is_central_admin):
        return Response({'error': 'אין הרשאה למחוק תוצאות שיבוץ'}, status=status.HTTP_403_FORBIDDEN)

    try:
        run = AllocationRun.objects.select_related('region').get(pk=run_id)
    except AllocationRun.DoesNotExist:
        return Response({'error': 'הרצה לא נמצאה'}, status=status.HTTP_404_NOT_FOUND)

    if not request.user.is_central_admin:
        if request.user.region != run.region:
            return Response({'error': 'אין הרשאה למחוק הרצה זו'}, status=status.HTTP_403_FORBIDDEN)

    if run.status == AllocationRun.Status.APPROVED:
        return Response(
            {'error': 'לא ניתן למחוק הקצאה שאושרה סופית'},
            status=status.HTTP_409_CONFLICT,
        )

    if run.status != AllocationRun.Status.COMPLETED:
        return Response({
            'error': f'לא ניתן למחוק הרצה עם סטטוס: {run.status}',
            'status': run.status,
        }, status=status.HTTP_409_CONFLICT)

    deleted_count = _cleanup_run_assignments(
        run_id,
        mark_status=AllocationRun.Status.DELETED,
    )

    return Response({
        'message': 'תוצאות השיבוץ נמחקו בהצלחה',
        'run_id': run_id,
        'deleted_assignments': deleted_count,
    }, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_active_allocation_run(request):
    """
    Return an active allocation run, or the latest completed run
    only when its active assignments still exist.
    """
    # G3-08: centralized region resolution - a region_boss/employee can
    # never read another region's active run by supplying ?region=, they
    # get a clean 403 instead (previously this endpoint had NO role check
    # at all on the query param, the widest-open instance of this bug).
    region_value = request.query_params.get('region')
    region, error = resolve_scoped_region(request.user, region_value)
    if error:
        return error

    if region is None:
        # central_admin with no region selected - "active run" has no
        # single-region meaning to aggregate, matching prior behavior.
        return Response(
            {'run': None},
            status=status.HTTP_200_OK,
        )

    active_statuses = [
        AllocationRun.Status.QUEUED,
        AllocationRun.Status.RUNNING,
        AllocationRun.Status.CANCELLATION_REQUESTED,
    ]

    active_run = AllocationRun.objects.filter(
        region=region,
        status__in=active_statuses,
    ).order_by('-started_at').first()

    if active_run:
        return Response(
            {
                'run': AllocationRunSerializer(
                    active_run
                ).data
            },
            status=status.HTTP_200_OK,
        )

    latest_completed_run = AllocationRun.objects.filter(
        region=region,
        status=AllocationRun.Status.COMPLETED,
    ).order_by('-started_at').first()

    if not latest_completed_run:
        return Response(
            {'run': None},
            status=status.HTTP_200_OK,
        )

    has_current_assignments = BedAssignment.objects.filter(
        allocation_run=latest_completed_run,
        status=BedAssignment.Status.ACTIVE,
        bed__room__is_active=True,
        bed__room__apartment__is_active=True,
        bed__room__apartment__building__is_active=True,
    ).exists()

    if not has_current_assignments:
        return Response(
            {'run': None},
            status=status.HTTP_200_OK,
        )

    return Response(
        {
            'run': AllocationRunSerializer(
                latest_completed_run
            ).data
        },
        status=status.HTTP_200_OK,
    )

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def allocation_history(request):
    queryset = AllocationRun.objects.all()

    if not request.user.is_central_admin:
        queryset = queryset.filter(region=request.user.region)

    serializer = AllocationRunSerializer(queryset[:20], many=True)
    return Response({'runs': serializer.data})


def _unassigned_students_queryset(region=None):
    """
    Currently-unassigned, solver-eligible students (excludes leaving and
    accessibility-flagged students, who are never part of this population -
    accessibility students are handled entirely by the separate
    accessibility-pending queue, see _accessibility_pending_queryset).

    Single source of truth for this population, shared by allocation_results
    and the Assisted Allocation queue endpoint so they can never drift.
    """
    queryset = Student.objects.select_related(
        'accepted_dorm_type',
        'accepted_dorm_type__region',
    ).exclude(
        category=Student.StudentCategory.LEAVING
    ).exclude(
        accessibility_flag=True
    ).filter(
        assigned_room__isnull=True
    )

    if region:
        queryset = queryset.filter(accepted_dorm_type__region=region)

    return queryset.order_by(
        '-is_priority',
        'last_name',
        'first_name',
        'student_id',
    )


def _accessibility_pending_queryset(region=None):
    """Accessibility-flagged students who still have no bed assignment."""
    queryset = Student.objects.select_related(
        'accepted_dorm_type',
        'accepted_dorm_type__region',
    ).filter(
        accessibility_flag=True,
        assigned_room__isnull=True,
    )

    if region:
        queryset = queryset.filter(accepted_dorm_type__region=region)

    return queryset.order_by('last_name', 'first_name', 'student_id')


def _build_unassigned_analysis(students):
    """
    Group currently-unassigned students by the characteristics that
    actually determine bed compatibility (accepted dorm type, gender,
    housing type) and explain, for each group, why they are blocked
    right now — physically free beds vs. beds actually compatible with
    them, and the first hard-constraint stage responsible.

    Reuses allocation.solver.analyze_unassigned_group — the exact staged
    predicates the solver's own candidate generation uses — so the
    reported reason can never diverge from real solver behavior. This
    function only handles grouping and current-inventory lookup; it
    contains no eligibility rules of its own.

    Computed against CURRENT active inventory (not a historical snapshot
    from any particular run), so it stays correct and actionable after
    staff convert apartments and reflects "what would happen if allocation
    ran again right now."
    """
    groups = defaultdict(list)
    for student in students:
        dorm_type = student.accepted_dorm_type
        key = (
            dorm_type.id if dorm_type else None,
            student.gender or '',
            student.housing_type or '',
        )
        groups[key].append(student)

    if not groups:
        return []

    from allocation.solver import analyze_unassigned_group

    dorm_type_ids = {key[0] for key in groups if key[0] is not None}
    rooms_by_dorm_type = defaultdict(list)
    if dorm_type_ids:
        rooms_qs = Room.objects.filter(
            apartment__building__dorm_type_id__in=dorm_type_ids,
            is_active=True,
            apartment__is_active=True,
            apartment__building__is_active=True,
        ).select_related(
            'apartment',
            'apartment__building',
            'apartment__building__dorm_type',
        ).prefetch_related('beds')
        for room in rooms_qs:
            rooms_by_dorm_type[room.apartment.building.dorm_type_id].append(room)

    category_labels = dict(Apartment.Category.choices)
    apartment_type_labels = dict(Apartment.ApartmentType.choices)

    analysis = []
    for (dorm_type_id, gender, housing_type), group_students in groups.items():
        representative = group_students[0]
        dorm_type = representative.accepted_dorm_type
        housing_type_display = (
            representative.get_housing_type_display() if housing_type else ''
        )

        if dorm_type_id is None:
            analysis.append({
                'accepted_dorm_type_id': None,
                'accepted_dorm_type_code': None,
                'accepted_dorm_type_name': '',
                'gender': gender,
                'housing_type': housing_type,
                'housing_type_display': housing_type_display,
                'student_count': len(group_students),
                'physically_free_beds_in_accepted_dorm': 0,
                'compatible_free_beds': 0,
                'reason_code': 'NO_ACCEPTED_DORM_TYPE',
                'inventory_breakdown': [],
            })
            continue

        group_rooms = rooms_by_dorm_type.get(dorm_type_id, [])
        result = analyze_unassigned_group(representative, group_rooms)
        inventory_breakdown = [
            {
                'category': item['category'],
                'category_display': category_labels.get(item['category'], item['category'] or ''),
                'apartment_type': item['apartment_type'],
                'apartment_type_display': apartment_type_labels.get(
                    item['apartment_type'], item['apartment_type'] or '',
                ),
                'free_beds': item['free_beds'],
            }
            for item in result['inventory_breakdown']
        ]

        analysis.append({
            'accepted_dorm_type_id': dorm_type_id,
            'accepted_dorm_type_code': getattr(dorm_type, 'code', None),
            'accepted_dorm_type_name': dorm_type.name if dorm_type else '',
            'gender': gender,
            'housing_type': housing_type,
            'housing_type_display': housing_type_display,
            'student_count': len(group_students),
            'physically_free_beds_in_accepted_dorm': result['physically_free_beds_in_accepted_dorm'],
            'compatible_free_beds': result['compatible_free_beds'],
            'reason_code': result['reason_code'],
            'inventory_breakdown': inventory_breakdown,
        })

    analysis.sort(key=lambda row: -row['student_count'])
    return analysis


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def allocation_results(request):
    """
    Return the current allocation results for the permitted region:

    1. Assigned students
    2. Unassigned allocatable students
    3. Available real Bed records

    The endpoint keeps the existing permission and region-scoping rules.
    """
    region_value = request.query_params.get('region') or None
    user = request.user

    # ============================================================
    # Resolve region according to the user's permissions (G3-03:
    # centralized helper - region_boss/employee alike are hard-locked to
    # their own region, a mismatched ?region= is a clean 403, never a
    # silent cross-region peek).
    # ============================================================
    region, error = resolve_scoped_region(user, region_value)
    if error:
        return error

    # ============================================================
    # Assigned students
    # ============================================================
    assignments_qs = BedAssignment.objects.filter(
        status=BedAssignment.Status.ACTIVE,
        bed__room__is_active=True,
        bed__room__apartment__is_active=True,
        bed__room__apartment__building__is_active=True,
    ).select_related(
        'student',
        'student__accepted_dorm_type',
        'student__accepted_dorm_type__region',
        'bed',
        'bed__room',
        'bed__room__apartment',
        'bed__room__apartment__building',
        'bed__room__apartment__building__dorm_type',
        'bed__room__apartment__building__dorm_type__region',
    )

    if region:
        assignments_qs = assignments_qs.filter(
            bed__room__apartment__building__dorm_type__region=region
        )

    assignments_qs = assignments_qs.order_by(
        'bed__room__apartment__building__number',
        'bed__room__apartment__number',
        'bed__room__name',
        'bed__label',
    )

    assignments = []

    for assignment in assignments_qs:
        student = assignment.student
        bed = assignment.bed
        room = bed.room
        apartment = room.apartment
        building = apartment.building
        dorm_type = building.dorm_type
        dorm_region = dorm_type.region if dorm_type else None

        assignments.append({
            'student_id': student.student_id,
            'student_name': student.full_name,
            'full_name': student.full_name,
            'first_name': student.first_name,
            'last_name': student.last_name,

            'gender': student.gender,
            'housing_type': student.housing_type,
            'housing_type_display': (
                student.get_housing_type_display()
                if student.housing_type
                else ''
            ),

            'requested_religion': student.requested_religion,
            'religion': student.requested_religion,
            'religion_display': (
                student.get_requested_religion_display()
                if student.requested_religion
                else ''
            ),

            'religious': student.religious,
            'placement_sector': student.placement_sector,
            'sector': student.placement_sector,
            'is_priority': student.is_priority,

            'building': building.number,
            'building_number': building.number,

            'apartment': apartment.number,
            'apartment_number': apartment.number,

            'apartment_type': apartment.apartment_type,
            'apartment_type_display': (
                apartment.get_apartment_type_display()
                if apartment.apartment_type
                else ''
            ),

            'apartment_category': apartment.category,
            'apartment_category_display': (
                apartment.get_category_display()
                if apartment.category
                else ''
            ),

            'room': room.name,
            'room_name': room.name,

            'bed': bed.label,
            'bed_label': bed.label,

            'dorm_type': dorm_type.name if dorm_type else '',
            'dorm_type_id': dorm_type.id if dorm_type else None,

            'region': dorm_region.name if dorm_region else '',
            'region_id': dorm_region.id if dorm_region else '',

            'assignment_type': assignment.assignment_type,
            'assignment_status': assignment.status,
            'assigned_at': (
                assignment.assigned_at.isoformat()
                if assignment.assigned_at
                else ''
            ),
        })

    # ============================================================
    # Unassigned students
    # ============================================================
    unassigned_qs = _unassigned_students_queryset(region)

    # Materialized once so both the per-student rows below and the grouped
    # unassigned_analysis further down iterate the same population without
    # a second database round trip.
    unassigned_student_objects = list(unassigned_qs)

    # Reused to give an eligible Hasmaha ANIR student a more specific
    # unassigned reason than the generic message below, so a solver-level
    # hard-constraint failure for this group is visibly distinguishable
    # from an ordinary student's generic "no valid assignment" outcome.
    # Accessibility-flagged students never reach this point at all — they
    # are excluded from unassigned_qs above, not shown here with a reason.
    from allocation.solver import _is_hasmaha_anier_student

    unassigned_students = []

    for student in unassigned_student_objects:
        dorm_type = student.accepted_dorm_type
        student_region = dorm_type.region if dorm_type else None

        special_statuses = [
            getattr(student, 'special_status_1', ''),
            getattr(student, 'special_status_2', ''),
            getattr(student, 'special_status_3', ''),
            getattr(student, 'special_status_4', ''),
        ]

        special_statuses = [
            value
            for value in special_statuses
            if value not in (None, '')
        ]

        unassigned_students.append({
            'student_db_id': student.id,
            'student_id': student.student_id,
            'business_partner_id': getattr(
                student,
                'business_partner_id',
                '',
            ),

            'student_name': student.full_name,
            'full_name': student.full_name,
            'first_name': student.first_name,
            'last_name': student.last_name,

            'gender': student.gender,
            'gender_display': (
                student.get_gender_display()
                if student.gender
                else ''
            ),

            'housing_type': student.housing_type,
            'housing_type_display': (
                student.get_housing_type_display()
                if student.housing_type
                else ''
            ),

            'requested_religion': student.requested_religion,
            'religion': student.requested_religion,
            'religion_display': (
                student.get_requested_religion_display()
                if student.requested_religion
                else ''
            ),

            'religious': student.religious,
            'placement_sector': student.placement_sector,
            'placement_sector_display': (
                student.get_placement_sector_display()
                if student.placement_sector
                else ''
            ),

            'is_priority': student.is_priority,
            'priority_reason': student.priority_reason,

            'category': student.category,
            'category_display': (
                student.get_category_display()
                if student.category
                else ''
            ),

            'accepted_dorm_type_id': (
                dorm_type.id
                if dorm_type
                else None
            ),
            'accepted_dorm_type': (
                dorm_type.name
                if dorm_type
                else ''
            ),

            'region_id': (
                student_region.id
                if student_region
                else ''
            ),
            'region': (
                student_region.name
                if student_region
                else ''
            ),

            'special_statuses': special_statuses,
            'unassigned_reason': (
                'סטודנט אנייר זכאי לבניין 179 (כפר הסמכה) — לא נמצאה מיטה '
                'מתאימה בבניין 179 או בבניין אחר בכפר הסמכה בתוצאת השיבוץ '
                'הנוכחית.'
                if _is_hasmaha_anier_student(student)
                else 'לא נמצא שיבוץ חוקי בתוצאת השיבוץ הנוכחית'
            ),
        })

    # ============================================================
    # Available real beds
    #
    # Only active buildings/apartments/rooms are included.
    # A bed with an ACTIVE BedAssignment is not available.
    # ============================================================
    occupied_bed_ids = BedAssignment.objects.filter(
        status=BedAssignment.Status.ACTIVE
    ).values_list(
        'bed_id',
        flat=True,
    )

    available_beds_qs = Bed.objects.filter(
        room__is_active=True,
        room__apartment__is_active=True,
        room__apartment__building__is_active=True,
    ).exclude(
        id__in=occupied_bed_ids
    ).select_related(
        'room',
        'room__apartment',
        'room__apartment__building',
        'room__apartment__building__dorm_type',
        'room__apartment__building__dorm_type__region',
    )

    if region:
        available_beds_qs = available_beds_qs.filter(
            room__apartment__building__dorm_type__region=region
        )

    available_beds_qs = available_beds_qs.order_by(
        'room__apartment__building__number',
        'room__apartment__number',
        'room__name',
        'label',
    )

    available_beds = []

    for bed in available_beds_qs:
        room = bed.room
        apartment = room.apartment
        building = apartment.building
        dorm_type = building.dorm_type
        dorm_region = dorm_type.region if dorm_type else None

        inactive_reason = getattr(apartment, 'inactive_reason', '')

        is_reserved = (
            str(inactive_reason).strip().lower() == 'reserved'
            or str(inactive_reason).strip() == 'שמור'
        )

        available_beds.append({
            'bed_id': bed.id,
            'bed': bed.label,
            'bed_label': bed.label,

            'room_id': room.id,
            'room': room.name,
            'room_name': room.name,
            'room_capacity': room.capacity,

            'apartment_id': apartment.id,
            'apartment': apartment.number,
            'apartment_number': apartment.number,
            'apartment_type': apartment.apartment_type,
            'apartment_type_display': (
                apartment.get_apartment_type_display()
                if apartment.apartment_type
                else ''
            ),
            'apartment_category': apartment.category,
            'apartment_category_display': (
                apartment.get_category_display()
                if apartment.category
                else ''
            ),
            'is_reserved': is_reserved,

            'building_id': building.id,
            'building': building.number,
            'building_number': building.number,
            'building_gender_restriction': getattr(
                building,
                'gender_restriction',
                '',
            ),

            'dorm_type_id': (
                dorm_type.id
                if dorm_type
                else None
            ),
            'dorm_type': (
                dorm_type.name
                if dorm_type
                else ''
            ),

            'region_id': (
                dorm_region.id
                if dorm_region
                else ''
            ),
            'region': (
                dorm_region.name
                if dorm_region
                else ''
            ),
        })

    unassigned_analysis = _build_unassigned_analysis(unassigned_student_objects)

    return Response({
        'counts': {
            'assigned': len(assignments),
            'unassigned': len(unassigned_students),
            'available_beds': len(available_beds),
        },
        'count': len(assignments),

        'assignments': assignments,
        'unassigned_students': unassigned_students,
        'available_beds': available_beds,
        'unassigned_analysis': unassigned_analysis,
    }, status=status.HTTP_200_OK)


# ============================================================================
# Assisted Allocation - staff workbench for accessibility + unassigned
# students (see src/pages/AssistedAllocationPage.js). Every hard-constraint
# check here reuses allocation.solver / allocation.manual_placement; this
# section only handles region scoping, request/response shape, and audit
# logging.
# ============================================================================

def _user_can_access_student_region(user, student):
    """
    Mirrors the region-scoping already used for room-assignment actions
    (_user_can_edit_room), applied to a Student via their accepted dorm
    type's region rather than a Room. A student with no resolvable region
    can only be acted on by a central admin - a regional user can never
    claim jurisdiction over a student the system cannot place in their
    region.
    """
    if not user or not user.is_authenticated:
        return False
    if user.is_central_admin:
        return True
    if not user.region_id:
        return False
    dorm_type = student.accepted_dorm_type
    if not dorm_type or not dorm_type.region_id:
        return False
    return dorm_type.region_id == user.region_id


def _pending_region_transfer(student):
    """
    The student's pending region_transfer StudentRequest, if any, or None.

    Single source of truth reused by the queue, the student-detail panel,
    the recommendations endpoint, and the assign/override write endpoints -
    a student with a pending region-transfer request must read as
    consistently "not locally actionable" everywhere, never computed
    independently in more than one place.
    """
    return StudentRequest.objects.filter(
        student=student,
        request_type=StudentRequest.RequestType.REGION_TRANSFER,
        status=StudentRequest.Status.PENDING,
    ).select_related(
        'target_region', 'source_region', 'requested_by', 'reviewed_by',
    ).order_by('-created_at').first()


def _assisted_allocation_student_row(student, group='', is_transfer_requested=False):
    dorm_type = student.accepted_dorm_type
    region = dorm_type.region if dorm_type else None
    special_statuses = [
        value for value in [
            student.special_status_1, student.special_status_2,
            student.special_status_3, student.special_status_4,
        ] if value
    ]

    return {
        'student_db_id': student.id,
        'student_id': student.student_id,
        'full_name': student.full_name,
        'first_name': student.first_name,
        'last_name': student.last_name,

        'gender': student.gender,
        'gender_display': student.get_gender_display() if student.gender else '',

        'accepted_dorm_type_id': dorm_type.id if dorm_type else None,
        'accepted_dorm_type': dorm_type.name if dorm_type else '',

        'housing_type': student.housing_type,
        'housing_type_display': (
            student.get_housing_type_display() if student.housing_type else ''
        ),

        'requested_religion': student.requested_religion,
        'religion_display': (
            student.get_requested_religion_display() if student.requested_religion else ''
        ),

        'region_id': region.id if region else '',
        'region': region.name if region else '',

        'is_priority': student.is_priority,
        'priority_reason': student.priority_reason,

        'accessibility_flag': student.accessibility_flag,
        'disability_percent': (
            str(student.disability_percent) if student.disability_percent is not None else None
        ),
        'medical_reason': student.medical_reason,
        'special_statuses': special_statuses,

        'group': group,
        'is_transfer_requested': is_transfer_requested,
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def assisted_allocation_queue(request):
    user = request.user
    region_value = request.query_params.get('region')

    # G3-03: centralized region resolution (see resolve_scoped_region) -
    # region_boss/employee can never pull another region's assisted
    # allocation queue via ?region=.
    region, error = resolve_scoped_region(user, region_value)
    if error:
        return error

    # Computed first (not after, as before) so it can be used to keep a
    # pending-transfer student OUT of accessibility_students/
    # unassigned_students below - a student must never simultaneously read
    # as "locally actionable" and "pending transfer to another region".
    transfer_requested_ids = set(
        StudentRequest.objects.filter(
            request_type=StudentRequest.RequestType.REGION_TRANSFER,
            status=StudentRequest.Status.PENDING,
        ).values_list('student_id', flat=True)
    )

    accessibility_students = [
        s for s in _accessibility_pending_queryset(region) if s.id not in transfer_requested_ids
    ]
    unassigned_students = [
        s for s in _unassigned_students_queryset(region) if s.id not in transfer_requested_ids
    ]

    transfer_pending_qs = Student.objects.filter(id__in=transfer_requested_ids).select_related(
        'accepted_dorm_type', 'accepted_dorm_type__region',
    )
    if region:
        transfer_pending_qs = transfer_pending_qs.filter(accepted_dorm_type__region=region)
    transfer_pending_students = list(transfer_pending_qs.order_by('last_name', 'first_name', 'student_id'))

    resolved_audit_qs = AssistedAllocationAudit.objects.filter(
        action_type__in=[
            AssistedAllocationAudit.ActionType.MANUAL_ASSIGNMENT,
            AssistedAllocationAudit.ActionType.MANUAL_OVERRIDE,
        ],
        bed_assignment__status=BedAssignment.Status.ACTIVE,
        student__isnull=False,
    ).select_related(
        'student', 'student__accepted_dorm_type', 'student__accepted_dorm_type__region',
    ).order_by('-created_at')
    if region:
        resolved_audit_qs = resolved_audit_qs.filter(student__accepted_dorm_type__region=region)

    resolved_students = []
    seen_ids = set()
    for audit in resolved_audit_qs:
        if audit.student_id in seen_ids:
            continue
        seen_ids.add(audit.student_id)
        resolved_students.append(audit.student)

    counts = {
        'accessibility_pending': len(accessibility_students),
        'unassigned': len(unassigned_students),
        'resolved': len(resolved_students),
        'transfer_requested': len(transfer_pending_students),
    }
    counts['needs_placement'] = counts['accessibility_pending'] + counts['unassigned']

    tab = request.query_params.get('tab', 'needs_placement')
    group_of = {}
    if tab == 'accessibility':
        students = accessibility_students
        group_of = {s.id: 'accessibility' for s in students}
    elif tab == 'unassigned':
        students = unassigned_students
        group_of = {s.id: 'unassigned' for s in students}
    elif tab == 'resolved':
        students = resolved_students
        group_of = {s.id: 'resolved' for s in students}
    elif tab == 'transfer_pending':
        students = transfer_pending_students
        group_of = {s.id: 'transfer_pending' for s in students}
    else:
        students = accessibility_students + unassigned_students
        group_of = {s.id: 'accessibility' for s in accessibility_students}
        for s in unassigned_students:
            group_of.setdefault(s.id, 'unassigned')

    gender_filter = request.query_params.get('gender')
    if gender_filter:
        students = [s for s in students if s.gender == gender_filter]

    dorm_type_filter = request.query_params.get('dorm_type')
    if dorm_type_filter:
        students = [s for s in students if str(s.accepted_dorm_type_id) == str(dorm_type_filter)]

    search = (request.query_params.get('search') or '').strip().lower()
    if search:
        students = [
            s for s in students
            if search in s.full_name.lower() or search in (s.student_id or '').lower()
        ]

    rows = [
        _assisted_allocation_student_row(
            s,
            group=group_of.get(s.id, tab),
            is_transfer_requested=s.id in transfer_requested_ids,
        )
        for s in students
    ]

    return Response({
        'counts': counts,
        'students': rows,
        'region_id': region.id if region else None,
        'region_name': region.name if region else None,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def assisted_allocation_student_detail(request, pk):
    try:
        student = Student.objects.select_related(
            'accepted_dorm_type', 'accepted_dorm_type__region', 'assigned_room',
        ).get(pk=pk)
    except Student.DoesNotExist:
        return Response({'error': 'הסטודנט לא נמצא'}, status=status.HTTP_404_NOT_FOUND)

    if not _user_can_access_student_region(request.user, student):
        return Response({'error': 'אין הרשאה לאזור זה'}, status=status.HTTP_403_FORBIDDEN)

    pending_transfer = _pending_region_transfer(student)

    # Priority: is_assigned wins over everything (a real placement is the
    # most authoritative state) - a manually-resolved accessibility student
    # must read as 'resolved' here (matching the queue's own "resolved"
    # tab, which is audit-based and not gated on accessibility_flag - see
    # resolved_audit_qs in assisted_allocation_queue), never fall back to
    # showing them as still-pending just because the flag is set. Next, a
    # pending region_transfer request takes the student out of the locally-
    # actionable population entirely (see _pending_region_transfer) -
    # otherwise they read as accessibility/unassigned as before. Previously
    # this only ever checked accessibility_flag, so an already-assigned (or
    # transfer-pending) student was mislabeled 'unassigned' here even
    # though the real state was known - the detail panel (and the
    # GroupBadge it feeds) never reflected it.
    if student.is_assigned:
        group = 'resolved'
    elif pending_transfer is not None:
        group = 'transfer_pending'
    elif student.accessibility_flag:
        group = 'accessibility'
    else:
        group = 'unassigned'
    row = _assisted_allocation_student_row(student, group=group, is_transfer_requested=pending_transfer is not None)

    roommate_requests = []
    for i in range(1, 6):
        name = getattr(student, f'roommate_request_{i}', '')
        if not name:
            continue
        roommate_requests.append({
            'name': name,
            'student_id': getattr(student, f'roommate_request_student_id_{i}', ''),
            'mutual': bool(getattr(student, f'roommate_request_flag_{i}', False)),
        })

    reason = None
    if not student.accessibility_flag and not student.is_assigned and pending_transfer is None:
        dorm_type = student.accepted_dorm_type
        if dorm_type is None:
            reason = {'reason_code': 'NO_ACCEPTED_DORM_TYPE', 'inventory_breakdown': []}
        else:
            from allocation.solver import analyze_unassigned_group

            rooms = list(
                Room.objects.filter(
                    apartment__building__dorm_type=dorm_type,
                    is_active=True,
                    apartment__is_active=True,
                    apartment__building__is_active=True,
                ).select_related(
                    'apartment', 'apartment__building', 'apartment__building__dorm_type',
                ).prefetch_related('beds')
            )
            analysis = analyze_unassigned_group(student, rooms)
            category_labels = dict(Apartment.Category.choices)
            apartment_type_labels = dict(Apartment.ApartmentType.choices)
            reason = {
                'reason_code': analysis['reason_code'],
                'physically_free_beds_in_accepted_dorm': analysis['physically_free_beds_in_accepted_dorm'],
                'compatible_free_beds': analysis['compatible_free_beds'],
                'inventory_breakdown': [
                    {
                        'category': item['category'],
                        'category_display': category_labels.get(item['category'], item['category'] or ''),
                        'apartment_type': item['apartment_type'],
                        'apartment_type_display': apartment_type_labels.get(
                            item['apartment_type'], item['apartment_type'] or '',
                        ),
                        'free_beds': item['free_beds'],
                    }
                    for item in analysis['inventory_breakdown']
                ],
            }

    history = [
        {
            'action_type': entry.action_type,
            'action_type_display': entry.get_action_type_display(),
            'actor_name': entry.actor.get_full_name() if entry.actor else '',
            'created_at': entry.created_at.isoformat(),
            'note': entry.note,
            'overridden_rules': entry.overridden_rules,
        }
        for entry in AssistedAllocationAudit.objects.filter(student=student)
            .select_related('actor').order_by('-created_at')[:10]
    ]

    return Response({
        'student': row,
        'roommate_requests': roommate_requests,
        'reason': reason,
        'history': history,
        # Lets the frontend show WHERE an already-resolved student now lives
        # (building/apartment/room/bed) instead of just a generic "resolved"
        # badge - reuses the same snapshot helper already used to record
        # before/after state on StudentRequest and AssistedAllocationAudit,
        # so this can never disagree with what those already persist.
        'current_placement': _assignment_snapshot(student),
        # The SAME StudentRequest row TransfersPage shows/approves/rejects -
        # serialized with the normal StudentRequestSerializer (not a
        # hand-rolled shape) so this can never drift from what that page
        # displays. None when there is no pending region_transfer.
        'pending_transfer_request': (
            StudentRequestSerializer(pending_transfer).data if pending_transfer else None
        ),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def assisted_allocation_recommendations(request, pk):
    try:
        student = Student.objects.select_related(
            'accepted_dorm_type', 'accepted_dorm_type__region',
        ).get(pk=pk)
    except Student.DoesNotExist:
        return Response({'error': 'הסטודנט לא נמצא'}, status=status.HTTP_404_NOT_FOUND)

    if not _user_can_access_student_region(request.user, student):
        return Response({'error': 'אין הרשאה לאזור זה'}, status=status.HTTP_403_FORBIDDEN)

    dorm_type = student.accepted_dorm_type
    region = dorm_type.region if dorm_type else None

    # An already-assigned student has left this workbench's population -
    # candidates must never be (re)computed for them here. Without this,
    # re-selecting a just-assigned student (e.g. via the post-assign
    # refresh) kept returning a full, freely-selectable candidate list as
    # if the student were still unplaced, letting staff silently re-run
    # manual placement and move them to a different bed with no warning
    # that anything was already saved. assisted_allocation_assign()/
    # _override() reject this case server-side too (defense in depth) -
    # this is what stops the frontend from ever showing the option.
    # Same principle extended to a pending region_transfer request: the
    # student has left this workbench's LOCAL placement population (they
    # are mid-transfer to another region) - local candidates must not be
    # presented, and assisted_allocation_assign()/_override() reject a
    # local placement attempt for them too (see _pending_region_transfer).
    if student.is_assigned or _pending_region_transfer(student) is not None:
        return Response({
            'candidates': {
                'buildings': [], 'total_valid_beds': 0, 'has_more': False,
                'next_offset': None, 'feasible': False,
            },
            'config_opportunities': [],
            'has_unsafe_config_candidates': False,
            'accepted_dorm_type': {'id': dorm_type.id, 'name': dorm_type.name} if dorm_type else None,
            'already_assigned': student.is_assigned,
            'transfer_pending': not student.is_assigned,
        })

    if dorm_type is None:
        return Response({
            'candidates': {
                'buildings': [], 'total_valid_beds': 0, 'has_more': False,
                'next_offset': None, 'feasible': False,
            },
            'config_opportunities': [],
            'accepted_dorm_type': None,
            'reason': 'לסטודנט אין סוג מעונות/אזור מוגדר',
        })

    # No pagination: candidates are hard-scoped to the student's own
    # accepted dorm type (never the whole region), which is a small,
    # bounded inventory - fetching it in full lets the frontend offer real
    # client-side search across every eligible bed instead of only the
    # beds that happen to be on the currently-loaded page. The building
    # list itself is already best-tier-first, so this is still a "ranked
    # initial candidates" view - the UI renders building cards collapsed by
    # default (lazy expansion), it just never needs a second round-trip.
    candidates = find_matching_room_options(
        request.user, student=student, region_id=region.id if region else None,
        limit=None, offset=0, assisted_mode=True,
    )

    from allocation.manual_placement import find_configuration_opportunities, has_unsafe_configuration_candidates

    config_opportunities = []
    has_unsafe_config_candidates = False
    if region is not None:
        queue_students = list(_accessibility_pending_queryset(region)) + list(_unassigned_students_queryset(region))
        config_opportunities = find_configuration_opportunities(region, queue_students)
        for opportunity in config_opportunities:
            opportunity['helps_selected_student'] = student.id in opportunity.get('affected_student_ids', [])
        # Informational only (see has_unsafe_configuration_candidates
        # docstring) - never affects config_opportunities itself, which
        # already only ever contains genuinely empty, safe-to-change units.
        has_unsafe_config_candidates = has_unsafe_configuration_candidates(region, queue_students)

    return Response({
        'candidates': candidates,
        'config_opportunities': config_opportunities,
        'has_unsafe_config_candidates': has_unsafe_config_candidates,
        'accepted_dorm_type': {'id': dorm_type.id, 'name': dorm_type.name},
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def assisted_allocation_override_check(request, pk):
    try:
        student = Student.objects.get(pk=pk)
    except Student.DoesNotExist:
        return Response({'error': 'הסטודנט לא נמצא'}, status=status.HTTP_404_NOT_FOUND)

    if not _user_can_access_student_region(request.user, student):
        return Response({'error': 'אין הרשאה לאזור זה'}, status=status.HTTP_403_FORBIDDEN)

    bed_id = request.query_params.get('bed_id')
    if not bed_id:
        return Response({'error': 'יש לבחור מיטה'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        bed = Bed.objects.select_related(
            'room', 'room__apartment', 'room__apartment__building',
            'room__apartment__building__dorm_type', 'room__apartment__building__dorm_type__region',
        ).get(pk=bed_id)
    except Bed.DoesNotExist:
        return Response({'error': 'המיטה לא נמצאה'}, status=status.HTTP_404_NOT_FOUND)

    if not _user_can_edit_room(request.user, bed.room):
        return Response({'error': 'אין הרשאה לחדר זה'}, status=status.HTTP_403_FORBIDDEN)

    from allocation.manual_placement import evaluate_manual_override
    violations = evaluate_manual_override(student, bed.room)
    blocked = any(not v['overridable'] for v in violations)
    overridable_violations = [v for v in violations if v['overridable']]

    return Response({
        'violations': violations,
        # blocked: at least one violation is structural (gender/housing
        # type/building/dorm-type eligibility) - this placement can never be
        # confirmed, with or without an override note.
        'blocked': blocked,
        # requires_override: compatible except for administrative
        # (religion/reserved) violations an authorized admin may knowingly
        # waive with a documented reason.
        'requires_override': (not blocked) and bool(overridable_violations),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def assisted_allocation_assign(request, pk):
    try:
        student = Student.objects.get(pk=pk)
    except Student.DoesNotExist:
        return Response({'error': 'הסטודנט לא נמצא'}, status=status.HTTP_404_NOT_FOUND)

    if not _user_can_access_student_region(request.user, student):
        return Response({'error': 'אין הרשאה לאזור זה'}, status=status.HTTP_403_FORBIDDEN)

    # Fast, unlocked pre-check for the common (non-racing) case - same
    # convention as StudentRequestViewSet.approve()'s PENDING re-check: this
    # rejects a second manual-placement call for a student the Assisted
    # Allocation workbench has already placed (e.g. a stale screen, a
    # double-click, or the post-assign refresh re-showing the same student)
    # instead of silently ending their current assignment and moving them
    # to a different bed with no warning. A genuine correction to an
    # existing placement belongs to the transfer workflow, not this
    # unassigned-student action. The unique_active_assignment_per_student DB
    # constraint (see BedAssignment.Meta) remains the authoritative backstop
    # against any true concurrent-request race.
    if student.is_assigned:
        return Response(
            {'error': 'הסטודנט/ית כבר משובץ/ת — לא ניתן לבצע שיבוץ ידני נוסף. לשינוי שיבוץ קיים יש להשתמש בבקשת העברה.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Same principle, for a pending region_transfer: local manual placement
    # must not proceed while the student is mid-transfer to another region
    # (Tab A requests a transfer, Tab B manually assigns them locally, is
    # exactly the conflicting-workflow case this blocks) - not just a UI
    # affordance, since a stale tab or a direct API call must be rejected
    # here too.
    if _pending_region_transfer(student) is not None:
        return Response(
            {'error': 'לסטודנט/ית יש בקשת העברה לאזור אחר הממתינה לאישור — לא ניתן לבצע שיבוץ ידני מקומי. יש לבטל את בקשת ההעברה תחילה אם השיבוץ המקומי נדרש.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    bed_id = request.data.get('bed_id')
    if not bed_id:
        return Response({'error': 'יש לבחור מיטה'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        bed = Bed.objects.select_related('room', 'room__apartment', 'room__apartment__building').get(pk=bed_id)
    except Bed.DoesNotExist:
        return Response({'error': 'המיטה לא נמצאה'}, status=status.HTTP_404_NOT_FOUND)

    room = bed.room
    if not _user_can_edit_room(request.user, room):
        return Response({'error': 'אין הרשאה לחדר זה'}, status=status.HTTP_403_FORBIDDEN)

    previous_state = _assignment_snapshot(student)

    try:
        assignment = assign_student_to_room(
            student=student, room=room, assigned_by=request.user,
            assignment_type=BedAssignment.AssignmentType.MANUAL, bed_id=bed.id,
        )
    except ValueError as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except ValidationError as e:
        message = '; '.join(e.messages) if hasattr(e, 'messages') else str(e)
        return Response({'error': message}, status=status.HTTP_400_BAD_REQUEST)

    student.refresh_from_db()
    AssistedAllocationAudit.objects.create(
        action_type=AssistedAllocationAudit.ActionType.MANUAL_ASSIGNMENT,
        actor=request.user,
        student=student,
        bed_assignment=assignment,
        building=room.apartment.building,
        apartment=room.apartment,
        previous_state=previous_state,
        new_state=_assignment_snapshot(student),
    )

    return Response({'message': 'הסטודנט שובץ בהצלחה', 'assignment_id': assignment.id})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def assisted_allocation_override(request, pk):
    # G3-11: overriding deliberately waives a hard placement/business rule -
    # unlike the normal assign() action (open to any in-region employee),
    # this is an elevated administrative action and requires region_boss or
    # central_admin. This does not change what the override actually does
    # (evaluate_manual_override's violation checks below are untouched),
    # only who may invoke it.
    if not request.user.is_boss:
        return Response({'error': 'רק מנהל אזור או מנהל מרכזי יכול לבצע שיבוץ בחריגה'}, status=status.HTTP_403_FORBIDDEN)

    try:
        student = Student.objects.get(pk=pk)
    except Student.DoesNotExist:
        return Response({'error': 'הסטודנט לא נמצא'}, status=status.HTTP_404_NOT_FOUND)

    if not _user_can_access_student_region(request.user, student):
        return Response({'error': 'אין הרשאה לאזור זה'}, status=status.HTTP_403_FORBIDDEN)

    # Same pre-checks as assisted_allocation_assign() above - see its comments.
    if student.is_assigned:
        return Response(
            {'error': 'הסטודנט/ית כבר משובץ/ת — לא ניתן לבצע שיבוץ ידני נוסף. לשינוי שיבוץ קיים יש להשתמש בבקשת העברה.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if _pending_region_transfer(student) is not None:
        return Response(
            {'error': 'לסטודנט/ית יש בקשת העברה לאזור אחר הממתינה לאישור — לא ניתן לבצע שיבוץ ידני מקומי. יש לבטל את בקשת ההעברה תחילה אם השיבוץ המקומי נדרש.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    bed_id = request.data.get('bed_id')
    note = (request.data.get('note') or '').strip()
    if not bed_id:
        return Response({'error': 'יש לבחור מיטה'}, status=status.HTTP_400_BAD_REQUEST)
    if not note:
        return Response({'error': 'יש להזין סיבה לחריגה'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        bed = Bed.objects.select_related('room', 'room__apartment', 'room__apartment__building').get(pk=bed_id)
    except Bed.DoesNotExist:
        return Response({'error': 'המיטה לא נמצאה'}, status=status.HTTP_404_NOT_FOUND)

    room = bed.room
    if not _user_can_edit_room(request.user, room):
        return Response({'error': 'אין הרשאה לחדר זה'}, status=status.HTTP_403_FORBIDDEN)

    from allocation.manual_placement import evaluate_manual_override
    # Recomputed server-side - a client-sent violation list is never trusted.
    violations = evaluate_manual_override(student, room)

    # Structural violations (gender/housing type/building/dorm-type
    # eligibility) can never be overridden, by anyone, for any reason - a
    # note does not make a fundamentally invalid placement valid. This is
    # enforced here regardless of what the client showed, so a stale or
    # hand-crafted request can never bypass it.
    blocking = [v for v in violations if not v['overridable']]
    if blocking:
        return Response({
            'error': 'לא ניתן לבצע שיבוץ בחריגה - קיימת חסימה מוחלטת שאינה ניתנת לעקיפה: '
                     + '; '.join(v['label'] for v in blocking),
            'violations': violations,
        }, status=status.HTTP_400_BAD_REQUEST)

    previous_state = _assignment_snapshot(student)

    try:
        assignment = assign_student_to_room(
            student=student, room=room, assigned_by=request.user,
            assignment_type=BedAssignment.AssignmentType.MANUAL, bed_id=bed.id,
            skip_validation=True,
        )
    except ValueError as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except ValidationError as e:
        message = '; '.join(e.messages) if hasattr(e, 'messages') else str(e)
        return Response({'error': message}, status=status.HTTP_400_BAD_REQUEST)

    student.refresh_from_db()
    AssistedAllocationAudit.objects.create(
        action_type=AssistedAllocationAudit.ActionType.MANUAL_OVERRIDE,
        actor=request.user,
        student=student,
        bed_assignment=assignment,
        building=room.apartment.building,
        apartment=room.apartment,
        previous_state=previous_state,
        new_state=_assignment_snapshot(student),
        overridden_rules=violations,
        note=note,
    )

    return Response({
        'message': 'השיבוץ בוצע בחריגה',
        'assignment_id': assignment.id,
        'overridden_rules': violations,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def allocation_summary(request):
    user = request.user

    # G3-03: centralized region resolution - region_boss/employee can never
    # pull another region's summary via ?region=/?region_id=/?region_name=.
    region_value = (
        request.query_params.get('region')
        or request.query_params.get('region_id')
        or request.query_params.get('region_name')
    )
    region, error = resolve_scoped_region(user, region_value)
    if error:
        return error

    if region is None:
        # central_admin with no region selected - this endpoint has no
        # single-region-independent meaning, matching prior behavior.
        return Response({
                'region': None,
                'total_students': 0,
                'unassigned_students': 0,
                'assigned_students': 0,
                'available_beds': 0,
                'priority_students': 0,
                'total_capacity': 0,
                'occupancy_rate': 0,
                'students_by_category': {
                    'new': 0,
                    'continuing': 0,
                    'transfer': 0,
                    'leaving': 0,
                },
                'students_by_housing_type': {
                    'single_male': 0,
                    'single_female': 0,
                    'single_mixed': 0,
                    'couple': 0,
                    'family': 0,
                    'unknown': 0,
                },
                'inventory_by_type': {
                    'single': {
                        'apartments': 0,
                        'rooms': 0,
                        'total_beds': 0,
                        'occupied_beds': 0,
                        'available_beds': 0,
                    },
                    'couple': {
                        'apartments': 0,
                        'rooms': 0,
                        'total_beds': 0,
                        'occupied_beds': 0,
                        'available_beds': 0,
                    },
                    'family': {
                        'apartments': 0,
                        'rooms': 0,
                        'total_beds': 0,
                        'occupied_beds': 0,
                        'available_beds': 0,
                    },
                },
                'population_summary': {
                    'imported_students': 0,
                    'excluded_accessibility': 0,
                    'excluded_leaving': 0,
                    'excluded_overlap': 0,
                    'excluded_total': 0,
                    'sent_to_solver': 0,
                    'sent_to_solver_student_ids': [],
                },
                'latest_inbox': None,
                'latest_run': None,
            }, status=status.HTTP_200_OK)

    all_students_qs = Student.objects.filter(
        accepted_dorm_type__region=region
    )

    # Pre-run preview of the population summary shown on AllocationPage
    # between upload and clicking "run allocation" — scoped strictly to
    # this region, never a global Student count. sent_to_solver here is
    # an estimate of what a default run would submit right now (eligible
    # and not yet assigned); once a real run exists, its persisted
    # diagnostics.population_summary (exposed via get_allocation_run_detail)
    # is the authoritative figure for that specific run.
    population_summary = _population_summary_for_region(region)

    # Keep the summary's actionable counts aligned with run_allocation:
    # students who are leaving, or who are accessibility/disability cases
    # handled manually by the dorm office, are reported in the breakdown
    # but are never offered to the solver.
    allocatable_students_qs = all_students_qs.exclude(
        category=Student.StudentCategory.LEAVING
    ).exclude(accessibility_flag=True)

    total_students = allocatable_students_qs.count()

    active_assigned_student_ids = BedAssignment.objects.filter(
        status=BedAssignment.Status.ACTIVE,
        student__accepted_dorm_type__region=region,
        bed__room__is_active=True,
        bed__room__apartment__is_active=True,
        bed__room__apartment__building__is_active=True,
    ).values_list(
        'student_id',
        flat=True,
    ).distinct()

    assigned_students = allocatable_students_qs.filter(
        id__in=active_assigned_student_ids
    ).count()

    students_for_allocation_qs = allocatable_students_qs.exclude(
        id__in=active_assigned_student_ids
    )

    unassigned_students = students_for_allocation_qs.count()
    priority_students = allocatable_students_qs.filter(
        is_priority=True
    ).count()

    known_housing_types = [
        Student.HousingType.SINGLE_MALE,
        Student.HousingType.SINGLE_FEMALE,
        Student.HousingType.SINGLE_IN_APARTMENT,
        Student.HousingType.COUPLE,
        Student.HousingType.FAMILY,
    ]

    students_by_housing_type = {
        'single_male': students_for_allocation_qs.filter(
            housing_type=Student.HousingType.SINGLE_MALE
        ).count(),
        'single_female': students_for_allocation_qs.filter(
            housing_type=Student.HousingType.SINGLE_FEMALE
        ).count(),
        'single_mixed': students_for_allocation_qs.filter(
            housing_type=Student.HousingType.SINGLE_IN_APARTMENT
        ).count(),
        'couple': students_for_allocation_qs.filter(
            housing_type=Student.HousingType.COUPLE
        ).count(),
        'family': students_for_allocation_qs.filter(
            housing_type=Student.HousingType.FAMILY
        ).count(),
        'unknown': students_for_allocation_qs.filter(
            Q(housing_type__isnull=True)
            | Q(housing_type='')
            | ~Q(housing_type__in=known_housing_types)
        ).count(),
    }

    students_by_category = {
        'new': all_students_qs.filter(
            category=Student.StudentCategory.NEW
        ).count(),
        'continuing': all_students_qs.filter(
            category=Student.StudentCategory.CONTINUING
        ).count(),
        'transfer': all_students_qs.filter(
            category=Student.StudentCategory.TRANSFER
        ).count(),
        'leaving': all_students_qs.filter(
            category=Student.StudentCategory.LEAVING
        ).count(),
    }

    apartments_qs = Apartment.objects.filter(
        building__dorm_type__region=region,
        is_active=True,
        building__is_active=True,
    )

    rooms_qs = Room.objects.filter(
        apartment__building__dorm_type__region=region,
        is_active=True,
        apartment__is_active=True,
        apartment__building__is_active=True,
    )

    total_capacity = sum(rooms_qs.values_list('capacity', flat=True))

    active_beds_qs = Bed.objects.filter(
        room__apartment__building__dorm_type__region=region,
        room__is_active=True,
        room__apartment__is_active=True,
        room__apartment__building__is_active=True,
    )

    active_assignments_qs = BedAssignment.objects.filter(
        status=BedAssignment.Status.ACTIVE,
        bed__room__apartment__building__dorm_type__region=region,
        bed__room__is_active=True,
        bed__room__apartment__is_active=True,
        bed__room__apartment__building__is_active=True,
    )

    total_beds = active_beds_qs.count()
    occupied_beds = active_assignments_qs.values(
        'bed_id'
    ).distinct().count()

    def inventory_bucket(apartment_type):
        type_apartments = apartments_qs.filter(
            apartment_type=apartment_type
        )
        type_rooms = rooms_qs.filter(
            apartment__apartment_type=apartment_type
        )
        type_beds = active_beds_qs.filter(
            room__apartment__apartment_type=apartment_type
        )
        type_assignments = active_assignments_qs.filter(
            bed__room__apartment__apartment_type=apartment_type
        )

        type_total_beds = type_beds.count()
        type_occupied_beds = type_assignments.values(
            'bed_id'
        ).distinct().count()

        return {
            'apartments': type_apartments.count(),
            'rooms': type_rooms.count(),
            'total_beds': type_total_beds,
            'occupied_beds': type_occupied_beds,
            'available_beds': max(
                type_total_beds - type_occupied_beds,
                0,
            ),
        }

    inventory_by_type = {
        'single': inventory_bucket(
            Apartment.ApartmentType.SINGLE
        ),
        'couple': inventory_bucket(
            Apartment.ApartmentType.COUPLE
        ),
        'family': inventory_bucket(
            Apartment.ApartmentType.FAMILY
        ),
    }

    if total_beds > 0:
        available_beds = max(total_beds - occupied_beds, 0)
        denominator = total_beds
    else:
        available_beds = max(total_capacity - occupied_beds, 0)
        denominator = total_capacity

    occupancy_rate = 0
    if denominator > 0:
        occupancy_rate = round((occupied_beds / denominator) * 100, 2)

    latest_inbox_obj = RegionInbox.objects.filter(
        region=region,
        status__in=[RegionInbox.Status.PENDING, RegionInbox.Status.VIEWED]
    ).select_related('batch').order_by('-created_at').first()

    latest_inbox = None
    if latest_inbox_obj:
        latest_inbox = RegionInboxSerializer(latest_inbox_obj).data

    latest_run_obj = AllocationRun.objects.filter(
        region=region
    ).select_related('run_by').order_by('-started_at').first()

    latest_run = None
    if latest_run_obj:
        latest_run = AllocationRunSerializer(latest_run_obj).data

    return Response({
        'region': RegionSerializer(region).data,
        'total_students': total_students,
        'unassigned_students': unassigned_students,
        'assigned_students': assigned_students,
        'available_beds': available_beds,
        'priority_students': priority_students,
        'total_capacity': total_capacity,
        'occupancy_rate': occupancy_rate,
        'students_by_category': students_by_category,
        'students_by_housing_type': students_by_housing_type,
        'inventory_by_type': inventory_by_type,
        'population_summary': population_summary,
        'latest_inbox': latest_inbox,
        'latest_run': latest_run,
    }, status=status.HTTP_200_OK)

def _annotate_analysis_building_occupancy(buildings_qs, rooms_qs, assignments_qs):
    """
    Queryset-level replacement for the three per-building queries
    analysis_data()'s occupancy_data loop used to run once per building row
    (confirmed baseline finding: 3 extra SQL queries per building,
    `total_queries = 31 + 3*N`, see
    project-quality/performance/ANALYSIS_BASELINE_SUMMARY.md):

      - building_capacity: sum(building_rooms_qs.values_list('capacity', flat=True))
      - building_assigned_beds: assignments_qs.filter(...).values('bed_id').distinct().count()
      - rooms_count: building_rooms_qs.count()

    Same technique already used and verified for Buildings (BLD-01) /
    Apartments (BLD-02) / Rooms (BLD-03) / Beds (BLD-04) via
    _annotate_building_inventory_counts / _annotate_apartment_inventory_counts
    above: each aggregate is an INDEPENDENT correlated subquery (Subquery +
    OuterRef, grouped by the target FK), not several Count()/Sum()
    annotations combined in one annotate() call on joined relations - this
    deliberately avoids the classic Django multi-aggregate JOIN-
    multiplication trap, where combining e.g. a Sum() over rooms and a
    Count() over assignments in the same annotate() would silently inflate
    both by the cross-joined row count of the other relation. Each subquery
    below is independently grouped/evaluated per building and runs inside
    the single `buildings_qs` SQL statement, so results are mathematically
    identical to running the original three queries once per building -
    just computed once, in one round trip, instead of 3*N times.

    `rooms_qs` and `assignments_qs` are passed in exactly as
    analysis_data() already built them (including its is_active and
    region scoping) - this function only adds the
    `apartment__building=OuterRef('pk')` /
    `bed__room__apartment__building=OuterRef('pk')` correlation on top,
    reproducing `building_rooms_qs = rooms_qs.filter(apartment__building=building)`
    and `assignments_qs.filter(bed__room__apartment__building=building)`
    field-for-field. Filtering semantics are therefore preserved exactly,
    with no re-interpretation of what counts as "active"/in-region:
    - _capacity: sum of Room.capacity for rooms matching the caller's
      rooms_qs (active room, active apartment, active building, optional
      region) under this building. NULL (no matching rooms) -> 0, matching
      the original `sum(empty values_list)` which is 0, never None.
    - _rooms_count: count of that same room set - same filter as
      _capacity, count instead of sum, matching the original
      `building_rooms_qs.count()` using the identical `building_rooms_qs`.
    - _assigned_beds: distinct bed count from the caller's assignments_qs
      (ACTIVE status, active room/apartment/building, optional region)
      under this building - matches the original
      `.values('bed_id').distinct().count()` exactly, including the
      distinct-bed semantics.
    """
    capacity_and_rooms_sq = rooms_qs.filter(
        apartment__building=OuterRef('pk'),
    ).order_by().values('apartment__building').annotate(
        cap=Sum('capacity'),
    ).values('cap')

    rooms_count_sq = rooms_qs.filter(
        apartment__building=OuterRef('pk'),
    ).order_by().values('apartment__building').annotate(
        c=Count('id'),
    ).values('c')

    assigned_beds_sq = assignments_qs.filter(
        bed__room__apartment__building=OuterRef('pk'),
    ).order_by().values('bed__room__apartment__building').annotate(
        c=Count('bed_id', distinct=True),
    ).values('c')

    return buildings_qs.annotate(
        _capacity=Coalesce(Subquery(capacity_and_rooms_sq, output_field=IntegerField()), 0),
        _rooms_count=Coalesce(Subquery(rooms_count_sq, output_field=IntegerField()), 0),
        _assigned_beds=Coalesce(Subquery(assigned_beds_sq, output_field=IntegerField()), 0),
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def analysis_data(request):
    user = request.user

    # =========================
    # Resolve region permissions
    # =========================
    if user.is_central_admin:
        region_value = (
            request.query_params.get('region')
            or request.query_params.get('region_id')
            or request.query_params.get('region_name')
        )

        if region_value:
            region = _resolve_region(region_value)
            if not region:
                return Response({
                    'error': 'אזור לא נמצא'
                }, status=status.HTTP_404_NOT_FOUND)
        else:
            region = None
    else:
        if not user.region:
            return Response({
                'error': 'המשתמש אינו משויך לאזור'
            }, status=status.HTTP_400_BAD_REQUEST)
        region = user.region

    # =========================
    # Base querysets
    # =========================
    students_qs = Student.objects.all()

    rooms_qs = Room.objects.filter(
        is_active=True,
        apartment__is_active=True,
        apartment__building__is_active=True,
    )

    buildings_qs = Building.objects.filter(
        is_active=True
    ).select_related(
        'dorm_type',
        'dorm_type__region'
    )

    assignments_qs = BedAssignment.objects.filter(
        status=BedAssignment.Status.ACTIVE,
        bed__room__is_active=True,
        bed__room__apartment__is_active=True,
        bed__room__apartment__building__is_active=True,
    )

    transfers_qs = Transfer.objects.all()
    runs_qs = AllocationRun.objects.all()

    # =========================
    # Region filtering
    # =========================
    if region:
        students_qs = students_qs.filter(
            accepted_dorm_type__region=region
        )

        rooms_qs = rooms_qs.filter(
            apartment__building__dorm_type__region=region
        )

        buildings_qs = buildings_qs.filter(
            dorm_type__region=region
        )

        assignments_qs = assignments_qs.filter(
            bed__room__apartment__building__dorm_type__region=region
        )

        transfers_qs = transfers_qs.filter(
            Q(from_room__apartment__building__dorm_type__region=region) |
            Q(to_room__apartment__building__dorm_type__region=region)
        )

        runs_qs = runs_qs.filter(region=region)

    # =========================
    # Summary numbers
    # =========================
    total_students = students_qs.count()

    # Real assigned students come from active BedAssignment, not from
    # Student.assigned_room. assigned_students / assigned_student_ids /
    # assigned_beds used to be 3 separate queries against the same
    # assignments_qs (2 COUNT DISTINCT + this raw fetch) - consolidated
    # into one fetch of (student_id, bed_id) pairs. This costs nothing
    # extra over the original: assigned_student_ids already had to pull
    # every matching row into memory (it's reused below, unchanged, by
    # the students-by-region loop), so adding bed_id to that same fetch
    # replaces 2 redundant COUNT queries with zero additional data
    # transfer - not a "fetch more to save queries" trade-off.
    # (project-quality/performance/ANALYSIS_FIXED_QUERY_INSPECTION.md,
    # "Assignments" consolidation candidate; validated at N=2,000
    # assignments in api/performance_tests/test_analysis_performance.py.)
    assignment_student_bed_pairs = list(
        assignments_qs.values('student_id', 'bed_id')
    )
    assigned_student_ids = {row['student_id'] for row in assignment_student_bed_pairs}
    assigned_students = len(assigned_student_ids)
    unassigned_students = max(total_students - assigned_students, 0)

    # Priority KPIs must be scoped to the same "automatic allocation
    # population" as the solver/allocation_summary — i.e. exclude LEAVING
    # and accessibility-flagged students, who are never sent to the
    # solver in the first place — so this tile cannot report a priority
    # count larger than the population the allocation pages are actually
    # working with.
    allocatable_students_qs = students_qs.exclude(
        category=Student.StudentCategory.LEAVING
    ).exclude(accessibility_flag=True)

    priority_students = allocatable_students_qs.filter(is_priority=True).count()

    # total_capacity/total_rooms used to be sum(values_list('capacity'))
    # (fetches every matching room's capacity into Python) plus a second,
    # independent .count() query over the same rooms_qs - now a single
    # DB-side aggregate() computes both, with NO room rows transferred to
    # Python at all (strictly less data movement than before, not merely
    # fewer round trips). ("Rooms" consolidation candidate.)
    room_aggregate = rooms_qs.aggregate(total_capacity=Sum('capacity'), total_rooms=Count('id'))
    total_capacity = room_aggregate['total_capacity'] or 0
    total_rooms = room_aggregate['total_rooms'] or 0

    assigned_beds = len({row['bed_id'] for row in assignment_student_bed_pairs})
    available_beds = max(total_capacity - assigned_beds, 0)

    occupancy_rate = 0
    if total_capacity > 0:
        occupancy_rate = round((assigned_beds / total_capacity) * 100, 2)

    total_buildings = buildings_qs.count()

    # all_buildings_count/inactive_buildings_count used to be computed
    # unconditionally (system-wide) and then immediately discarded and
    # recomputed region-scoped whenever `region` was set - 2 wasted
    # queries on every region-scoped request (any non-admin user, or an
    # admin who picked a region - the common case). Now computed exactly
    # once, in whichever shape is actually needed. (Finding "C" - pure
    # dead-code elimination, not a trade-off.)
    if region:
        all_buildings_count = Building.objects.filter(
            dorm_type__region=region
        ).count()
        inactive_buildings_count = Building.objects.filter(
            dorm_type__region=region,
            is_active=False
        ).count()
    else:
        all_buildings_count = Building.objects.count()
        inactive_buildings_count = Building.objects.filter(is_active=False).count()

    # transfers_by_status's grouped counts already contain everything
    # total_transfers/pending_transfers need (every Transfer row falls
    # into exactly one status group) - computed here once and reused
    # both for these two summary numbers AND for the
    # 'transfers_by_status' response field further below (no second,
    # regrouped query). ("Transfers" consolidation candidate.)
    transfers_by_status = list(
        transfers_qs
        .values('status')
        .annotate(count=Count('id'))
        .order_by('status')
    )
    total_transfers = sum(row['count'] for row in transfers_by_status)
    pending_transfers = next(
        (row['count'] for row in transfers_by_status if row['status'] == Transfer.Status.PENDING),
        0,
    )

    latest_run = runs_qs.select_related('run_by', 'region').order_by('-started_at').first()

    # Pending requests via the unified StudentRequest workflow (the page
    # actually used for review/approval today) - kept separate from the
    # legacy Transfer-based pending_transfers above, which predates it.
    requests_qs = StudentRequest.objects.filter(status=StudentRequest.Status.PENDING)
    if region:
        requests_qs = requests_qs.filter(
            Q(requested_by__region_id=region.id) |
            Q(student__accepted_dorm_type__region_id=region.id) |
            Q(target_room__apartment__building__dorm_type__region_id=region.id)
        ).distinct()

    # Pending requests broken down by type, for the Data Analysis page's
    # "Special requests" analysis. requests_qs is ALREADY filtered to
    # status=PENDING only, so this grouped query's counts already sum to
    # exactly what pending_requests needs - one query instead of two.
    # ("Requests" consolidation candidate; requests_qs's region-scoping
    # joins are all forward FK (many-to-one), so .distinct() cannot
    # affect these per-request_type group counts - see
    # ANALYSIS_FIXED_QUERY_INSPECTION.md for the join-structure proof.)
    pending_requests_by_type = list(
        requests_qs
        .values('request_type')
        .annotate(count=Count('id'))
        .order_by('-count')
    )
    pending_requests = sum(row['count'] for row in pending_requests_by_type)

    priority_unassigned_students = allocatable_students_qs.filter(
        is_priority=True
    ).exclude(
        id__in=assignments_qs.values('student_id')
    ).count()

    if region is None:
        latest_batch = ImportBatch.objects.select_related('uploaded_by').order_by('-created_at').first()
    else:
        batch_ids = RegionInbox.objects.filter(region=region).values_list('batch_id', flat=True)
        latest_batch = ImportBatch.objects.filter(
            id__in=batch_ids
        ).select_related('uploaded_by').order_by('-created_at').first()

    # =========================
    # Student distributions
    # These MUST be arrays because AnalysisPage uses .map()
    # =========================
    students_by_gender = list(
        students_qs
        .values('gender')
        .annotate(count=Count('id'))
        .order_by('gender')
    )

    students_by_religion = list(
        students_qs
        .values('requested_religion')
        .annotate(count=Count('id'))
        .order_by('requested_religion')
    )

    students_by_religious = list(
        students_qs
        .values('religious')
        .annotate(count=Count('id'))
        .order_by('religious')
    )

    students_by_category = list(
        students_qs
        .values('category')
        .annotate(count=Count('id'))
        .order_by('category')
    )

    students_by_housing = list(
        students_qs
        .values('housing_type')
        .annotate(count=Count('id'))
        .order_by('housing_type')
    )

    # =========================
    # Students by region
    # Source: Student data only.
    # Primary source: accepted_dorm_type.region
    # Fallback source: current_dorm_type text, resolved through DormType/code/name aliases.
    # This prevents "לא ידוע" when the student has dorm information but accepted_dorm_type is missing.
    # =========================

    def _normalize_for_region_match(value):
        return re.sub(r'\s+', '', safe_str(value)).lower()

    dorm_types_for_region = DormType.objects.select_related('region').all()

    region_by_dorm_name = {}
    region_by_dorm_code = {}

    for dorm_type in dorm_types_for_region:
        if not dorm_type.region:
            continue

        if dorm_type.name:
            region_by_dorm_name[_normalize_for_region_match(dorm_type.name)] = dorm_type.region.name

        if dorm_type.code is not None:
            region_by_dorm_code[str(dorm_type.code)] = dorm_type.region.name

    def _resolve_region_name_from_student_text(value):
        raw_value = safe_str(value)

        if not raw_value:
            return None

        normalized_value = _normalize_for_region_match(raw_value)

        # Example: "2", "02", "2.0"
        code_int = safe_int(raw_value, default=None)
        if code_int is not None:
            region_name = region_by_dorm_code.get(str(code_int))
            if region_name:
                return region_name

        # Exact dorm name match
        region_name = region_by_dorm_name.get(normalized_value)
        if region_name:
            return region_name

        # Legacy/name aliases from the Excel import mapping.
        alias_code = EXCEL_DORM_NAME_TO_OFFICIAL_CODE.get(normalized_value)
        if alias_code is not None:
            region_name = region_by_dorm_code.get(str(alias_code))
            if region_name:
                return region_name

        # Partial match, for values like "מעונות קנדה - בניין 12"
        for dorm_name_normalized, region_name in region_by_dorm_name.items():
            if dorm_name_normalized and dorm_name_normalized in normalized_value:
                return region_name

        for alias_name_normalized, alias_code in EXCEL_DORM_NAME_TO_OFFICIAL_CODE.items():
            if alias_name_normalized and alias_name_normalized in normalized_value:
                region_name = region_by_dorm_code.get(str(alias_code))
                if region_name:
                    return region_name

        return None

    students_by_region_counts = {}

    # Assigned/unassigned split per region, used by the Data Analysis page's
    # "Demand / waiting students" analysis. Built in the same single-query
    # loop as students_by_region above, so it costs nothing extra beyond the
    # assigned_student_ids set already computed above (no N+1).
    students_by_region_demand = {}

    for student in students_qs.select_related(
            'accepted_dorm_type',
            'accepted_dorm_type__region',
    ):
        region_name = None

        if student.accepted_dorm_type and student.accepted_dorm_type.region:
            region_name = student.accepted_dorm_type.region.name

        if not region_name:
            region_name = _resolve_region_name_from_student_text(student.current_dorm_type)

        if not region_name:
            region_name = _resolve_region_name_from_student_text(student.current_address)

        # Do NOT add "לא ידוע" to the graph.
        # If there is truly no dorm data at all, skip it instead of showing a fake category.
        if not region_name:
            continue

        students_by_region_counts[region_name] = students_by_region_counts.get(region_name, 0) + 1

        demand_bucket = students_by_region_demand.setdefault(
            region_name, {'total': 0, 'assigned': 0}
        )
        demand_bucket['total'] += 1
        if student.id in assigned_student_ids:
            demand_bucket['assigned'] += 1

    region_name_to_id = {r.name: r.id for r in Region.objects.all()}

    unassigned_by_region = [
        {
            'region': region_name,
            'region_id': region_name_to_id.get(region_name, ''),
            'total_students': bucket['total'],
            'assigned_students': bucket['assigned'],
            'unassigned_students': max(bucket['total'] - bucket['assigned'], 0),
        }
        for region_name, bucket in sorted(
            students_by_region_demand.items(),
            key=lambda item: item[0]
        )
    ]

    students_by_region = [
        {
            'region': region_name,
            'count': count,
        }
        for region_name, count in sorted(
            students_by_region_counts.items(),
            key=lambda item: item[0]
        )
    ]

    # =========================
    # Transfers distributions
    # =========================
    # transfers_by_status was already computed earlier (Summary numbers
    # section) and reused here unchanged - see the "Transfers"
    # consolidation candidate comment above.
    transfers_by_type = list(
        transfers_qs
        .values('movement_request__movement_type')
        .annotate(count=Count('id'))
        .order_by('movement_request__movement_type')
    )

    # =========================
    # Occupancy by building
    # Uses:
    # - raw capacity from Room.capacity
    # - real occupancy from active BedAssignment
    # =========================
    occupancy_data = []

    # _capacity/_rooms_count/_assigned_beds are computed once, inside this
    # single query, via correlated subqueries - see
    # _annotate_analysis_building_occupancy for the exact filter-for-filter
    # equivalence to the original per-building queries this replaces
    # (confirmed baseline: 3 extra SQL queries per building,
    # `total_queries = 31 + 3*N`).
    occupancy_buildings_qs = _annotate_analysis_building_occupancy(
        buildings_qs, rooms_qs, assignments_qs
    )

    for building in occupancy_buildings_qs.order_by(
        'dorm_type__region__name',
        'dorm_type__name',
        'number'
    ):
        building_capacity = building._capacity
        building_assigned_beds = building._assigned_beds

        building_available_beds = max(
            building_capacity - building_assigned_beds,
            0
        )

        building_occupancy_rate = 0
        if building_capacity > 0:
            building_occupancy_rate = round(
                (building_assigned_beds / building_capacity) * 100,
                2
            )

        dorm_type = building.dorm_type
        dorm_region = dorm_type.region if dorm_type else None

        occupancy_data.append({
            'building_id': building.id,
            'building': f'{dorm_type.name if dorm_type else ""} - בניין {building.number}',
            'building_number': building.number,

            'dorm_type': dorm_type.name if dorm_type else '',
            'region': dorm_region.name if dorm_region else '',
            'region_id': dorm_region.id if dorm_region else '',

            'rooms_count': building._rooms_count,

            # Names expected by AnalysisPage
            'total_beds': building_capacity,
            'assigned': building_assigned_beds,

            # Extra useful fields
            'available_beds': building_available_beds,
            'occupancy_rate': building_occupancy_rate,
        })

    return Response({
        'region': RegionSerializer(region).data if region else None,

        'summary': {
            'total_students': total_students,
            'assigned_students': assigned_students,
            'unassigned_students': unassigned_students,
            'priority_students': priority_students,

            'total_buildings': all_buildings_count,
            'active_buildings': total_buildings,
            'inactive_buildings': inactive_buildings_count,
            'total_rooms': total_rooms,

            # Both names are included so the frontend is safe
            'total_capacity': total_capacity,
            'total_beds': total_capacity,

            'assigned_beds': assigned_beds,
            'occupied_beds': assigned_beds,
            'available_beds': available_beds,
            'occupancy_rate': occupancy_rate,

            'total_transfers': total_transfers,
            'pending_transfers': pending_transfers,
            'pending_requests': pending_requests,
            'priority_unassigned_students': priority_unassigned_students,
        },

        'students_by_gender': students_by_gender,
        'students_by_religion': students_by_religion,
        'students_by_religious': students_by_religious,
        'students_by_category': students_by_category,
        'students_by_housing': students_by_housing,
        'students_by_region': students_by_region,
        'unassigned_by_region': unassigned_by_region,

        'occupancy_data': occupancy_data,

        'transfers_by_status': transfers_by_status,
        'transfers_by_type': transfers_by_type,
        'pending_requests_by_type': pending_requests_by_type,

        'latest_run': AllocationRunSerializer(latest_run).data if latest_run else None,
        'latest_batch': ImportBatchSerializer(latest_batch).data if latest_batch else None,
    }, status=status.HTTP_200_OK)

# =========================
# WHAT IF - Building Inactivation
# =========================

def _what_if_get_buildings_from_request(request):
    building_ids = request.data.get('building_ids') or request.data.get('buildings') or []

    if not isinstance(building_ids, list) or len(building_ids) == 0:
        raise ValueError('building_ids must be a non-empty list.')

    buildings = Building.objects.filter(id__in=building_ids).select_related(
        'dorm_type',
        'dorm_type__region'
    )

    if buildings.count() != len(set(building_ids)):
        raise ValueError('One or more selected buildings were not found.')

    return buildings


def _what_if_user_can_access_buildings(user, buildings):
    if user.is_central_admin:
        return True

    if not user.region_id:
        return False

    return not buildings.exclude(dorm_type__region=user.region).exists()


def _what_if_get_affected_assignments(building_ids):
    return BedAssignment.objects.filter(
        status=BedAssignment.Status.ACTIVE,
        bed__room__apartment__building_id__in=building_ids,
    ).select_related(
        'student',
        'student__accepted_dorm_type',
        'bed',
        'bed__room',
        'bed__room__apartment',
        'bed__room__apartment__building',
        'bed__room__apartment__building__dorm_type',
        'bed__room__apartment__building__dorm_type__region',
    ).order_by(
        'bed__room__apartment__building__number',
        'bed__room__apartment__number',
        'bed__room__name',
        'bed__label',
    )


def _what_if_format_student_from_assignment(assignment):
    student = assignment.student
    bed = assignment.bed
    room = bed.room
    apartment = room.apartment
    building = apartment.building
    dorm_type = building.dorm_type
    region = dorm_type.region if dorm_type else None

    return {
        'assignment_id': assignment.id,

        'student_db_id': student.id,
        'student_id': student.student_id,
        'business_partner_id': student.business_partner_id,
        'full_name': student.full_name,
        'first_name': student.first_name,
        'last_name': student.last_name,

        'gender': student.gender,
        'requested_religion': student.requested_religion,
        'religious': student.religious,
        'placement_sector': student.placement_sector,
        'category': student.category,
        'housing_type': student.housing_type,

        # Same get_FOO_display() convention StudentSerializer already
        # exposes as gender_display/requested_religion_display/
        # religious_display (see serializers.py) - added here so the
        # What-If "Affected Students" table can show the same human-
        # readable labels used everywhere else in the app instead of the
        # raw enum codes above (project-quality/ui/
        # UI_FIXES_DASHBOARD_WHATIF_REPORT.md).
        'gender_display': student.get_gender_display() if student.gender else '',
        'requested_religion_display': student.get_requested_religion_display(),
        'religious_display': student.get_religious_display(),

        'is_priority': student.is_priority,
        'priority_reason': student.priority_reason,

        'accepted_dorm_type_id': student.accepted_dorm_type_id,
        'accepted_dorm_type_name': student.accepted_dorm_type.name if student.accepted_dorm_type else '',

        'current_building_id': building.id,
        'current_building_number': building.number,
        'current_apartment_id': apartment.id,
        'current_apartment_number': apartment.number,
        'current_room_id': room.id,
        'current_room_name': room.name,
        'current_bed_id': bed.id,
        'current_bed_label': bed.label,

        'dorm_type_id': dorm_type.id if dorm_type else None,
        'dorm_type_name': dorm_type.name if dorm_type else '',
        'region_id': region.id if region else '',
        'region_name': region.name if region else '',

        'status': 'needs_transfer',
    }


def _what_if_count_by_value(items, key):
    counts = {}

    for item in items:
        value = item.get(key) or 'not_specified'
        counts[value] = counts.get(value, 0) + 1

    return [
        {
            'value': value,
            'count': count
        }
        for value, count in counts.items()
    ]


def _what_if_analysis_snapshot(region=None, excluded_building_ids=None):
    excluded_building_ids = excluded_building_ids or []

    buildings_qs = Building.objects.filter(
        is_active=True
    ).select_related(
        'dorm_type',
        'dorm_type__region'
    )

    rooms_qs = Room.objects.filter(
        is_active=True,
        apartment__is_active=True,
        apartment__building__is_active=True,
    )

    assignments_qs = BedAssignment.objects.filter(
        status=BedAssignment.Status.ACTIVE,
        bed__room__is_active=True,
        bed__room__apartment__is_active=True,
        bed__room__apartment__building__is_active=True,
    )

    students_qs = Student.objects.all()

    if region:
        buildings_qs = buildings_qs.filter(
            dorm_type__region=region
        )
        rooms_qs = rooms_qs.filter(
            apartment__building__dorm_type__region=region
        )
        assignments_qs = assignments_qs.filter(
            bed__room__apartment__building__dorm_type__region=region
        )
        students_qs = students_qs.filter(
            accepted_dorm_type__region=region
        )

    if excluded_building_ids:
        buildings_qs = buildings_qs.exclude(
            id__in=excluded_building_ids
        )
        rooms_qs = rooms_qs.exclude(
            apartment__building_id__in=excluded_building_ids
        )
        assignments_qs = assignments_qs.exclude(
            bed__room__apartment__building_id__in=excluded_building_ids
        )

    total_students = students_qs.count()
    assigned_students = assignments_qs.values('student_id').distinct().count()
    unassigned_students = max(total_students - assigned_students, 0)

    total_capacity = sum(
        rooms_qs.values_list('capacity', flat=True)
    )

    occupied_beds = assignments_qs.values('bed_id').distinct().count()
    available_beds = max(total_capacity - occupied_beds, 0)

    occupancy_rate = 0
    if total_capacity > 0:
        occupancy_rate = round((occupied_beds / total_capacity) * 100, 2)

    return {
        'total_students': total_students,
        'assigned_students': assigned_students,
        'unassigned_students': unassigned_students,
        'total_buildings': buildings_qs.count(),
        'total_rooms': rooms_qs.count(),
        'total_capacity': total_capacity,
        'total_beds': total_capacity,
        'occupied_beds': occupied_beds,
        'assigned_beds': occupied_beds,
        'available_beds': available_beds,
        'occupancy_rate': occupancy_rate,
    }


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def what_if_building_inactivation_simulate(request):
    """
    Simulate what happens if one or more buildings are inactivated.
    This endpoint does NOT change the database.
    """
    try:
        buildings = _what_if_get_buildings_from_request(request)

        if not _what_if_user_can_access_buildings(request.user, buildings):
            return Response({
                'success': False,
                'error': 'אין הרשאה לבצע סימולציה עבור אחד או יותר מהבניינים שנבחרו.'
            }, status=status.HTTP_403_FORBIDDEN)

        building_ids = list(buildings.values_list('id', flat=True))

        affected_assignments = _what_if_get_affected_assignments(building_ids)

        affected_students = [
            _what_if_format_student_from_assignment(assignment)
            for assignment in affected_assignments
        ]

        selected_regions = list(
            buildings.values_list('dorm_type__region_id', flat=True).distinct()
        )

        snapshot_region = None
        if len(selected_regions) == 1 and selected_regions[0]:
            snapshot_region = Region.objects.filter(pk=selected_regions[0]).first()

        lost_rooms_qs = Room.objects.filter(
            apartment__building_id__in=building_ids,
            is_active=True,
            apartment__is_active=True,
        )

        lost_apartments = Apartment.objects.filter(
            building_id__in=building_ids,
            is_active=True,
        ).count()

        lost_rooms = lost_rooms_qs.count()

        lost_capacity = sum(
            lost_rooms_qs.values_list('capacity', flat=True)
        )

        lost_beds = Bed.objects.filter(
            room__apartment__building_id__in=building_ids,
            room__is_active=True,
            room__apartment__is_active=True,
        ).count()

        selected_buildings = []

        for building in buildings:
            dorm_type = building.dorm_type
            region = dorm_type.region if dorm_type else None

            selected_buildings.append({
                'id': building.id,
                'number': building.number,
                'dorm_type_id': dorm_type.id if dorm_type else None,
                'dorm_type_name': dorm_type.name if dorm_type else '',
                'region_id': region.id if region else '',
                'region_name': region.name if region else '',
                'is_active': building.is_active,
            })

        analysis_before = _what_if_analysis_snapshot(
            region=snapshot_region
        )

        analysis_after = _what_if_analysis_snapshot(
            region=snapshot_region,
            excluded_building_ids=building_ids
        )

        return Response({
            'success': True,
            'scenario': 'building_inactivation',
            'selected_buildings': selected_buildings,

            'summary': {
                'affected_students_count': len(affected_students),
                'students_without_valid_placement': len(affected_students),

                'male_count': sum(
                    1 for student in affected_students
                    if student.get('gender') == Student.Gender.MALE
                ),
                'female_count': sum(
                    1 for student in affected_students
                    if student.get('gender') == Student.Gender.FEMALE
                ),

                'lost_apartments': lost_apartments,
                'lost_rooms': lost_rooms,
                'lost_capacity': lost_capacity,
                'lost_beds': lost_beds,
            },

            'breakdowns': {
                'gender': _what_if_count_by_value(affected_students, 'gender'),
                'requested_religion': _what_if_count_by_value(affected_students, 'requested_religion'),
                'religious': _what_if_count_by_value(affected_students, 'religious'),
                'placement_sector': _what_if_count_by_value(affected_students, 'placement_sector'),
                'category': _what_if_count_by_value(affected_students, 'category'),
                'housing_type': _what_if_count_by_value(affected_students, 'housing_type'),
            },

            'analysis_before': analysis_before,
            'analysis_after': analysis_after,
            'affected_students': affected_students,
        }, status=status.HTTP_200_OK)

    except ValueError as e:
        return Response({
            'success': False,
            'error': str(e)
        }, status=status.HTTP_400_BAD_REQUEST)

    except Exception as e:
        traceback.print_exc()
        return Response({
            'success': False,
            'error': str(e),
            'error_type': e.__class__.__name__,
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def what_if_building_inactivation_confirm(request):
    """
    Confirm building inactivation and create pending StudentRequest rows
    (the model backing the Transfer Requests / בקשות מעבר page) for
    affected active assignments. This does not choose new rooms and does
    not run allocation.
    """
    try:
        if not request.user.is_boss:
            return Response({
                'success': False,
                'error': 'רק מנהל יכול לאשר השבתת בניינים ויצירת בקשות העברה.'
            }, status=status.HTTP_403_FORBIDDEN)

        buildings = _what_if_get_buildings_from_request(request)

        if not _what_if_user_can_access_buildings(request.user, buildings):
            return Response({
                'success': False,
                'error': 'אין הרשאה להשבית אחד או יותר מהבניינים שנבחרו.'
            }, status=status.HTTP_403_FORBIDDEN)

        reason = request.data.get('reason') or 'Building was inactivated and student needs transfer.'
        inactivate_buildings = request.data.get('inactivate_buildings', True)

        building_ids = list(buildings.values_list('id', flat=True))

        affected_assignments = list(
            _what_if_get_affected_assignments(building_ids)
        )

        created_count = 0
        skipped_existing_count = 0
        created_request_ids = []

        with transaction.atomic():
            if inactivate_buildings:
                buildings.update(is_active=False)

            for assignment in affected_assignments:
                transfer_request = _create_deactivation_transfer_request(
                    assignment=assignment,
                    reason=reason,
                    requested_by=request.user,
                )

                if transfer_request is None:
                    skipped_existing_count += 1
                    continue

                created_count += 1
                created_request_ids.append(transfer_request.id)

        return Response({
            'success': True,
            'message': 'Building inactivation confirmed and transfer requests were created.',
            'inactivated_buildings': inactivate_buildings,
            'selected_building_ids': building_ids,
            'affected_students_count': len(affected_assignments),
            'created_requests': created_count,
            'skipped_existing_requests': skipped_existing_count,
            'created_request_ids': created_request_ids,
        }, status=status.HTTP_200_OK)

    except ValueError as e:
        return Response({
            'success': False,
            'error': str(e)
        }, status=status.HTTP_400_BAD_REQUEST)

    except Exception as e:
        traceback.print_exc()
        return Response({
            'success': False,
            'error': str(e),
            'error_type': e.__class__.__name__,
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _what_if_get_targets_from_request(request):
    target_type = request.data.get('target_type') or 'building'
    target_ids = request.data.get('target_ids') or []

    if target_type not in ['building', 'apartment', 'room']:
        raise ValueError('target_type must be one of: building, apartment, room.')

    if not isinstance(target_ids, list) or len(target_ids) == 0:
        raise ValueError('target_ids must be a non-empty list.')

    target_ids = list(set(target_ids))

    if target_type == 'building':
        targets = Building.objects.filter(id__in=target_ids).select_related(
            'dorm_type',
            'dorm_type__region'
        )
    elif target_type == 'apartment':
        targets = Apartment.objects.filter(id__in=target_ids).select_related(
            'building',
            'building__dorm_type',
            'building__dorm_type__region'
        )
    else:
        targets = Room.objects.filter(id__in=target_ids).select_related(
            'apartment',
            'apartment__building',
            'apartment__building__dorm_type',
            'apartment__building__dorm_type__region'
        )

    if targets.count() != len(target_ids):
        raise ValueError('One or more selected targets were not found.')

    return target_type, target_ids, targets


def _what_if_user_can_access_targets(user, target_type, targets):
    if user.is_central_admin:
        return True

    if not user.region_id:
        return False

    if target_type == 'building':
        return not targets.exclude(dorm_type__region=user.region).exists()

    if target_type == 'apartment':
        return not targets.exclude(building__dorm_type__region=user.region).exists()

    return not targets.exclude(apartment__building__dorm_type__region=user.region).exists()


def _what_if_get_affected_assignments_for_targets(target_type, target_ids):
    filters = {
        'status': BedAssignment.Status.ACTIVE,
    }

    if target_type == 'building':
        filters['bed__room__apartment__building_id__in'] = target_ids
    elif target_type == 'apartment':
        filters['bed__room__apartment_id__in'] = target_ids
    else:
        filters['bed__room_id__in'] = target_ids

    return BedAssignment.objects.filter(**filters).select_related(
        'student',
        'student__accepted_dorm_type',
        'bed',
        'bed__room',
        'bed__room__apartment',
        'bed__room__apartment__building',
        'bed__room__apartment__building__dorm_type',
        'bed__room__apartment__building__dorm_type__region',
    ).order_by(
        'bed__room__apartment__building__number',
        'bed__room__apartment__number',
        'bed__room__name',
        'bed__label',
    )


def _what_if_get_snapshot_region_for_targets(target_type, targets):
    if target_type == 'building':
        region_ids = list(
            targets.values_list('dorm_type__region_id', flat=True).distinct()
        )
    elif target_type == 'apartment':
        region_ids = list(
            targets.values_list('building__dorm_type__region_id', flat=True).distinct()
        )
    else:
        region_ids = list(
            targets.values_list(
                'apartment__building__dorm_type__region_id',
                flat=True
            ).distinct()
        )

    region_ids = [region_id for region_id in region_ids if region_id]

    if len(region_ids) == 1:
        return Region.objects.filter(pk=region_ids[0]).first()

    return None


def _what_if_analysis_snapshot_generic(
    region=None,
    excluded_building_ids=None,
    excluded_apartment_ids=None,
    excluded_room_ids=None,
):
    excluded_building_ids = excluded_building_ids or []
    excluded_apartment_ids = excluded_apartment_ids or []
    excluded_room_ids = excluded_room_ids or []

    buildings_qs = Building.objects.filter(
        is_active=True
    ).select_related(
        'dorm_type',
        'dorm_type__region'
    )

    rooms_qs = Room.objects.filter(
        is_active=True,
        apartment__is_active=True,
        apartment__building__is_active=True,
    )

    assignments_qs = BedAssignment.objects.filter(
        status=BedAssignment.Status.ACTIVE,
        bed__room__is_active=True,
        bed__room__apartment__is_active=True,
        bed__room__apartment__building__is_active=True,
    )

    students_qs = Student.objects.all()

    if region:
        buildings_qs = buildings_qs.filter(
            dorm_type__region=region
        )
        rooms_qs = rooms_qs.filter(
            apartment__building__dorm_type__region=region
        )
        assignments_qs = assignments_qs.filter(
            bed__room__apartment__building__dorm_type__region=region
        )
        students_qs = students_qs.filter(
            accepted_dorm_type__region=region
        )

    if excluded_building_ids:
        buildings_qs = buildings_qs.exclude(
            id__in=excluded_building_ids
        )
        rooms_qs = rooms_qs.exclude(
            apartment__building_id__in=excluded_building_ids
        )
        assignments_qs = assignments_qs.exclude(
            bed__room__apartment__building_id__in=excluded_building_ids
        )

    if excluded_apartment_ids:
        rooms_qs = rooms_qs.exclude(
            apartment_id__in=excluded_apartment_ids
        )
        assignments_qs = assignments_qs.exclude(
            bed__room__apartment_id__in=excluded_apartment_ids
        )

    if excluded_room_ids:
        rooms_qs = rooms_qs.exclude(
            id__in=excluded_room_ids
        )
        assignments_qs = assignments_qs.exclude(
            bed__room_id__in=excluded_room_ids
        )

    total_students = students_qs.count()
    assigned_students = assignments_qs.values('student_id').distinct().count()
    unassigned_students = max(total_students - assigned_students, 0)

    total_capacity = sum(
        rooms_qs.values_list('capacity', flat=True)
    )

    occupied_beds = assignments_qs.values('bed_id').distinct().count()
    available_beds = max(total_capacity - occupied_beds, 0)

    occupancy_rate = 0
    if total_capacity > 0:
        occupancy_rate = round((occupied_beds / total_capacity) * 100, 2)

    return {
        'total_students': total_students,
        'assigned_students': assigned_students,
        'unassigned_students': unassigned_students,
        'total_buildings': buildings_qs.count(),
        'total_rooms': rooms_qs.count(),
        'total_capacity': total_capacity,
        'total_beds': total_capacity,
        'occupied_beds': occupied_beds,
        'assigned_beds': occupied_beds,
        'available_beds': available_beds,
        'occupancy_rate': occupancy_rate,
    }


def _what_if_lost_resources_for_targets(target_type, target_ids):
    if target_type == 'building':
        lost_apartments_qs = Apartment.objects.filter(
            building_id__in=target_ids,
            is_active=True,
        )

        lost_rooms_qs = Room.objects.filter(
            apartment__building_id__in=target_ids,
            is_active=True,
            apartment__is_active=True,
        )

        lost_beds_qs = Bed.objects.filter(
            room__apartment__building_id__in=target_ids,
            room__is_active=True,
            room__apartment__is_active=True,
        )

    elif target_type == 'apartment':
        lost_apartments_qs = Apartment.objects.filter(
            id__in=target_ids,
            is_active=True,
        )

        lost_rooms_qs = Room.objects.filter(
            apartment_id__in=target_ids,
            is_active=True,
            apartment__is_active=True,
        )

        lost_beds_qs = Bed.objects.filter(
            room__apartment_id__in=target_ids,
            room__is_active=True,
            room__apartment__is_active=True,
        )

    else:
        lost_rooms_qs = Room.objects.filter(
            id__in=target_ids,
            is_active=True,
            apartment__is_active=True,
        )

        lost_apartments_qs = Apartment.objects.filter(
            rooms__id__in=target_ids
        ).distinct()

        lost_beds_qs = Bed.objects.filter(
            room_id__in=target_ids,
            room__is_active=True,
            room__apartment__is_active=True,
        )

    lost_rooms = lost_rooms_qs.count()
    lost_capacity = sum(
        lost_rooms_qs.values_list('capacity', flat=True)
    )

    return {
        'lost_apartments': lost_apartments_qs.count(),
        'lost_rooms': lost_rooms,
        'lost_capacity': lost_capacity,
        'lost_beds': lost_beds_qs.count(),
    }


def _what_if_format_targets(target_type, targets):
    formatted = []

    for target in targets:
        if target_type == 'building':
            dorm_type = target.dorm_type
            region = dorm_type.region if dorm_type else None

            formatted.append({
                'id': target.id,
                'target_type': 'building',
                'label': f'Building {target.number}',
                'number': target.number,
                'building_id': target.id,
                'building_number': target.number,
                'dorm_type_id': dorm_type.id if dorm_type else None,
                'dorm_type_name': dorm_type.name if dorm_type else '',
                'region_id': region.id if region else '',
                'region_name': region.name if region else '',
                'is_active': target.is_active,
            })

        elif target_type == 'apartment':
            building = target.building
            dorm_type = building.dorm_type if building else None
            region = dorm_type.region if dorm_type else None

            formatted.append({
                'id': target.id,
                'target_type': 'apartment',
                'label': f'Building {building.number} / Apartment {target.number}',
                'number': target.number,
                'apartment_id': target.id,
                'apartment_number': target.number,
                'building_id': building.id if building else None,
                'building_number': building.number if building else '',
                'dorm_type_id': dorm_type.id if dorm_type else None,
                'dorm_type_name': dorm_type.name if dorm_type else '',
                'region_id': region.id if region else '',
                'region_name': region.name if region else '',
                'is_active': target.is_active,
            })

        else:
            apartment = target.apartment
            building = apartment.building if apartment else None
            dorm_type = building.dorm_type if building else None
            region = dorm_type.region if dorm_type else None

            formatted.append({
                'id': target.id,
                'target_type': 'room',
                'label': f'Building {building.number} / Apartment {apartment.number} / Room {target.name}',
                'room_id': target.id,
                'room_name': target.name,
                'apartment_id': apartment.id if apartment else None,
                'apartment_number': apartment.number if apartment else '',
                'building_id': building.id if building else None,
                'building_number': building.number if building else '',
                'dorm_type_id': dorm_type.id if dorm_type else None,
                'dorm_type_name': dorm_type.name if dorm_type else '',
                'region_id': region.id if region else '',
                'region_name': region.name if region else '',
                'capacity': target.capacity,
                'is_active': target.is_active,
            })

    return formatted


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def what_if_availability_simulate(request):
    """
    Generic What-if simulation for buildings, apartments, and rooms.
    This endpoint does NOT change the database.
    """
    try:
        target_type, target_ids, targets = _what_if_get_targets_from_request(request)

        if not _what_if_user_can_access_targets(request.user, target_type, targets):
            return Response({
                'success': False,
                'error': 'אין הרשאה לבצע סימולציה עבור אחד או יותר מהפריטים שנבחרו.'
            }, status=status.HTTP_403_FORBIDDEN)

        affected_assignments = _what_if_get_affected_assignments_for_targets(
            target_type,
            target_ids
        )

        affected_students = [
            _what_if_format_student_from_assignment(assignment)
            for assignment in affected_assignments
        ]

        snapshot_region = _what_if_get_snapshot_region_for_targets(
            target_type,
            targets
        )

        excluded_building_ids = target_ids if target_type == 'building' else []
        excluded_apartment_ids = target_ids if target_type == 'apartment' else []
        excluded_room_ids = target_ids if target_type == 'room' else []

        analysis_before = _what_if_analysis_snapshot_generic(
            region=snapshot_region
        )

        analysis_after = _what_if_analysis_snapshot_generic(
            region=snapshot_region,
            excluded_building_ids=excluded_building_ids,
            excluded_apartment_ids=excluded_apartment_ids,
            excluded_room_ids=excluded_room_ids,
        )

        lost_resources = _what_if_lost_resources_for_targets(
            target_type,
            target_ids
        )

        return Response({
            'success': True,
            'scenario': f'{target_type}_availability_change',
            'target_type': target_type,
            'target_ids': target_ids,
            'selected_targets': _what_if_format_targets(target_type, targets),

            'summary': {
                'affected_students_count': len(affected_students),
                'students_without_valid_placement': len(affected_students),

                'male_count': sum(
                    1 for student in affected_students
                    if student.get('gender') == Student.Gender.MALE
                ),
                'female_count': sum(
                    1 for student in affected_students
                    if student.get('gender') == Student.Gender.FEMALE
                ),

                **lost_resources,
            },

            'breakdowns': {
                'gender': _what_if_count_by_value(affected_students, 'gender'),
                'requested_religion': _what_if_count_by_value(affected_students, 'requested_religion'),
                'religious': _what_if_count_by_value(affected_students, 'religious'),
                'placement_sector': _what_if_count_by_value(affected_students, 'placement_sector'),
                'category': _what_if_count_by_value(affected_students, 'category'),
                'housing_type': _what_if_count_by_value(affected_students, 'housing_type'),
            },

            'analysis_before': analysis_before,
            'analysis_after': analysis_after,
            'affected_students': affected_students,
        }, status=status.HTTP_200_OK)

    except ValueError as e:
        return Response({
            'success': False,
            'error': str(e)
        }, status=status.HTTP_400_BAD_REQUEST)

    except Exception as e:
        traceback.print_exc()
        return Response({
            'success': False,
            'error': str(e),
            'error_type': e.__class__.__name__,
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _create_deactivation_transfer_request(assignment, reason, requested_by):
    """
    Ensure a pending StudentRequest exists for a student whose current
    inventory (building/apartment/room) was just deactivated.

    StudentRequest — not MovementRequest — is the model the actual
    Transfer Requests / בקשות מעבר page (StudentRequestViewSet, /api/requests/)
    reads. MovementRequest is only ever consumed by the legacy, UI-dead
    Transfer/TransferViewSet pair, so a request created there is invisible
    to staff. This reuses the same request_type/status/snapshot
    conventions StudentRequestViewSet.perform_create already uses for
    manually-created room/apartment transfer requests (see
    _assignment_snapshot / _student_current_region_id above), so
    deactivation-triggered requests render identically on the existing
    page instead of needing special-cased UI.

    Idempotent: BedAssignment enforces at most one ACTIVE assignment per
    student, so a student who already has a pending room/apartment-type
    request necessarily already has one covering this exact current
    assignment - regardless of which level of the hierarchy
    (building/apartment/room) triggered the deactivation. Returns the
    created StudentRequest, or None when an existing pending request
    already covers this student and nothing was created.
    """
    student = assignment.student

    already_pending = StudentRequest.objects.filter(
        student=student,
        status=StudentRequest.Status.PENDING,
        request_type__in=[
            StudentRequest.RequestType.ROOM,
            StudentRequest.RequestType.APARTMENT,
        ],
    ).exists()
    if already_pending:
        return None

    transfer_request = StudentRequest.objects.create(
        student=student,
        request_type=StudentRequest.RequestType.ROOM,
        status=StudentRequest.Status.PENDING,
        reason=reason,
        requested_by=requested_by,
        transfer_scope=StudentRequest.TransferScope.SAME_REGION,
        source_region_id=_student_current_region_id(student),
        current_assignment_snapshot=_assignment_snapshot(student),
    )
    transfer_request.request_number = f"REQ-{transfer_request.id:06d}"
    transfer_request.save(update_fields=['request_number'])
    return transfer_request


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def what_if_availability_confirm(request):
    """
    Confirm generic availability change for buildings, apartments, or rooms.
    Inactivation affects the database by setting is_active=False.
    It also creates pending StudentRequest rows (the model backing the
    Transfer Requests / בקשות מעבר page) for affected active assignments,
    so occupants stay assigned to their current bed and become visible to
    staff for manual resolution instead of disappearing from workflow.
    """
    try:
        if not request.user.is_boss:
            return Response({
                'success': False,
                'error': 'רק מנהל יכול לאשר שינוי זמינות ויצירת בקשות העברה.'
            }, status=status.HTTP_403_FORBIDDEN)

        target_type, target_ids, targets = _what_if_get_targets_from_request(request)

        if not _what_if_user_can_access_targets(request.user, target_type, targets):
            return Response({
                'success': False,
                'error': 'אין הרשאה לשנות זמינות עבור אחד או יותר מהפריטים שנבחרו.'
            }, status=status.HTTP_403_FORBIDDEN)

        action = request.data.get('action') or 'inactivate'

        if action not in ['inactivate', 'reactivate']:
            raise ValueError('action must be inactivate or reactivate.')

        reason = request.data.get('reason') or 'Availability changed.'

        affected_assignments = list(
            _what_if_get_affected_assignments_for_targets(
                target_type,
                target_ids
            )
        )

        created_count = 0
        skipped_existing_count = 0
        created_request_ids = []

        with transaction.atomic():
            new_active_value = action == 'reactivate'

            if target_type == 'building':
                Building.objects.filter(id__in=target_ids).update(
                    is_active=new_active_value
                )
            elif target_type == 'apartment':
                Apartment.objects.filter(id__in=target_ids).update(
                    is_active=new_active_value
                )
            else:
                Room.objects.filter(id__in=target_ids).update(
                    is_active=new_active_value
                )

            if action == 'inactivate':
                for assignment in affected_assignments:
                    transfer_request = _create_deactivation_transfer_request(
                        assignment=assignment,
                        reason=reason,
                        requested_by=request.user,
                    )

                    if transfer_request is None:
                        skipped_existing_count += 1
                        continue

                    created_count += 1
                    created_request_ids.append(transfer_request.id)

        return Response({
            'success': True,
            'message': 'Availability change confirmed.',
            'target_type': target_type,
            'target_ids': target_ids,
            'action': action,
            'affected_students_count': len(affected_assignments),
            'created_requests': created_count,
            'skipped_existing_requests': skipped_existing_count,
            'created_request_ids': created_request_ids,
        }, status=status.HTTP_200_OK)

    except ValueError as e:
        return Response({
            'success': False,
            'error': str(e)
        }, status=status.HTTP_400_BAD_REQUEST)

    except Exception as e:
        traceback.print_exc()
        return Response({
            'success': False,
            'error': str(e),
            'error_type': e.__class__.__name__,
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

# =========================
# Statistics
# =========================

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def statistics(request):
    user = request.user
    region_value = request.query_params.get('region')

    # G3-03: centralized region resolution - region_boss/employee can never
    # pull another region's statistics via ?region=.
    region, error = resolve_scoped_region(user, region_value)
    if error:
        return error

    if region is None:
        students = Student.objects.all()
        buildings = Building.objects.filter(is_active=True)
        rooms = Room.objects.filter(
            is_active=True,
            apartment__is_active=True,
            apartment__building__is_active=True,
        )
        active_assignments = BedAssignment.objects.filter(
            status=BedAssignment.Status.ACTIVE,
            bed__room__is_active=True,
            bed__room__apartment__is_active=True,
            bed__room__apartment__building__is_active=True,
        )
        transfers = Transfer.objects.filter(status=Transfer.Status.PENDING)
    else:
        students = Student.objects.filter(
            accepted_dorm_type__region=region
        )
        buildings = Building.objects.filter(
            dorm_type__region=region,
            is_active=True
        )
        rooms = Room.objects.filter(
            apartment__building__dorm_type__region=region,
            is_active=True,
            apartment__is_active=True,
            apartment__building__is_active=True,
        )
        active_assignments = BedAssignment.objects.filter(
            status=BedAssignment.Status.ACTIVE,
            bed__room__apartment__building__dorm_type__region=region,
            bed__room__is_active=True,
            bed__room__apartment__is_active=True,
            bed__room__apartment__building__is_active=True,
        )
        transfers = Transfer.objects.filter(
            Q(from_room__apartment__building__dorm_type__region=region) |
            Q(to_room__apartment__building__dorm_type__region=region),
            status=Transfer.Status.PENDING
        )

    total_capacity = sum(rooms.values_list('capacity', flat=True))
    if region is None:
        total_buildings_count = Building.objects.count()
        inactive_buildings_count = Building.objects.filter(is_active=False).count()
    else:
        total_buildings_count = Building.objects.filter(
            dorm_type__region=region
        ).count()
        inactive_buildings_count = Building.objects.filter(
            dorm_type__region=region,
            is_active=False
        ).count()

    occupied_beds = active_assignments.values('bed_id').distinct().count()
    assigned_students = active_assignments.values('student_id').distinct().count()

    unassigned_students = max(students.count() - assigned_students, 0)
    available_beds = max(total_capacity - occupied_beds, 0)

    occupancy_rate = 0
    if total_capacity > 0:
        occupancy_rate = round((occupied_beds / total_capacity) * 100)

    # Priority KPI scoped to the same automatic-allocation population as
    # run_allocation/allocation_summary (excludes LEAVING and
    # accessibility-flagged students, who are never sent to the solver).
    allocatable_students = students.exclude(
        category=Student.StudentCategory.LEAVING
    ).exclude(accessibility_flag=True)

    return Response({
        'total_students': students.count(),
        'assigned_students': assigned_students,
        'unassigned_students': unassigned_students,
        'priority_students': allocatable_students.filter(is_priority=True).count(),
        'total_buildings': total_buildings_count,
        'active_buildings': buildings.count(),
        'inactive_buildings': inactive_buildings_count,
        'total_rooms': rooms.count(),
        'total_capacity': total_capacity,
        'occupied_beds': occupied_beds,
        'available_beds': available_beds,
        'occupancy_rate': occupancy_rate,
        'pending_transfers': transfers.count(),
    })


# =========================
# Operational Home Page (/api/home/)
# =========================

_HOME_REQUEST_TYPE_LABELS_EN = {
    'add_student': 'Add student',
    'remove_student': 'Remove student',
    'room': 'Room change',
    'apartment': 'Apartment transfer',
    'swap': 'Student swap',
    'region_transfer': 'Region transfer',
    'other': 'Other request',
}


def _home_action(key, label_he, label_en, route):
    return {'key': key, 'label_he': label_he, 'label_en': label_en, 'route': route}


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def home_dashboard(request):
    """
    Aggregated, read-only data for the post-login operational homepage.

    central_admin gets a system-wide view; region_boss/employee get their
    own region's view (server-side enforced, mirrors the scoping already
    used by statistics/allocation_summary/list_batches/region_inbox).
    """
    user = request.user
    is_admin = user.is_central_admin
    can_upload = is_admin
    can_run_allocation = user.is_boss
    can_review_requests = user.is_boss

    if is_admin:
        region = None
    else:
        region = user.region
        if not region:
            return Response({
                'error': 'המשתמש אינו משויך לאזור',
                'errorEn': 'User is not assigned to a region',
            }, status=status.HTTP_400_BAD_REQUEST)

    # ---- Student / occupancy metrics (same scoping rules as statistics()) ----
    if region is None:
        students_qs = Student.objects.all()
        rooms_qs = Room.objects.filter(
            is_active=True, apartment__is_active=True, apartment__building__is_active=True,
        )
        active_assignments_qs = BedAssignment.objects.filter(
            status=BedAssignment.Status.ACTIVE,
            bed__room__is_active=True,
            bed__room__apartment__is_active=True,
            bed__room__apartment__building__is_active=True,
        )
    else:
        students_qs = Student.objects.filter(accepted_dorm_type__region=region)
        rooms_qs = Room.objects.filter(
            apartment__building__dorm_type__region=region,
            is_active=True, apartment__is_active=True, apartment__building__is_active=True,
        )
        active_assignments_qs = BedAssignment.objects.filter(
            status=BedAssignment.Status.ACTIVE,
            bed__room__apartment__building__dorm_type__region=region,
            bed__room__is_active=True,
            bed__room__apartment__is_active=True,
            bed__room__apartment__building__is_active=True,
        )

    allocatable_qs = students_qs.exclude(
        category=Student.StudentCategory.LEAVING
    ).exclude(accessibility_flag=True)

    assigned_students = allocatable_qs.filter(assigned_room__isnull=False).count()
    unassigned_students = allocatable_qs.filter(assigned_room__isnull=True).count()

    # total_capacity/occupied_beds AND the admin-only per-region breakdown
    # used by the "High-occupancy regions" attention card both come out of
    # these same 2 queries - reshaped to also carry a region_id column
    # (GROUP BY / an extra .values() field) rather than running 2 more
    # queries to get a per-region breakdown, to stay within the query-count
    # budget already established for this endpoint (see
    # performance_tests/test_home_dashboard_performance.py's
    # test_query_count_after_fix_central_admin, <=16 total queries - this
    # trades a scalar SELECT for a GROUP BY / row-fetching one, exactly the
    # "Assignments"/"Rooms" consolidation trade-off already used elsewhere
    # in this endpoint and in analysis_data() above).
    region_capacity = {}
    region_occupied_beds = {}
    if region is None:
        room_rows = rooms_qs.values('apartment__building__dorm_type__region_id').annotate(
            cap=Sum('capacity')
        )
        total_capacity = 0
        for row in room_rows:
            cap = row['cap'] or 0
            total_capacity += cap
            region_capacity[row['apartment__building__dorm_type__region_id']] = cap

        assignment_rows = active_assignments_qs.values(
            'bed__room__apartment__building__dorm_type__region_id', 'bed_id'
        ).distinct()
        region_bed_ids = {}
        for row in assignment_rows:
            region_bed_ids.setdefault(
                row['bed__room__apartment__building__dorm_type__region_id'], set()
            ).add(row['bed_id'])
        occupied_beds = sum(len(beds) for beds in region_bed_ids.values())
        region_occupied_beds = {rid: len(beds) for rid, beds in region_bed_ids.items()}
    else:
        total_capacity = sum(rooms_qs.values_list('capacity', flat=True))
        occupied_beds = active_assignments_qs.values('bed_id').distinct().count()

    available_beds = max(total_capacity - occupied_beds, 0)
    occupancy_rate = round((occupied_beds / total_capacity) * 100) if total_capacity else 0

    # ---- High-occupancy regions (central-admin "High-occupancy regions"
    # attention card) - threshold = occupancy >= 90%, using the per-region
    # capacity/occupied numbers computed above (no extra query). ----
    HIGH_OCCUPANCY_THRESHOLD = 90
    regions_high_occupancy_count = 0
    for region_id, capacity in region_capacity.items():
        if not region_id or capacity <= 0:
            continue
        occupied = region_occupied_beds.get(region_id, 0)
        if (occupied / capacity) * 100 >= HIGH_OCCUPANCY_THRESHOLD:
            regions_high_occupancy_count += 1

    priority_students_pending = 0
    if is_admin:
        # Scoped to allocatable_qs (excludes LEAVING/accessibility-flagged
        # students) so this figure matches the same automatic-allocation
        # population as the rest of this dashboard and analysis_data's
        # priority_unassigned_students.
        priority_students_pending = allocatable_qs.filter(
            is_priority=True, assigned_room__isnull=True
        ).count()

    # ---- Pending requests (unified StudentRequest workflow used by /transfers) ----
    def _scope_requests(qs):
        if region is None:
            return qs
        return qs.filter(
            Q(requested_by__region_id=region.id) |
            Q(student__accepted_dorm_type__region_id=region.id) |
            Q(target_room__apartment__building__dorm_type__region_id=region.id)
        ).distinct()

    pending_requests = _scope_requests(
        StudentRequest.objects.filter(status=StudentRequest.Status.PENDING)
    ).count()

    # ---- Latest import batch ----
    if is_admin:
        latest_batch = ImportBatch.objects.select_related('uploaded_by').order_by('-created_at').first()
    else:
        batch_ids = RegionInbox.objects.filter(region=region).values_list('batch_id', flat=True)
        latest_batch = ImportBatch.objects.filter(
            id__in=batch_ids
        ).select_related('uploaded_by').order_by('-created_at').first()

    # ---- Region inbox status ----
    latest_inbox = None
    pending_inbox_count = 0
    viewed_inbox_count = 0
    if region is not None:
        # 'region' added to select_related: RegionInboxSerializer.region_name
        # (source='region.name') was previously issuing a lazy per-request
        # fetch here whenever latest_inbox was not None - now covered.
        # (project-quality/performance/GROUP1_BACKEND_PERFORMANCE_AUDIT.md, G1-08.)
        latest_inbox = RegionInbox.objects.select_related('batch', 'region').filter(
            region=region
        ).order_by('-created_at').first()
        pending_inbox_count = 1 if latest_inbox and latest_inbox.status == RegionInbox.Status.PENDING else 0
        viewed_inbox_count = 1 if latest_inbox and latest_inbox.status == RegionInbox.Status.VIEWED else 0
    else:
        # Two independent .count() queries over the same table consolidated
        # into one GROUP BY - safe because both counts are simple, disjoint
        # status filters over the exact same unscoped RegionInbox table.
        # (G1-06.)
        inbox_status_counts = {
            row['status']: row['c']
            for row in RegionInbox.objects.values('status').annotate(c=Count('id'))
        }
        pending_inbox_count = inbox_status_counts.get(RegionInbox.Status.PENDING, 0)
        viewed_inbox_count = inbox_status_counts.get(RegionInbox.Status.VIEWED, 0)

    # ---- Allocation runs ----
    # run_qs is evaluated 4 separate times below/further down (active_run,
    # latest_run, has_completed_run, and the recent_activity [:3] slice) -
    # flagged in the Group 1 audit (G1-07) as a possible consolidation
    # candidate. NOT consolidated here: each has a genuinely different
    # filter (active-like status / no filter / completed-like status /
    # most-recent-3), and has_completed_run in particular means "has ANY
    # run, ever, of this shape" - answering that from a bounded recent-N
    # window would silently return a wrong answer if more than N
    # non-completed runs exist before the most recent completed one
    # (explicitly the technique this fix must NOT use, per
    # GROUP1_BACKEND_PERFORMANCE_AUDIT.md's implementation instructions).
    # Each of these 4 queries is already a single, simple,
    # appropriately-scoped lookup (an indexed .first()/.exists()/sliced
    # query, not a table scan) - the measured benefit of forcing them into
    # fewer round trips does not clear the bar for the correctness risk it
    # would introduce. Left unchanged.
    run_qs = AllocationRun.objects.select_related('region', 'run_by')
    if region is not None:
        run_qs = run_qs.filter(region=region)

    active_run = run_qs.filter(status__in=[
        AllocationRun.Status.QUEUED,
        AllocationRun.Status.RUNNING,
        AllocationRun.Status.CANCELLATION_REQUESTED,
    ]).order_by('-started_at').first()
    latest_run = run_qs.order_by('-started_at').first()
    completed_like = {AllocationRun.Status.COMPLETED, AllocationRun.Status.APPROVED}
    has_completed_run = run_qs.filter(status__in=completed_like).exists()
    latest_run_failed = bool(latest_run and latest_run.status == AllocationRun.Status.FAILED)

    regions_with_active_run = 0
    regions_with_failed_latest = 0
    if region is None:
        latest_status_by_region = {}
        for row in AllocationRun.objects.order_by('region_id', '-started_at').values('region_id', 'status'):
            latest_status_by_region.setdefault(row['region_id'], row['status'])
        active_like = {
            AllocationRun.Status.QUEUED,
            AllocationRun.Status.RUNNING,
            AllocationRun.Status.CANCELLATION_REQUESTED,
        }
        regions_with_active_run = sum(1 for s in latest_status_by_region.values() if s in active_like)
        regions_with_failed_latest = sum(
            1 for s in latest_status_by_region.values() if s == AllocationRun.Status.FAILED
        )

    # ---- Workflow stage derivation (objective, role-independent) ----
    if latest_batch is None:
        stage_upload = 'active'
    elif latest_batch.status == ImportBatch.Status.FAILED:
        stage_upload = 'attention'
    else:
        stage_upload = 'completed'

    if region is not None:
        if latest_inbox is None:
            stage_review, stage_processing = 'waiting', 'waiting'
        elif latest_inbox.status == RegionInbox.Status.PENDING:
            stage_review, stage_processing = 'active', 'waiting'
        elif latest_inbox.status == RegionInbox.Status.VIEWED:
            stage_review, stage_processing = 'completed', 'active'
        else:  # PROCESSED / SUPERSEDED
            stage_review, stage_processing = 'completed', 'completed'
    else:
        if pending_inbox_count > 0:
            stage_review = 'active'
            stage_processing = 'active' if viewed_inbox_count > 0 else 'waiting'
        elif viewed_inbox_count > 0:
            stage_review, stage_processing = 'completed', 'active'
        elif latest_batch is not None:
            stage_review, stage_processing = 'completed', 'completed'
        else:
            stage_review, stage_processing = 'waiting', 'waiting'

    if active_run is not None or regions_with_active_run > 0:
        stage_allocation = 'active'
    elif latest_run_failed or regions_with_failed_latest > 0:
        stage_allocation = 'attention'
    elif not has_completed_run:
        stage_allocation = 'waiting'
    else:
        stage_allocation = 'completed'

    if not has_completed_run:
        stage_results = 'waiting'
    elif unassigned_students > 0:
        stage_results = 'attention'
    else:
        stage_results = 'completed'

    workflow = [
        {'key': 'upload', 'label_he': 'העלאת קובץ', 'label_en': 'File upload', 'status': stage_upload},
        {'key': 'data_review', 'label_he': 'סקירת נתונים', 'label_en': 'Data review', 'status': stage_review},
        {'key': 'regional_processing', 'label_he': 'עיבוד אזורי', 'label_en': 'Regional processing', 'status': stage_processing},
        {'key': 'allocation', 'label_he': 'שיבוץ', 'label_en': 'Allocation', 'status': stage_allocation},
        {'key': 'results_review', 'label_he': 'סקירת תוצאות', 'label_en': 'Results review', 'status': stage_results},
    ]

    # ---- Situation sentence ----
    if stage_upload == 'attention' or stage_allocation == 'attention':
        situation_he = 'יש נושאים שדורשים את תשומת ליבכם בתהליך השיבוץ הנוכחי'
        situation_en = 'There are issues in the current allocation process that need your attention'
    elif stage_allocation == 'active':
        situation_he = 'תהליך השיבוץ פעיל כרגע'
        situation_en = 'The allocation process is currently running'
    elif stage_review == 'active' or stage_processing == 'active':
        situation_he = 'ישנם נתוני סטודנטים חדשים הממתינים לסקירה'
        situation_en = 'New student data is waiting for review'
    elif stage_results == 'completed':
        situation_he = 'תהליך השיבוץ הנוכחי הושלם ואין נושאים פתוחים'
        situation_en = 'The current allocation process is complete with no open issues'
    else:
        situation_he = 'הכל מתנהל כסדרו כרגע'
        situation_en = 'Everything is on track right now'

    # ---- Primary action (respects what this role can actually do) ----
    primary_action = None

    if latest_batch is not None and latest_batch.status == ImportBatch.Status.FAILED and can_upload:
        primary_action = _home_action('upload_retry', 'העלאת הקובץ נכשלה - נסו שוב', 'Upload failed — try again', '/upload')
    elif latest_batch is None and can_upload:
        primary_action = _home_action('upload', 'העלאת קובץ סטודנטים', 'Upload student file', '/upload')
    elif active_run is not None:
        primary_action = _home_action('view_active', 'צפייה בשיבוץ הפעיל', 'View active allocation', '/allocation')
    elif region is not None and latest_inbox is not None and latest_inbox.status == RegionInbox.Status.PENDING:
        primary_action = (
            _home_action('review_data', 'סקירת נתוני האזור', 'Review regional data', '/allocation')
            if can_run_allocation else
            _home_action('view_region_status', 'צפייה בסטטוס האזור', 'View regional status', '/allocation')
        )
    elif latest_run_failed and can_run_allocation:
        primary_action = _home_action('retry_allocation', 'הרצת השיבוץ נכשלה - נסו שוב', 'Allocation failed — retry', '/allocation')
    elif region is not None and not has_completed_run and latest_inbox is not None \
            and latest_inbox.status in (RegionInbox.Status.VIEWED, RegionInbox.Status.PROCESSED):
        primary_action = (
            _home_action('run_allocation', 'הרצת שיבוץ', 'Run allocation', '/allocation')
            if can_run_allocation else
            _home_action('view_region_status', 'צפייה בסטטוס האזור', 'View regional status', '/allocation')
        )
    elif has_completed_run and unassigned_students > 0:
        primary_action = _home_action('review_unassigned', 'סקירת סטודנטים ללא שיבוץ', 'Review unassigned students', '/students')
    elif pending_requests > 0:
        primary_action = (
            _home_action('review_requests', 'סקירת בקשות ממתינות', 'Review pending requests', '/transfers')
            if can_review_requests else
            _home_action('view_requests', 'צפייה בבקשות', 'View requests', '/transfers')
        )
    elif has_completed_run:
        primary_action = _home_action('review_results', 'צפייה בתוצאות השיבוץ', 'View allocation results', '/allocation/results')

    # ---- Attention items ----
    attention_items = []

    if unassigned_students > 0:
        attention_items.append({
            'id': 'unassigned-students', 'severity': 'warning', 'icon': 'users', 'count': unassigned_students,
            'title_he': 'סטודנטים ללא שיבוץ', 'title_en': 'Unassigned students',
            'description_he': f'{unassigned_students} סטודנטים ממתינים לשיבוץ לחדר',
            'description_en': f'{unassigned_students} students are waiting for a room assignment',
            'route': '/students',
        })

    if pending_requests > 0:
        attention_items.append({
            'id': 'pending-requests', 'severity': 'warning', 'icon': 'arrow-left-right', 'count': pending_requests,
            'title_he': 'בקשות ממתינות לטיפול', 'title_en': 'Pending requests',
            'description_he': f'{pending_requests} בקשות סטודנטים ממתינות לטיפול',
            'description_en': f'{pending_requests} student requests await review',
            'route': '/transfers',
        })

    if latest_batch is not None and latest_batch.status == ImportBatch.Status.FAILED and can_upload:
        attention_items.append({
            'id': 'upload-failed', 'severity': 'error', 'icon': 'upload', 'count': None,
            'title_he': 'העלאת קובץ נכשלה', 'title_en': 'File upload failed',
            'description_he': latest_batch.error_message or 'ההעלאה האחרונה נכשלה, נסו שוב',
            'description_en': latest_batch.error_message or 'The latest upload failed, please try again',
            'route': '/upload',
        })

    if latest_run_failed and can_run_allocation:
        attention_items.append({
            'id': 'allocation-failed', 'severity': 'error', 'icon': 'shuffle', 'count': None,
            'title_he': 'הרצת השיבוץ האחרונה נכשלה', 'title_en': 'Latest allocation run failed',
            'description_he': latest_run.error_message or 'נסו להריץ שיבוץ מחדש',
            'description_en': latest_run.error_message or 'Try running the allocation again',
            'route': '/allocation',
        })

    if active_run is not None:
        attention_items.append({
            'id': 'allocation-running', 'severity': 'info', 'icon': 'clock', 'count': None,
            'title_he': 'שיבוץ פעיל כעת', 'title_en': 'Allocation currently running',
            'description_he': 'תהליך השיבוץ באזור שלכם פעיל כרגע',
            'description_en': 'An allocation run is currently in progress',
            'route': '/allocation',
        })

    if region is not None and latest_inbox is not None and latest_inbox.status in (
        RegionInbox.Status.PENDING, RegionInbox.Status.VIEWED
    ):
        attention_items.append({
            'id': 'inbox-not-processed', 'severity': 'warning', 'icon': 'inbox', 'count': latest_inbox.students_count,
            'title_he': 'נתוני סטודנטים חדשים ממתינים', 'title_en': 'New student data awaiting processing',
            'description_he': f'{latest_inbox.students_count} סטודנטים חדשים התקבלו וטרם טופלו',
            'description_en': f'{latest_inbox.students_count} new students received and not yet processed',
            'route': '/allocation',
        })

    if is_admin and pending_inbox_count > 0:
        # NOTE: this item is intentionally NOT rendered by the frontend
        # dashboard anymore (see HomePage.js) - the Central Admin "regions
        # with unviewed new data" card was replaced by the clickable
        # 'regions-high-occupancy' card below (project-quality/ui/
        # UI_FIXES_DASHBOARD_WHATIF_REPORT.md). It is kept here, unchanged,
        # purely so this endpoint keeps returning pending_inbox_count for
        # backend regression coverage (see the G1-06 consolidated-groupby
        # correctness test in performance_tests/test_home_dashboard_performance.py,
        # which has no other way to observe this system-wide number).
        attention_items.append({
            'id': 'regions-pending-review', 'severity': 'warning', 'icon': 'inbox', 'count': pending_inbox_count,
            'title_he': 'אזורים עם נתונים חדשים שטרם נצפו', 'title_en': 'Regions with unviewed new data',
            'description_he': f'{pending_inbox_count} אזורים טרם צפו בנתוני הסטודנטים החדשים שלהם',
            'description_en': f'{pending_inbox_count} regions have not yet viewed their new student data',
            'route': None,
        })

    if is_admin and regions_high_occupancy_count > 0:
        attention_items.append({
            'id': 'regions-high-occupancy', 'severity': 'warning', 'icon': 'percent', 'count': regions_high_occupancy_count,
            'title_he': 'אזורים בתפוסה גבוהה', 'title_en': 'High-occupancy regions',
            'description_he': f'{regions_high_occupancy_count} אזורים נמצאים בתפוסה של 90% ומעלה',
            'description_en': f'{regions_high_occupancy_count} regions are at 90% occupancy or higher',
            'route': '/analysis',
        })

    if is_admin and regions_with_failed_latest > 0:
        attention_items.append({
            'id': 'regions-failed-allocation', 'severity': 'error', 'icon': 'shuffle', 'count': regions_with_failed_latest,
            'title_he': 'אזורים עם הרצת שיבוץ שנכשלה', 'title_en': 'Regions with a failed allocation run',
            'description_he': f'{regions_with_failed_latest} אזורים עם הרצת השיבוץ האחרונה שלהם נכשלה',
            'description_en': f'{regions_with_failed_latest} regions have a failed latest allocation run',
            'route': None,
        })

    if is_admin and priority_students_pending > 0:
        attention_items.append({
            'id': 'priority-students', 'severity': 'info', 'icon': 'star', 'count': priority_students_pending,
            'title_he': 'סטודנטים בעדיפות ללא שיבוץ', 'title_en': 'Priority students without assignment',
            'description_he': f'{priority_students_pending} סטודנטים בעדיפות ממתינים לשיבוץ',
            'description_en': f'{priority_students_pending} priority students are waiting for assignment',
            'route': '/priority',
        })

    severity_order = {'error': 0, 'warning': 1, 'info': 2}
    attention_items.sort(key=lambda item: severity_order.get(item['severity'], 3))

    # ---- Recent activity (uploads + allocation runs + student requests) ----
    recent_activity = []

    batch_qs = (
        ImportBatch.objects.select_related('uploaded_by')
        if is_admin else
        ImportBatch.objects.filter(id__in=RegionInbox.objects.filter(region=region).values_list('batch_id', flat=True))
    )
    for b in batch_qs.order_by('-created_at')[:3]:
        recent_activity.append({
            'id': f'batch-{b.id}', 'type': 'upload', 'icon': 'upload', 'status': b.status,
            'title_he': f'קובץ הועלה: {b.filename}', 'title_en': f'File uploaded: {b.filename}',
            'subtitle_he': f'{b.total_students} סטודנטים', 'subtitle_en': f'{b.total_students} students',
            'timestamp': b.created_at.isoformat() if b.created_at else None,
            'route': '/upload' if is_admin else '/allocation',
        })

    for r in run_qs.order_by('-started_at')[:3]:
        r_time = r.completed_at or r.started_at
        recent_activity.append({
            'id': f'run-{r.id}', 'type': 'allocation', 'icon': 'shuffle', 'status': r.status,
            'title_he': f'הרצת שיבוץ - {r.region.name}', 'title_en': f'Allocation run - {r.region.name}',
            'subtitle_he': f'{r.successful_assignments} שיבוצים מוצלחים', 'subtitle_en': f'{r.successful_assignments} successful assignments',
            'timestamp': r_time.isoformat() if r_time else None,
            'route': '/allocation/results' if r.status in completed_like else '/allocation',
        })

    recent_requests_qs = _scope_requests(
        StudentRequest.objects.select_related('student', 'requested_by')
    ).order_by('-created_at')[:5]
    for sr in recent_requests_qs:
        student_label = sr.student.full_name if sr.student else (sr.student_data or {}).get('first_name', '') or ''
        type_he = sr.get_request_type_display()
        type_en = _HOME_REQUEST_TYPE_LABELS_EN.get(sr.request_type, sr.request_type)
        recent_activity.append({
            'id': f'request-{sr.id}', 'type': 'request', 'icon': 'file-text', 'status': sr.status,
            'title_he': f'{type_he} - {student_label}'.strip(' -') if student_label else type_he,
            'title_en': f'{type_en} - {student_label}'.strip(' -') if student_label else type_en,
            'subtitle_he': (sr.reason or '')[:80], 'subtitle_en': (sr.reason or '')[:80],
            'timestamp': sr.created_at.isoformat() if sr.created_at else None,
            'route': '/transfers',
        })

    recent_activity = [a for a in recent_activity if a['timestamp']]
    recent_activity.sort(key=lambda a: a['timestamp'], reverse=True)
    recent_activity = recent_activity[:8]

    return Response({
        'user': {
            'name': user.get_full_name() or user.email,
            'role': user.role,
            'role_display': user.get_role_display(),
            'region_id': region.id if region else None,
            'region_name': region.name if region else None,
        },
        'scope': 'system' if region is None else 'region',
        'metrics': {
            'assigned_students': assigned_students,
            'unassigned_students': unassigned_students,
            'occupancy_rate': occupancy_rate,
            'available_beds': available_beds,
            'pending_requests': pending_requests,
        },
        'process': {
            'latest_batch': ImportBatchSerializer(latest_batch).data if latest_batch else None,
            'latest_inbox': RegionInboxSerializer(latest_inbox).data if latest_inbox else None,
            'active_run': AllocationRunSerializer(active_run).data if active_run else None,
            'latest_run': AllocationRunSerializer(latest_run).data if latest_run else None,
            'has_completed_run': has_completed_run,
        },
        'workflow': workflow,
        'situation_he': situation_he,
        'situation_en': situation_en,
        'primary_action': primary_action,
        'attention_items': attention_items,
        'recent_activity': recent_activity,
    })


# =========================
# Excel Upload Helpers
# =========================

# Legacy/demo-file name aliases. Every alias resolves to the official
# DormType.code, never to a database primary key and never to an arbitrary
# "first dorm in region" row.
EXCEL_DORM_NAME_TO_OFFICIAL_CODE = {
    'ריפקין': 1,
    'קנדה': 2,
    'מעונות קנדה': 2,
    'קסל': 3,
    'זוגות': 4,
    'מזרח ישן': 5,
    'נווה אמריקה': 6,
    'סנט': 7,
    'משפחות': 8,
    'יחיד בחדר': 10,
    'עליון עמים': 11,
    'מזרח חדש': 12,
    'סגל זוטר': 13,
    'כפר משתלמים': 14,
    'כפר הסמכה': 15,
    'רות הכהן': 16,
    'ברושים': 17,
    'סנט חדש': 18,
}

# Real dorm-office sheets that should not enter allocation.
LEAVING_SHEET_NAMES = {'עוזבים'}

# Column aliases: supports both the old demo Excel and the real dorm-office Excel.
COLUMN_ALIASES = {
    'student_id': ['ת"ז ישראלית'],
    'business_partner_id': ['שותף עסקי'],
    'first_name': ['שם פרטי'],
    'last_name': ['שם משפחה'],
    'phone': ['טלפון 1'],
    'phone_secondary': ['טלפון חירום', 'טלפון 2'],
    'email': ['אימייל 1'],
    'email_secondary': ['אימייל 2'],
    'city': ['שם ישוב'],

    'gender': ['תיאור מגדר'],
    'housing_type': ['תיאור סוג מגורים', 'החלטה-תאור סוג מגורים'],
    'tenant_type': ['החלטה-סוג מגורים של הדייר'],

    'decision_status': [
        'החלטת מעונות - אביב',
        'החלטה-החלטת מעונות - תאור',
        'גריעה/תוספת-תיאור קוד החלטה',
        'גריעה/תוספת-סוג החלטה',
    ],
    'decision_dorm_code': [
        'אזור החלטה לאביב',
        'החלטה-תוכן החלטה – מעונות',
        'החלטה-תוכן החלטה - מעונות',
        'החלטה-תוכן החלטה מעונות',
        'גריעה/תוספת-תוכן ההחלטה',
    ],
    'decision_dorm_name': [
        'גריעה/תוספת-תוכן ההחלטה-תיאור',
        'גריעה/תוספת-תוכן החלטה-תיאור',
        'גריעה/תוספת-תוכן החלטה-סוג',
    ],
    'current_dorm_code': ['אזור מגורים נוכחי'],
    'current_address': ['כתובת במעונות נוכחית', 'כ.נוכחית-כתובת במעונות-תיאור'],

    'religion': [
        'תיאור קוד לאום מבוקש',
        'החלטה-תאור קוד לאום מבוקש',
        'החלטה-קוד לאום מבוקש',
    ],
    'religious': [
        'החלטה אחרונה - דתי לצורך שיבוץ תיאור',
        'החלטה אחרונה - דתי לצרכי שיבוץ',
    ],
    'allocation_group': [
        'תיאור קבוצת הקצאה',
        'קבוצת הקצאה',
        'החלטה-תאור קבוצת הקצאה',
        'החלטה-קבוצת הקצאה',
    ],

    'accessibility_flag': ['החלטה-זקוק להנגשה'],
    'disability_percent': ['%נכות'],
    'medical_reason': ['סיבה רפואית מאושרת מרופאת הטכניון'],
    'anier_flag': ['9108-אנייר'],

    'roommate_flag_1': ['בקשה לגור עם סטודנטים חבר1'],
    'roommate_flag_2': ['החלטה אחרונה: בקשה לגור עם סטודנטים חבר2'],
    'roommate_flag_3': ['החלטה אחרונה: בקשה לגור עם סטודנטים חבר3'],
    'roommate_flag_4': ['החלטה אחרונה: בקשה לגור עם סטודנטים חבר4'],
    'roommate_flag_5': ['החלטה אחרונה: בקשה לגור עם סטודנטים חבר5'],
    'roommate_name_1': ['החלטה אחרונה: שם חבר 1'],
    'roommate_name_2': ['החלטה אחרונה: שם חבר 2'],
    'roommate_name_3': ['החלטה אחרונה: שם חבר 3'],
    'roommate_name_4': ['החלטה אחרונה: שם חבר 4'],
    'roommate_name_5': ['החלטה אחרונה: שם חבר 5'],
    'roommate_id_1': ['החלטה אחרונה: תז חבר 1', 'ת"ז חבר 1', 'מספר סטודנט חבר 1'],
    'roommate_id_2': ['החלטה אחרונה: תז חבר 2', 'ת"ז חבר 2', 'מספר סטודנט חבר 2'],
    'roommate_id_3': ['החלטה אחרונה: תז חבר 3', 'ת"ז חבר 3', 'מספר סטודנט חבר 3'],
    'roommate_id_4': ['החלטה אחרונה: תז חבר 4', 'ת"ז חבר 4', 'מספר סטודנט חבר 4'],
    'roommate_id_5': ['החלטה אחרונה: תז חבר 5', 'ת"ז חבר 5', 'מספר סטודנט חבר 5'],

    'special_status_1': ['תאור סטטוס מיוחד1'],
    'special_status_2': ['תאור סטטוס מיוחד2'],
    'special_status_3': ['תאור סטטוס מיוחד3'],
    'special_status_4': ['תאור סטטוס מיוחד4'],
    'study_points': ['נ.אקדמי מצטבר'],
}


def is_blank(value):
    if value is None:
        return True
    try:
        if pd.isna(value):
            return True
    except Exception:
        pass
    return str(value).strip() == ''


def safe_str(value, default=''):
    if is_blank(value):
        return default

    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return str(value).strip()

    return str(value).strip()


def safe_int(value, default=0):
    if is_blank(value):
        return default
    try:
        return int(float(value))
    except Exception:
        return default


def safe_decimal(value, default=None):
    if is_blank(value):
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return default


def normalize_compact(value):
    """Normalize text for comparisons where spaces are unreliable in the Excel."""
    return re.sub(r'\s+', '', safe_str(value)).lower()


def get_row_value(row, *column_names, default=''):
    for column_name in column_names:
        if column_name in row.index:
            value = row.get(column_name)
            if not is_blank(value):
                return value
    return default


def get_alias_value(row, alias_key, default=''):
    return get_row_value(row, *COLUMN_ALIASES.get(alias_key, []), default=default)


def normalize_phone(value):
    value = safe_str(value)
    if not value:
        return ''

    value = value.replace('-', '').replace(' ', '').replace('.0', '')

    if value.startswith('972') and len(value) >= 11:
        value = '0' + value[3:]

    return value


def parse_yes_no_code(value):
    value = normalize_compact(value)

    if value in {'כן', 'yes', 'true', '1', 'x', 'v', 'y'}:
        return True

    return False


def extract_roommate_flag(value):
    return parse_yes_no_code(value)


STUDENT_HOUSING_CODE_MAP = {
    'z1': Student.HousingType.SINGLE_MALE,
    'z2': Student.HousingType.SINGLE_FEMALE,
    'z3': Student.HousingType.COUPLE,
    'z4': Student.HousingType.FAMILY,
    'z6': Student.HousingType.SINGLE_IN_APARTMENT,
}


def normalize_student_housing_type(housing_type='', tenant_type=''):
    """Return only values supported by Student.HousingType."""
    housing_description = safe_str(housing_type)
    tenant_type_code = normalize_compact(tenant_type)

    mapped_value = STUDENT_HOUSING_CODE_MAP.get(tenant_type_code)
    if mapped_value:
        return mapped_value

    normalized_description = normalize_compact(housing_description)
    if not normalized_description:
        return ''

    # Check the mixed-single value before the male/female single values.
    if (
        'רווקים/ות' in normalized_description
        or 'רווקיםות' in normalized_description
        or 'singlemixed' in normalized_description
    ):
        return Student.HousingType.SINGLE_IN_APARTMENT

    if 'משפח' in normalized_description or 'family' in normalized_description:
        return Student.HousingType.FAMILY

    if 'זוג' in normalized_description or 'couple' in normalized_description:
        return Student.HousingType.COUPLE

    if 'רווקות' in normalized_description or 'בנות' in normalized_description:
        return Student.HousingType.SINGLE_FEMALE

    if 'רווקים' in normalized_description or 'בנים' in normalized_description:
        return Student.HousingType.SINGLE_MALE

    # Do not store values outside Student.HousingType.choices.
    return ''


def parse_explicit_gender(value):
    """Parse a real male/female value when the Excel explicitly provides one."""
    value_norm = normalize_compact(value)

    if value_norm in {'זכר', 'בנים', 'בן', 'male', 'man', 'men', 'm'}:
        return Student.Gender.MALE

    if value_norm in {'נקבה', 'בנות', 'בת', 'female', 'woman', 'women', 'f'}:
        return Student.Gender.FEMALE

    return None


def _housing_type_does_not_require_gender(housing_type):
    """Z3, Z4 and Z6 are allocated by housing type, not resident gender."""
    return housing_type in {
        Student.HousingType.COUPLE,
        Student.HousingType.FAMILY,
        Student.HousingType.SINGLE_IN_APARTMENT,
    }


def _gender_field_supports_empty_value():
    """Return True only after the nullable-gender model migration is applied."""
    gender_field = Student._meta.get_field('gender')
    return bool(gender_field.null or gender_field.blank)


def validate_gender_model_for_housing_import():
    """
    Fail early instead of silently importing only Z1/Z2.

    Z3/Z4/Z6 may legitimately have no gender value in the additions workbook,
    so the deployed Student.gender field must accept NULL/blank.
    """
    if not _gender_field_supports_empty_value():
        raise RuntimeError(
            'Student.gender is still NOT NULL. Update the model to null=True, '
            'blank=True and apply the migration before importing Z3/Z4/Z6.'
        )


def gender_value_is_valid_for_import(value, housing_type):
    """Validate only what the housing business rules actually require."""
    if value not in (None, ''):
        return True

    if _housing_type_does_not_require_gender(housing_type):
        return _gender_field_supports_empty_value()

    return False


def parse_gender_from_housing_type(
    housing_type,
    tenant_type='',
    explicit_gender='',
    existing_student=None,
):
    """
    Resolve Student.gender without confusing resident gender with apartment type.

    - Preserve an explicit Excel gender when present.
    - Preserve an existing student's real gender.
    - Z1 implies male and Z2 implies female.
    - Z3, Z4 and Z6 do not need gender for allocation, so NULL is valid.
    """
    parsed_explicit_gender = parse_explicit_gender(explicit_gender)
    if parsed_explicit_gender is not None:
        return parsed_explicit_gender

    if existing_student and getattr(existing_student, 'gender', None) not in (None, ''):
        return existing_student.gender

    normalized_housing_type = normalize_student_housing_type(
        housing_type,
        tenant_type,
    )

    if normalized_housing_type == Student.HousingType.SINGLE_MALE:
        return Student.Gender.MALE

    if normalized_housing_type == Student.HousingType.SINGLE_FEMALE:
        return Student.Gender.FEMALE

    if _housing_type_does_not_require_gender(normalized_housing_type):
        return None

    return None


def parse_requested_religion(value):
    value = safe_str(value)
    value_norm = normalize_compact(value)

    if value_norm in {'יהודי', 'jewish'}:
        return Student.Religion.Jewish

    if value_norm in {'מוסלמי', 'מוסלמים', 'muslim', 'muslims'}:
        return Student.Religion.Muslim

    if value_norm in {'נוצרי', 'christian'}:
        return Student.Religion.Christian

    if value_norm in {'דרוזי', 'druze'}:
        return Student.Religion.Druze

    return Student.Religion.NOT_SPECIFIED


def parse_placement_sector(row):
    religion = parse_requested_religion(get_alias_value(row, 'religion', default=''))

    if religion == Student.Religion.Jewish:
        return Student.PlacementSector.JEWISH

    if religion in {
        Student.Religion.Muslim,
        Student.Religion.Christian,
        Student.Religion.Druze,
    }:
        return Student.PlacementSector.ARAB

    return Student.PlacementSector.UNKNOWN


def parse_religious(value):
    value_norm = normalize_compact(value)

    if value_norm in {'כן', 'דתי', 'religious', 'yes', 'true', '1'}:
        return Student.Religious.RELIGIOUS

    if value_norm in {'לא', 'לאמשנה', 'no', 'false', '0', 'nopreference'}:
        return Student.Religious.NO_PREFERENCE

    return Student.Religious.NOT_SPECIFIED


def parse_category(value, sheet_name=''):
    sheet_norm = normalize_compact(sheet_name)

    if sheet_norm == normalize_compact('עוזבים'):
        return Student.StudentCategory.LEAVING

    if sheet_norm == normalize_compact('מעברים'):
        return Student.StudentCategory.TRANSFER

    if sheet_norm == normalize_compact('נכנסים חדשים'):
        return Student.StudentCategory.NEW

    if sheet_norm == normalize_compact('נשארים'):
        return Student.StudentCategory.CONTINUING

    # Confirmed exact allocation-group ("החלטה-תאור קבוצת הקצאה") values
    # take priority over the generic substring heuristic below: the
    # staying/continuing value contains the substring 'חדשים' (it lists
    # veterans + new-who-were-disqualified-as-new), which the heuristic
    # would otherwise misread as StudentCategory.NEW.
    exact_category = allocation_group_category(value)
    if exact_category is not None:
        return exact_category

    value = safe_str(value)
    value_norm = normalize_compact(value)

    if any(x in value_norm for x in ['מעבר', 'מעברים', 'transfer']):
        return Student.StudentCategory.TRANSFER

    if any(x in value_norm for x in ['עזיבה', 'עוזב', 'leaving']):
        return Student.StudentCategory.LEAVING

    if any(x in value_norm for x in ['חדשים', 'חדש', 'new']):
        return Student.StudentCategory.NEW

    return Student.StudentCategory.CONTINUING


def get_decision_status(row):
    return safe_str(get_alias_value(row, 'decision_status', default=''))


def is_positive_decision(decision_status):
    if is_blank(decision_status):
        # Preserve old behavior: blank decision does not block import.
        return True
    return normalize_compact(decision_status) == normalize_compact('החלטה חיובית')


def get_decision_dorm_code(row):
    """Return the authoritative dorm/area code from the dorm-office Excel."""
    return safe_str(get_alias_value(row, 'decision_dorm_code', default=''))


def get_decision_dorm_name(row):
    """Return a human-readable dorm name where available; real file mostly uses numeric codes."""
    return safe_str(get_alias_value(row, 'decision_dorm_name', default=''))



# The dorm-office area number is the official DormType.code.
# It must never be translated through Django primary keys.


def _normalize_excel_area_code(code_value):
    """Normalize Excel dorm-office area codes such as 06 -> 6 and 2.0 -> 2."""
    code_text = safe_str(code_value)
    if not code_text:
        return ''

    code_int = safe_int(code_text, default=None)
    if code_int is not None:
        return str(code_int)

    return code_text.strip()


def _find_dorm_type_by_code(code_value):
    """Resolve a dorm strictly by its stable official DormType.code."""
    normalized_code = _normalize_excel_area_code(code_value)
    code_int = safe_int(normalized_code, default=None)

    if code_int is None:
        return None

    return DormType.objects.filter(
        code=code_int
    ).select_related('region').first()


def get_or_create_dorm_type_from_excel(dorm_code=None, dorm_name=None):
    """
    Resolve DormType without creating rows.

    A supplied dorm decision code is authoritative. When that field is present,
    resolution is performed only through DormType.code. It never falls back to
    a name, a region, or DormType.pk.

    Name/legacy-alias resolution is retained only for old files in which the
    dorm-code field itself is blank.
    """
    dorm_code_text = safe_str(dorm_code)
    if dorm_code_text:
        return _find_dorm_type_by_code(dorm_code_text)

    dorm_name = safe_str(dorm_name)
    if not dorm_name:
        return None

    dorm_type = DormType.objects.filter(
        name__iexact=dorm_name
    ).select_related('region').first()
    if dorm_type:
        return dorm_type

    alias_code = EXCEL_DORM_NAME_TO_OFFICIAL_CODE.get(
        normalize_compact(dorm_name)
    )
    if alias_code is not None:
        return _find_dorm_type_by_code(alias_code)

    return None


def read_accessibility_fields(row):
    """
    Read the raw accessibility/medical columns from the Excel row, exactly
    as imported — independent of whether they end up implying priority.
    """
    explicit_flag = parse_yes_no_code(get_alias_value(row, 'accessibility_flag', default=''))
    disability_percent = safe_decimal(get_alias_value(row, 'disability_percent', default=''), default=None)
    medical_reason = safe_str(get_alias_value(row, 'medical_reason', default=''))
    return explicit_flag, disability_percent, medical_reason


def is_accessibility_priority(row):
    explicit_flag, disability_percent, medical_reason = read_accessibility_fields(row)
    return explicit_flag or (disability_percent is not None and disability_percent > 0) or bool(medical_reason)


def _normalize_allocation_group_value(value):
    """
    Like normalize_compact, but additionally unifies dash characters
    (Excel exports mix '-', '–' and '—' inconsistently across identical
    category values) before whitespace-stripping/lowercasing.
    """
    text = safe_str(value).replace('–', '-').replace('—', '-')
    return normalize_compact(text)



# The Excel column name itself ("החלטה-תאור קבוצת הקצאה", aliased in
# COLUMN_ALIASES['allocation_group']) is kept separate from the cell
# VALUES it can contain below. Never compare a value against the column
# name — see test_allocation_group_header_is_not_treated_as_value.
ALLOCATION_GROUP_EXCEL_COLUMN_NAME = "החלטה-תאור קבוצת הקצאה"

# Confirmed exact allocation-group cell values. All students in this
# column are still sent to the solver EXCEPT the accessibility value —
# staying/continuing and new students are both re-allocated from scratch.
ALLOCATION_GROUP_VALUE_STAYING = "הסמכה – ותיקים+חדשים שנפסלו כחדשים+בינלאומי מלאות2"
ALLOCATION_GROUP_VALUES_NEW = (
    "הסמכה – חדשים",
    "מסיימי מכינה מאוחרים – שנה 1",
)
ALLOCATION_GROUP_VALUE_ACCESSIBILITY = "הסמכה - נכים"

_ALLOCATION_GROUP_STAYING_NORMALIZED = _normalize_allocation_group_value(ALLOCATION_GROUP_VALUE_STAYING)
_ALLOCATION_GROUP_NEW_NORMALIZED = {
    _normalize_allocation_group_value(value) for value in ALLOCATION_GROUP_VALUES_NEW
}

# Only 'הסמכה - נכים' marks a student as accessibility/disability. This is
# an exact-match whitelist, never a substring/bool(cell) rule — a value
# merely containing 'הסמכה' or 'נכים' as part of a longer, unrelated
# category name must NOT match.
ACCESSIBILITY_ALLOCATION_GROUP_VALUES = {
    _normalize_allocation_group_value(ALLOCATION_GROUP_VALUE_ACCESSIBILITY)
}


def allocation_group_indicates_accessibility(allocation_group_value):
    """
    True only when allocation_group_value exactly matches (after dash/
    whitespace/case normalization) one of the confirmed accessibility
    allocation-group category values in ACCESSIBILITY_ALLOCATION_GROUP_VALUES.
    """
    return _normalize_allocation_group_value(allocation_group_value) in ACCESSIBILITY_ALLOCATION_GROUP_VALUES


def allocation_group_category(allocation_group_value):
    """
    Exact-match staying/new classification for the confirmed
    allocation-group values, reusing the existing Student.category field
    (StudentCategory.CONTINUING/NEW) instead of a new database column.

    Returns None when allocation_group_value is not one of the confirmed
    staying/new values, so callers can fall back to the generic
    substring heuristic in parse_category() for other sheets/files.
    """
    normalized = _normalize_allocation_group_value(allocation_group_value)

    if normalized == _ALLOCATION_GROUP_STAYING_NORMALIZED:
        return Student.StudentCategory.CONTINUING

    if normalized in _ALLOCATION_GROUP_NEW_NORMALIZED:
        return Student.StudentCategory.NEW

    return None


def classify_allocation_group_bucket(allocation_group_value):
    """
    Non-persisted classification used only for import-summary logging
    (see upload_excel). Never stored on the Student model.
    """
    if allocation_group_indicates_accessibility(allocation_group_value):
        return 'accessibility'

    category = allocation_group_category(allocation_group_value)
    if category == Student.StudentCategory.CONTINUING:
        return 'staying'
    if category == Student.StudentCategory.NEW:
        return 'new'

    return 'other'


def priority_fields_from_special_statuses(*special_statuses):
    """
    is_priority/priority_reason are derived solely from special_status_1..4.
    Accessibility/medical data (is_accessibility_priority) is imported and
    preserved for the dorm office to allocate those students manually, but
    must never affect is_priority, the solver, priority score, clustering,
    or building rules.
    """
    non_empty = [status for status in special_statuses if status]
    return bool(non_empty), ' | '.join(non_empty)


def inject_special_status_marker(special_statuses, marker):
    """
    Insert `marker` into the first blank slot among the 4 special_status
    values, unless it is already present in one of them. Returns a new
    4-tuple.

    Some special-status signals (e.g. the 'אנייר' / anier group) arrive
    via their own dedicated raw Excel column ('9108-אנייר' == 'X'), not
    already embedded in the 'תאור סטטוס מיוחד1..4' description text the
    way הסמכה/עתודאי already are. Without this, _has_anier_special_status
    (and priority_fields_from_special_statuses) would never see the
    marker, even though the student was correctly flagged in the source
    file.
    """
    statuses = list(special_statuses)
    if any(marker in status for status in statuses if status):
        return tuple(statuses)
    for index, status in enumerate(statuses):
        if not status:
            statuses[index] = marker
            return tuple(statuses)
    # All four slots occupied: append rather than silently dropping the marker.
    statuses[-1] = f"{statuses[-1]} | {marker}"
    return tuple(statuses)


def filter_payload_to_student_fields(payload):
    """Avoid create/update errors if the model does not contain optional fields."""
    student_fields = _get_model_field_names(Student)
    return {key: value for key, value in payload.items() if key in student_fields}


def build_student_payload_from_row(row, existing_student=None, sheet_name=''):
    housing_type = safe_str(get_alias_value(row, 'housing_type', default=''))
    tenant_type = safe_str(get_alias_value(row, 'tenant_type', default=''))
    gender_text = safe_str(get_alias_value(row, 'gender', default=''))
    normalized_housing_type = normalize_student_housing_type(
        housing_type,
        tenant_type,
    )

    decision_dorm_code = get_decision_dorm_code(row)
    decision_dorm_name = get_decision_dorm_name(row)

    accepted_dorm_type = get_or_create_dorm_type_from_excel(
        decision_dorm_code,
        decision_dorm_name
    )

    # Accessibility/medical data is imported and stored on its own fields
    # (accessibility_flag/disability_percent/medical_reason) so the dorm
    # office can allocate these students manually. It must never feed
    # is_priority — see priority_fields_from_special_statuses below.
    accessibility_flag, disability_percent, medical_reason = read_accessibility_fields(row)
    placement_sector = parse_placement_sector(row)
    allocation_group_value = get_alias_value(row, 'allocation_group', default='')

    # Some allocation groups (e.g. 'הסמכה - נכים') mark accessibility even
    # when the explicit accessibility columns are blank for this row.
    if allocation_group_indicates_accessibility(allocation_group_value):
        accessibility_flag = True

    special_status_1 = safe_str(get_alias_value(row, 'special_status_1'))
    special_status_2 = safe_str(get_alias_value(row, 'special_status_2'))
    special_status_3 = safe_str(get_alias_value(row, 'special_status_3'))
    special_status_4 = safe_str(get_alias_value(row, 'special_status_4'))

    if parse_yes_no_code(get_alias_value(row, 'anier_flag', default='')):
        special_status_1, special_status_2, special_status_3, special_status_4 = (
            inject_special_status_marker(
                (special_status_1, special_status_2, special_status_3, special_status_4),
                'אנייר',
            )
        )

    is_priority, priority_reason = priority_fields_from_special_statuses(
        special_status_1, special_status_2, special_status_3, special_status_4,
    )

    current_dorm_type_value = (
        accepted_dorm_type.name
        if accepted_dorm_type
        else (decision_dorm_code or decision_dorm_name)
    )

    payload = {
        'student_id': safe_str(get_alias_value(row, 'student_id')),
        'first_name': safe_str(get_alias_value(row, 'first_name')),
        'last_name': safe_str(get_alias_value(row, 'last_name')),
        'phone': normalize_phone(get_alias_value(row, 'phone')),
        'phone_secondary': normalize_phone(get_alias_value(row, 'phone_secondary')),
        'email': safe_str(get_alias_value(row, 'email')),
        'city': safe_str(get_alias_value(row, 'city')),

        'gender': parse_gender_from_housing_type(
            normalized_housing_type,
            tenant_type=tenant_type,
            explicit_gender=gender_text,
            existing_student=existing_student,
        ),

        'requested_religion': parse_requested_religion(get_alias_value(row, 'religion', default='')),
        'placement_sector': placement_sector,
        'religious': parse_religious(get_alias_value(row, 'religious', default='')),
        'category': parse_category(allocation_group_value, sheet_name=sheet_name),

        'housing_type': normalized_housing_type,
        'allocation_group': safe_str(allocation_group_value),
        'accepted_dorm_type': accepted_dorm_type,

        'roommate_request_1': safe_str(get_alias_value(row, 'roommate_name_1')),
        'roommate_request_2': safe_str(get_alias_value(row, 'roommate_name_2')),
        'roommate_request_3': safe_str(get_alias_value(row, 'roommate_name_3')),
        'roommate_request_4': safe_str(get_alias_value(row, 'roommate_name_4')),
        'roommate_request_5': safe_str(get_alias_value(row, 'roommate_name_5')),

        'roommate_request_student_id_1': safe_str(get_alias_value(row, 'roommate_id_1')),
        'roommate_request_student_id_2': safe_str(get_alias_value(row, 'roommate_id_2')),
        'roommate_request_student_id_3': safe_str(get_alias_value(row, 'roommate_id_3')),
        'roommate_request_student_id_4': safe_str(get_alias_value(row, 'roommate_id_4')),
        'roommate_request_student_id_5': safe_str(get_alias_value(row, 'roommate_id_5')),

        'roommate_request_flag_1': extract_roommate_flag(get_alias_value(row, 'roommate_flag_1')),
        'roommate_request_flag_2': extract_roommate_flag(get_alias_value(row, 'roommate_flag_2')),
        'roommate_request_flag_3': extract_roommate_flag(get_alias_value(row, 'roommate_flag_3')),
        'roommate_request_flag_4': extract_roommate_flag(get_alias_value(row, 'roommate_flag_4')),
        'roommate_request_flag_5': extract_roommate_flag(get_alias_value(row, 'roommate_flag_5')),

        'special_status_1': special_status_1,
        'special_status_2': special_status_2,
        'special_status_3': special_status_3,
        'special_status_4': special_status_4,

        'study_points': safe_decimal(get_alias_value(row, 'study_points', default=''), default=None),
        'current_address': safe_str(get_alias_value(row, 'current_address', default='')),
        'current_dorm_type': current_dorm_type_value,

        'is_priority': is_priority,
        'priority_reason': priority_reason,

        'accessibility_flag': accessibility_flag,
        'disability_percent': disability_percent,
        'medical_reason': medical_reason,
    }

    optional_fields = {
        'business_partner_id': safe_str(get_alias_value(row, 'business_partner_id')),
        'email_secondary': safe_str(get_alias_value(row, 'email_secondary')),
        'current_dorm_code': safe_str(get_alias_value(row, 'current_dorm_code')),
        'accepted_dorm_code': decision_dorm_code,
    }

    payload.update(optional_fields)
    return filter_payload_to_student_fields(payload)

def get_additions_decision_status(row):
    """
    For additions file, use the final dorm decision status.
    We do not want to rely on gria/tosefet status if the final decision exists.
    """
    return safe_str(
        get_row_value(
            row,
            'החלטה-החלטת מעונות - תאור',
            default=''
        )
    )


def get_additions_decision_dorm_code(row):
    """
    In the additions file, the real dorm decision code is usually in
    the 'decision content - dorms' column.

    Important:
    Do NOT use company code columns like 3000 as dorm type code.
    """
    return safe_str(
        get_row_value(
            row,
            'החלטה-תוכן החלטה – מעונות',
            'החלטה-תוכן החלטה - מעונות',
            'החלטה-תוכן החלטה מעונות',
            'החלטה-תוכן החלטה מעונות-קוד',
            'אזור החלטה לאביב',
            default=''
        )
    )


def is_additions_positive_decision(row):
    decision_status = get_additions_decision_status(row)

    if is_blank(decision_status):
        return False

    return normalize_compact(decision_status) == normalize_compact('החלטה חיובית')


def refresh_db_connection():
    """Reuse a healthy connection; reconnect only when it is actually stale."""
    if connection.connection is None:
        connection.ensure_connection()
        return

    try:
        if connection.is_usable():
            return
    except Exception:
        pass

    connection.close()
    connection.ensure_connection()


# ============================================================
# Import batch lifecycle: init / status / stop / delete
#
# Two-step handshake: the frontend calls init_import_batch() first to get a
# batch_id BEFORE sending the Excel file, since the actual upload endpoints
# (upload_excel / upload_additions_excel) stay fully synchronous - the
# batch_id has to exist ahead of time so Stop/Status can target it while
# that request is still in flight, and so the frontend never has to guess
# or fall back to "the latest batch."
# ============================================================

_IMPORT_BATCH_STOP_STATUSES = {
    ImportBatch.Status.CANCELLATION_REQUESTED,
    ImportBatch.Status.STOP_AND_DELETE_REQUESTED,
}


def _delete_students_created_by_batch(batch):
    """
    Deletes ONLY Student rows this batch created (created_in_batch) - never
    students it merely updated, never dorm inventory. BedAssignment.student
    is on_delete=PROTECT, so a created student who has since been allocated
    a bed raises ProtectedError; caught per-student here so one protected
    row never blocks the rest and is never silently reported as deleted.
    """
    deleted = []
    protected = []

    for student in Student.objects.filter(created_in_batch=batch):
        student_pk = student.pk
        student_label = student.student_id
        try:
            student.delete()
            deleted.append(student_pk)
        except ProtectedError:
            protected.append({'id': student_pk, 'student_id': student_label})

    return {
        'requested': True,
        'deleted_count': len(deleted),
        'protected_count': len(protected),
        'protected_students': protected,
        'performed_at': timezone.now().isoformat(),
    }


def _get_owned_batch_or_error(request, batch_id, expected_kind=None):
    """Shared lookup+ownership+kind check for the batch-lifecycle endpoints.

    Returns (batch, None) on success, or (None, Response) on failure - the
    caller just does `if error: return error`.
    """
    if not request.user.is_central_admin:
        return None, Response({
            'error': 'רק מנהל מרכזי יכול לבצע פעולה זו',
            'errorEn': 'Only Central Admin can perform this action',
        }, status=status.HTTP_403_FORBIDDEN)

    try:
        batch = ImportBatch.objects.get(pk=batch_id)
    except ImportBatch.DoesNotExist:
        return None, Response({
            'error': 'קובץ יבוא לא נמצא',
            'errorEn': 'Import batch not found',
        }, status=status.HTTP_404_NOT_FOUND)

    if batch.uploaded_by_id != request.user.id:
        return None, Response({
            'error': 'קובץ יבוא זה שייך למשתמש אחר',
            'errorEn': 'This import batch belongs to a different user',
        }, status=status.HTTP_403_FORBIDDEN)

    if expected_kind is not None and batch.kind != expected_kind:
        return None, Response({
            'error': 'סוג קובץ היבוא אינו תואם',
            'errorEn': 'Import batch kind mismatch',
        }, status=status.HTTP_400_BAD_REQUEST)

    return batch, None


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def init_import_batch(request):
    """Step 1 of the upload handshake: create a PENDING batch and hand its
    id to the frontend BEFORE any file is sent, so Stop/Status can target
    an explicit batch_id from the very start of the upload flow."""
    if not request.user.is_central_admin:
        return Response({
            'error': 'רק מנהל מרכזי יכול להעלות קבצים',
            'errorEn': 'Only Central Admin can upload files'
        }, status=status.HTTP_403_FORBIDDEN)

    kind = request.data.get('kind') or ImportBatch.Kind.MAIN
    if kind not in ImportBatch.Kind.values:
        return Response({
            'error': 'סוג קובץ לא תקין',
            'errorEn': 'Invalid upload kind',
        }, status=status.HTTP_400_BAD_REQUEST)

    batch = ImportBatch.objects.create(
        uploaded_by=request.user,
        kind=kind,
        status=ImportBatch.Status.PENDING,
    )

    return Response({
        'batch_id': batch.id,
        'status': batch.status,
    }, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_import_batch_status(request, batch_id):
    batch, error = _get_owned_batch_or_error(request, batch_id)
    if error:
        return error

    return Response(ImportBatchSerializer(batch).data, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def stop_import_batch(request, batch_id):
    with transaction.atomic():
        batch, error = _get_owned_batch_or_error(request, batch_id)
        if error:
            return error

        batch = ImportBatch.objects.select_for_update().get(pk=batch.id)

        if batch.status != ImportBatch.Status.PROCESSING:
            return Response({
                'error': 'ניתן לעצור רק קובץ שנמצא כרגע בעיבוד',
                'errorEn': 'Only a batch currently processing can be stopped',
                'status': batch.status,
            }, status=status.HTTP_409_CONFLICT)

        batch.status = ImportBatch.Status.CANCELLATION_REQUESTED
        batch.save(update_fields=['status'])

    return Response(ImportBatchSerializer(batch).data, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def stop_and_delete_import_batch(request, batch_id):
    with transaction.atomic():
        batch, error = _get_owned_batch_or_error(request, batch_id)
        if error:
            return error

        batch = ImportBatch.objects.select_for_update().get(pk=batch.id)

        if batch.status == ImportBatch.Status.PENDING:
            # Nothing was ever created for this batch - resolve immediately,
            # no running loop will ever notice a requested-state flag here.
            batch.status = ImportBatch.Status.STOPPED
            batch.finished_at = timezone.now()
            batch.result = {
                'success': True,
                'stopped': True,
                'deletion': {
                    'requested': True,
                    'deleted_count': 0,
                    'protected_count': 0,
                    'protected_students': [],
                    'performed_at': timezone.now().isoformat(),
                },
            }
            batch.save(update_fields=['status', 'finished_at', 'result'])
            return Response(ImportBatchSerializer(batch).data, status=status.HTTP_200_OK)

        if batch.status not in (
            ImportBatch.Status.PROCESSING,
            ImportBatch.Status.CANCELLATION_REQUESTED,
        ):
            return Response({
                'error': 'לא ניתן לעצור ולמחוק קובץ שכבר הסתיים. השתמשו בפעולת המחיקה הרגילה.',
                'errorEn': 'Cannot stop-and-delete a batch that already finished. Use the plain delete action.',
                'status': batch.status,
            }, status=status.HTTP_409_CONFLICT)

        # PROCESSING or CANCELLATION_REQUESTED: the still-running upload
        # request will notice this on its next per-row check and perform
        # the deletion itself, inline, before it returns - see the
        # `finally:` block in upload_excel/upload_additions_excel.
        batch.status = ImportBatch.Status.STOP_AND_DELETE_REQUESTED
        batch.save(update_fields=['status'])

    return Response(ImportBatchSerializer(batch).data, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def delete_import_batch(request, batch_id):
    with transaction.atomic():
        batch, error = _get_owned_batch_or_error(request, batch_id)
        if error:
            return error

        batch = ImportBatch.objects.select_for_update().get(pk=batch.id)

        if batch.status not in (
            ImportBatch.Status.COMPLETED,
            ImportBatch.Status.STOPPED,
            ImportBatch.Status.FAILED,
        ):
            return Response({
                'error': 'ניתן למחוק סטודנטים רק לאחר שההעלאה הסתיימה או נעצרה',
                'errorEn': 'Students can only be deleted once the upload has finished or stopped',
                'status': batch.status,
            }, status=status.HTTP_409_CONFLICT)

        deletion = _delete_students_created_by_batch(batch)
        result = dict(batch.result or {})
        result['deletion'] = deletion
        batch.result = result
        batch.save(update_fields=['result'])

    return Response(ImportBatchSerializer(batch).data, status=status.HTTP_200_OK)


# G3-21: explicit upload guards, checked BEFORE the (comparatively
# expensive) pandas/openpyxl parse and before the ImportBatch is ever
# marked PROCESSING - a rejected file here never touches batch state at
# all (it stays PENDING, so the frontend can just let the operator pick a
# different file and retry with the same batch_id; no FAILED/stuck-
# PROCESSING cleanup is ever needed for this class of rejection).
MAX_UPLOAD_FILE_SIZE_BYTES = int(os.getenv('MAX_UPLOAD_FILE_SIZE_MB', '25')) * 1024 * 1024


def _validate_upload_file_or_error(uploaded_file):
    """
    Shared main/additions upload validation (G3-21):
    1. extension allow-list (unchanged - kept as the fast first check)
    2. explicit byte-size ceiling, checked from Django's UploadedFile.size
       without reading the file into memory
    3. actual content validation - attempts to open the workbook with
       pandas/openpyxl; a corrupt file, a renamed non-Excel file, or any
       other structurally invalid upload fails HERE with a clean 400,
       never as an unhandled exception deeper in the row-by-row import
       loop (and never leaking a pandas/openpyxl stack trace to the
       client - that detail stays server-side via traceback.print_exc()).

    Returns (excel_file, error_response). On success error_response is
    None and excel_file is the already-opened pd.ExcelFile, reused by the
    caller instead of re-opening the upload a second time.
    """
    if not uploaded_file.name.lower().endswith(('.xlsx', '.xls')):
        return None, Response({
            'error': 'סוג קובץ לא נתמך. נא להעלות קובץ Excel (.xlsx או .xls)',
            'errorEn': 'Unsupported file type. Please upload an Excel file (.xlsx or .xls)'
        }, status=status.HTTP_400_BAD_REQUEST)

    if uploaded_file.size is not None and uploaded_file.size > MAX_UPLOAD_FILE_SIZE_BYTES:
        max_mb = MAX_UPLOAD_FILE_SIZE_BYTES // (1024 * 1024)
        return None, Response({
            'error': f'הקובץ גדול מדי. הגודל המרבי המותר הוא {max_mb}MB.',
            'errorEn': f'File is too large. Maximum allowed size is {max_mb}MB.',
        }, status=status.HTTP_400_BAD_REQUEST)

    if uploaded_file.size == 0:
        return None, Response({
            'error': 'הקובץ ריק',
            'errorEn': 'The uploaded file is empty',
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        excel_file = pd.ExcelFile(uploaded_file)
        # Touch sheet_names now (cheap - it's already parsed the workbook's
        # central directory/structure to open it) so a workbook that
        # "opens" but has no readable sheet structure also fails here
        # rather than later.
        _ = excel_file.sheet_names
    except Exception:
        # Server-side only - never returned to the client (no stack trace
        # leak; see docstring above).
        traceback.print_exc()
        return None, Response({
            'error': 'לא ניתן לקרוא את הקובץ - ודאו שמדובר בקובץ Excel תקין (.xlsx/.xls) ולא פגום.',
            'errorEn': 'Could not read the file - please make sure it is a valid, non-corrupted Excel file (.xlsx/.xls).',
        }, status=status.HTTP_400_BAD_REQUEST)

    return excel_file, None


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def upload_excel(request):
    """
    Upload status report Excel.

    This import supports all four sheets:
    - עוזבים
    - מעברים
    - נכנסים חדשים
    - נשארים

    Important:
    - No students are deleted.
    - Leaving students are imported with category=LEAVING.
    - Students are not skipped because of non-positive decision status.
    - Students are not skipped because accepted_dorm_type could not be resolved.
    - Existing students are updated carefully without clearing existing values
      when the Excel cell is empty.
    """

    if not request.user.is_central_admin:
        return Response({
            'error': 'רק מנהל מרכזי יכול להעלות קבצים',
            'errorEn': 'Only Central Admin can upload files'
        }, status=status.HTTP_403_FORBIDDEN)

    if 'file' not in request.FILES:
        return Response({
            'error': 'לא נבחר קובץ',
            'errorEn': 'No file selected'
        }, status=status.HTTP_400_BAD_REQUEST)

    uploaded_file = request.FILES['file']

    # G3-21: size/content validation, before anything else touches this
    # upload or the ImportBatch's state - see _validate_upload_file_or_error.
    excel_file, upload_error = _validate_upload_file_or_error(uploaded_file)
    if upload_error:
        return upload_error

    validate_gender_model_for_housing_import()

    batch_id = request.data.get('batch_id')
    if not batch_id:
        return Response({
            'error': 'נדרש batch_id. יש לאתחל את ההעלאה תחילה.',
            'errorEn': 'batch_id is required. Initialize the upload first.',
        }, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        batch, error = _get_owned_batch_or_error(request, batch_id, expected_kind=ImportBatch.Kind.MAIN)
        if error:
            return error

        batch = ImportBatch.objects.select_for_update().get(pk=batch.id)

        if batch.status != ImportBatch.Status.PENDING:
            return Response({
                'error': 'קובץ יבוא זה כבר עובד או הסתיים',
                'errorEn': 'This import batch has already been processed',
                'status': batch.status,
            }, status=status.HTTP_409_CONFLICT)

        batch.filename = uploaded_file.name
        batch.status = ImportBatch.Status.PROCESSING
        batch.started_at = timezone.now()
        batch.save(update_fields=['filename', 'status', 'started_at'])

    stop_requested = False
    requested_stop_status = None
    processed_rows = 0
    total_rows = 0

    try:

        created_count = 0
        updated_count = 0
        skipped_count = 0

        errors = []
        warnings = []
        region_counts = {}
        sheet_counts = {}
        skipped_by_reason = {}

        category_counts = {
            'new': 0,
            'continuing': 0,
            'transfer': 0,
            'leaving': 0,
        }

        # Import-summary buckets derived from the allocation-group column,
        # for logging only — never persisted on the Student model.
        allocation_group_bucket_counts = {
            'staying': 0,
            'new': 0,
            'accessibility': 0,
            'other': 0,
        }

        # If a student appears in more than one sheet, we keep the stronger status.
        category_priority = {
            Student.StudentCategory.CONTINUING: 1,
            Student.StudentCategory.NEW: 2,
            Student.StudentCategory.TRANSFER: 3,
            Student.StudentCategory.LEAVING: 4,
        }

        imported_student_category_priority = {}
        dorm_inventory_cache = {}

        def dorm_has_active_inventory(dorm_type):
            if dorm_type is None:
                return False
            if dorm_type.pk not in dorm_inventory_cache:
                dorm_inventory_cache[dorm_type.pk] = dorm_type.buildings.filter(
                    is_active=True
                ).exists()
            return dorm_inventory_cache[dorm_type.pk]

        def add_skip(reason, amount=1):
            nonlocal skipped_count
            skipped_count += amount
            skipped_by_reason[reason] = skipped_by_reason.get(reason, 0) + amount

        def add_region_count(region, created=False, updated=False):
            if not region:
                return

            if region.id not in region_counts:
                region_counts[region.id] = {
                    'region': region,
                    'count': 0,
                    'created': 0,
                    'updated': 0,
                }

            region_counts[region.id]['count'] += 1

            if created:
                region_counts[region.id]['created'] += 1

            if updated:
                region_counts[region.id]['updated'] += 1

        def update_existing_student(existing, student_payload):
            """
            Update an existing student carefully:
            - Always update category and batch.
            - Do not clear existing values when Excel value is blank.
            - Do not replace accepted_dorm_type with None.
            """
            for key, value in student_payload.items():
                if key == 'student_id':
                    continue

                if key == 'category':
                    setattr(existing, key, value)
                    continue

                if key == 'accepted_dorm_type':
                    if value is not None:
                        setattr(existing, key, value)
                    continue

                # Preserve existing data if the Excel value is empty.
                if is_blank(value):
                    continue

                setattr(existing, key, value)

            existing.batch = batch
            existing.save()

        for sheet_name in excel_file.sheet_names:
            df = pd.read_excel(excel_file, sheet_name=sheet_name)
            df.columns = [safe_str(col) for col in df.columns]

            total_rows += len(df)
            ImportBatch.objects.filter(pk=batch.id).update(total_rows=total_rows)

            sheet_counts[sheet_name] = {
                'rows': len(df),
                'created': 0,
                'updated': 0,
                'skipped': 0,
                'categories': {
                    'new': 0,
                    'continuing': 0,
                    'transfer': 0,
                    'leaving': 0,
                }
            }

            required_columns = ['ת"ז ישראלית', 'שם פרטי', 'שם משפחה']
            missing_required = [col for col in required_columns if col not in df.columns]

            if missing_required:
                add_skip('missing_required_columns', len(df))
                sheet_counts[sheet_name]['skipped'] += len(df)
                errors.append(
                    f"Sheet '{sheet_name}' missing required columns: {', '.join(missing_required)}"
                )
                continue

            for idx, row in df.iterrows():
                try:
                    student_id = safe_str(get_alias_value(row, 'student_id'))

                    if not student_id:
                        add_skip('missing_student_id')
                        sheet_counts[sheet_name]['skipped'] += 1
                        errors.append(
                            f"Sheet '{sheet_name}', row {idx + 2}: missing student_id"
                        )
                        continue

                    existing = Student.objects.filter(student_id=student_id).select_related(
                        'accepted_dorm_type',
                        'accepted_dorm_type__region'
                    ).first()

                    student_payload = build_student_payload_from_row(
                        row,
                        existing_student=existing,
                        sheet_name=sheet_name,
                    )

                    normalized_housing_type = student_payload.get('housing_type')
                    if not existing and not gender_value_is_valid_for_import(
                        student_payload.get('gender'),
                        normalized_housing_type,
                    ):
                        if normalized_housing_type in {
                            Student.HousingType.COUPLE,
                            Student.HousingType.FAMILY,
                            Student.HousingType.SINGLE_IN_APARTMENT,
                        }:
                            raise ValueError(
                                'Student.gender must allow NULL/blank for Z3/Z4/Z6. '
                                'Apply the nullable-gender migration before importing.'
                            )

                        add_skip('missing_gender_for_unknown_housing_type')
                        sheet_counts[sheet_name]['skipped'] += 1
                        errors.append(
                            f"Sheet '{sheet_name}', row {idx + 2}, student {student_id}: "
                            "gender and housing type could not be resolved."
                        )
                        continue

                    student_category = student_payload.get('category') or parse_category('', sheet_name=sheet_name)
                    student_payload['category'] = student_category

                    # Handle duplicate students inside the same uploaded Excel.
                    new_priority = category_priority.get(student_category, 0)
                    old_priority = imported_student_category_priority.get(student_id)

                    if old_priority is not None and new_priority < old_priority:
                        # Do not allow a weaker sheet to overwrite a stronger category.
                        if existing:
                            student_payload['category'] = existing.category

                        warnings.append(
                            f"Student {student_id} appeared again in sheet '{sheet_name}' "
                            f"with weaker category '{student_category}'. Category was not overwritten."
                        )
                    else:
                        imported_student_category_priority[student_id] = new_priority

                    accepted_dorm_type = student_payload.get('accepted_dorm_type')
                    target_region = accepted_dorm_type.region if accepted_dorm_type else None

                    # In this status-report import, we do NOT skip students if dorm type is missing.
                    # This is especially important for leaving students.
                    if accepted_dorm_type is None:
                        warnings.append(
                            f"Student {student_id}: accepted_dorm_type could not be resolved. "
                            f"Student was imported anyway."
                        )

                    if accepted_dorm_type is not None and target_region is None:
                        warnings.append(
                            f"Student {student_id}: dorm type '{accepted_dorm_type.name}' has no region. "
                            f"Student was imported anyway."
                        )

                    if accepted_dorm_type is not None and not dorm_has_active_inventory(accepted_dorm_type):
                        warnings.append(
                            f"Student {student_id}: official dorm code {accepted_dorm_type.code} "
                            "currently has no active building inventory. The decision was preserved, "
                            "but allocation may have no feasible room for this student."
                        )

                    if existing:
                        update_existing_student(existing, student_payload)

                        updated_count += 1
                        sheet_counts[sheet_name]['updated'] += 1

                        if target_region:
                            add_region_count(target_region, updated=True)

                    else:
                        Student.objects.create(
                            batch=batch,
                            created_in_batch=batch,
                            **student_payload
                        )

                        created_count += 1
                        sheet_counts[sheet_name]['created'] += 1

                        if target_region:
                            add_region_count(target_region, created=True)

                    final_category = student_payload.get('category')

                    if final_category in category_counts:
                        category_counts[final_category] += 1

                    if final_category in sheet_counts[sheet_name]['categories']:
                        sheet_counts[sheet_name]['categories'][final_category] += 1

                    allocation_group_bucket = classify_allocation_group_bucket(
                        student_payload.get('allocation_group', '')
                    )
                    allocation_group_bucket_counts[allocation_group_bucket] += 1

                except Exception as e:
                    add_skip('row_exception')
                    sheet_counts[sheet_name]['skipped'] += 1
                    errors.append(
                        f"Sheet '{sheet_name}', row {idx + 2}: "
                        f"{e.__class__.__name__}: {str(e)}"
                    )
                    continue
                finally:
                    # Always runs - through the early `continue`s above, the
                    # except branch's `continue`, and normal completion -
                    # so this is the single choke point where a row's
                    # outcome is guaranteed decided. A `break` placed here
                    # overrides any pending `continue` from the try/except
                    # above (standard Python finally semantics) and exits
                    # the row loop cleanly.
                    processed_rows += 1
                    ImportBatch.objects.filter(pk=batch.id).update(processed_rows=processed_rows)

                    live_status = ImportBatch.objects.filter(pk=batch.id).values_list(
                        'status', flat=True
                    ).first()
                    if live_status in _IMPORT_BATCH_STOP_STATUSES:
                        stop_requested = True
                        requested_stop_status = live_status
                        break

            if stop_requested:
                break

        refresh_db_connection()

        for region_id in region_counts.keys():
            RegionInbox.objects.filter(
                region_id=region_id,
                status__in=[
                    RegionInbox.Status.PENDING,
                    RegionInbox.Status.VIEWED,
                ]
            ).update(status=RegionInbox.Status.SUPERSEDED)

        region_breakdown = []

        for region_id, data in region_counts.items():
            refresh_db_connection()

            RegionInbox.objects.create(
                region_id=region_id,
                batch_id=batch.id,
                students_count=data['count'],
                status=RegionInbox.Status.PENDING,
                message=(
                    f'התקבל דוח שיבוץ עם {data["count"]} סטודנטים באזור זה. '
                    f'הדוח כולל נשארים, מעברים, נכנסים חדשים ועוזבים.'
                )
            )

            region_breakdown.append({
                'region_id': region_id,
                'region_name': data['region'].name,
                'count': data['count'],
                'created': data['created'],
                'updated': data['updated'],
            })

        total_imported = created_count + updated_count

        # Sent to the solver = everyone except LEAVING and accessibility
        # students, mirroring the exclusion in run_allocation/
        # _execute_allocation_background.
        final_students_for_solver = (
            total_imported
            - category_counts['leaving']
            - allocation_group_bucket_counts['accessibility']
        )
        print(
            ">>> upload_excel allocation-group summary: "
            f"total={total_imported}, "
            f"staying={allocation_group_bucket_counts['staying']}, "
            f"new={allocation_group_bucket_counts['new']}, "
            f"accessibility_excluded={allocation_group_bucket_counts['accessibility']}, "
            f"other={allocation_group_bucket_counts['other']}, "
            f"final_sent_to_solver={final_students_for_solver}",
            flush=True,
        )

        result_payload = {
            'success': True,
            'stopped': stop_requested,
            'message': (
                'עיבוד הקובץ נעצר לבקשת המשתמש' if stop_requested
                else 'דוח השיבוץ הועלה ועובד בהצלחה'
            ),
            'messageEn': (
                'File processing was stopped by request' if stop_requested
                else 'Status report uploaded and processed successfully'
            ),
            'batch_id': batch.id,
            'total_students': total_imported,
            'created': created_count,
            'updated': updated_count,
            'skipped': skipped_count,
            'category_counts': category_counts,
            'region_breakdown': region_breakdown,
            'sheet_counts': sheet_counts,
            'skipped_by_reason': skipped_by_reason,
            'warnings': warnings[:100],
            'errors': errors[:100],
        }

        refresh_db_connection()

        if stop_requested:
            if requested_stop_status == ImportBatch.Status.STOP_AND_DELETE_REQUESTED:
                result_payload['deletion'] = _delete_students_created_by_batch(batch)

            ImportBatch.objects.filter(pk=batch.id).update(
                total_students=total_imported,
                status=ImportBatch.Status.STOPPED,
                finished_at=timezone.now(),
                error_message='',
                result=result_payload,
            )
        else:
            ImportBatch.objects.filter(pk=batch.id).update(
                total_students=total_imported,
                status=ImportBatch.Status.COMPLETED,
                finished_at=timezone.now(),
                error_message='',
                result=result_payload,
            )

        return Response(result_payload, status=status.HTTP_200_OK)

    except Exception as e:
        traceback.print_exc()

        try:
            refresh_db_connection()
            ImportBatch.objects.filter(pk=batch.id).update(
                status=ImportBatch.Status.FAILED,
                error_message=str(e)[:2000],
                finished_at=timezone.now(),
            )
        except Exception:
            traceback.print_exc()

        # G3-21: the stack trace stays server-side (traceback.print_exc()
        # above) - never echoed back to the client.
        return Response({
            'success': False,
            'error': f'שגיאה בעיבוד דוח השיבוץ: {str(e)}',
            'errorEn': f'Error processing status report: {str(e)}',
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



# ============================================================
# Additions-file-specific housing normalization
# ============================================================
# These wrappers are used by upload_additions_excel(); the shared canonical
# housing normalization is also used by the general student import.

ADDITIONS_HOUSING_CODE_MAP = STUDENT_HOUSING_CODE_MAP


def normalize_additions_housing_type(row):
    """Return one of the five canonical Student.HousingType values."""
    return normalize_student_housing_type(
        get_alias_value(row, 'housing_type', default=''),
        get_alias_value(row, 'tenant_type', default=''),
    )


def additions_housing_bucket(housing_type):
    """Return a stable import-summary bucket for a canonical housing value."""
    if housing_type == Student.HousingType.FAMILY:
        return 'family'
    if housing_type == Student.HousingType.COUPLE:
        return 'couple'
    if housing_type == Student.HousingType.SINGLE_IN_APARTMENT:
        return 'single_mixed'
    if housing_type == Student.HousingType.SINGLE_FEMALE:
        return 'single_female'
    if housing_type == Student.HousingType.SINGLE_MALE:
        return 'single_male'

    return 'unknown'


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def upload_additions_excel(request):
    """
    Upload additions Excel file.

    This function is for the 'מתווספים' file.

    Logic:
    - Import only positive decisions.
    - Import all supported Z1/Z2/Z3/Z4/Z6 housing types.
    - Route each student by the authoritative numeric DormType.code.
    - If student already exists:
        update enrichment fields only.
        do NOT override category.
        do NOT override assigned_room.
        do NOT touch BedAssignment.
    - If student does not exist:
        create student as category=NEW.
    """

    if not request.user.is_central_admin:
        return Response({
            'error': 'רק מנהל מרכזי יכול להעלות קבצים',
            'errorEn': 'Only Central Admin can upload files'
        }, status=status.HTTP_403_FORBIDDEN)

    if 'file' not in request.FILES:
        return Response({
            'error': 'לא נבחר קובץ',
            'errorEn': 'No file selected'
        }, status=status.HTTP_400_BAD_REQUEST)

    uploaded_file = request.FILES['file']

    # G3-21: size/content validation, before anything else touches this
    # upload or the ImportBatch's state - see _validate_upload_file_or_error.
    excel_file, upload_error = _validate_upload_file_or_error(uploaded_file)
    if upload_error:
        return upload_error

    validate_gender_model_for_housing_import()

    batch_id = request.data.get('batch_id')
    if not batch_id:
        return Response({
            'error': 'נדרש batch_id. יש לאתחל את ההעלאה תחילה.',
            'errorEn': 'batch_id is required. Initialize the upload first.',
        }, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        batch, error = _get_owned_batch_or_error(request, batch_id, expected_kind=ImportBatch.Kind.ADDITIONS)
        if error:
            return error

        batch = ImportBatch.objects.select_for_update().get(pk=batch.id)

        if batch.status != ImportBatch.Status.PENDING:
            return Response({
                'error': 'קובץ יבוא זה כבר עובד או הסתיים',
                'errorEn': 'This import batch has already been processed',
                'status': batch.status,
            }, status=status.HTTP_409_CONFLICT)

        batch.filename = uploaded_file.name
        batch.status = ImportBatch.Status.PROCESSING
        batch.started_at = timezone.now()
        batch.save(update_fields=['filename', 'status', 'started_at'])

    stop_requested = False
    requested_stop_status = None
    processed_rows = 0
    total_rows = 0

    try:

        created_count = 0
        updated_count = 0
        skipped_count = 0

        errors = []
        warnings = []
        region_counts = {}
        sheet_counts = {}
        skipped_by_reason = {}

        existing_category_preserved_count = 0
        dorm_inventory_cache = {}

        def dorm_has_active_inventory(dorm_type):
            if dorm_type is None:
                return False
            if dorm_type.pk not in dorm_inventory_cache:
                dorm_inventory_cache[dorm_type.pk] = dorm_type.buildings.filter(
                    is_active=True
                ).exists()
            return dorm_inventory_cache[dorm_type.pk]

        housing_type_counts = {
            'single_male': 0,
            'single_female': 0,
            'single_mixed': 0,
            'couple': 0,
            'family': 0,
            'unknown': 0,
        }

        def add_skip(reason, amount=1):
            nonlocal skipped_count
            skipped_count += amount
            skipped_by_reason[reason] = skipped_by_reason.get(reason, 0) + amount

        def add_region_count(region, created=False, updated=False):
            if not region:
                return

            if region.id not in region_counts:
                region_counts[region.id] = {
                    'region': region,
                    'count': 0,
                    'created': 0,
                    'updated': 0,
                }

            region_counts[region.id]['count'] += 1

            if created:
                region_counts[region.id]['created'] += 1

            if updated:
                region_counts[region.id]['updated'] += 1

        def update_existing_student_from_additions(existing, student_payload):
            """
            Update only safe enrichment fields from additions file.

            Do not override fields that represent current status / occupancy.
            Do not clear existing fields with blank Excel values.
            """

            protected_fields = {
                'student_id',
                'category',
                'assigned_room',
                'current_address',
                'current_dorm_type',
                'move_in_date',
                'move_out_date',
            }

            for key, value in student_payload.items():
                if key in protected_fields:
                    continue

                if key == 'accepted_dorm_type':
                    if value is not None:
                        setattr(existing, key, value)
                    continue

                if is_blank(value):
                    continue

                setattr(existing, key, value)

            existing.batch = batch
            existing.save()

        for sheet_name in excel_file.sheet_names:
            df = pd.read_excel(excel_file, sheet_name=sheet_name)
            df.columns = [safe_str(col) for col in df.columns]

            total_rows += len(df)
            ImportBatch.objects.filter(pk=batch.id).update(total_rows=total_rows)

            sheet_counts[sheet_name] = {
                'rows': len(df),
                'created': 0,
                'updated': 0,
                'skipped': 0,
                'positive_decisions': 0,
                'non_positive_decisions': 0,
                'existing_category_preserved': 0,
                'housing_type_counts': {
                    'single_male': 0,
                    'single_female': 0,
                    'single_mixed': 0,
                    'couple': 0,
                    'family': 0,
                    'unknown': 0,
                },
            }

            required_columns = ['ת"ז ישראלית', 'שם פרטי', 'שם משפחה']
            missing_required = [col for col in required_columns if col not in df.columns]

            if missing_required:
                add_skip('missing_required_columns', len(df))
                sheet_counts[sheet_name]['skipped'] += len(df)
                errors.append(
                    f"Sheet '{sheet_name}' missing required columns: {', '.join(missing_required)}"
                )
                continue

            for idx, row in df.iterrows():
                try:
                    student_id = safe_str(get_alias_value(row, 'student_id'))

                    if not student_id:
                        add_skip('missing_student_id')
                        sheet_counts[sheet_name]['skipped'] += 1
                        errors.append(
                            f"Sheet '{sheet_name}', row {idx + 2}: missing student_id"
                        )
                        continue

                    decision_status = get_additions_decision_status(row)

                    if not is_additions_positive_decision(row):
                        add_skip('non_positive_decision')
                        sheet_counts[sheet_name]['skipped'] += 1
                        sheet_counts[sheet_name]['non_positive_decisions'] += 1
                        continue

                    sheet_counts[sheet_name]['positive_decisions'] += 1

                    existing = Student.objects.filter(student_id=student_id).select_related(
                        'accepted_dorm_type',
                        'accepted_dorm_type__region'
                    ).first()

                    student_payload = build_student_payload_from_row(
                        row,
                        existing_student=existing,
                        sheet_name=sheet_name,
                    )

                    # The additions file is imported through this SECOND upload
                    # function. Normalize its official Z1/Z2/Z3/Z4/Z6 housing
                    # values here using the same canonical model choices.
                    normalized_housing_type = normalize_additions_housing_type(row)
                    housing_bucket = additions_housing_bucket(normalized_housing_type)

                    student_payload['housing_type'] = normalized_housing_type
                    resolved_gender = parse_gender_from_housing_type(
                        normalized_housing_type,
                        tenant_type=get_alias_value(row, 'tenant_type', default=''),
                        explicit_gender=get_alias_value(row, 'gender', default=''),
                        existing_student=existing,
                    )
                    student_payload['gender'] = resolved_gender

                    if not existing and not gender_value_is_valid_for_import(
                        resolved_gender,
                        normalized_housing_type,
                    ):
                        if normalized_housing_type in {
                            Student.HousingType.COUPLE,
                            Student.HousingType.FAMILY,
                            Student.HousingType.SINGLE_IN_APARTMENT,
                        }:
                            raise ValueError(
                                'Student.gender must allow NULL/blank for Z3/Z4/Z6. '
                                'Apply the nullable-gender migration before importing.'
                            )

                        add_skip('missing_gender_for_unknown_housing_type')
                        sheet_counts[sheet_name]['skipped'] += 1
                        errors.append(
                            f"Sheet '{sheet_name}', row {idx + 2}, student {student_id}: "
                            "gender and housing type could not be resolved."
                        )
                        continue

                    if housing_bucket == 'unknown':
                        warnings.append(
                            f"Sheet '{sheet_name}', row {idx + 2}, student {student_id}: "
                            f"unknown housing type. description='"
                            f"{safe_str(get_alias_value(row, 'housing_type', default=''))}', "
                            f"tenant_code='"
                            f"{safe_str(get_alias_value(row, 'tenant_type', default=''))}'"
                        )

                    # In additions file, this sheet does not define continuing/transfer/leaving.
                    # Therefore:
                    # - New students become NEW.
                    # - Existing students keep their current category.
                    if existing:
                        original_category = existing.category
                        student_payload['category'] = original_category
                    else:
                        student_payload['category'] = Student.StudentCategory.NEW

                    # Resolve dorm type using the correct additions dorm code.
                    additions_dorm_code = get_additions_decision_dorm_code(row)
                    additions_dorm_name = get_decision_dorm_name(row)

                    accepted_dorm_type = get_or_create_dorm_type_from_excel(
                        dorm_code=additions_dorm_code,
                        dorm_name=additions_dorm_name
                    )

                    if accepted_dorm_type is not None:
                        student_payload['accepted_dorm_type'] = accepted_dorm_type
                    else:
                        # The numeric decision code is authoritative. Never replace
                        # it with the descriptive/name column (for example קנדה).
                        student_payload.pop('accepted_dorm_type', None)

                        if existing:
                            warnings.append(
                                f"Student {student_id}: official dorm decision code "
                                f"'{additions_dorm_code}' could not be resolved. "
                                "The existing accepted_dorm_type was preserved and "
                                "no name fallback was used."
                            )

                    target_region = accepted_dorm_type.region if accepted_dorm_type else None

                    # For a new student, we need accepted_dorm_type to know where to route them.
                    if not existing and accepted_dorm_type is None:
                        add_skip('could_not_resolve_dorm_type')
                        sheet_counts[sheet_name]['skipped'] += 1
                        errors.append(
                            f"Student {student_id}: positive decision but could not resolve dorm type. "
                            f"decision_status='{decision_status}', "
                            f"additions_dorm_code='{additions_dorm_code}', "
                            f"additions_dorm_name='{additions_dorm_name}'"
                        )
                        continue

                    if accepted_dorm_type is not None and target_region is None:
                        add_skip('dorm_type_without_region')
                        sheet_counts[sheet_name]['skipped'] += 1
                        errors.append(
                            f"Student {student_id}: dorm type '{accepted_dorm_type.name}' has no region"
                        )
                        continue

                    if accepted_dorm_type is not None and not dorm_has_active_inventory(accepted_dorm_type):
                        warnings.append(
                            f"Student {student_id}: official dorm code {accepted_dorm_type.code} "
                            "currently has no active building inventory. The decision was preserved, "
                            "but allocation may have no feasible room for this student."
                        )

                    if existing:
                        old_category = existing.category

                        update_existing_student_from_additions(existing, student_payload)

                        # Extra safety: category must not change for existing students.
                        if existing.category != old_category:
                            existing.category = old_category
                            existing.save(update_fields=['category'])

                        updated_count += 1
                        sheet_counts[sheet_name]['updated'] += 1
                        sheet_counts[sheet_name]['existing_category_preserved'] += 1
                        existing_category_preserved_count += 1

                        if target_region:
                            add_region_count(target_region, updated=True)

                    else:
                        Student.objects.create(
                            batch=batch,
                            created_in_batch=batch,
                            **student_payload
                        )

                        created_count += 1
                        sheet_counts[sheet_name]['created'] += 1

                        if target_region:
                            add_region_count(target_region, created=True)

                    # Count only rows that were actually persisted. This keeps
                    # the upload report aligned with the database.
                    housing_type_counts[housing_bucket] += 1
                    sheet_counts[sheet_name]['housing_type_counts'][housing_bucket] += 1

                except Exception as e:
                    add_skip('row_exception')
                    sheet_counts[sheet_name]['skipped'] += 1
                    errors.append(
                        f"Sheet '{sheet_name}', row {idx + 2}: "
                        f"{e.__class__.__name__}: {str(e)}"
                    )
                    continue
                finally:
                    # See upload_excel's identical block for why `finally`
                    # is the single correct choke point here.
                    processed_rows += 1
                    ImportBatch.objects.filter(pk=batch.id).update(processed_rows=processed_rows)

                    live_status = ImportBatch.objects.filter(pk=batch.id).values_list(
                        'status', flat=True
                    ).first()
                    if live_status in _IMPORT_BATCH_STOP_STATUSES:
                        stop_requested = True
                        requested_stop_status = live_status
                        break

            if stop_requested:
                break

        refresh_db_connection()

        for region_id in region_counts.keys():
            RegionInbox.objects.filter(
                region_id=region_id,
                status__in=[
                    RegionInbox.Status.PENDING,
                    RegionInbox.Status.VIEWED,
                ]
            ).update(status=RegionInbox.Status.SUPERSEDED)

        region_breakdown = []

        for region_id, data in region_counts.items():
            refresh_db_connection()

            RegionInbox.objects.create(
                region_id=region_id,
                batch_id=batch.id,
                students_count=data['count'],
                status=RegionInbox.Status.PENDING,
                message=(
                    f'התקבל קובץ מתווספים עם {data["count"]} סטודנטים באזור זה. '
                    f'הקובץ מוסיף סטודנטים עם החלטה חיובית ומשלים מידע לסטודנטים קיימים.'
                )
            )

            region_breakdown.append({
                'region_id': region_id,
                'region_name': data['region'].name,
                'count': data['count'],
                'created': data['created'],
                'updated': data['updated'],
            })

        total_imported = created_count + updated_count

        result_payload = {
            'success': True,
            'stopped': stop_requested,
            'message': (
                'עיבוד הקובץ נעצר לבקשת המשתמש' if stop_requested
                else 'קובץ המתווספים הועלה ועובד בהצלחה'
            ),
            'messageEn': (
                'File processing was stopped by request' if stop_requested
                else 'Additions file uploaded and processed successfully'
            ),
            'batch_id': batch.id,
            'total_students': total_imported,
            'created': created_count,
            'updated': updated_count,
            'skipped': skipped_count,
            'existing_category_preserved': existing_category_preserved_count,
            'housing_type_counts': housing_type_counts,
            'region_breakdown': region_breakdown,
            'sheet_counts': sheet_counts,
            'skipped_by_reason': skipped_by_reason,
            'warnings': warnings[:100],
            'errors': errors[:100],
        }

        refresh_db_connection()

        if stop_requested:
            if requested_stop_status == ImportBatch.Status.STOP_AND_DELETE_REQUESTED:
                result_payload['deletion'] = _delete_students_created_by_batch(batch)

            ImportBatch.objects.filter(pk=batch.id).update(
                total_students=total_imported,
                status=ImportBatch.Status.STOPPED,
                finished_at=timezone.now(),
                error_message='',
                result=result_payload,
            )
        else:
            ImportBatch.objects.filter(pk=batch.id).update(
                total_students=total_imported,
                status=ImportBatch.Status.COMPLETED,
                finished_at=timezone.now(),
                error_message='',
                result=result_payload,
            )

        return Response(result_payload, status=status.HTTP_200_OK)

    except Exception as e:
        traceback.print_exc()

        try:
            refresh_db_connection()
            ImportBatch.objects.filter(pk=batch.id).update(
                status=ImportBatch.Status.FAILED,
                error_message=str(e)[:2000],
                finished_at=timezone.now(),
            )
        except Exception:
            traceback.print_exc()

        # G3-21: the stack trace stays server-side (traceback.print_exc()
        # above) - never echoed back to the client.
        return Response({
            'success': False,
            'error': f'שגיאה בעיבוד קובץ המתווספים: {str(e)}',
            'errorEn': f'Error processing additions file: {str(e)}',
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_batches(request):
    if request.user.is_central_admin:
        batches = ImportBatch.objects.all()[:20]
    else:
        batch_ids = RegionInbox.objects.filter(
            region=request.user.region
        ).values_list('batch_id', flat=True)
        batches = ImportBatch.objects.filter(id__in=batch_ids)[:20]

    serializer = ImportBatchSerializer(batches, many=True)
    return Response({'batches': serializer.data})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def region_inbox(request):
    if request.user.is_central_admin:
        inbox_items = RegionInbox.objects.all()[:50]
    else:
        if not request.user.region:
            return Response({
                'error': 'משתמש לא משויך לאזור',
                'errorEn': 'User not assigned to a region'
            }, status=status.HTTP_400_BAD_REQUEST)
        inbox_items = RegionInbox.objects.filter(region=request.user.region)

    serializer = RegionInboxSerializer(inbox_items, many=True)
    return Response({'inbox': serializer.data})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def region_inbox_latest(request):
    if request.user.is_central_admin:
        return Response({
            'error': 'מנהל מרכזי אינו מקבל הודעות תיבת דואר',
            'errorEn': 'Central admin does not receive inbox items'
        }, status=status.HTTP_400_BAD_REQUEST)

    if not request.user.region:
        return Response({
            'error': 'משתמש לא משויך לאזור',
            'errorEn': 'User not assigned to a region'
        }, status=status.HTTP_400_BAD_REQUEST)

    inbox_item = RegionInbox.objects.filter(
        region=request.user.region,
        status__in=[RegionInbox.Status.PENDING, RegionInbox.Status.VIEWED]
    ).order_by('-created_at').first()

    if not inbox_item:
        return Response({
            'inbox': None,
            'message': 'אין הודעות חדשות'
        })

    serializer = RegionInboxSerializer(inbox_item)
    return Response({'inbox': serializer.data})


@api_view(['PUT'])
@permission_classes([IsAuthenticated])
def mark_inbox_viewed(request, inbox_id):
    try:
        inbox_item = RegionInbox.objects.get(id=inbox_id)
    except RegionInbox.DoesNotExist:
        return Response({
            'error': 'הודעה לא נמצאה'
        }, status=status.HTTP_404_NOT_FOUND)

    if not request.user.is_central_admin and inbox_item.region != request.user.region:
        return Response({
            'error': 'אין הרשאה לצפות בהודעה זו'
        }, status=status.HTTP_403_FORBIDDEN)

    if inbox_item.status == RegionInbox.Status.PENDING:
        inbox_item.status = RegionInbox.Status.VIEWED
        inbox_item.viewed_at = timezone.now()
        inbox_item.save()

    serializer = RegionInboxSerializer(inbox_item)
    return Response({'inbox': serializer.data})


@api_view(['PUT'])
@permission_classes([IsAuthenticated])
def mark_inbox_processed(request, inbox_id):
    try:
        inbox_item = RegionInbox.objects.get(id=inbox_id)
    except RegionInbox.DoesNotExist:
        return Response({
            'error': 'הודעה לא נמצאה'
        }, status=status.HTTP_404_NOT_FOUND)

    if not request.user.is_boss:
        return Response({
            'error': 'רק מנהל יכול לסמן הודעה כטופלה'
        }, status=status.HTTP_403_FORBIDDEN)

    if not request.user.is_central_admin and inbox_item.region != request.user.region:
        return Response({
            'error': 'אין הרשאה לעדכן הודעה זו'
        }, status=status.HTTP_403_FORBIDDEN)

    inbox_item.status = RegionInbox.Status.PROCESSED
    inbox_item.processed_at = timezone.now()
    inbox_item.save()

    serializer = RegionInboxSerializer(inbox_item)
    return Response({'inbox': serializer.data})

def _room_region(room):
    try:
        return room.apartment.building.dorm_type.region
    except AttributeError:
        return None


def _user_can_edit_room(user, room):
    if not user or not user.is_authenticated:
        return False

    if user.is_central_admin:
        return True

    if not user.region_id:
        return False

    room_region = _room_region(room)
    if not room_region:
        return False

    return room_region.id == user.region_id


def _get_student_from_request(request, key='student_id'):
    value = request.data.get(key) or request.data.get('student')
    if not value:
        raise ValueError('Missing student_id')

    # Prefer database PK. Fallback to university/student number.
    try:
        return Student.objects.get(pk=value)
    except (Student.DoesNotExist, ValueError, TypeError):
        return Student.objects.get(student_id=value)


def _get_room_from_request(request, key='room_id'):
    value = request.data.get(key) or request.data.get('room')
    if not value:
        raise ValueError('Missing room_id')
    return Room.objects.select_related(
        'apartment',
        'apartment__building',
        'apartment__building__dorm_type',
        'apartment__building__dorm_type__region',
    ).get(pk=value)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def assign_student_room(request):
    """Assign an unassigned student to a room. Backend chooses the first free bed."""
    try:
        student = _get_student_from_request(request)
        room = _get_room_from_request(request)

        if not _user_can_edit_room(request.user, room):
            return Response({'error': 'אין הרשאה לערוך חדר באזור זה'}, status=status.HTTP_403_FORBIDDEN)

        assignment = assign_student_to_room(
            student=student,
            room=room,
            assigned_by=request.user,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
            bed_id=request.data.get('bed_id'),
        )

        return Response({
            'success': True,
            'message': 'Student assigned successfully',
            'assignment_id': assignment.id,
            'student_id': student.id,
            'room_id': room.id,
            'bed_id': assignment.bed_id,
        }, status=status.HTTP_200_OK)

    except (Student.DoesNotExist, Room.DoesNotExist):
        return Response({'error': 'Student or room not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def move_student_room(request):
    """Move a student to another room. This ends the old active assignment and creates a new one."""
    try:
        student = _get_student_from_request(request)
        room = _get_room_from_request(request)

        if not _user_can_edit_room(request.user, room):
            return Response({'error': 'אין הרשאה לערוך חדר באזור זה'}, status=status.HTTP_403_FORBIDDEN)

        current_room = student.assigned_room
        if current_room and not request.user.is_central_admin:
            current_room = Room.objects.select_related(
                'apartment__building__dorm_type__region'
            ).get(pk=current_room.pk)
            if not _user_can_edit_room(request.user, current_room):
                return Response({'error': 'אין הרשאה להעביר סטודנט מאזור זה'}, status=status.HTTP_403_FORBIDDEN)

        assignment = assign_student_to_room(
            student=student,
            room=room,
            assigned_by=request.user,
            assignment_type=BedAssignment.AssignmentType.MANUAL,
            bed_id=request.data.get('bed_id'),
        )

        return Response({
            'success': True,
            'message': 'Student moved successfully',
            'assignment_id': assignment.id,
            'student_id': student.id,
            'room_id': room.id,
            'bed_id': assignment.bed_id,
        }, status=status.HTTP_200_OK)

    except (Student.DoesNotExist, Room.DoesNotExist):
        return Response({'error': 'Student or room not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def unassign_student_room(request):
    """Remove a student's active room/bed assignment."""
    try:
        student = _get_student_from_request(request)
        current_assignment = BedAssignment.objects.select_related(
            'bed__room__apartment__building__dorm_type__region'
        ).filter(
            student=student,
            status=BedAssignment.Status.ACTIVE,
        ).first()

        if not current_assignment:
            student.assigned_room = None
            student.save(update_fields=['assigned_room'])
            return Response({'success': True, 'message': 'Student was already unassigned'}, status=status.HTTP_200_OK)

        room = current_assignment.bed.room
        if not _user_can_edit_room(request.user, room):
            return Response({'error': 'אין הרשאה לערוך חדר באזור זה'}, status=status.HTTP_403_FORBIDDEN)

        with transaction.atomic():
            current_assignment.status = BedAssignment.Status.ENDED
            current_assignment.ended_at = timezone.now()
            current_assignment.save(update_fields=['status', 'ended_at'])

            student.assigned_room = None
            student.save(update_fields=['assigned_room'])

        return Response({
            'success': True,
            'message': 'Student unassigned successfully',
            'student_id': student.id,
        }, status=status.HTTP_200_OK)

    except Student.DoesNotExist:
        return Response({'error': 'Student not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


def _execute_swap(student_a, student_b, performed_by):
    """
    Atomically swap two students' active bed assignments. This is the single
    swap implementation (§7, §14) - both the direct
    /api/room-assignments/swap/ endpoint and StudentRequest SWAP approval
    call this instead of duplicating the logic.

    select_for_update() locks both BedAssignment rows for the duration of
    the transaction, so a concurrent request cannot reassign either bed out
    from under this swap. Both directions are validated with the same
    validate_apartment_assignment() used everywhere else before *anything*
    is written; if either direction is invalid (or the room-edit permission
    check fails), the whole transaction rolls back and neither student's
    original assignment is touched.

    Raises: Student.DoesNotExist is not caught here (callers resolve
    students first); BedAssignment.DoesNotExist if either lacks an active
    assignment; PermissionError if the caller may not edit one of the rooms
    (this is what makes a cross-region swap require a central admin -
    _user_can_edit_room already restricts regional users to their own
    region); ValueError for any hard-constraint violation.
    """
    with transaction.atomic():
        # select_for_update(of=('self',)) locks only the BedAssignment row
        # itself. Locking across the full select_related chain would fail on
        # Postgres ("FOR UPDATE cannot be applied to the nullable side of an
        # outer join") because Building.dorm_type and DormType.region are
        # nullable FKs, which Django joins as LEFT OUTER JOIN - that join
        # type can never be combined with FOR UPDATE, independent of whether
        # any actual row has a null value there.
        assignment_a = BedAssignment.objects.select_for_update(of=('self',)).select_related(
            'bed__room__apartment__building__dorm_type__region'
        ).get(student=student_a, status=BedAssignment.Status.ACTIVE)

        assignment_b = BedAssignment.objects.select_for_update(of=('self',)).select_related(
            'bed__room__apartment__building__dorm_type__region'
        ).get(student=student_b, status=BedAssignment.Status.ACTIVE)

        room_a = assignment_a.bed.room
        room_b = assignment_b.bed.room

        if room_a.id == room_b.id:
            raise ValueError('שני הסטודנטים כבר נמצאים באותו חדר')

        if not _user_can_edit_room(performed_by, room_a) or not _user_can_edit_room(performed_by, room_b):
            raise PermissionError('אין הרשאה לערוך אחד מהחדרים')

        validate_apartment_assignment(student_a, room_b)
        validate_apartment_assignment(student_b, room_a)

        now = timezone.now()
        assignment_a.status = BedAssignment.Status.ENDED
        assignment_a.ended_at = now
        assignment_a.save(update_fields=['status', 'ended_at'])

        assignment_b.status = BedAssignment.Status.ENDED
        assignment_b.ended_at = now
        assignment_b.save(update_fields=['status', 'ended_at'])

        new_a = assign_student_to_room(
            student=student_a,
            room=room_b,
            assigned_by=performed_by,
            assignment_type=BedAssignment.AssignmentType.TRANSFER,
        )
        new_b = assign_student_to_room(
            student=student_b,
            room=room_a,
            assigned_by=performed_by,
            assignment_type=BedAssignment.AssignmentType.TRANSFER,
        )

    return new_a, new_b, room_a, room_b


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def swap_students_rooms(request):
    """Swap the current rooms of two already-assigned students."""
    try:
        student_a_value = request.data.get('student_a_id') or request.data.get('studentAId')
        student_b_value = request.data.get('student_b_id') or request.data.get('studentBId')

        if not student_a_value or not student_b_value:
            return Response({'error': 'Missing student_a_id or student_b_id'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            student_a = Student.objects.get(pk=student_a_value)
        except (Student.DoesNotExist, ValueError, TypeError):
            student_a = Student.objects.get(student_id=student_a_value)

        try:
            student_b = Student.objects.get(pk=student_b_value)
        except (Student.DoesNotExist, ValueError, TypeError):
            student_b = Student.objects.get(student_id=student_b_value)

        new_a, new_b, room_a, room_b = _execute_swap(student_a, student_b, request.user)

        return Response({
            'success': True,
            'message': 'Students swapped successfully',
            'student_a': {'student_id': student_a.id, 'room_id': room_b.id, 'bed_id': new_a.bed_id},
            'student_b': {'student_id': student_b.id, 'room_id': room_a.id, 'bed_id': new_b.bed_id},
        }, status=status.HTTP_200_OK)

    except Student.DoesNotExist:
        return Response({'error': 'Student not found'}, status=status.HTTP_404_NOT_FOUND)
    except BedAssignment.DoesNotExist:
        return Response({'error': 'Both students must have active assignments before swapping'}, status=status.HTTP_400_BAD_REQUEST)
    except PermissionError as e:
        return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


# =========================
# Allocation Status Endpoint
# =========================

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def allocation_status(request):
    """
    Returns the current allocation status for the user's region:
    the most recent run (any status) plus active counts.
    """
    user = request.user
    region_value = request.query_params.get('region')

    if region_value:
        region = _resolve_region(region_value)
        if not region:
            return Response({'error': 'אזור לא נמצא'}, status=status.HTTP_404_NOT_FOUND)
    elif user.is_central_admin:
        return Response({
            'status': 'not_started',
            'run': None,
            'region': None,
        }, status=status.HTTP_200_OK)
    elif user.region:
        region = user.region
    else:
        return Response({'error': 'המשתמש אינו משויך לאזור'}, status=status.HTTP_400_BAD_REQUEST)

    active_statuses = [
        AllocationRun.Status.QUEUED,
        AllocationRun.Status.RUNNING,
        AllocationRun.Status.CANCELLATION_REQUESTED,
    ]

    active_run = AllocationRun.objects.filter(
        region=region,
        status__in=active_statuses,
    ).order_by('-started_at').first()

    if active_run:
        return Response({
            'status': active_run.status,
            'run': AllocationRunSerializer(active_run).data,
            'region': RegionSerializer(region).data,
        }, status=status.HTTP_200_OK)

    latest_run = AllocationRun.objects.filter(
        region=region,
    ).order_by('-started_at').first()

    if not latest_run:
        return Response({
            'status': 'not_started',
            'run': None,
            'region': RegionSerializer(region).data,
        }, status=status.HTTP_200_OK)

    return Response({
        'status': latest_run.status,
        'run': AllocationRunSerializer(latest_run).data,
        'region': RegionSerializer(region).data,
    }, status=status.HTTP_200_OK)


# =========================
# Inventory by Housing Type
# =========================

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def inventory_by_housing_type(request):
    """
    Returns detailed inventory breakdown per housing type (DormType),
    including building-level details.
    """
    user = request.user
    region_value = request.query_params.get('region')

    if region_value:
        region = _resolve_region(region_value)
        if not region:
            return Response({'error': 'אזור לא נמצא'}, status=status.HTTP_404_NOT_FOUND)
    elif user.is_central_admin:
        region = None
    elif user.region:
        region = user.region
    else:
        return Response({'error': 'המשתמש אינו משויך לאזור'}, status=status.HTTP_400_BAD_REQUEST)

    dorm_types_qs = DormType.objects.prefetch_related(
        'buildings',
        'buildings__apartments',
        'buildings__apartments__rooms',
        'buildings__apartments__rooms__beds',
    ).order_by('code', 'name')

    if region:
        dorm_types_qs = dorm_types_qs.filter(region=region)

    active_assignment_bed_ids = set(
        BedAssignment.objects.filter(
            status=BedAssignment.Status.ACTIVE
        ).values_list('bed_id', flat=True)
    )

    result = []

    for dorm_type in dorm_types_qs:
        buildings_data = []
        dt_total_beds = 0
        dt_occupied_beds = 0
        dt_available_beds = 0
        dt_total_rooms = 0
        dt_total_apts = 0
        dt_buildings = 0

        for building in dorm_type.buildings.all():
            if not building.is_active:
                continue

            b_total_beds = 0
            b_occupied = 0
            b_total_rooms = 0
            b_active_apts = 0

            for apartment in building.apartments.all():
                if not apartment.is_active:
                    continue

                b_active_apts += 1

                for room in apartment.rooms.all():
                    if not room.is_active:
                        continue

                    b_total_rooms += 1
                    room_beds = list(room.beds.all())
                    b_total_beds += len(room_beds)

                    for bed in room_beds:
                        if bed.id in active_assignment_bed_ids:
                            b_occupied += 1

            b_available = max(b_total_beds - b_occupied, 0)
            b_occupancy = round((b_occupied / b_total_beds) * 100, 1) if b_total_beds > 0 else 0

            dt_buildings += 1
            dt_total_apts += b_active_apts
            dt_total_rooms += b_total_rooms
            dt_total_beds += b_total_beds
            dt_occupied_beds += b_occupied
            dt_available_beds += b_available

            buildings_data.append({
                'id': building.id,
                'number': building.number,
                'is_active': building.is_active,
                'total_beds': b_total_beds,
                'occupied_beds': b_occupied,
                'available_beds': b_available,
                'total_rooms': b_total_rooms,
                'apartments': b_active_apts,
                'occupancy_pct': b_occupancy,
            })

        dt_occupancy = round(
            (dt_occupied_beds / dt_total_beds) * 100, 1
        ) if dt_total_beds > 0 else 0

        result.append({
            'id': dorm_type.id,
            'code': dorm_type.code,
            'name': dorm_type.name,
            'buildings_count': dt_buildings,
            'apartments': dt_total_apts,
            'rooms': dt_total_rooms,
            'total_beds': dt_total_beds,
            'occupied_beds': dt_occupied_beds,
            'available_beds': dt_available_beds,
            'temporarily_unavailable_beds': 0,
            'occupancy_pct': dt_occupancy,
            'buildings': buildings_data,
        })

    return Response({
        'region': RegionSerializer(region).data if region else None,
        'inventory': result,
    }, status=status.HTTP_200_OK)


# =========================
# Allocation Conditions
# =========================

# In-memory store for conditions per region (production would use DB/cache).
# This is a simple approach; for persistence across restarts use a dedicated model.
_CONDITIONS_STORE = {}

DEFAULT_CONDITIONS = {
    'sameGender':              {'enabled': True,  'strict': True,  'critical': True,  'weight': 0},
    'priorityFirst':           {'enabled': True,  'strict': True,  'critical': True,  'weight': 0},
    'roommatePositiveOnly':    {'enabled': True,  'strict': True,  'critical': True,  'weight': 0},
    'ReligiousTogether':       {'enabled': True,  'strict': True,  'critical': True,  'weight': 0},
    'sameReligion':            {'enabled': True,  'strict': False, 'critical': False, 'weight': 6},
    'roommateMatch':           {'enabled': True,  'strict': False, 'critical': False, 'weight': 8},
    'sectorMatching':          {'enabled': True,  'strict': False, 'critical': False, 'weight': 7},
    'avoidYearMix_1_with_3_4': {'enabled': True,  'strict': False, 'critical': False, 'weight': 4},
    'avoidAtudaimWithHasmaha': {'enabled': True,  'strict': False, 'critical': False, 'weight': 4},
}


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def allocation_conditions(request):
    """
    GET  /api/allocation/conditions/ — return saved conditions for the region.
    PUT  /api/allocation/conditions/ — update and persist conditions.
    """
    user = request.user

    region_value = (
        request.query_params.get('region')
        or (request.data.get('region') if request.method == 'PUT' else None)
    )

    if region_value:
        region = _resolve_region(region_value)
        if not region:
            return Response({'error': 'אזור לא נמצא'}, status=status.HTTP_404_NOT_FOUND)
        region_key = str(region.id)
    elif not user.is_central_admin and user.region:
        region = user.region
        region_key = str(region.id)
    else:
        region = None
        region_key = '__global__'

    if request.method == 'GET':
        saved = _CONDITIONS_STORE.get(region_key, DEFAULT_CONDITIONS.copy())
        return Response({
            'region': RegionSerializer(region).data if region else None,
            'conditions': saved,
        }, status=status.HTTP_200_OK)

    # PUT
    if not (user.is_boss or user.is_central_admin):
        return Response(
            {'error': 'אין הרשאה לשנות תנאי שיבוץ'},
            status=status.HTTP_403_FORBIDDEN,
        )

    incoming = request.data.get('conditions')
    if not isinstance(incoming, dict):
        return Response(
            {'error': 'conditions must be a JSON object'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    validated = {}
    for key, value in incoming.items():
        if not isinstance(value, dict):
            continue
        is_critical = DEFAULT_CONDITIONS.get(key, {}).get('critical', False)
        validated[key] = {
            'enabled': True if is_critical else bool(value.get('enabled', True)),
            'strict': bool(value.get('strict', is_critical)),
            'critical': is_critical,
            'weight': 0 if is_critical else max(0, min(10, int(value.get('weight', 5)))),
        }

    _CONDITIONS_STORE[region_key] = validated

    return Response({
        'message': 'Conditions updated successfully',
        'region': RegionSerializer(region).data if region else None,
        'conditions': validated,
    }, status=status.HTTP_200_OK)

# =========================
# Reports
# =========================

def _excel_response(buffer, filename):
    """Return an in-memory XLSX workbook as a downloadable HTTP response."""
    response = HttpResponse(
        buffer.getvalue(),
        content_type=(
            'application/vnd.openxmlformats-officedocument.'
            'spreadsheetml.sheet'
        ),
    )
    response['Content-Disposition'] = (
        f'attachment; filename="{filename}"'
    )
    return response

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsCentralAdmin])
def dormify_report(request):
    """
    Generate the complete, all-regions Dormify Excel report.

    Central-admin only: generate_dormify_report() has no region-filtering
    capability at all, so - unlike the other report endpoints below, which
    scope to the caller's region via _resolve_report_region - this one
    cannot be safely offered to regional users without leaking every other
    region's data (§9).
    """
    from .report_exports import generate_dormify_report

    try:
        buffer = generate_dormify_report()
    except Exception as exc:
        return Response(
            {'error': str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    today = timezone.now().strftime('%Y-%m-%d')
    return _excel_response(
        buffer,
        f'Dormify_Report_{today}.xlsx',
    )


def _resolve_report_region(request):
    """
    Resolve the optional report region query parameter.

    §9/§16: a regional user's own region always wins here - a region_id
    sent in the query string is only ever honored for central admins
    (who may deliberately request "all regions" by omitting it, or any one
    region). This prevents a regional employee from pulling another
    region's report by editing the request directly.

    This helper intentionally has a report-specific name so it does not
    overwrite the existing allocation helper `_resolve_region(region_value)`.
    """
    user = request.user

    if not user.is_central_admin:
        if not user.region_id:
            return None, None
        region_id = user.region_id
    else:
        region_id = request.query_params.get('region_id') or None

    if not region_id:
        return None, None

    try:
        region_obj = Region.objects.get(pk=region_id)
        return region_id, region_obj.name
    except (Region.DoesNotExist, ValueError, TypeError):
        return region_id, None


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def student_allocation_report(request):
    """
    Legacy endpoint retained for backward compatibility.

    It delegates to the student-actions report generator - region-scoped
    the same way student_actions_report is (§9/§16), so a regional user
    cannot use the legacy URL to bypass the region restriction.
    """
    from .report_exports import generate_student_actions_report

    region_id, region_name = _resolve_report_region(request)

    try:
        buffer = generate_student_actions_report(region_id=region_id, region_name=region_name)
    except Exception as exc:
        return Response(
            {'error': str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    today = timezone.now().strftime('%Y-%m-%d')
    return _excel_response(
        buffer,
        f'Dormify_Student_Allocation_Report_{today}.xlsx',
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def student_actions_report(request):
    """Generate the student-actions report, optionally filtered by region."""
    from .report_exports import generate_student_actions_report

    region_id, region_name = _resolve_report_region(request)

    try:
        buffer = generate_student_actions_report(
            region_id=region_id,
            region_name=region_name,
        )
    except Exception as exc:
        return Response(
            {'error': str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    today = timezone.now().strftime('%Y-%m-%d')
    file_part = region_id or 'All_Regions'

    return _excel_response(
        buffer,
        f'Dormify_Student_Actions_Report_{file_part}_{today}.xlsx',
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def capacity_report(request):
    """Generate the capacity report, optionally filtered by region."""
    from .report_exports import generate_capacity_report

    region_id, region_name = _resolve_report_region(request)

    try:
        buffer = generate_capacity_report(
            region_id=region_id,
            region_name=region_name,
        )
    except Exception as exc:
        return Response(
            {'error': str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    today = timezone.now().strftime('%Y-%m-%d')
    file_part = region_id or 'All_Regions'

    return _excel_response(
        buffer,
        f'Dormify_Capacity_Report_{file_part}_{today}.xlsx',
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def manual_review_report(request):
    """Generate the manual-review report, optionally filtered by region."""
    from .report_exports import generate_manual_review_report

    region_id, region_name = _resolve_report_region(request)

    try:
        buffer = generate_manual_review_report(
            region_id=region_id,
            region_name=region_name,
        )
    except Exception as exc:
        return Response(
            {'error': str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    today = timezone.now().strftime('%Y-%m-%d')
    file_part = region_id or 'All_Regions'

    return _excel_response(
        buffer,
        f'Dormify_Manual_Review_Report_{file_part}_{today}.xlsx',
    )

