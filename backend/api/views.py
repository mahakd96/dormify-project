"""
DORMIFY - API Views
Safe merged version
"""

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework_simplejwt.tokens import RefreshToken
from django.utils import timezone
from django.db import transaction
from django.db.models import Q
import pandas as pd

from .models import (
    User, Region, Office, StaffProfile, DormType, Building, Floor, Apartment, Room, Bed,
    Student, BedAssignment, MovementRequest, Transfer,
    AllocationRun, ImportBatch, RegionInbox
)
from .serializers import (
    UserSerializer, LoginSerializer, RegisterSerializer,
    RegionSerializer, BuildingSerializer, ApartmentSerializer,
    RoomSerializer, StudentSerializer, TransferSerializer,
    AllocationRunSerializer, ImportBatchSerializer, RegionInboxSerializer
)


# ===========================================
# AUTHENTICATION VIEWS
# ===========================================
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


# ===========================================
# PERMISSION HELPERS
# ===========================================
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
    """
    If room has no Bed records yet, create beds automatically based on capacity.
    This keeps old room-based frontend working while enabling new bed-level model.
    """
    existing = room.beds.count()
    if existing >= room.capacity:
        return

    for i in range(existing + 1, room.capacity + 1):
        Bed.objects.create(room=room, label=f'Bed {i}')


def get_free_bed(room: Room):
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


def assign_student_to_room(student: Student, room: Room, assigned_by: User, assignment_type=BedAssignment.AssignmentType.MANUAL):
    """
    Creates/updates the normalized bed assignment,
    and also keeps Student.assigned_room updated for frontend compatibility.
    """
    free_bed = get_free_bed(room)
    if not free_bed:
        raise ValueError('No available bed in selected room.')

    end_active_bed_assignments(student)

    assignment = BedAssignment.objects.create(
        student=student,
        bed=free_bed,
        status=BedAssignment.Status.ACTIVE,
        assignment_type=assignment_type,
        assigned_by=assigned_by
    )

    student.assigned_room = room
    student.save(update_fields=['assigned_room', 'updated_at'])

    return assignment


def infer_movement_type(from_room: Room, to_room: Room):
    if not from_room or not to_room:
        return MovementRequest.MovementType.INTERNAL

    from_region = from_room.region if from_room else None
    to_region = to_room.region if to_room else None

    if from_region and to_region and from_region != to_region:
        return MovementRequest.MovementType.REGION_CHANGE

    from_dorm_type = from_room.apartment.dorm_type_id if from_room and from_room.apartment else None
    to_dorm_type = to_room.apartment.dorm_type_id if to_room and to_room.apartment else None
    if from_dorm_type != to_dorm_type:
        return MovementRequest.MovementType.DORM_TYPE_CHANGE

    return MovementRequest.MovementType.INTERNAL


def user_can_approve_transfer(user: User, transfer: Transfer):
    """
    Central admin: can approve everything
    Region boss: only same-region internal moves
    """
    if user.is_central_admin:
        return True

    if not user.is_boss or not user.region:
        return False

    same_from_region = transfer.from_room.region == user.region
    same_to_region = transfer.to_room.region == user.region

    # regional boss only internal/same-region approval
    return same_from_region and same_to_region


# ===========================================
# REGION VIEWS
# ===========================================
class RegionViewSet(viewsets.ModelViewSet):
    serializer_class = RegionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = Region.objects.all()
        if self.request.user.is_central_admin:
            return queryset
        return queryset.filter(pk=self.request.user.region_id)

# ===========================================
# BUILDING VIEWS
# ===========================================
class BuildingViewSet(viewsets.ModelViewSet):
    serializer_class = BuildingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = Building.objects.filter(is_active=True)
        return filter_by_region(queryset, self.request.user)

    @action(detail=True, methods=['get'])
    def apartments(self, request, pk=None):
        building = self.get_object()
        apartments = building.apartments.filter(is_active=True)
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


