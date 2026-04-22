from decimal import Decimal, InvalidOperation
import re
import pandas as pd

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework_simplejwt.tokens import RefreshToken

from django.utils import timezone
from django.db import transaction
from django.db.models import Q
from django.core.exceptions import ValidationError

from .models import (
    User, Region, Office, StaffProfile, DormType, Building, Apartment, Room, Bed,
    Student, BedAssignment, MovementRequest, Transfer,
    AllocationRun, ImportBatch, RegionInbox
)
from .serializers import (
    UserSerializer, LoginSerializer, RegisterSerializer,
    RegionSerializer, BuildingSerializer, ApartmentSerializer,
    RoomSerializer, StudentSerializer, TransferSerializer,
    AllocationRunSerializer, ImportBatchSerializer, RegionInboxSerializer
)


@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    serializer = LoginSerializer(data=request.data)

    if serializer.is_valid():
        user = serializer.validated_data['user']
        refresh = RefreshToken.for_user(user)

        return Response({
            'message': 'התחברות בוצעה בהצלחה',
            'messageEn': 'Login successful',
            'user': UserSerializer(user).data,
            'tokens': {
                'access': str(refresh.access_token),
                'refresh': str(refresh),
            }
        })

    return Response({
        'error': serializer.errors,
        'errorHe': 'אימייל או סיסמה שגויים'
    }, status=status.HTTP_401_UNAUTHORIZED)


@api_view(['POST'])
@permission_classes([AllowAny])
def register_view(request):
    serializer = RegisterSerializer(data=request.data)

    if serializer.is_valid():
        user = serializer.save()
        refresh = RefreshToken.for_user(user)

        return Response({
            'message': 'משתמש נוצר בהצלחה',
            'messageEn': 'User created successfully',
            'user': UserSerializer(user).data,
            'tokens': {
                'access': str(refresh.access_token),
                'refresh': str(refresh),
            }
        }, status=status.HTTP_201_CREATED)

    return Response({
        'error': serializer.errors
    }, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_view(request):
    return Response({
        'user': UserSerializer(request.user).data
    })


@api_view(['PUT'])
@permission_classes([IsAuthenticated])
def change_password_view(request):
    user = request.user
    current_password = request.data.get('current_password')
    new_password = request.data.get('new_password')

    if not current_password or not new_password:
        return Response({
            'error': 'נדרשת סיסמה נוכחית וסיסמה חדשה'
        }, status=status.HTTP_400_BAD_REQUEST)

    if not user.check_password(current_password):
        return Response({
            'error': 'סיסמה נוכחית שגויה'
        }, status=status.HTTP_401_UNAUTHORIZED)

    user.set_password(new_password)
    user.save()

    return Response({
        'message': 'סיסמה שונתה בהצלחה'
    })


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


def ensure_room_beds(room: Room):
    existing = room.beds.count()
    if existing >= room.capacity:
        return

    for i in range(existing + 1, room.capacity + 1):
        Bed.objects.create(room=room, label=f'Bed {i}')


def get_free_bed(room: Room):
    if not room.is_active:
        return None
    if not room.apartment.is_active:
        return None
    if not room.apartment.building.is_active:
        return None

    ensure_room_beds(room)

    occupied_bed_ids = BedAssignment.objects.filter(
        bed__room=room,
        status=BedAssignment.Status.ACTIVE
    ).values_list('bed_id', flat=True)

    return room.beds.exclude(id__in=occupied_bed_ids).order_by('id').first()


def end_active_bed_assignments(student: Student):
    BedAssignment.objects.filter(
        student=student,
        status=BedAssignment.Status.ACTIVE
    ).update(
        status=BedAssignment.Status.ENDED,
        ended_at=timezone.now()
    )


def validate_apartment_assignment(student: Student, room: Room):
    apartment = room.apartment

    if not apartment.is_active:
        raise ValueError(f'Apartment is inactive: {apartment.get_inactive_reason_display()}')

    if apartment.category == Apartment.Category.MALE and student.gender != Student.Gender.MALE:
        raise ValueError('This apartment is for male students only.')

    if apartment.category == Apartment.Category.FEMALE and student.gender != Student.Gender.FEMALE:
        raise ValueError('This apartment is for female students only.')


def assign_student_to_room(
    student: Student,
    room: Room,
    assigned_by: User,
    assignment_type=BedAssignment.AssignmentType.MANUAL
):
    validate_apartment_assignment(student, room)
    free_bed = get_free_bed(room)
    if not free_bed:
        raise ValueError('No available bed in selected room.')

    with transaction.atomic():
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

        student.assigned_room = room
        student.save(update_fields=['assigned_room', 'updated_at'])

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


class RegionViewSet(viewsets.ModelViewSet):
    serializer_class = RegionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = Region.objects.all()
        if self.request.user.is_central_admin:
            return queryset
        return queryset.filter(pk=self.request.user.region_id)


class BuildingViewSet(viewsets.ModelViewSet):
    serializer_class = BuildingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = Building.objects.filter(is_active=True)
        user = self.request.user

        if user.is_central_admin:
            return queryset
        if not user.region:
            return queryset.none()
        return queryset.filter(dorm_type__region=user.region)

    @action(detail=True, methods=['get'])
    def apartments(self, request, pk=None):
        building = self.get_object()
        apartments = building.apartments.filter(is_active=True)

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
            is_active=True
        )

        available_only = request.query_params.get('available', 'false') == 'true'
        if available_only:
            rooms = [r for r in rooms if not r.is_full]

        serializer = RoomSerializer(rooms, many=True)
        return Response({'rooms': serializer.data})


