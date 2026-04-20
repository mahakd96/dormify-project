"""
DORMIFY - Database Models
Safe merged schema:
- keeps current frontend-compatible fields
- adds normalized tables (Office, StaffProfile, DormType, Floor, Bed, BedAssignment, MovementRequest)
"""

from django.db import models
from django.contrib.auth.models import AbstractUser
from django.utils.translation import gettext_lazy as _
from django.core.exceptions import ValidationError


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
    # keep for frontend compatibility
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
        return f"{self.get_full_name() or self.email} ({self.get_role_display()})"

    @property
    def is_central_admin(self):
        return self.role == self.Role.CENTRAL_ADMIN

    @property
    def is_boss(self):
        return self.role in [self.Role.CENTRAL_ADMIN, self.Role.REGION_BOSS]


# ===========================================
# REGION / OFFICE / STAFF
# ===========================================
class Region(models.Model):
    """Dormitory regions (Canada, Mizrah,  etc.)"""

    id = models.CharField(max_length=50, primary_key=True)  # e.g. 'canada'
    name = models.CharField(max_length=100)

    class Meta:
        verbose_name = _('אזור')
        verbose_name_plural = _('אזורים')
        ordering = ['name']

    def __str__(self):
        return self.name


class Office(models.Model):
    class OfficeType(models.TextChoices):
        CENTRAL = 'central', _('לשכה מרכזית')
        REGIONAL = 'regional', _('משרד אזורי')

    name = models.CharField(max_length=100)
    office_type = models.CharField(
        max_length=20,
        choices=OfficeType.choices,
        default=OfficeType.REGIONAL
    )
    region = models.ForeignKey(
        Region,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='offices'
    )

    class Meta:
        verbose_name = _('משרד')
        verbose_name_plural = _('משרדים')
        ordering = ['office_type', 'name']
        constraints = [
            models.UniqueConstraint(
                fields=['region', 'office_type'],
                condition=models.Q(office_type='regional'),
                name='unique_regional_office_per_region'
            )
        ]

    def clean(self):
        if self.office_type == self.OfficeType.REGIONAL and not self.region:
            raise ValidationError('Regional office must have a region.')
        if self.office_type == self.OfficeType.CENTRAL and self.region:
            raise ValidationError('Central office should not be linked to a region.')

    def __str__(self):
        return self.name


class StaffProfile(models.Model):
    class StaffRole(models.TextChoices):
        CENTRAL_ADMIN = 'central_admin', _('מנהל מרכזי')
        REGION_BOSS = 'region_boss', _('מנהל אזור')
        EMPLOYEE = 'employee', _('עובד')

    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name='staff_profile'
    )
    role = models.CharField(max_length=20, choices=StaffRole.choices)
    office = models.ForeignKey(
        Office,
        on_delete=models.CASCADE,
        related_name='staff_profiles'
    )

    class Meta:
        verbose_name = _('פרופיל עובד')
        verbose_name_plural = _('פרופילי עובדים')

    def __str__(self):
        return f"{self.user.email} - {self.get_role_display()}"


# ===========================================
# BUILDING / FLOOR / APARTMENT / ROOM / BED
# ===========================================
class DormType(models.Model):
    code = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=100, unique=True)
    region = models.ForeignKey(
        Region,
        on_delete=models.PROTECT,
        related_name='dorm_types'
    )

    class Meta:
        verbose_name = _('סוג מעון')
        verbose_name_plural = _('סוגי מעונות')
        ordering = ['code']

    def __str__(self):
        return f"{self.code} - {self.name} ({self.region.name})"


class Building(models.Model):
    number = models.PositiveIntegerField(unique=True)
    dorm_type = models.ForeignKey(
        DormType,
        on_delete=models.PROTECT,
        related_name='buildings',
    )
    is_active = models.BooleanField(default=True)
    class Meta:
        verbose_name = _('בניין')
        verbose_name_plural = _('בניינים')
        ordering = ['number']

    def __str__(self):
        return f"Building {self.number} - {self.dorm_type.name}"


