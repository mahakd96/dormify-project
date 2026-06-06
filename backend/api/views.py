from decimal import Decimal, InvalidOperation
import re
import traceback

import pandas as pd

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework.exceptions import ValidationError as DRFValidationError

from django.utils import timezone
from django.db import transaction
from django.db.models import Q
from django.core.exceptions import ValidationError
from django.db import close_old_connections, connection

from .models import (
    User, Region, Office, StaffProfile, DormType, Building, Apartment, Room, Bed,
    Student, BedAssignment, MovementRequest, Transfer,
    AllocationRun, ImportBatch, RegionInbox
)
from .serializers import (
    UserSerializer, LoginSerializer, RegisterSerializer,
    RegionSerializer, DormTypeSerializer, BuildingSerializer, ApartmentSerializer,
    RoomSerializer, StudentSerializer, TransferSerializer,
    AllocationRunSerializer, ImportBatchSerializer, RegionInboxSerializer
)

# =========================
# Auth Views
# =========================

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

    def get_queryset(self):
        queryset = Region.objects.all()
        user = self.request.user

        if user.is_central_admin or user.is_boss:
            return queryset

        if not user.region:
            return queryset.none()

        return queryset.filter(pk=user.region_id)

class DormTypeViewSet(viewsets.ModelViewSet):
    serializer_class = DormTypeSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = DormType.objects.select_related('region').all()
        user = self.request.user

        # Central admin and region boss can browse the selectors.
        if user.is_central_admin or user.is_boss:
            return queryset

        # Employees only see their own region.
        if not user.region:
            return queryset.none()

        return queryset.filter(region=user.region)

class BuildingViewSet(viewsets.ModelViewSet):
    serializer_class = BuildingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = Building.objects.filter(is_active=True).select_related(
            'dorm_type',
            'dorm_type__region',
        )
        user = self.request.user

        if user.is_central_admin or user.is_boss:
            return queryset

        if not user.region:
            return queryset.none()

        return queryset.filter(dorm_type__region=user.region)

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



class StudentViewSet(viewsets.ModelViewSet):
    serializer_class = StudentSerializer
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        return StudentSerializer

    def get_queryset(self):
        queryset = Student.objects.select_related(
            'accepted_dorm_type',
            'accepted_dorm_type__region',
            'assigned_room',
        ).all()

        if not (self.request.user.is_central_admin or self.request.user.is_boss):
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

        placement_sector = self.request.query_params.get('placement_sector')
        if placement_sector and placement_sector != 'all':
            queryset = queryset.filter(placement_sector=placement_sector)

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
            raise DRFValidationError('הסטודנט אינו משויך כרגע לחדר מקור')

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
            raise DRFValidationError('אין מיטה פנויה בחדר היעד')

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