class StudentViewSet(viewsets.ModelViewSet):
    serializer_class = StudentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = Student.objects.all()

        if not self.request.user.is_central_admin:
            if not self.request.user.region:
                return queryset.none()
            queryset = queryset.filter(
                accepted_dorm_type__region=self.request.user.region
            )

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(first_name__icontains=search) |
                Q(last_name__icontains=search) |
                Q(student_id__icontains=search) |
                Q(business_partner_id__icontains=search)
            )

        gender = self.request.query_params.get('gender')
        if gender and gender != 'all':
            queryset = queryset.filter(gender=gender)

        requested_religion = self.request.query_params.get('requested_religion')
        if requested_religion and requested_religion != 'all':
            queryset = queryset.filter(requested_religion=requested_religion)

        religious = self.request.query_params.get('religious')
        if religious and religious != 'all':
            queryset = queryset.filter(religious=religious)

        status_filter = self.request.query_params.get('status')
        if status_filter == 'assigned':
            queryset = queryset.filter(assigned_room__isnull=False)
        elif status_filter == 'unassigned':
            queryset = queryset.filter(assigned_room__isnull=True)
        elif status_filter == 'priority':
            queryset = queryset.filter(is_priority=True)

        return queryset

    def perform_create(self, serializer):
        if not self.request.user.is_central_admin:
            raise permissions.PermissionDenied('רק מנהל מרכזי יכול להוסיף סטודנטים')
        serializer.save()


