"""
DORMIFY - API Views
Handle all API requests
"""

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework_simplejwt.tokens import RefreshToken
from django.utils import timezone
from django.db.models import Q

from .models import User, Region, Building, Apartment, Room, Student, Transfer, AllocationRun
from .serializers import (
    UserSerializer, LoginSerializer, RegisterSerializer,
    RegionSerializer, BuildingSerializer, ApartmentSerializer,
    RoomSerializer, StudentSerializer, TransferSerializer,
    AllocationRunSerializer
)


# ===========================================
# AUTHENTICATION VIEWS
# ===========================================
@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    """Login and get JWT token"""
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
    """Register new user"""
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
    """Get current logged-in user"""
    return Response({
        'user': UserSerializer(request.user).data
    })


@api_view(['PUT'])
@permission_classes([IsAuthenticated])
def change_password_view(request):
    """Change password"""
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
    """Only central admin can access"""
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_central_admin


class IsBoss(permissions.BasePermission):
    """Central admin or region boss can access"""
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.is_boss


def filter_by_region(queryset, user, region_field='region'):
    """Filter queryset by user's region (unless central admin)"""
    if user.is_central_admin:
        return queryset
    return queryset.filter(**{region_field: user.region})


# ===========================================
# REGION VIEWS
# ===========================================
class RegionViewSet(viewsets.ModelViewSet):
    """API endpoint for regions"""
    serializer_class = RegionSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = Region.objects.filter(is_active=True)
        if self.request.user.is_central_admin:
            return queryset
        return queryset.filter(id=self.request.user.region_id)


# ===========================================
# BUILDING VIEWS
# ===========================================
class BuildingViewSet(viewsets.ModelViewSet):
    """API endpoint for buildings"""
    serializer_class = BuildingSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = Building.objects.filter(is_active=True)
        return filter_by_region(queryset, self.request.user)
    
    @action(detail=True, methods=['get'])
    def apartments(self, request, pk=None):
        """Get apartments in a building"""
        building = self.get_object()
        apartments = building.apartments.filter(is_active=True)
        serializer = ApartmentSerializer(apartments, many=True)
        return Response({'apartments': serializer.data})
    
    @action(detail=True, methods=['get'])
    def rooms(self, request, pk=None):
        """Get rooms in a building"""
        building = self.get_object()
        rooms = Room.objects.filter(
            apartment__building=building,
            is_active=True
        )
        
        # Filter by available only
        available_only = request.query_params.get('available', 'false') == 'true'
        if available_only:
            rooms = [r for r in rooms if not r.is_full]
        
        serializer = RoomSerializer(rooms, many=True)
        return Response({'rooms': serializer.data})


# ===========================================
# STUDENT VIEWS
# ===========================================
class StudentViewSet(viewsets.ModelViewSet):
    """API endpoint for students"""
    serializer_class = StudentSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = Student.objects.filter(is_active=True)
        queryset = filter_by_region(queryset, self.request.user)
        
        # Search
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(first_name__icontains=search) |
                Q(last_name__icontains=search) |
                Q(student_id__icontains=search)
            )
        
        # Filter by gender
        gender = self.request.query_params.get('gender')
        if gender and gender != 'all':
            queryset = queryset.filter(gender=gender)
        
        # Filter by religion
        religion = self.request.query_params.get('religion')
        if religion and religion != 'all':
            queryset = queryset.filter(religion=religion)
        
        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter == 'assigned':
            queryset = queryset.filter(assigned_room__isnull=False)
        elif status_filter == 'unassigned':
            queryset = queryset.filter(assigned_room__isnull=True)
        elif status_filter == 'priority':
            queryset = queryset.filter(is_priority=True)
        
        return queryset
    
    def perform_create(self, serializer):
        # Only central admin can create students
        if not self.request.user.is_central_admin:
            raise permissions.PermissionDenied('רק מנהל מרכזי יכול להוסיף סטודנטים')
        serializer.save()