class Apartment(models.Model):
    class Category(models.TextChoices):
        MALE = 'male', _('זכר')
        FEMALE = 'female', _('נקבה')

    class ApartmentType(models.TextChoices):
        SINGLE = 'single', _('רווקים')
        COUPLE = 'couple', _('זוגות')
        FAMILY = 'family', _('משפחה')

    class InactiveReason(models.TextChoices):
        RESERVED = 'reserved', _('שמורה')
        MAINTENANCE = 'maintenance', _('תחזוקה')
        RENOVATION = 'renovation', _('שיפוץ')
        STAFF_USE = 'staff_use', _('שימוש מנהלתי')
        OTHER = 'other', _('אחר')

    building = models.ForeignKey(
        Building,
        on_delete=models.CASCADE,
        related_name='apartments'
    )
    number = models.CharField(max_length=20)
    category = models.CharField(max_length=10, choices=Category.choices)
    apartment_type = models.CharField(
        max_length=10,
        choices=ApartmentType.choices
    )
    room_count = models.PositiveIntegerField()
    apartment_capacity = models.PositiveIntegerField()
    is_active = models.BooleanField(default=True)
    inactive_reason = models.CharField(
        max_length=20,
        choices=InactiveReason.choices,
        blank=True
    )

    class Meta:
        verbose_name = _('דירה')
        verbose_name_plural = _('דירות')
        ordering = ['building', 'number']
        unique_together = ['building', 'number']

    def __str__(self):
        return f"דירה {self.number} - {self.building}"

    @property
    def region(self):
        return self.building.dorm_type.region

    @property
    def dorm_type(self):
        return self.building.dorm_type

class Room(models.Model):
    """
    Keep field 'name' because frontend likely uses it.
    Add property 'number' for your ER idea.
    """
    apartment = models.ForeignKey(
        Apartment,
        on_delete=models.CASCADE,
        related_name='rooms'
    )
    name = models.CharField(max_length=50)  # keeps old frontend working
    capacity = models.PositiveIntegerField()
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name = _('חדר')
        verbose_name_plural = _('חדרים')
        ordering = ['apartment', 'name']
        unique_together = ['apartment', 'name']

    def __str__(self):
        return f"{self.name} - {self.apartment}"

    @property
    def number(self):
        return self.name

    @property
    def building(self):
        return self.apartment.building

    @property
    def region(self):
        return self.apartment.building.dorm_type.region

    @property
    def current_occupancy(self):
        return BedAssignment.objects.filter(
            bed__room=self,
            status=BedAssignment.Status.ACTIVE
        ).count()

    @property
    def is_full(self):
        if not self.is_active:
            return True
        return self.available_beds <= 0

    @property
    def available_beds(self):
        if not self.is_active:
            return 0

        used = BedAssignment.objects.filter(
            bed__room=self,
            status=BedAssignment.Status.ACTIVE
        ).values('bed_id').distinct().count()

        return max(self.beds.count() - used, 0)

class Bed(models.Model):
    label = models.CharField(max_length=20)
    room = models.ForeignKey(
        Room,
        on_delete=models.CASCADE,
        related_name='beds'
    )

    class Meta:
        verbose_name = _('מיטה')
        verbose_name_plural = _('מיטות')
        ordering = ['room', 'label']
        unique_together = ['room', 'label']

    def __str__(self):
        return f"{self.room} / {self.label}"

    @property
    def is_occupied(self):
        return self.assignments.filter(status=BedAssignment.Status.ACTIVE).exists()