# ===========================================
# STUDENT VIEWS
# ===========================================
class StudentViewSet(viewsets.ModelViewSet):
    serializer_class = StudentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = Student.objects.filter(is_active=True)
        queryset = filter_by_region(queryset, self.request.user)

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(first_name__icontains=search) |
                Q(last_name__icontains=search) |
                Q(student_id__icontains=search)
            )

        gender = self.request.query_params.get('gender')
        if gender and gender != 'all':
            queryset = queryset.filter(gender=gender)

        religion = self.request.query_params.get('religion')
        if religion and religion != 'all':
            queryset = queryset.filter(religion=religion)

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


# ===========================================
# TRANSFER VIEWS
# ===========================================
class TransferViewSet(viewsets.ModelViewSet):
    serializer_class = TransferSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = Transfer.objects.select_related(
            'student', 'from_room', 'to_room', 'requested_by', 'reviewed_by'
        )

        if not self.request.user.is_central_admin:
            queryset = queryset.filter(student__region=self.request.user.region)

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

        movement_type = infer_movement_type(from_room, to_room)

        transfer = serializer.save(
            requested_by=self.request.user,
            from_room=from_room,
            movement_type=movement_type
        )

        current_assignment = student.current_assignment
        target_bed = get_free_bed(to_room)

        movement_request = MovementRequest.objects.create(
            student=student,
            from_assignment=current_assignment,
            to_bed=target_bed,
            movement_type=movement_type,
            status=MovementRequest.Status.PENDING,
            reason=transfer.reason,
            requested_by=self.request.user
        )
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
                    transfer.movement_request.completed_at = timezone.now()
                    transfer.movement_request.save()

            return Response({
                'message': 'הבקשה אושרה בהצלחה',
                'transfer': TransferSerializer(transfer).data
            })

        except ValueError as e:
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

        if not request.user.is_central_admin and transfer.student.region != request.user.region:
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
            transfer.movement_request.completed_at = timezone.now()
            transfer.movement_request.save()

        return Response({
            'message': 'הבקשה נדחתה',
            'transfer': TransferSerializer(transfer).data
        })


# ===========================================
# ALLOCATION VIEWS
# ===========================================
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def run_allocation(request):
    if not request.user.is_boss:
        return Response({
            'error': 'רק מנהל יכול להריץ שיבוץ'
        }, status=status.HTTP_403_FORBIDDEN)

    region_name = request.data.get('region_name')
    if not region_name:
        if request.user.is_central_admin:
            return Response({
                'error': 'נדרש לבחור אזור'
            }, status=status.HTTP_400_BAD_REQUEST)
        region_name = request.user.region.name

    try:
        region = Region.objects.get(pk=region_name)
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


