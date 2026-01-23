"""
DORMIFY - Database Models
All database tables are defined here
"""

from django.db import models
from django.contrib.auth.models import AbstractUser
from django.utils.translation import gettext_lazy as _


# ===========================================
# USER MODEL (Custom with roles)
# ===========================================
class User(AbstractUser):
    """Custom user with role-based permissions"""
    
    class Role(models.TextChoices):
        CENTRAL_ADMIN = 'central_admin', _('מנהל מרכזי')
        REGION_BOSS = 'region_boss', _('מנהל אזור')
        EMPLOYEE = 'employee', _('עובד')
    
    email = models.EmailField(_('email'), unique=True)
    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.EMPLOYEE
    )
    region = models.ForeignKey(
        'Region',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='users'
    )
    phone = models.CharField(max_length=20, blank=True)
    
    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']
    
    class Meta:
        verbose_name = _('משתמש')
        verbose_name_plural = _('משתמשים')
    
    def __str__(self):
        return f"{self.get_full_name()} ({self.get_role_display()})"
    
    @property
    def is_central_admin(self):
        return self.role == self.Role.CENTRAL_ADMIN
    
    @property
    def is_boss(self):
        return self.role in [self.Role.CENTRAL_ADMIN, self.Role.REGION_BOSS]


# ===========================================
# REGION MODEL
# ===========================================
class Region(models.Model):
    """Dormitory regions (Canada, Mizrah, Taub, etc.)"""
    
    id = models.CharField(max_length=50, primary_key=True)  # e.g., 'canada'
    name = models.CharField(max_length=100)  # Hebrew: 'מעונות קנדה'
    name_en = models.CharField(max_length=100)  # English: 'Canada Dorms'
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = _('אזור')
        verbose_name_plural = _('אזורים')
        ordering = ['name']
    
    def __str__(self):
        return self.name


# ===========================================
# BUILDING MODEL
# ===========================================
class Building(models.Model):
    """Buildings within each region"""
    
    region = models.ForeignKey(
        Region,
        on_delete=models.CASCADE,
        related_name='buildings'
    )
    name = models.CharField(max_length=100)  # e.g., 'בניין 1'
    floors = models.PositiveIntegerField(default=1)
    apartments_per_floor = models.PositiveIntegerField(default=4)
    image_url = models.URLField(blank=True)
    address = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = _('בניין')
        verbose_name_plural = _('בניינים')
        ordering = ['region', 'name']
    
    def __str__(self):
        return f"{self.name} - {self.region.name}"


# ===========================================
# APARTMENT MODEL
# ===========================================
class Apartment(models.Model):
    """Apartments within buildings"""
    
    building = models.ForeignKey(
        Building,
        on_delete=models.CASCADE,
        related_name='apartments'
    )
    number = models.PositiveIntegerField()
    floor = models.PositiveIntegerField()
    room_count = models.PositiveIntegerField(default=2)
    is_reserved = models.BooleanField(default=False)  # For priority students
    reserved_reason = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = _('דירה')
        verbose_name_plural = _('דירות')
        ordering = ['building', 'floor', 'number']
        unique_together = ['building', 'number']
    
    def __str__(self):
        return f"דירה {self.number} - {self.building}"
    
    @property
    def region(self):
        return self.building.region


# ===========================================
# ROOM MODEL
# ===========================================
class Room(models.Model):
    """Rooms within apartments"""
    
    apartment = models.ForeignKey(
        Apartment,
        on_delete=models.CASCADE,
        related_name='rooms'
    )
    name = models.CharField(max_length=50)  # e.g., 'חדר A'
    capacity = models.PositiveIntegerField(default=2)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = _('חדר')
        verbose_name_plural = _('חדרים')
        ordering = ['apartment', 'name']
    
    def __str__(self):
        return f"{self.name} - {self.apartment}"
    
    @property
    def building(self):
        return self.apartment.building
    
    @property
    def region(self):
        return self.apartment.building.region
    
    @property
    def current_occupancy(self):
        return self.students.filter(is_active=True).count()
    
    @property
    def is_full(self):
        return self.current_occupancy >= self.capacity
    
    @property
    def available_beds(self):
        return self.capacity - self.current_occupancy