# ===========================================
# STUDENT
# ===========================================
class Student(models.Model):
    class Gender(models.TextChoices):
        MALE = 'male', _('זכר')
        FEMALE = 'female', _('נקבה')

    class Religion(models.TextChoices):
        Muslim = 'Muslims', _('מוסלמי')
        Jewish = 'Jewish', _('יהודי')
        Christian = 'Christian', _('נוצרי')
        Druze = 'Druze', _('דרוזי')
        NOT_SPECIFIED = 'not_specified', _('לא צוין')

    class Religious(models.TextChoices):
        RELIGIOUS = 'religious', _('דתי')
        NO_PREFERENCE = 'no_preference', _('לא משנה')
        NOT_SPECIFIED = 'not_specified', _('לא צוין')

    class Nationality(models.TextChoices):
        ISRAELI = 'israeli', _('ישראלי')
        INTERNATIONAL = 'international', _('בינלאומי')

    class StudentCategory(models.TextChoices):
        NEW = 'new', _('סטודנטים חדשים')
        CONTINUING = 'continuing', _('ממשיכים')
        TRANSFER = 'transfer', _('מעברים')
        LEAVING = 'leaving', _('עזיבה')

    student_id = models.CharField(max_length=20, unique=True)
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    email = models.EmailField(blank=True)
    email_secondary = models.EmailField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    phone_secondary = models.CharField(max_length=20, blank=True)
    city = models.CharField(max_length=100, blank=True)
    business_partner_id = models.CharField(max_length=20, blank=True)
    gender = models.CharField(max_length=10, choices=Gender.choices)
    requested_religion = models.CharField(max_length=20, choices=Religion.choices, default=Religion.NOT_SPECIFIED)
    category = models.CharField(max_length=20, choices=StudentCategory.choices, default=StudentCategory.NEW)
    ## סוג המעון שאליו נרשם הסטודנט - רווקים\ זוגות\ משפחות
    housing_type = models.CharField(max_length=100, blank=True)
    ## סטודנטים חדשים\ עוזבים\ עוברים\ נשארים\ תוכניות מיוחדות ....
    allocation_group = models.CharField(max_length=50, blank=True)
    # #סוג המעון שאליו הסטודנט התקבל
    accepted_dorm_type = models.ForeignKey(
        DormType,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='accepted_students',
        verbose_name=_('סוג מעונות אליו התקבל הסטודנט')
    )

    batch = models.ForeignKey(
        'ImportBatch',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='students'
    )
    religious = models.CharField(
        max_length=20,
        choices=Religious.choices,
        default=Religious.NOT_SPECIFIED
    )

    roommate_request_1 = models.CharField(max_length=100, blank=True)
    roommate_request_2 = models.CharField(max_length=100, blank=True)
    roommate_request_3 = models.CharField(max_length=100, blank=True)
    roommate_request_4 = models.CharField(max_length=100, blank=True)
    roommate_request_5 = models.CharField(max_length=100, blank=True)
    ##האם התקבלה ההחלטה או לא
    roommate_request_flag_1 = models.BooleanField(default=False)
    roommate_request_flag_2 = models.BooleanField(default=False)
    roommate_request_flag_3 = models.BooleanField(default=False)
    roommate_request_flag_4 = models.BooleanField(default=False)
    roommate_request_flag_5 = models.BooleanField(default=False)
    ##סטטוס מיוחד
    special_status_1 = models.CharField(max_length=100, blank=True)
    special_status_2 = models.CharField(max_length=100, blank=True)
    special_status_3 = models.CharField(max_length=100, blank=True)
    special_status_4 = models.CharField(max_length=100, blank=True)

    is_priority = models.BooleanField(default=False)
    priority_reason = models.CharField(max_length=255, blank=True)
    study_points = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name=_('נקודות לימוד')
    )

    current_address = models.CharField(max_length=255, blank=True)
    current_dorm_type = models.CharField(max_length=100, blank=True)
    # # מתי הסטודנט נכנס למעונות, מתי הסטודנט עזב המעונות
    move_in_date = models.DateField(null=True, blank=True)
    move_out_date = models.DateField(null=True, blank=True)

    ## מתי הפעם האחרונה שנוסף סטודנט או נעשה שינוי במערכת- זה קשור יותר להיסטוריה
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    ## לאיזה חדר הסטודנט משוייך כרגע
    assigned_room = models.ForeignKey(
        Room,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='students'
    )

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
    def housing_gender(self):
        mapping = {
            'רווקים': 'male',
            'רווקות': 'female',
        }
        return mapping.get(self.housing_type)

    @property
    def is_assigned(self):
        return self.assigned_room is not None

    @property
    def current_assignment(self):
        return self.bed_assignments.filter(status=BedAssignment.Status.ACTIVE).select_related('bed', 'bed__room').first()

    @property
    def current_bed(self):
        assignment = self.current_assignment
        return assignment.bed if assignment else None