# =========================
# Allocation
# =========================
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def run_allocation(request):
    connection.close()
    close_old_connections()
    connection.ensure_connection()

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

    constraints_config = request.data.get('constraints') or {}
    allocation_run = None

    try:
        from allocation.solver import run_improved_ortools_allocation

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

        if 'category' in student_fields:
            students_base = students_base.exclude(
                category=Student.StudentCategory.LEAVING
            )

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

            connection.close()
            close_old_connections()
            connection.ensure_connection()
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
                    'assignments': [],
                    'run': AllocationRunSerializer(allocation_run).data
                }
            }, status=status.HTTP_200_OK)

        if rooms_count == 0:
            allocation_run.status = AllocationRun.Status.FAILED
            allocation_run.error_message = 'לא נמצאו חדרים פעילים באזור זה'
            allocation_run.completed_at = timezone.now()

            connection.close()
            close_old_connections()
            connection.ensure_connection()
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
            constraints_config=constraints_config
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

        # Important after a long solver run with Neon:
        # force Django to drop the stale SSL connection and open a fresh one.
        connection.close()
        close_old_connections()
        connection.ensure_connection()
        allocation_run.save()

        # ============================================================
        # Build assignment table rows from DB for the frontend results
        # ============================================================
        assignment_rows = []

        connection.close()
        close_old_connections()
        connection.ensure_connection()

        active_assignments = BedAssignment.objects.filter(
            status=BedAssignment.Status.ACTIVE,
            bed__room__apartment__building__dorm_type__region=region
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

                connection.close()
                close_old_connections()
                connection.ensure_connection()
                allocation_run.save()
            except Exception:
                traceback.print_exc()

        return Response({
            'success': False,
            'error': f'שגיאה בהרצת השיבוץ: {str(e)}',
            'error_type': e.__class__.__name__,
            'traceback': traceback.format_exc(),
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
def allocation_results(request):
    """
    Return active BedAssignment rows for the requesting user's region.
    Central admin may pass ?region=<id> to filter. Without a region, central admin sees all regions.
    """
    region_value = request.query_params.get('region') or None

    if region_value:
        region = _resolve_region(region_value)
        if not region:
            return Response({'error': 'אזור לא נמצא'}, status=status.HTTP_404_NOT_FOUND)
    elif request.user.is_central_admin:
        region = None
    elif request.user.region:
        region = request.user.region
    else:
        return Response({'error': 'המשתמש אינו משויך לאזור'}, status=status.HTTP_400_BAD_REQUEST)

    qs = BedAssignment.objects.filter(
        status=BedAssignment.Status.ACTIVE
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
        qs = qs.filter(
            bed__room__apartment__building__dorm_type__region=region
        )

    assignments = []
    for ba in qs:
        student = ba.student
        bed = ba.bed
        room = bed.room
        apartment = room.apartment
        building = apartment.building
        dorm_type = building.dorm_type
        dorm_region = dorm_type.region if dorm_type else None

        assignments.append({
            'student_id': student.student_id,
            'full_name': student.full_name,
            'first_name': student.first_name,
            'last_name': student.last_name,
            'gender': student.gender,
            'religion': student.requested_religion,
            'religious': student.religious,
            'sector': student.placement_sector,
            'building': building.number,
            'apartment': apartment.number,
            'room': room.name,
            'bed': bed.label,
            'dorm_type': dorm_type.name if dorm_type else '',
            'region': dorm_region.name if dorm_region else '',
            'region_id': dorm_region.id if dorm_region else '',
            'assigned_at': ba.assigned_at.isoformat() if ba.assigned_at else '',
        })

    return Response({
        'count': len(assignments),
        'assignments': assignments,
    }, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def allocation_summary(request):
    user = request.user

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
                'latest_inbox': None,
                'latest_run': None,
            }, status=status.HTTP_200_OK)
    else:
        if not user.region:
            return Response({
                'error': 'המשתמש אינו משויך לאזור'
            }, status=status.HTTP_400_BAD_REQUEST)
        region = user.region

    students_qs = Student.objects.filter(
        accepted_dorm_type__region=region
    )

    total_students = students_qs.count()
    assigned_students = students_qs.filter(assigned_room__isnull=False).count()
    unassigned_students = students_qs.filter(assigned_room__isnull=True).count()
    priority_students = students_qs.filter(is_priority=True).count()

    students_by_category = {
        'new': students_qs.filter(category=Student.StudentCategory.NEW).count(),
        'continuing': students_qs.filter(category=Student.StudentCategory.CONTINUING).count(),
        'transfer': students_qs.filter(category=Student.StudentCategory.TRANSFER).count(),
        'leaving': students_qs.filter(category=Student.StudentCategory.LEAVING).count(),
    }

    rooms_qs = Room.objects.filter(
        apartment__building__dorm_type__region=region,
        is_active=True,
        apartment__is_active=True,
        apartment__building__is_active=True,
    )

    total_capacity = sum(rooms_qs.values_list('capacity', flat=True))

    total_beds = Bed.objects.filter(
        room__apartment__building__dorm_type__region=region,
        room__is_active=True,
        room__apartment__is_active=True,
        room__apartment__building__is_active=True,
    ).count()

    occupied_beds = BedAssignment.objects.filter(
        status=BedAssignment.Status.ACTIVE,
        bed__room__apartment__building__dorm_type__region=region,
        bed__room__is_active=True,
        bed__room__apartment__is_active=True,
        bed__room__apartment__building__is_active=True,
    ).values('bed_id').distinct().count()

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
        'latest_inbox': latest_inbox,
        'latest_run': latest_run,
    }, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def analysis_data(request):
    user = request.user

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

    students_qs = Student.objects.all()
    rooms_qs = Room.objects.filter(
        is_active=True,
        apartment__is_active=True,
        apartment__building__is_active=True,
    )
    assignments_qs = BedAssignment.objects.filter(
        status=BedAssignment.Status.ACTIVE
    )
    transfers_qs = Transfer.objects.all()
    runs_qs = AllocationRun.objects.all()

    if region:
        students_qs = students_qs.filter(accepted_dorm_type__region=region)
        rooms_qs = rooms_qs.filter(apartment__building__dorm_type__region=region)
        assignments_qs = assignments_qs.filter(
            bed__room__apartment__building__dorm_type__region=region
        )
        transfers_qs = transfers_qs.filter(
            Q(from_room__apartment__building__dorm_type__region=region) |
            Q(to_room__apartment__building__dorm_type__region=region)
        )
        runs_qs = runs_qs.filter(region=region)

    total_students = students_qs.count()
    assigned_students = students_qs.filter(assigned_room__isnull=False).count()
    unassigned_students = students_qs.filter(assigned_room__isnull=True).count()
    priority_students = students_qs.filter(is_priority=True).count()

    total_capacity = sum(rooms_qs.values_list('capacity', flat=True))
    active_assignments = assignments_qs.values('bed_id').distinct().count()
    available_beds = max(total_capacity - active_assignments, 0)

    occupancy_rate = 0
    if total_capacity > 0:
        occupancy_rate = round((active_assignments / total_capacity) * 100, 2)

    latest_run = runs_qs.select_related('run_by', 'region').order_by('-started_at').first()

    return Response({
        'region': RegionSerializer(region).data if region else None,
        'summary': {
            'total_students': total_students,
            'assigned_students': assigned_students,
            'unassigned_students': unassigned_students,
            'priority_students': priority_students,
            'total_capacity': total_capacity,
            'available_beds': available_beds,
            'occupancy_rate': occupancy_rate,
            'pending_transfers': transfers_qs.filter(status=Transfer.Status.PENDING).count(),
        },
        'students_by_category': {
            'new': students_qs.filter(category=Student.StudentCategory.NEW).count(),
            'continuing': students_qs.filter(category=Student.StudentCategory.CONTINUING).count(),
            'transfer': students_qs.filter(category=Student.StudentCategory.TRANSFER).count(),
            'leaving': students_qs.filter(category=Student.StudentCategory.LEAVING).count(),
        },
        'students_by_gender': {
            'male': students_qs.filter(gender=Student.Gender.MALE).count(),
            'female': students_qs.filter(gender=Student.Gender.FEMALE).count(),
        },
        'latest_run': AllocationRunSerializer(latest_run).data if latest_run else None,
    }, status=status.HTTP_200_OK)


# =========================
# Statistics
# =========================

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


# =========================
# Excel Upload Helpers
# =========================

# Legacy/demo-file text mapping. Kept as fallback.
EXCEL_DORM_TYPE_TO_REGION = {
    'קנדה': 'canada',
    'מעונות קנדה': 'canada',
    'ברושים': 'broshim',
    'מזרח': 'mizrah',
    'מגדל המזרח': 'mizrah',
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
        'גריעה/תוספת-תוכן החלטה מעונות-קוד חברה',
        'החלטה-תוכן החלטה מעונות-קוד חברה',
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


def parse_gender_from_housing_type(housing_type, tenant_type='', existing_student=None):
    housing_type = safe_str(housing_type)
    tenant_type = safe_str(tenant_type)

    if existing_student and getattr(existing_student, 'gender', None):
        return existing_student.gender

    male_values = {
        'רווקים', 'בנים', 'זכר', 'male', 'men', 'man', 'z1',
    }

    female_values = {
        'רווקות', 'בנות', 'נקבה', 'female', 'women', 'woman', 'z2',
    }

    housing_norm = normalize_compact(housing_type)
    tenant_norm = normalize_compact(tenant_type)

    if housing_norm in male_values or tenant_norm in male_values:
        return Student.Gender.MALE

    if housing_norm in female_values or tenant_norm in female_values:
        return Student.Gender.FEMALE

    if 'רווקות' in housing_type or 'בנות' in housing_type or 'נקבה' in housing_type:
        return Student.Gender.FEMALE

    if 'רווקים' in housing_type or 'בנים' in housing_type or 'זכר' in housing_type:
        return Student.Gender.MALE

    # Model requires male/female. Keep deterministic fallback instead of crashing import.
    return Student.Gender.MALE


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
    """Return the real dorm/area code from the dorm-office Excel, with legacy fallback."""
    return safe_str(get_alias_value(row, 'decision_dorm_code', default=''))


def get_decision_dorm_name(row):
    """Return a human-readable dorm name where available; real file mostly uses numeric codes."""
    return safe_str(get_alias_value(row, 'decision_dorm_name', default=''))


def resolve_region_from_dorm_name(dorm_name):
    dorm_name = safe_str(dorm_name)

    if not dorm_name:
        return None

    for key, region_id in EXCEL_DORM_TYPE_TO_REGION.items():
        if key in dorm_name:
            try:
                return Region.objects.get(pk=region_id)
            except Region.DoesNotExist:
                continue

    return None


def _first_dorm_type_for_region(region):
    if not region:
        return None
    return DormType.objects.filter(region=region).select_related('region').order_by('id').first()


# Official dorm-office Excel mapping.
#
# IMPORTANT:
# The real Excel column 'אזור החלטה לאביב' is NOT the same thing as
# our Django DormType.id and is NOT DormType.code.
# It is the dorm-office area code. Therefore every real Excel area code
# must be mapped explicitly to the matching DormType primary key in our DB.
#
# This explicit mapping prevents bugs like:
# Excel code 2 -> DormType id 2 -> יחיד תחתון
# while the office meaning of Excel code 2 is actually קנדה.
EXCEL_AREA_TO_DORM_TYPE_ID = {
    '1': 1,     # ריפקין -> תחתון שניים בחדר
    '2': 3,     # קנדה -> קנדה רווקים / רווקות
    '4': 4,     # זוגות / משפחות related to קנדה
    '5': 7,     # מזרח ישן
    '6': 12,    # נווה אמריקה
    '7': 13,    # סנאט / סנט
    '8': 6,     # משפחות -> זוגות / משפחות
    '10': 2,    # יחיד בחדר -> יחיד תחתון
    '11': 11,   # עליון עמים
    '12': 9,    # מזרח חדש
    '13': 16,   # סגל זוטר
    '14': 14,   # כפר משתלמים / כפר הסמכה רווקים
    '15': 14,   # כפר הסמכה
    '17': 5,    # ברושים
    '18': 13,   # סנט חדש
}


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
    code_text = safe_str(code_value)
    if not code_text:
        return None

    normalized_code = _normalize_excel_area_code(code_text)
    code_int = safe_int(code_text, default=None)

    # 1) Real dorm-office file path:
    #    'אזור החלטה לאביב' -> explicit office-code-to-DormType-id mapping.
    mapped_pk = (
        EXCEL_AREA_TO_DORM_TYPE_ID.get(normalized_code)
        or EXCEL_AREA_TO_DORM_TYPE_ID.get(code_text)
    )

    if mapped_pk is not None:
        dorm_type = DormType.objects.filter(pk=mapped_pk).select_related('region').first()
        if dorm_type:
            return dorm_type

    # 2) Legacy/demo/import-buildings path:
    #    In older/demo files the value may be the 5-digit DormType.code,
    #    such as 19417 / 88119. Keep this fallback for compatibility.
    candidates = []
    if code_int is not None:
        candidates.append(code_int)
    candidates.append(code_text)

    for candidate in candidates:
        try:
            dorm_type = DormType.objects.filter(code=candidate).select_related('region').first()
            if dorm_type:
                return dorm_type
        except Exception:
            continue

    # 3) Deliberately DO NOT fallback to DormType.pk for small numeric values.
    #    That was the bug that mapped Excel code 2 to DormType id 2 instead of Canada.
    return None


def get_or_create_dorm_type_from_excel(dorm_code=None, dorm_name=None):
    """
    Resolve DormType for imported students.

    Real dorm-office file: 'אזור החלטה לאביב' is the important numeric dorm/area code.
    Legacy/demo file: dorm name text such as קנדה/ברושים/מזרח is used as fallback.

    This function intentionally does NOT create DormType rows.
    DormTypes should already exist from import_buildings.
    """
    dorm_type = _find_dorm_type_by_code(dorm_code)
    if dorm_type:
        return dorm_type

    dorm_name = safe_str(dorm_name)
    if dorm_name:
        dorm_type = _find_dorm_type_by_code(dorm_name)
        if dorm_type:
            return dorm_type

        region = resolve_region_from_dorm_name(dorm_name)
        if region:
            return _first_dorm_type_for_region(region)

    # Last fallback: maybe the code itself is a Region primary key/name.
    region = _resolve_region(dorm_code)
    if region:
        return _first_dorm_type_for_region(region)

    return None


def is_accessibility_priority(row):
    explicit_flag = parse_yes_no_code(get_alias_value(row, 'accessibility_flag', default=''))
    disability_percent = safe_decimal(get_alias_value(row, 'disability_percent', default=''), default=Decimal('0'))
    medical_reason = safe_str(get_alias_value(row, 'medical_reason', default=''))

    return explicit_flag or (disability_percent is not None and disability_percent > 0) or bool(medical_reason)


def filter_payload_to_student_fields(payload):
    """Avoid create/update errors if the model does not contain optional fields."""
    student_fields = _get_model_field_names(Student)
    return {key: value for key, value in payload.items() if key in student_fields}


def build_student_payload_from_row(row, existing_student=None, sheet_name=''):
    housing_type = safe_str(get_alias_value(row, 'housing_type', default=''))
    tenant_type = safe_str(get_alias_value(row, 'tenant_type', default=''))
    gender_text = safe_str(get_alias_value(row, 'gender', default=''))

    decision_dorm_code = get_decision_dorm_code(row)
    decision_dorm_name = get_decision_dorm_name(row)

    accepted_dorm_type = get_or_create_dorm_type_from_excel(
        decision_dorm_code,
        decision_dorm_name
    )

    needs_accessibility = is_accessibility_priority(row)
    placement_sector = parse_placement_sector(row)
    allocation_group_value = get_alias_value(row, 'allocation_group', default='')

    current_dorm_type_value = (
        accepted_dorm_type.name
        if accepted_dorm_type
        else (decision_dorm_name or decision_dorm_code)
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
            housing_type,
            tenant_type=tenant_type or gender_text,
            existing_student=existing_student
        ),

        'requested_religion': parse_requested_religion(get_alias_value(row, 'religion', default='')),
        'placement_sector': placement_sector,
        'religious': parse_religious(get_alias_value(row, 'religious', default='')),
        'category': parse_category(allocation_group_value, sheet_name=sheet_name),

        'housing_type': housing_type,
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

        'special_status_1': safe_str(get_alias_value(row, 'special_status_1')),
        'special_status_2': safe_str(get_alias_value(row, 'special_status_2')),
        'special_status_3': safe_str(get_alias_value(row, 'special_status_3')),
        'special_status_4': safe_str(get_alias_value(row, 'special_status_4')),

        'study_points': safe_decimal(get_alias_value(row, 'study_points', default=''), default=None),
        'current_address': safe_str(get_alias_value(row, 'current_address', default='')),
        'current_dorm_type': current_dorm_type_value,

        'is_priority': needs_accessibility,
        'priority_reason': 'נגישות/רפואי' if needs_accessibility else '',
    }

    optional_fields = {
        'business_partner_id': safe_str(get_alias_value(row, 'business_partner_id')),
        'email_secondary': safe_str(get_alias_value(row, 'email_secondary')),
        'current_dorm_code': safe_str(get_alias_value(row, 'current_dorm_code')),
        'accepted_dorm_code': decision_dorm_code,
    }

    payload.update(optional_fields)
    return filter_payload_to_student_fields(payload)




def refresh_db_connection():
    """Force Django to use a usable DB connection after long imports.

    Neon/PostgreSQL can close an idle/stale SSL connection during a long Excel
    import. Calling this before final metadata writes prevents the import from
    inserting students successfully but crashing before returning the response.
    """
    try:
        close_old_connections()
        if connection.connection is None or not connection.is_usable():
            connection.close()
        connection.ensure_connection()
    except Exception:
        connection.close()
        close_old_connections()
        connection.ensure_connection()


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
        sheet_counts = {}
        skipped_by_reason = {}

        def add_skip(reason, amount=1):
            nonlocal skipped_count
            skipped_count += amount
            skipped_by_reason[reason] = skipped_by_reason.get(reason, 0) + amount

        for sheet_name in excel_file.sheet_names:
            df = pd.read_excel(excel_file, sheet_name=sheet_name)
            df.columns = [safe_str(col) for col in df.columns]
            sheet_counts[sheet_name] = {
                'rows': len(df),
                'created': 0,
                'updated': 0,
                'skipped': 0,
            }

            if normalize_compact(sheet_name) in {normalize_compact(x) for x in LEAVING_SHEET_NAMES}:
                add_skip('leaving_sheet', len(df))
                sheet_counts[sheet_name]['skipped'] += len(df)
                errors.append(f"Sheet '{sheet_name}' skipped: leaving students are not imported for allocation")
                continue

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
                        errors.append(f"Sheet '{sheet_name}', row {idx + 2}: missing student_id")
                        continue

                    decision_status = get_decision_status(row)

                    if not is_positive_decision(decision_status):
                        add_skip('non_positive_decision')
                        sheet_counts[sheet_name]['skipped'] += 1
                        errors.append(
                            f"Student {student_id}: skipped בגלל סטטוס החלטה '{decision_status}'"
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

                    accepted_dorm_type = student_payload.get('accepted_dorm_type')
                    decision_dorm_name = get_decision_dorm_name(row)
                    decision_dorm_code = get_decision_dorm_code(row)

                    if accepted_dorm_type is None:
                        add_skip('could_not_resolve_dorm_type')
                        sheet_counts[sheet_name]['skipped'] += 1
                        errors.append(
                            f"Student {student_id}: could not resolve accepted dorm type. "
                            f"name='{decision_dorm_name}', code='{decision_dorm_code}'"
                        )
                        continue

                    target_region = accepted_dorm_type.region

                    if target_region is None:
                        add_skip('dorm_type_without_region')
                        sheet_counts[sheet_name]['skipped'] += 1
                        errors.append(
                            f"Student {student_id}: dorm type '{accepted_dorm_type.name}' has no region"
                        )
                        continue

                    if existing:
                        for key, value in student_payload.items():
                            setattr(existing, key, value)

                        existing.batch = batch
                        existing.save()
                        updated_count += 1
                        sheet_counts[sheet_name]['updated'] += 1
                    else:
                        Student.objects.create(
                            batch=batch,
                            **student_payload
                        )
                        created_count += 1
                        sheet_counts[sheet_name]['created'] += 1

                    if target_region.id not in region_counts:
                        region_counts[target_region.id] = {
                            'region': target_region,
                            'count': 0,
                            'created': 0,
                            'updated': 0,
                        }

                    region_counts[target_region.id]['count'] += 1
                    if existing:
                        region_counts[target_region.id]['updated'] += 1
                    else:
                        region_counts[target_region.id]['created'] += 1

                except Exception as e:
                    add_skip('row_exception')
                    sheet_counts[sheet_name]['skipped'] += 1
                    errors.append(
                        f"Sheet '{sheet_name}', row {idx + 2}: {e.__class__.__name__}: {str(e)}"
                    )
                    continue

        # Final metadata writes happen after a long row-by-row import.
        # Refresh the DB connection here so a stale Neon/PostgreSQL connection
        # does not crash after the student rows were already inserted.
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
                message=f'התקבלו {data["count"]} סטודנטים חדשים לשיבוץ'
            )

            region_breakdown.append({
                'region_id': region_id,
                'region_name': data['region'].name,
                'count': data['count'],
                'created': data['created'],
                'updated': data['updated'],
            })

        total_imported = created_count + updated_count

        refresh_db_connection()
        ImportBatch.objects.filter(pk=batch.id).update(
            total_students=total_imported,
            status=ImportBatch.Status.COMPLETED,
            error_message=''
        )

        return Response({
            'success': True,
            'message': 'הקובץ הועלה ועובד בהצלחה',
            'messageEn': 'File uploaded and processed successfully',
            'batch_id': batch.id,
            'total_students': total_imported,
            'created': created_count,
            'updated': updated_count,
            'skipped': skipped_count,
            'region_breakdown': region_breakdown,
            'sheet_counts': sheet_counts,
            'skipped_by_reason': skipped_by_reason,
            'errors': errors[:100]
        }, status=status.HTTP_200_OK)

    except Exception as e:
        traceback.print_exc()

        # If the import crashes after a long run, the current DB connection may
        # already be closed. Use a fresh connection and QuerySet.update() so the
        # error handler itself does not crash while trying to mark the batch.
        try:
            refresh_db_connection()
            ImportBatch.objects.filter(pk=batch.id).update(
                status=ImportBatch.Status.FAILED,
                error_message=str(e)[:2000]
            )
        except Exception:
            traceback.print_exc()

        return Response({
            'success': False,
            'error': f'שגיאה בעיבוד הקובץ: {str(e)}',
            'errorEn': f'Error processing file: {str(e)}',
            'traceback': traceback.format_exc(),
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
    """Assign a student to a room. Backend chooses the first free bed."""
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
    """Move a student to another room. Ends old active assignment and creates a new one."""
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
            return Response({
                'success': True,
                'message': 'Student was already unassigned',
                'student_id': student.id,
            }, status=status.HTTP_200_OK)

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

        with transaction.atomic():
            assignment_a = BedAssignment.objects.select_for_update().select_related(
                'bed__room__apartment__building__dorm_type__region'
            ).get(student=student_a, status=BedAssignment.Status.ACTIVE)

            assignment_b = BedAssignment.objects.select_for_update().select_related(
                'bed__room__apartment__building__dorm_type__region'
            ).get(student=student_b, status=BedAssignment.Status.ACTIVE)

            room_a = assignment_a.bed.room
            room_b = assignment_b.bed.room

            if not _user_can_edit_room(request.user, room_a) or not _user_can_edit_room(request.user, room_b):
                return Response({'error': 'אין הרשאה לערוך אחד מהחדרים'}, status=status.HTTP_403_FORBIDDEN)

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
                assigned_by=request.user,
                assignment_type=BedAssignment.AssignmentType.MANUAL,
            )

            new_b = assign_student_to_room(
                student=student_b,
                room=room_a,
                assigned_by=request.user,
                assignment_type=BedAssignment.AssignmentType.MANUAL,
            )

        return Response({
            'success': True,
            'message': 'Students swapped successfully',
            'student_a_id': student_a.id,
            'student_b_id': student_b.id,
            'student_a_room_id': room_b.id,
            'student_b_room_id': room_a.id,
            'assignment_a_id': new_a.id,
            'assignment_b_id': new_b.id,
        }, status=status.HTTP_200_OK)

    except Student.DoesNotExist:
        return Response({'error': 'Student not found'}, status=status.HTTP_404_NOT_FOUND)
    except BedAssignment.DoesNotExist:
        return Response({'error': 'Both students must have active assignments'}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


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

        with transaction.atomic():
            assignment_a = BedAssignment.objects.select_for_update().select_related(
                'bed__room__apartment__building__dorm_type__region'
            ).get(student=student_a, status=BedAssignment.Status.ACTIVE)

            assignment_b = BedAssignment.objects.select_for_update().select_related(
                'bed__room__apartment__building__dorm_type__region'
            ).get(student=student_b, status=BedAssignment.Status.ACTIVE)

            room_a = assignment_a.bed.room
            room_b = assignment_b.bed.room

            if not _user_can_edit_room(request.user, room_a) or not _user_can_edit_room(request.user, room_b):
                return Response({'error': 'אין הרשאה לערוך אחד מהחדרים'}, status=status.HTTP_403_FORBIDDEN)

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
                assigned_by=request.user,
                assignment_type=BedAssignment.AssignmentType.MANUAL,
            )
            new_b = assign_student_to_room(
                student=student_b,
                room=room_a,
                assigned_by=request.user,
                assignment_type=BedAssignment.AssignmentType.MANUAL,
            )

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
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