# ===========================================
# STUDENT MODEL
# ===========================================
class Student(models.Model):
    """Students to be assigned to rooms"""
    
    class Gender(models.TextChoices):
        MALE = 'male', _('זכר')
        FEMALE = 'female', _('נקבה')
    
    class Religion(models.TextChoices):
        JEWISH = 'jewish', _('יהודי')
        MUSLIM = 'muslim', _('מוסלמי')
        CHRISTIAN = 'christian', _('נוצרי')
        DRUZE = 'druze', _('דרוזי')
        OTHER = 'other', _('אחר')
    
    # Personal Info
    student_id = models.CharField(max_length=20, unique=True)  # תעודת זהות
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    
    # Attributes for allocation
    gender = models.CharField(max_length=10, choices=Gender.choices)
    religion = models.CharField(max_length=20, choices=Religion.choices)
    
    # Region assignment
    region = models.ForeignKey(
        Region,
        on_delete=models.CASCADE,
        related_name='students'
    )
    
    # Roommate request
    roommate_request_id = models.CharField(max_length=20, blank=True)  # Student ID of requested roommate
    
    # Priority status
    is_priority = models.BooleanField(default=False)
    priority_reason = models.CharField(max_length=255, blank=True)
    
    # Room assignment
    assigned_room = models.ForeignKey(
        Room,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='students'
    )
    
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = _('סטודנט')
        verbose_name_plural = _('סטודנטים')
        ordering = ['last_name', 'first_name']
    
    def __str__(self):
        return f"{self.first_name} {self.last_name} ({self.student_id})"
    
    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}"
    
    @property
    def is_assigned(self):
        return self.assigned_room is not None


# ===========================================
# TRANSFER REQUEST MODEL
# ===========================================
class Transfer(models.Model):
    """Room transfer requests"""
    
    class Status(models.TextChoices):
        PENDING = 'pending', _('ממתין')
        APPROVED = 'approved', _('אושר')
        REJECTED = 'rejected', _('נדחה')
    
    student = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        related_name='transfers'
    )
    from_room = models.ForeignKey(
        Room,
        on_delete=models.CASCADE,
        related_name='transfers_from'
    )
    to_room = models.ForeignKey(
        Room,
        on_delete=models.CASCADE,
        related_name='transfers_to'
    )
    reason = models.TextField(blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING
    )
    
    # Who requested
    requested_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='requested_transfers'
    )
    
    # Who reviewed (boss)
    reviewed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_transfers'
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = _('בקשת העברה')
        verbose_name_plural = _('בקשות העברה')
        ordering = ['-created_at']
    
    def __str__(self):
        return f"העברה: {self.student} - {self.get_status_display()}"


# ===========================================
# ALLOCATION HISTORY MODEL
# ===========================================
class AllocationRun(models.Model):
    """History of allocation runs"""
    
    class Status(models.TextChoices):
        RUNNING = 'running', _('רץ')
        COMPLETED = 'completed', _('הושלם')
        FAILED = 'failed', _('נכשל')
    
    region = models.ForeignKey(
        Region,
        on_delete=models.CASCADE,
        related_name='allocation_runs'
    )
    run_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='allocation_runs'
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.RUNNING
    )
    
    # Results
    students_processed = models.PositiveIntegerField(default=0)
    successful_assignments = models.PositiveIntegerField(default=0)
    roommate_matches = models.PositiveIntegerField(default=0)
    conflicts = models.PositiveIntegerField(default=0)
    
    # Timing
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    # Error info if failed
    error_message = models.TextField(blank=True)
    
    class Meta:
        verbose_name = _('הרצת שיבוץ')
        verbose_name_plural = _('הרצות שיבוץ')
        ordering = ['-started_at']
    
    def __str__(self):
        return f"שיבוץ {self.region} - {self.started_at.strftime('%Y-%m-%d %H:%M')}"