# ===========================================
# BED ASSIGNMENTS / MOVEMENTS
# ===========================================
class BedAssignment(models.Model):
    class Status(models.TextChoices):
        ACTIVE = 'active', _('פעיל')
        ENDED = 'ended', _('הסתיים')
        CANCELLED = 'cancelled', _('בוטל')

    class AssignmentType(models.TextChoices):
        INITIAL = 'initial', _('שיבוץ ראשוני')
        TRANSFER = 'transfer', _('העברה')
        MANUAL = 'manual', _('ידני')
        PHASE2 = 'phase2', _('שלב 2')

    student = models.ForeignKey(
        Student,
        on_delete=models.PROTECT,
        related_name='bed_assignments'
    )
    bed = models.ForeignKey(
        Bed,
        on_delete=models.PROTECT,
        related_name='assignments'
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE
    )
    assignment_type = models.CharField(
        max_length=20,
        choices=AssignmentType.choices,
        default=AssignmentType.MANUAL
    )
    assigned_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_bed_assignments'
    )
    assigned_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = _('שיבוץ מיטה')
        verbose_name_plural = _('שיבוצי מיטות')
        ordering = ['-assigned_at']
        constraints = [
            models.UniqueConstraint(
                fields=['bed'],
                condition=models.Q(status='active'),
                name='unique_active_assignment_per_bed'
            ),
            models.UniqueConstraint(
                fields=['student'],
                condition=models.Q(status='active'),
                name='unique_active_assignment_per_student'
            ),
        ]

    def __str__(self):
        return f"{self.student.full_name} -> {self.bed}"

    def clean(self):
        if self.status == self.Status.ACTIVE:
            qs = BedAssignment.objects.filter(
                bed=self.bed,
                status=self.Status.ACTIVE
            )
            if self.pk:
                qs = qs.exclude(pk=self.pk)
            if qs.exists():
                raise ValidationError('This bed already has an active assignment.')

            student_qs = BedAssignment.objects.filter(
                student=self.student,
                status=self.Status.ACTIVE
            )
            if self.pk:
                student_qs = student_qs.exclude(pk=self.pk)
            if student_qs.exists():
                raise ValidationError('This student already has an active bed assignment.')

        if self.status == self.Status.ACTIVE and self.ended_at is not None:
            raise ValidationError('Active assignment cannot have an ended_at value.')

        if self.status in (self.Status.ENDED, self.Status.CANCELLED) and self.ended_at is None:
            raise ValidationError('Ended or cancelled assignment must have ended_at.')

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class MovementRequest(models.Model):
    class MovementType(models.TextChoices):
        INTERNAL = 'internal', _('מעבר פנימי')
        REGION_CHANGE = 'region_change', _('מעבר בין אזורים')
        DORM_TYPE_CHANGE = 'dorm_type_change', _('שינוי סוג מעונות')
        PHASE2 = 'phase2', _('שלב 2')

    class Status(models.TextChoices):
        PENDING = 'pending', _('ממתין')
        APPROVED = 'approved', _('אושר')
        REJECTED = 'rejected', _('נדחה')
        COMPLETED = 'completed', _('הושלם')

    student = models.ForeignKey(
        Student,
        on_delete=models.PROTECT,
        related_name='movement_requests'
    )
    from_assignment = models.ForeignKey(
        BedAssignment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='movement_requests_from'
    )
    to_bed = models.ForeignKey(
        Bed,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='movement_requests_to'
    )
    movement_type = models.CharField(
        max_length=30,
        choices=MovementType.choices,
        default=MovementType.INTERNAL
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING
    )
    reason = models.TextField(blank=True)
    requested_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='requested_movements'
    )
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_movements'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = _('בקשת תנועה')
        verbose_name_plural = _('בקשות תנועה')
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.student.full_name} - {self.get_movement_type_display()} - {self.get_status_display()}"

    def clean(self):
        if self.status == self.Status.PENDING:
            if self.approved_by is not None or self.reviewed_at is not None or self.completed_at is not None:
                raise ValidationError('Pending request cannot have approval/completion data.')

        if self.status == self.Status.APPROVED:
            if self.approved_by is None or self.reviewed_at is None:
                raise ValidationError('Approved request must have approved_by and reviewed_at.')

        if self.status == self.Status.REJECTED:
            if self.approved_by is None or self.reviewed_at is None:
                raise ValidationError('Rejected request must have approved_by and reviewed_at.')

        if self.status == self.Status.COMPLETED:
            if self.approved_by is None or self.reviewed_at is None or self.completed_at is None:
                raise ValidationError('Completed request must have approval and completion timestamps.')

        if self.status in [self.Status.APPROVED, self.Status.COMPLETED] and self.to_bed is None:
            raise ValidationError('Approved or completed request must have target bed.')