# ===========================================
# STATISTICS VIEW
# ===========================================
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def statistics(request):
    user = request.user

    if user.is_central_admin:
        students = Student.objects.filter(is_active=True)
        buildings = Building.objects.filter(is_active=True)
        rooms = Room.objects.filter(is_active=True)
        transfers = Transfer.objects.filter(status=Transfer.Status.PENDING)
    else:
        students = Student.objects.filter(region=user.region, is_active=True)
        buildings = Building.objects.filter(region=user.region, is_active=True)
        rooms = Room.objects.filter(apartment__building__region=user.region, is_active=True)
        transfers = Transfer.objects.filter(
            student__region=user.region,
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


# ===========================================
# EXCEL UPLOAD HELPERS
# ===========================================
REGION_MAPPING = {
    'מעונות קנדה': 'canada',
    'מעונות ההסמכה': 'hasmaha',
    'מעונות מזרח': 'mizrah',
    'מעונות מזרח חדש': 'mizrach-hadash',
    'מעונות מזרח ישן': 'mizrach-yashan',
    'מעונות טאוב': 'taub',
    'מעונות שרמן': 'sherman',
    'מעונות איינשטיין': 'einstein',
    'מעונות ריפקין': 'rifkin',
    'מעונות סנאט': 'senate',
    'מעונות ברושים': 'broshim',
    'מעונות נווה אמריקה': 'neve-america',
    'מעונות סגל זוטר': 'segal-zutar',
    'מעונות כפר השמכה': 'kfar-hasmaha',
}


def get_or_create_region(region_name_hebrew):
    region_id = REGION_MAPPING.get(region_name_hebrew)

    if not region_id:
        region = Region.objects.filter(name=region_name_hebrew).first()
        if region:
            return region
        region_id = region_name_hebrew.replace(' ', '-').replace('מעונות ', '')

    region, _ = Region.objects.get_or_create(
        id=region_id,
        defaults={
            'name': region_name_hebrew,
        }
    )
    return region


def parse_religion(value):
    if not value or pd.isna(value):
        return Student.Religion.NOT_SPECIFIED
    value = str(value).strip()
    if 'חילוני' in value:
        return Student.Religion.SECULAR
    elif 'דתי' in value:
        return Student.Religion.RELIGIOUS
    elif 'מסורתי' in value:
        return Student.Religion.TRADITIONAL
    return Student.Religion.NOT_SPECIFIED


def parse_gender(value):
    if not value or pd.isna(value):
        return Student.Gender.MALE
    value = str(value).strip()
    if 'נקבה' in value:
        return Student.Gender.FEMALE
    return Student.Gender.MALE


def parse_nationality(value):
    if not value or pd.isna(value):
        return Student.Nationality.ISRAELI
    value = str(value).strip()
    if 'בינלאומי' in value:
        return Student.Nationality.INTERNATIONAL
    return Student.Nationality.ISRAELI


def parse_category(value):
    if not value or pd.isna(value):
        return Student.StudentCategory.NEW
    value = str(value).strip()
    if 'חדשים' in value:
        return Student.StudentCategory.NEW
    elif 'ממשיכים' in value:
        return Student.StudentCategory.CONTINUING
    elif 'מעברים' in value:
        return Student.StudentCategory.TRANSFER
    elif 'עזיבה' in value:
        return Student.StudentCategory.LEAVING
    return Student.StudentCategory.NEW


def safe_str(value):
    if value is None or pd.isna(value):
        return ''
    return str(value).strip()


def safe_int(value, default=0):
    if value is None or pd.isna(value):
        return default
    try:
        return int(float(value))
    except Exception:
        return default


# ===========================================
# EXCEL UPLOAD AND SPLIT FUNCTIONALITY
# ===========================================
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
        all_students = []

        for sheet_name in excel_file.sheet_names:
            df = pd.read_excel(excel_file, sheet_name=sheet_name)

            if 'ת"ז ישראלית' not in df.columns:
                continue

            for _, row in df.iterrows():
                student_id = safe_str(row.get('ת"ז ישראלית'))
                if not student_id:
                    continue

                region_name = safe_str(row.get('אזור החלטה לאביב'))
                if not region_name:
                    continue

                decision_status = safe_str(row.get('החלטת מעונות - אביב'))
                if decision_status == 'מבוטל':
                    continue

                student_data = {
                    'student_id': student_id,
                    'business_partner_id': safe_str(row.get('שותף עסקי')),
                    'first_name': safe_str(row.get('שם פרטי')),
                    'last_name': safe_str(row.get('שם משפחה')),
                    'email': safe_str(row.get('אימייל 1')),
                    'email_secondary': safe_str(row.get('אימייל 2')),
                    'phone': safe_str(row.get('טלפון 1')),
                    'phone_secondary': safe_str(row.get('טלפון 2')),
                    'city': safe_str(row.get('שם ישוב')),
                    'gender': parse_gender(row.get('תיאור מגדר')),
                    'religion': parse_religion(row.get('החלטה אחרונה - דתי לצורך שיבוץ תיאור')),
                    'nationality': parse_nationality(row.get('תיאור קוד לאום מבוקש')),
                    'category': parse_category(row.get('תיאור קבוצת הקצאה')),
                    'housing_type': safe_str(row.get('תיאור סוג מגורים')),
                    'allocation_group': safe_str(row.get('קבוצת הקצאה')),
                    'region_name': region_name,
                    'disability_percentage': safe_int(row.get('%נכות')),
                    'medical_approval': safe_str(row.get('סיבה רפואית מאושרת מרופאת הטכניון')) == 'כן',
                    'current_address': safe_str(row.get('כתובת במעונות נוכחית')),
                    'current_region_name': safe_str(row.get('אזור מגורים נוכחי')),
                    'decision_status': decision_status,
                    'roommate_request_1': safe_str(row.get('החלטה אחרונה: שם חבר 1')),
                    'roommate_request_2': safe_str(row.get('החלטה אחרונה: שם חבר 2')),
                    'roommate_request_3': safe_str(row.get('החלטה אחרונה: שם חבר 3')),
                    'roommate_request_4': safe_str(row.get('החלטה אחרונה: שם חבר 4')),
                    'roommate_request_5': safe_str(row.get('החלטה אחרונה: שם חבר 5')),
                    'sheet_name': sheet_name,
                }
                all_students.append(student_data)

        region_counts = {}
        created_count = 0
        updated_count = 0
        errors = []

        for student_data in all_students:
            try:
                region_name = student_data.pop('region_name')
                student_data.pop('sheet_name', None)

                region = get_or_create_region(region_name)

                if region.id not in region_counts:
                    region_counts[region.id] = {'region': region, 'count': 0}
                region_counts[region.id]['count'] += 1

                existing = Student.objects.filter(student_id=student_data['student_id']).first()

                if existing:
                    for key, value in student_data.items():
                        setattr(existing, key, value)
                    existing.region = region
                    existing.batch = batch
                    existing.is_active = True
                    existing.is_priority = student_data['disability_percentage'] > 0 or student_data['medical_approval']
                    existing.priority_reason = (
                        'נכות' if student_data['disability_percentage'] > 0
                        else ('סיבה רפואית' if student_data['medical_approval'] else '')
                    )
                    existing.save()
                    updated_count += 1
                else:
                    Student.objects.create(
                        region=region,
                        batch=batch,
                        is_priority=student_data['disability_percentage'] > 0 or student_data['medical_approval'],
                        priority_reason='נכות' if student_data['disability_percentage'] > 0 else ('סיבה רפואית' if student_data['medical_approval'] else ''),
                        **student_data
                    )
                    created_count += 1

            except Exception as e:
                errors.append(f"Error processing student {student_data.get('student_id', 'unknown')}: {str(e)}")
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
                message=f'התקבלו {data["count"]} סטודנטים לשיבוץ מלשכת המעונות המרכזית'
            )
            region_breakdown.append({
                'region_id': region_id,
                'region_name': data['region'].name,
                'count': data['count']
            })

        batch.total_students = created_count + updated_count
        batch.status = ImportBatch.Status.COMPLETED
        batch.save()

        return Response({
            'success': True,
            'message': 'הקובץ הועלה ועובד בהצלחה',
            'messageEn': 'File uploaded and processed successfully',
            'batch_id': batch.id,
            'total_students': batch.total_students,
            'created': created_count,
            'updated': updated_count,
            'region_breakdown': region_breakdown,
            'errors': errors[:10] if errors else []
        })

    except Exception as e:
        batch.status = ImportBatch.Status.FAILED
        batch.error_message = str(e)
        batch.save()

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
        students = Student.objects.filter(is_active=True)
        rooms = Room.objects.filter(is_active=True)
        latest_inbox = None
    else:
        if not user.region:
            return Response({
                'error': 'משתמש לא משויך לאזור'
            }, status=status.HTTP_400_BAD_REQUEST)

        students = Student.objects.filter(region=user.region, is_active=True)
        rooms = Room.objects.filter(apartment__building__region=user.region, is_active=True)

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