# ===========================================
# TRANSFER VIEWS
# ===========================================
class TransferViewSet(viewsets.ModelViewSet):
    """API endpoint for transfer requests"""
    serializer_class = TransferSerializer
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        queryset = Transfer.objects.all()
        
        # Filter by region
        if not self.request.user.is_central_admin:
            queryset = queryset.filter(student__region=self.request.user.region)
        
        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter and status_filter != 'all':
            queryset = queryset.filter(status=status_filter)
        
        return queryset
    
    def perform_create(self, serializer):
        # Set requested_by to current user
        serializer.save(requested_by=self.request.user)
    
    @action(detail=True, methods=['put'])
    def approve(self, request, pk=None):
        """Approve transfer request (boss only)"""
        if not request.user.is_boss:
            return Response({
                'error': 'רק מנהל יכול לאשר בקשות'
            }, status=status.HTTP_403_FORBIDDEN)
        
        transfer = self.get_object()
        
        if transfer.status != Transfer.Status.PENDING:
            return Response({
                'error': 'הבקשה כבר טופלה'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Check region permission
        if not request.user.is_central_admin:
            if transfer.student.region != request.user.region:
                return Response({
                    'error': 'אין הרשאה לאשר בקשה זו'
                }, status=status.HTTP_403_FORBIDDEN)
        
        # Update transfer
        transfer.status = Transfer.Status.APPROVED
        transfer.reviewed_by = request.user
        transfer.reviewed_at = timezone.now()
        transfer.save()
        
        # Update student's room
        student = transfer.student
        student.assigned_room = transfer.to_room
        student.save()
        
        return Response({
            'message': 'הבקשה אושרה בהצלחה',
            'transfer': TransferSerializer(transfer).data
        })
    
    @action(detail=True, methods=['put'])
    def reject(self, request, pk=None):
        """Reject transfer request (boss only)"""
        if not request.user.is_boss:
            return Response({
                'error': 'רק מנהל יכול לדחות בקשות'
            }, status=status.HTTP_403_FORBIDDEN)
        
        transfer = self.get_object()
        
        if transfer.status != Transfer.Status.PENDING:
            return Response({
                'error': 'הבקשה כבר טופלה'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Update transfer
        transfer.status = Transfer.Status.REJECTED
        transfer.reviewed_by = request.user
        transfer.reviewed_at = timezone.now()
        transfer.rejection_reason = request.data.get('reason', '')
        transfer.save()
        
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
    """Run the MiniZinc allocation algorithm"""
    if not request.user.is_boss:
        return Response({
            'error': 'רק מנהל יכול להריץ שיבוץ'
        }, status=status.HTTP_403_FORBIDDEN)
    
    region_id = request.data.get('region_id')
    if not region_id:
        if request.user.is_central_admin:
            return Response({
                'error': 'נדרש לבחור אזור'
            }, status=status.HTTP_400_BAD_REQUEST)
        region_id = request.user.region_id
    
    try:
        region = Region.objects.get(id=region_id)
    except Region.DoesNotExist:
        return Response({
            'error': 'אזור לא נמצא'
        }, status=status.HTTP_404_NOT_FOUND)
    
    # Create allocation run record
    allocation_run = AllocationRun.objects.create(
        region=region,
        run_by=request.user
    )
    
    try:
        # Import and run allocation algorithm
        from allocation.solver import run_allocation_algorithm
        result = run_allocation_algorithm(region)
        
        # Update run record
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
    """Get allocation run history"""
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
    """Get dashboard statistics"""
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
# UPLOAD STUDENTS FROM EXCEL
# ===========================================
@api_view(['POST'])
@permission_classes([AllowAny])  # For testing - change later
def upload_students(request):
    """Receive students from Excel upload"""
    students_data = request.data.get('students', [])
    region_id = request.data.get('region_id', 'canada')

    created_count = 0

    for s in students_data:
        try:
            # Get or create region
            region_code = 'canada' if 'א' in str(s.get('region', '')) else 'mizrah'
            region = Region.objects.filter(id=region_code).first()

            if not region:
                region = Region.objects.first()

            # Create student
            Student.objects.create(
                student_id=str(s.get('studentId', '')),
                first_name=s.get('firstName', ''),
                last_name=s.get('lastName', ''),
                email=s.get('email', ''),
                phone=str(s.get('phone', '')),
                gender='male' if s.get('gender') == 'זכר' else 'female',
                religion='jewish' if 'יהודי' in str(s.get('religion', '')) else 'muslim' if 'מוסלמי' in str(
                    s.get('religion', '')) else 'other',
                region=region,
                is_priority=False,
            )
            created_count += 1
        except Exception as e:
            print(f"Error creating student: {e}")
            continue

    return Response({
        'message': f'נוצרו {created_count} סטודנטים בהצלחה!',
        'created': created_count
    })