# ===========================================
# KEEP EXISTING TRANSFER MODEL FOR FRONTEND
# ===========================================
class Transfer(models.Model):
    """Keep existing transfer model so current frontend does not break"""

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
    movement_type = models.CharField(max_length=30, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING
    )

    requested_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='requested_transfers'
    )
    reviewed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_transfers'
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)

    # optional normalized link
    movement_request = models.OneToOneField(
        MovementRequest,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='legacy_transfer'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _('בקשת העברה')
        verbose_name_plural = _('בקשות העברה')
        ordering = ['-created_at']

    def __str__(self):
        return f"העברה: {self.student} - {self.get_status_display()}"


# ===========================================
# ALLOCATION / IMPORT / INBOX
# ===========================================
class AllocationRun(models.Model):
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

    students_processed = models.PositiveIntegerField(default=0)
    successful_assignments = models.PositiveIntegerField(default=0)
    roommate_matches = models.PositiveIntegerField(default=0)
    conflicts = models.PositiveIntegerField(default=0)

    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    error_message = models.TextField(blank=True)

    class Meta:
        verbose_name = _('הרצת שיבוץ')
        verbose_name_plural = _('הרצות שיבוץ')
        ordering = ['-started_at']

    def __str__(self):
        return f"שיבוץ {self.region} - {self.started_at.strftime('%Y-%m-%d %H:%M')}"


class ImportBatch(models.Model):
    class Status(models.TextChoices):
        PROCESSING = 'processing', _('מעבד')
        COMPLETED = 'completed', _('הושלם')
        FAILED = 'failed', _('נכשל')

    uploaded_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='import_batches'
    )
    filename = models.CharField(max_length=255)
    total_students = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PROCESSING
    )
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _('קובץ יבוא')
        verbose_name_plural = _('קבצי יבוא')
        ordering = ['-created_at']

    def __str__(self):
        return f"Batch {self.id} - {self.filename} ({self.created_at.strftime('%Y-%m-%d %H:%M')})"


class RegionInbox(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', _('ממתין')
        VIEWED = 'viewed', _('נצפה')
        PROCESSED = 'processed', _('טופל')
        SUPERSEDED = 'superseded', _('הוחלף')

    region = models.ForeignKey(
        Region,
        on_delete=models.CASCADE,
        related_name='inbox_items'
    )
    batch = models.ForeignKey(
        ImportBatch,
        on_delete=models.CASCADE,
        related_name='region_inboxes'
    )
    students_count = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING
    )
    message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    viewed_at = models.DateTimeField(null=True, blank=True)
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = _('הודעת אזור')
        verbose_name_plural = _('הודעות אזור')
        ordering = ['-created_at']

    def __str__(self):
        return f"Inbox: {self.region.name} - {self.students_count} students (Batch {self.batch_id})"