class TransferViewSet(viewsets.ModelViewSet):
    serializer_class = TransferSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = Transfer.objects.select_related(
            'student', 'from_room', 'to_room', 'requested_by', 'reviewed_by'
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

    def perform_create(self, serializer):
        student = serializer.validated_data['student']
        from_room = serializer.validated_data.get('from_room') or student.assigned_room
        to_room = serializer.validated_data['to_room']

        if not from_room:
            raise permissions.ValidationError('הסטודנט אינו משויך כרגע לחדר מקור')

        validate_apartment_assignment(student, to_room)
        movement_type = infer_movement_type(from_room, to_room)

        transfer = serializer.save(
            requested_by=self.request.user,
            from_room=from_room,
            movement_type=movement_type
        )

        current_assignment = student.current_assignment
        target_bed = get_free_bed(to_room)
        if not target_bed:
            raise permissions.ValidationError('אין מיטה פנויה בחדר היעד')

        movement_request = MovementRequest(
            student=student,
            from_assignment=current_assignment,
            to_bed=target_bed,
            movement_type=movement_type,
            status=MovementRequest.Status.PENDING,
            reason=transfer.reason,
            requested_by=self.request.user
        )
        movement_request.full_clean()
        movement_request.save()

        transfer.movement_request = movement_request
        transfer.save(update_fields=['movement_request', 'updated_at'])

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
                transfer.status = Transfer.Status.APPROVED
                transfer.reviewed_by = request.user
                transfer.reviewed_at = timezone.now()
                transfer.save()

                student = transfer.student
                assignment_type = (
                    BedAssignment.AssignmentType.PHASE2
                    if transfer.movement_type == MovementRequest.MovementType.PHASE2
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

        if not request.user.is_central_admin:
            transfer_region = transfer.to_room.apartment.building.dorm_type.region
            if transfer_region != request.user.region:
                return Response({
                    'error': 'אין הרשאה לדחות בקשה זו'
                }, status=status.HTTP_403_FORBIDDEN)

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


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def run_allocation(request):
    if not request.user.is_boss:
        return Response({
            'error': 'רק מנהל יכול להריץ שיבוץ'
        }, status=status.HTTP_403_FORBIDDEN)

    region_id = request.data.get('region_id') or request.data.get('region_name')

    if not region_id:
        if request.user.is_central_admin:
            return Response({
                'error': 'נדרש לבחור אזור'
            }, status=status.HTTP_400_BAD_REQUEST)
        if not request.user.region:
            return Response({
                'error': 'המשתמש אינו משויך לאזור'
            }, status=status.HTTP_400_BAD_REQUEST)
        region_id = request.user.region_id

    try:
        region = Region.objects.get(pk=region_id)
    except Region.DoesNotExist:
        return Response({
            'error': 'אזור לא נמצא'
        }, status=status.HTTP_404_NOT_FOUND)

    allocation_run = AllocationRun.objects.create(
        region=region,
        run_by=request.user
    )

    try:
        from backend.allocation.solver import run_allocation_algorithm
        result = run_allocation_algorithm(region)

        allocation_run.status = AllocationRun.Status.COMPLETED
        allocation_run.students_processed = result.get('students_processed', 0)
        allocation_run.successful_assignments = result.get('successful_assignments', 0)
        allocation_run.roommate_matches = result.get('roommate_matches', 0)
        allocation_run.conflicts = result.get('conflicts', 0)
        allocation_run.completed_at = timezone.now()
        allocation_run.save()

        return Response({
            'message': 'השיבוץ הושלם בהצלחה',
            'result': AllocationRunSerializer(allocation_run).data
        })

    except Exception as e:
        allocation_run.status = AllocationRun.Status.FAILED
        allocation_run.error_message = str(e)
        allocation_run.completed_at = timezone.now()
        allocation_run.save()

        return Response({
            'error': f'שגיאה בהרצת השיבוץ: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def allocation_history(request):
    queryset = AllocationRun.objects.all()

    if not request.user.is_central_admin:
        queryset = queryset.filter(region=request.user.region)

    serializer = AllocationRunSerializer(queryset[:20], many=True)
    return Response({'runs': serializer.data})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def statistics(request):
    user = request.user

    if user.is_central_admin:
        students = Student.objects.all()
        buildings = Building.objects.filter(is_active=True)
        rooms = Room.objects.filter(is_active=True)
        transfers = Transfer.objects.filter(status=Transfer.Status.PENDING)
    else:
        students = Student.objects.filter(accepted_dorm_type__region=user.region)
        buildings = Building.objects.filter(dorm_type__region=user.region, is_active=True)
        rooms = Room.objects.filter(apartment__building__dorm_type__region=user.region, is_active=True)
        transfers = Transfer.objects.filter(
            Q(from_room__apartment__building__dorm_type__region=user.region) |
            Q(to_room__apartment__building__dorm_type__region=user.region),
            status=Transfer.Status.PENDING
        )

    total_capacity = sum(r.capacity for r in rooms)
    assigned_students = students.filter(assigned_room__isnull=False).count()

    return Response({
        'total_students': students.count(),
        'assigned_students': assigned_students,
        'unassigned_students': students.count() - assigned_students,
        'priority_students': students.filter(is_priority=True).count(),
        'total_buildings': buildings.count(),
        'total_rooms': rooms.count(),
        'total_capacity': total_capacity,
        'occupancy_rate': round((assigned_students / total_capacity * 100) if total_capacity > 0 else 0),
        'pending_transfers': transfers.count(),
    })


EXCEL_DORM_TYPE_TO_REGION = {
    'קנדה': 'canada',
    'ברושים': 'broshim',
    'מגדל המזרח': 'mizrah',
    'הטכניון': 'technion',
}

ALLOWED_DECISION_STATUSES = {
    'החלטה חיובית',
}


def slugify_hebrew(value: str) -> str:
    value = safe_str(value)
    value = value.replace('״', '').replace('"', '').replace("'", "")
    value = value.replace('/', '-').replace('\\', '-')
    value = re.sub(r'\s+', '-', value.strip())
    return value.lower()


def safe_str(value):
    if value is None or pd.isna(value):
        return ''
    return str(value).strip()


def safe_int(value, default=0):
    if value is None or pd.isna(value) or value == '':
        return default
    try:
        return int(float(value))
    except Exception:
        return default


def safe_decimal(value, default=None):
    if value is None or pd.isna(value) or value == '':
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return default


def parse_yes_no_code(value):
    value = safe_str(value).lower()

    yes_values = {'1', 'כן', 'yes', 'true', '136'}
    no_values = {'0', 'לא', 'no', 'false', '135', ''}

    if value in yes_values:
        return True
    if value in no_values:
        return False
    return False


def parse_requested_religion(value):
    value = safe_str(value)

    if not value:
        return Student.Religion.NOT_SPECIFIED

    if 'מוסל' in value or 'muslim' in value.lower():
        return Student.Religion.Muslim
    if 'יהוד' in value or 'jew' in value.lower():
        return Student.Religion.Jewish
    if 'נוצר' in value or 'christ' in value.lower():
        return Student.Religion.Christian
    if 'דרוז' in value or 'druze' in value.lower():
        return Student.Religion.Druze

    return Student.Religion.NOT_SPECIFIED


def parse_religious(value):
    value = safe_str(value)

    if not value:
        return Student.Religious.NOT_SPECIFIED

    if value in ['כן', 'דתי', 'religious']:
        return Student.Religious.RELIGIOUS
    if value in ['לא', 'לא משנה', 'no_preference']:
        return Student.Religious.NO_PREFERENCE
    return Student.Religious.NOT_SPECIFIED


def parse_gender_from_housing_type(housing_type, existing_student=None):
    housing_type = safe_str(housing_type)

    if 'רווקות' in housing_type:
        return Student.Gender.FEMALE
    if 'רווקים' in housing_type:
        return Student.Gender.MALE

    if existing_student and existing_student.gender:
        return existing_student.gender

    return Student.Gender.MALE


def parse_category(value):
    value = safe_str(value)

    if not value:
        return Student.StudentCategory.NEW

    if 'חדש' in value:
        return Student.StudentCategory.NEW
    if 'ממשיכ' in value or 'ותיק' in value:
        return Student.StudentCategory.CONTINUING
    if 'מעבר' in value:
        return Student.StudentCategory.TRANSFER
    if 'עזיב' in value:
        return Student.StudentCategory.LEAVING

    return Student.StudentCategory.NEW


def extract_roommate_flag(value):
    return parse_yes_no_code(value)


def normalize_phone(value):
    value = safe_str(value)
    return value.replace('.0', '') if value else ''


def get_or_create_region_by_id(region_id, region_name=None):
    region_id = safe_str(region_id)
    region_name = safe_str(region_name) or region_id

    region, _ = Region.objects.get_or_create(
        id=region_id,
        defaults={'name': region_name}
    )
    return region


def get_or_create_dorm_type_from_excel(dorm_code, dorm_name):
    dorm_name = safe_str(dorm_name)
    dorm_code_int = safe_int(dorm_code, default=None)

    if not dorm_name and dorm_code_int is None:
        return None

    dorm_type = None

    if dorm_code_int is not None:
        dorm_type = DormType.objects.filter(code=dorm_code_int).select_related('region').first()

    if not dorm_type and dorm_name:
        dorm_type = DormType.objects.filter(name=dorm_name).select_related('region').first()

    if dorm_type:
        return dorm_type

    region_id = EXCEL_DORM_TYPE_TO_REGION.get(dorm_name)
    if region_id:
        region = get_or_create_region_by_id(region_id, dorm_name)
    else:
        generated_region_id = slugify_hebrew(dorm_name) or f"dorm-{dorm_code_int or 'unknown'}"
        region = get_or_create_region_by_id(generated_region_id, dorm_name)

    if dorm_code_int is None:
        existing_max = DormType.objects.order_by('-code').values_list('code', flat=True).first()
        dorm_code_int = (existing_max or 0) + 1

    dorm_type, _ = DormType.objects.get_or_create(
        code=dorm_code_int,
        defaults={
            'name': dorm_name or f'Dorm {dorm_code_int}',
            'region': region,
        }
    )

    updated = False
    if dorm_name and dorm_type.name != dorm_name:
        dorm_type.name = dorm_name
        updated = True
    if dorm_type.region_id != region.id:
        dorm_type.region = region
        updated = True
    if updated:
        dorm_type.save(update_fields=['name', 'region'])

    return dorm_type


def build_student_payload_from_row(row, existing_student=None):
    housing_type = safe_str(row.get('החלטה-תאור סוג מגורים'))
    accepted_dorm_type = get_or_create_dorm_type_from_excel(
        row.get('החלטה-בחירת סוג מעון1'),
        row.get('החלטה-תאור קוד חברה1')
    )

    return {
        'student_id': safe_str(row.get('ת"ז ישראלית')),
        'first_name': safe_str(row.get('שם פרטי')),
        'last_name': safe_str(row.get('שם משפחה')),
        'phone': normalize_phone(row.get('טלפון 1')),
        'phone_secondary': normalize_phone(row.get('טלפון חירום')),
        'email': safe_str(row.get('אימייל 1')),
        'city': safe_str(row.get('שם ישוב')),
        'gender': parse_gender_from_housing_type(housing_type, existing_student=existing_student),
        'requested_religion': parse_requested_religion(row.get('החלטה-תאור קוד לאום מבוקש')),
        'religious': parse_religious(row.get('החלטה אחרונה - דתי לצורך שיבוץ תיאור')),
        'category': parse_category(row.get('החלטה-תאור קבוצת הקצאה')),
        'housing_type': housing_type,
        'allocation_group': safe_str(row.get('החלטה-קבוצת הקצאה')),
        'accepted_dorm_type': accepted_dorm_type,
        'roommate_request_1': safe_str(row.get('החלטה אחרונה: שם חבר 1')),
        'roommate_request_2': safe_str(row.get('החלטה אחרונה: שם חבר 2')),
        'roommate_request_3': safe_str(row.get('החלטה אחרונה: שם חבר 3')),
        'roommate_request_4': safe_str(row.get('החלטה אחרונה: שם חבר 4')),
        'roommate_request_5': safe_str(row.get('החלטה אחרונה: שם חבר 5')),
        'roommate_request_flag_1': extract_roommate_flag(row.get('בקשה לגור עם סטודנטים חבר1')),
        'roommate_request_flag_2': extract_roommate_flag(row.get('החלטה אחרונה: בקשה לגור עם סטודנטים חבר2')),
        'roommate_request_flag_3': extract_roommate_flag(row.get('החלטה אחרונה: בקשה לגור עם סטודנטים חבר3')),
        'roommate_request_flag_4': extract_roommate_flag(row.get('החלטה אחרונה: בקשה לגור עם סטודנטים חבר4')),
        'roommate_request_flag_5': extract_roommate_flag(row.get('החלטה אחרונה: בקשה לגור עם סטודנטים חבר5')),
        'special_status_1': safe_str(row.get('תאור סטטוס מיוחד1')),
        'special_status_2': safe_str(row.get('תאור סטטוס מיוחד2')),
        'special_status_3': safe_str(row.get('תאור סטטוס מיוחד3')),
        'special_status_4': safe_str(row.get('תאור סטטוס מיוחד4')),
        'study_points': safe_decimal(row.get('נ.אקדמי מצטבר'), default=None),
        'current_address': safe_str(row.get('כ.נוכחית-כתובת במעונות-תיאור')),
        'current_dorm_type': safe_str(row.get('החלטה-תאור קוד חברה1')),
        'is_priority': parse_yes_no_code(row.get('החלטה-זקוק להנגשה')),
        'priority_reason': 'נגישות' if parse_yes_no_code(row.get('החלטה-זקוק להנגשה')) else '',
    }


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def upload_excel(request):
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

    if not uploaded_file.name.endswith(('.xlsx', '.xls')):
        return Response({
            'error': 'סוג קובץ לא נתמך. נא להעלות קובץ Excel (.xlsx או .xls)',
            'errorEn': 'Unsupported file type. Please upload an Excel file (.xlsx or .xls)'
        }, status=status.HTTP_400_BAD_REQUEST)

    batch = ImportBatch.objects.create(
        uploaded_by=request.user,
        filename=uploaded_file.name,
        status=ImportBatch.Status.PROCESSING
    )

    try:
        excel_file = pd.ExcelFile(uploaded_file)
        created_count = 0
        updated_count = 0
        skipped_count = 0
        errors = []
        region_counts = {}

        for sheet_name in excel_file.sheet_names:
            df = pd.read_excel(excel_file, sheet_name=sheet_name)

            required_columns = ['ת"ז ישראלית', 'שם פרטי', 'שם משפחה']
            missing_required = [col for col in required_columns if col not in df.columns]
            if missing_required:
                errors.append(
                    f"Sheet '{sheet_name}' missing required columns: {', '.join(missing_required)}"
                )
                continue

            for idx, row in df.iterrows():
                try:
                    student_id = safe_str(row.get('ת"ז ישראלית'))
                    if not student_id:
                        skipped_count += 1
                        continue

                    decision_status = safe_str(row.get('החלטה-החלטת מעונות - תאור'))
                    if decision_status and decision_status not in ALLOWED_DECISION_STATUSES:
                        skipped_count += 1
                        continue

                    existing = Student.objects.filter(student_id=student_id).select_related(
                        'accepted_dorm_type',
                        'accepted_dorm_type__region'
                    ).first()

                    student_payload = build_student_payload_from_row(row, existing_student=existing)
                    accepted_dorm_type = student_payload.get('accepted_dorm_type')

                    if accepted_dorm_type is None:
                        skipped_count += 1
                        errors.append(
                            f"Student {student_id}: could not resolve accepted dorm type from columns "
                            f"'החלטה-בחירת סוג מעון1' / 'החלטה-תאור קוד חברה1'"
                        )
                        continue

                    target_region = accepted_dorm_type.region

                    if existing:
                        for key, value in student_payload.items():
                            setattr(existing, key, value)
                        existing.batch = batch
                        existing.save()
                        updated_count += 1
                    else:
                        Student.objects.create(
                            batch=batch,
                            **student_payload
                        )
                        created_count += 1

                    if target_region.id not in region_counts:
                        region_counts[target_region.id] = {
                            'region': target_region,
                            'count': 0
                        }
                    region_counts[target_region.id]['count'] += 1

                except Exception as e:
                    errors.append(f"Sheet '{sheet_name}', row {idx + 2}: {str(e)}")
                    continue

        for region_id in region_counts.keys():
            RegionInbox.objects.filter(
                region_id=region_id,
                status=RegionInbox.Status.PENDING
            ).update(status=RegionInbox.Status.SUPERSEDED)

        region_breakdown = []
        for region_id, data in region_counts.items():
            RegionInbox.objects.create(
                region=data['region'],
                batch=batch,
                students_count=data['count'],
                status=RegionInbox.Status.PENDING,
                message=f'התקבלו {data["count"]} סטודנטים חדשים לשיבוץ'
            )

            region_breakdown.append({
                'region_id': region_id,
                'region_name': data['region'].name,
                'count': data['count']
            })

        batch.total_students = created_count + updated_count
        batch.status = ImportBatch.Status.COMPLETED
        batch.save(update_fields=['total_students', 'status'])

        return Response({
            'success': True,
            'message': 'הקובץ הועלה ועובד בהצלחה',
            'messageEn': 'File uploaded and processed successfully',
            'batch_id': batch.id,
            'total_students': batch.total_students,
            'created': created_count,
            'updated': updated_count,
            'skipped': skipped_count,
            'region_breakdown': region_breakdown,
            'errors': errors[:20]
        })

    except Exception as e:
        batch.status = ImportBatch.Status.FAILED
        batch.error_message = str(e)
        batch.save(update_fields=['status', 'error_message'])

        return Response({
            'error': f'שגיאה בעיבוד הקובץ: {str(e)}',
            'errorEn': f'Error processing file: {str(e)}'
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
    ).first()

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


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def allocation_summary(request):
    user = request.user

    if user.is_central_admin:
        students = Student.objects.all()
        rooms = Room.objects.filter(is_active=True)
        latest_inbox = None
    else:
        if not user.region:
            return Response({
                'error': 'משתמש לא משויך לאזור'
            }, status=status.HTTP_400_BAD_REQUEST)

        students = Student.objects.filter(accepted_dorm_type__region=user.region)
        rooms = Room.objects.filter(apartment__building__dorm_type__region=user.region, is_active=True)

        latest_inbox = RegionInbox.objects.filter(
            region=user.region,
            status__in=[RegionInbox.Status.PENDING, RegionInbox.Status.VIEWED]
        ).first()

    total_students = students.count()
    unassigned_students = students.filter(assigned_room__isnull=True).count()
    assigned_students = total_students - unassigned_students
    priority_students = students.filter(is_priority=True).count()
    total_capacity = sum(r.capacity for r in rooms)
    available_beds = sum(r.available_beds for r in rooms)

    batch_info = None
    if latest_inbox:
        batch_info = {
            'batch_id': latest_inbox.batch_id,
            'students_count': latest_inbox.students_count,
            'created_at': latest_inbox.created_at.isoformat(),
            'message': latest_inbox.message,
            'status': latest_inbox.status,
        }

    students_by_category = {}
    for cat in Student.StudentCategory:
        students_by_category[cat.value] = students.filter(category=cat.value).count()

    return Response({
        'total_students': total_students,
        'unassigned_students': unassigned_students,
        'assigned_students': assigned_students,
        'priority_students': priority_students,
        'total_capacity': total_capacity,
        'available_beds': available_beds,
        'occupancy_rate': round((assigned_students / total_capacity * 100) if total_capacity > 0 else 0),
        'latest_inbox': batch_info,
        'students_by_category': students_by_category,
        'region': RegionSerializer(user.region).data if user.region else None,
    })