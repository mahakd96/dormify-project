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
        constraints = [
            # G3-19: DB-level backstop for "at most one region_boss per
            # region" - the application-level check lives in
            # accounts.serializers.StaffUserSerializer.create() (which also
            # closes the concurrent-duplicate race via select_for_update()
            # on the Region row; this constraint alone only catches the
            # duplicate case, not a region left with zero managers - see
            # that create() method's comment for the full picture).
            #
            # Applied to the real production database as part of the production
            # closeout - the previously-existing duplicate region_boss
            # records were cleaned up manually before this migration was
            # applied. See
            # project-quality/security/SECURITY_AND_AUTHORIZATION_REPORT.md
            # section 14 for the cleanup and migration-application record.
            models.UniqueConstraint(
                fields=['region'],
                condition=models.Q(role='region_boss'),
                name='unique_region_boss_per_region',
            ),
        ]

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



class DormType(models.Model):
    code = models.PositiveIntegerField(null=True, blank=True, unique=True)
    name = models.CharField(max_length=100, unique=True)
    region = models.ForeignKey(
        Region,
        on_delete=models.PROTECT,
        related_name='dorm_types',
        null=True,
        blank=True
    )

    class Meta:
        verbose_name = _('סוג מעון')
        verbose_name_plural = _('סוגי מעונות')
        ordering = ['code']

    def __str__(self):
        region_name = self.region.name if self.region else "No Region"
        return f"{self.code} - {self.name} ({region_name})"

class Building(models.Model):
    class GenderRestriction(models.TextChoices):
        MALE = 'male', _('בנים בלבד')
        FEMALE = 'female', _('בנות בלבד')

    number = models.PositiveIntegerField(null=True, blank=True)
    dorm_type = models.ForeignKey(
        DormType,
        on_delete=models.PROTECT,
        related_name='buildings',
        null=True,
        blank=True
    )
    is_active = models.BooleanField(default=True)
    gender_restriction = models.CharField(
        max_length=10,
        choices=GenderRestriction.choices,
        blank=True,
        verbose_name=_('הגבלת מגדר לבניין'),
        help_text=_(
            'לבניינים עם שירותים משותפים: כל הבניין מוגבל למגדר אחד, '
            'ללא קשר לקטגוריית הדירות. ריק = ללא הגבלת בניין (ברירת מחדל).'
        ),
    )

    class Meta:
        verbose_name = _('בניין')
        verbose_name_plural = _('בניינים')
        ordering = ['dorm_type', 'number']
        constraints = [
            models.UniqueConstraint(
                fields=['dorm_type', 'number'],
                name='unique_building_per_dorm_type',
            ),
        ]

    def __str__(self):
        dorm_type_name = self.dorm_type.name if self.dorm_type else "No Dorm Type"
        return f"Building {self.number} - {dorm_type_name}"


class Apartment(models.Model):
    class Category(models.TextChoices):
        MALE = 'male', _('זכר')
        FEMALE = 'female', _('נקבה')
        MIXED = 'mixed', _('מעורב / לא רלוונטי')

    class ApartmentType(models.TextChoices):
        # ApartmentType describes the physical/administrative apartment class.
        # Gender is represented separately by Category.
        SINGLE = 'single', _('רווקים/ות')
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
        choices=ApartmentType.choices,
        null=True,
        blank=True
    )
    room_count = models.PositiveIntegerField()
    apartment_capacity = models.PositiveIntegerField(null=True, blank=True)
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
    Keep field 'name' for frontend compatibility.
    Expose room number and building information through properties.
    """

    apartment = models.ForeignKey(
        Apartment,
        on_delete=models.CASCADE,
        related_name='rooms'
    )

    name = models.CharField(
        max_length=50
    )

    capacity = models.PositiveIntegerField()
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name = _('חדר')
        verbose_name_plural = _('חדרים')
        ordering = ['apartment', 'name']
        unique_together = ['apartment', 'name']

    def __str__(self):
        return (
            f"Room {self.name} - "
            f"Apartment {self.apartment.number} - "
            f"Building {self.apartment.building.number}"
        )

    @property
    def number(self):
        return self.name

    @property
    def building(self):
        return self.apartment.building

    @property
    def building_number(self):
        return self.apartment.building.number

    @property
    def apartment_number(self):
        return self.apartment.number

    @property
    def dorm_type(self):
        return self.apartment.building.dorm_type

    @property
    def dorm_code(self):
        return self.apartment.building.dorm_type.code

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
        ).values(
            'bed_id'
        ).distinct().count()

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



class Student(models.Model):
    class Gender(models.TextChoices):
        MALE = 'male', _('זכר')
        FEMALE = 'female', _('נקבה')


    class HousingType(models.TextChoices):
        # Values match the descriptions received in the student Excel file.
        SINGLE_MALE = 'רווקים', _('רווקים')                 # Z1
        SINGLE_FEMALE = 'רווקות', _('רווקות')               # Z2
        COUPLE = 'זוגות', _('זוגות')                         # Z3
        FAMILY = 'משפחות עד 2 ילדים (כולל)', _('משפחות עד 2 ילדים (כולל)')  # Z4
        SINGLE_IN_APARTMENT = 'רווקים/ות בדירה', _('רווקים/ות בדירה')       # Z6

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

    class PlacementSector(models.TextChoices):
        JEWISH = 'jewish', _('יהודי')
        ARAB = 'arab', _('ערבי')
        OTHER = 'other', _('אחר')
        UNKNOWN = 'unknown', _('לא ידוע')

    student_id = models.CharField(max_length=20, unique=True)
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    email = models.EmailField(blank=True)
    email_secondary = models.EmailField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    phone_secondary = models.CharField(max_length=20, blank=True)
    city = models.CharField(max_length=100, blank=True)
    business_partner_id = models.CharField(max_length=20, blank=True)

    gender = models.CharField(
        max_length=10,
        choices=Gender.choices,
        null=True,
        blank=True,
    )
    requested_religion = models.CharField(max_length=20, choices=Religion.choices, default=Religion.NOT_SPECIFIED)
    placement_sector = models.CharField(
        max_length=20,
        choices=PlacementSector.choices,
        default=PlacementSector.UNKNOWN,
    )

    category = models.CharField(max_length=20, choices=StudentCategory.choices, default=StudentCategory.NEW)
    housing_type = models.CharField(
        max_length=100,
        choices=HousingType.choices,
        blank=True,
    )
    allocation_group = models.CharField(max_length=50, blank=True)
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

    # Set ONLY at creation time, never reassigned on update - unlike `batch`
    # above (which tracks "last touched by"), this is the sole reliable way
    # to know "did THIS batch create this student row." Used to scope the
    # upload-workflow delete controls so they can never remove a
    # pre-existing student that a batch merely updated.
    created_in_batch = models.ForeignKey(
        'ImportBatch',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_students',
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

    roommate_request_student_id_1 = models.CharField(max_length=20, blank=True)
    roommate_request_student_id_2 = models.CharField(max_length=20, blank=True)
    roommate_request_student_id_3 = models.CharField(max_length=20, blank=True)
    roommate_request_student_id_4 = models.CharField(max_length=20, blank=True)
    roommate_request_student_id_5 = models.CharField(max_length=20, blank=True)



    roommate_request_flag_1 = models.BooleanField(default=False)
    roommate_request_flag_2 = models.BooleanField(default=False)
    roommate_request_flag_3 = models.BooleanField(default=False)
    roommate_request_flag_4 = models.BooleanField(default=False)
    roommate_request_flag_5 = models.BooleanField(default=False)

    special_status_1 = models.CharField(max_length=100, blank=True)
    special_status_2 = models.CharField(max_length=100, blank=True)
    special_status_3 = models.CharField(max_length=100, blank=True)
    special_status_4 = models.CharField(max_length=100, blank=True)

    is_priority = models.BooleanField(default=False)
    priority_reason = models.CharField(max_length=255, blank=True)

    # Accessibility/medical import data. Kept intentionally separate from
    # is_priority/priority_reason: accessible students are allocated
    # manually by the dorm office, not by the solver's priorityFirst rule.
    accessibility_flag = models.BooleanField(default=False)
    disability_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name=_('אחוז נכות'),
    )
    medical_reason = models.CharField(max_length=255, blank=True)

    study_points = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name=_('נקודות לימוד')
    )

    current_address = models.CharField(max_length=255, blank=True)
    current_dorm_type = models.CharField(max_length=100, blank=True)
    move_in_date = models.DateField(null=True, blank=True)
    move_out_date = models.DateField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

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
        """
        Return the gender restriction imposed by the housing type.

        Z1 requires a male single apartment.
        Z2 requires a female single apartment.

        Z3 couples, Z4 families and Z6 single occupancy do not impose
        a male/female apartment-category restriction.
        """
        if self.housing_type == self.HousingType.SINGLE_MALE:
            return self.Gender.MALE

        if self.housing_type == self.HousingType.SINGLE_FEMALE:
            return self.Gender.FEMALE

        return None

    @property
    def requires_gender_restricted_apartment(self):
        """
        True only when housing eligibility depends on a male/female
        apartment category.
        """
        return self.housing_type in {
            self.HousingType.SINGLE_MALE,
            self.HousingType.SINGLE_FEMALE,
        }


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
    allocation_run = models.ForeignKey(
        'AllocationRun',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='bed_assignments',
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



class Transfer(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', _('ממתין')
        APPROVED = 'approved', _('אושר')
        REJECTED = 'rejected', _('נדחה')

    student = models.ForeignKey(
        Student,
        on_delete=models.PROTECT,
        related_name='transfers'
    )
    from_room = models.ForeignKey(
        Room,
        on_delete=models.PROTECT,
        related_name='transfers_from'
    )
    to_room = models.ForeignKey(
        Room,
        on_delete=models.PROTECT,
        related_name='transfers_to'
    )
    reason = models.TextField(blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING
    )

    requested_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
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

    def clean(self):
        if self.from_room_id and self.to_room_id and self.from_room_id == self.to_room_id:
            raise ValidationError('Source room and target room cannot be the same.')

        if self.status == self.Status.PENDING:
            if self.reviewed_by is not None or self.reviewed_at is not None:
                raise ValidationError('Pending transfer cannot have review data.')
            if self.rejection_reason:
                raise ValidationError('Pending transfer cannot have rejection_reason.')

        if self.status == self.Status.APPROVED:
            if self.reviewed_by is None or self.reviewed_at is None:
                raise ValidationError('Approved transfer must have reviewed_by and reviewed_at.')
            if self.rejection_reason:
                raise ValidationError('Approved transfer cannot have rejection_reason.')

        if self.status == self.Status.REJECTED:
            if self.reviewed_by is None or self.reviewed_at is None:
                raise ValidationError('Rejected transfer must have reviewed_by and reviewed_at.')

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)
# ===========================================
# ALLOCATION / IMPORT / INBOX
# ===========================================
class AllocationRun(models.Model):
    class Status(models.TextChoices):
        QUEUED = 'queued', _('בתור')
        RUNNING = 'running', _('רץ')
        CANCELLATION_REQUESTED = 'cancellation_requested', _('מבוקשת עצירה')
        STOP_AND_SAVE_REQUESTED = 'stop_and_save_requested', _('מבוקשת עצירה ושמירה')
        STOPPED = 'stopped', _('עצר')
        COMPLETED = 'completed', _('הושלם')
        FAILED = 'failed', _('נכשל')
        DELETED = 'deleted', _('נמחק')
        APPROVED = 'approved', _('אושר')

    region = models.ForeignKey(
        Region,
        on_delete=models.PROTECT,
        related_name='allocation_runs'
    )
    run_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='allocation_runs'
    )
    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.QUEUED
    )

    students_processed = models.PositiveIntegerField(default=0)
    successful_assignments = models.PositiveIntegerField(default=0)
    roommate_matches = models.PositiveIntegerField(default=0)
    conflicts = models.PositiveIntegerField(default=0)

    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    error_message = models.TextField(blank=True)


    max_search_seconds = models.PositiveIntegerField(null=True, blank=True)

 
    search_started_at = models.DateTimeField(null=True, blank=True)


    live_snapshot = models.JSONField(null=True, blank=True, default=None)


    diagnostics = models.JSONField(default=dict, blank=True)

    class Meta:
        verbose_name = _('הרצת שיבוץ')
        verbose_name_plural = _('הרצות שיבוץ')
        ordering = ['-started_at']

    def __str__(self):
        return f"שיבוץ {self.region} - {self.started_at.strftime('%Y-%m-%d %H:%M')}"
    def clean(self):
        in_progress = {
            self.Status.QUEUED,
            self.Status.RUNNING,
            self.Status.CANCELLATION_REQUESTED,
            self.Status.STOP_AND_SAVE_REQUESTED,
        }

        if self.status in in_progress:
            if self.completed_at is not None:
                raise ValidationError(f'{self.status} allocation cannot have completed_at.')
            if self.error_message:
                raise ValidationError(f'{self.status} allocation cannot have error_message.')

        elif self.status == self.Status.COMPLETED:
            if self.completed_at is None:
                raise ValidationError('Completed allocation must have completed_at.')
            if self.error_message:
                raise ValidationError('Completed allocation should not have error_message.')

        elif self.status == self.Status.FAILED:
            if self.completed_at is None:
                raise ValidationError('Failed allocation must have completed_at.')
            if not self.error_message:
                raise ValidationError('Failed allocation should include error_message.')

        elif self.status in {self.Status.STOPPED, self.Status.DELETED, self.Status.APPROVED}:
            if self.completed_at is None:
                raise ValidationError(f'{self.status} allocation must have completed_at.')

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class ImportBatch(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', _('ממתין להעלאה')
        PROCESSING = 'processing', _('מעבד')
        CANCELLATION_REQUESTED = 'cancellation_requested', _('בקשת עצירה')
        STOP_AND_DELETE_REQUESTED = 'stop_and_delete_requested', _('בקשת עצירה ומחיקה')
        STOPPED = 'stopped', _('נעצר')
        COMPLETED = 'completed', _('הושלם')
        FAILED = 'failed', _('נכשל')

    class Kind(models.TextChoices):
        MAIN = 'main', _('קובץ שיבוץ ראשי')
        ADDITIONS = 'additions', _('קובץ מתווספים')

    uploaded_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name='import_batches'
    )
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.MAIN)
    # Blank until the actual file arrives - a batch is created (PENDING) via
    # the init handshake before the caller has even chosen/sent a file.
    filename = models.CharField(max_length=255, blank=True, default='')
    total_students = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.PENDING
    )
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # Authoritative timestamps for the frontend timer and for distinguishing
    # "created but never submitted" (started_at is null) from "actually ran."
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    # Lightweight live-progress counters, updated once per row as it's
    # processed. Not a resumable cursor (no per-sheet position is stored) -
    # only enough for a progress display and for the frontend to know
    # processing is actually advancing.
    total_rows = models.PositiveIntegerField(default=0)
    processed_rows = models.PositiveIntegerField(default=0)

    # Full terminal summary (same shape as the synchronous upload response),
    # persisted so a page refresh/re-poll can recover it after the original
    # request has already returned. Also holds the deletion outcome
    # (`result['deletion']`) when Delete/Stop & Delete actually removes
    # students - deliberately not a separate status value.
    result = models.JSONField(null=True, blank=True)

    class Meta:
        verbose_name = _('קובץ יבוא')
        verbose_name_plural = _('קבצי יבוא')
        ordering = ['-created_at']

    def __str__(self):
        return f"Batch {self.id} - {self.filename} ({self.created_at.strftime('%Y-%m-%d %H:%M')})"

    def clean(self):
        if self.status == self.Status.FAILED:
            if not self.error_message:
                raise ValidationError('Failed batch should include error_message.')
        elif self.error_message:
            raise ValidationError(
                f'{self.get_status_display()} batch cannot have error_message.'
            )

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class RegionInbox(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', _('ממתין')
        VIEWED = 'viewed', _('נצפה')
        PROCESSED = 'processed', _('טופל')
        SUPERSEDED = 'superseded', _('הוחלף')

    region = models.ForeignKey(
        Region,
        on_delete=models.PROTECT,
        related_name='inbox_items'
    )
    batch = models.ForeignKey(
        ImportBatch,
        on_delete=models.PROTECT,
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

    def clean(self):
        if self.status == self.Status.PENDING:
            if self.viewed_at is not None or self.processed_at is not None:
                raise ValidationError('Pending inbox item cannot have viewed_at or processed_at.')

        if self.status == self.Status.VIEWED:
            if self.viewed_at is None:
                raise ValidationError('Viewed inbox item must have viewed_at.')

        if self.status == self.Status.PROCESSED:
            if self.processed_at is None:
                raise ValidationError('Processed inbox item must have processed_at.')

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class StudentRequest(models.Model):
    class RequestType(models.TextChoices):
        ADD_STUDENT    = 'add_student',    _('הוספת סטודנט')
        REMOVE_STUDENT = 'remove_student', _('הסרת סטודנט מהמעונות')
        ROOM           = 'room',           _('שינוי חדר')
        APARTMENT      = 'apartment',      _('מעבר מהדירה')
        SWAP           = 'swap',           _('חילוף בין סטודנטים')
        REGION_TRANSFER = 'region_transfer', _('העברה בין אזורים')
        OTHER          = 'other',          _('בקשה אחרת')

    class Status(models.TextChoices):
        PENDING   = 'pending',   _('ממתין')
        APPROVED  = 'approved',  _('אושר')
        REJECTED  = 'rejected',  _('נדחה')
        # Distinct from REJECTED: the requesting side withdrew its own
        # pending request (e.g. the source region's "ביטול בקשת העברה"
        # action), never a reviewer's decision. Keeping these separate
        # preserves the audit meaning of REJECTED - "a reviewer considered
        # and declined this" - which CANCELLED must not silently overload.
        CANCELLED = 'cancelled', _('בוטל')

    class Priority(models.TextChoices):
        LOW    = 'low',    _('Low')
        NORMAL = 'normal', _('Normal')
        HIGH   = 'high',   _('High')
        URGENT = 'urgent', _('Urgent')

    request_type = models.CharField(max_length=20, choices=RequestType.choices)
    reason = models.TextField(blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    requested_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name='created_student_requests',
    )
    reviewed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_student_requests',
    )
    student = models.ForeignKey(
        Student,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='requests',
    )

    other_description = models.TextField(
        blank=True,
        default='',
        help_text='Description text for "other" request type',
    )
    same_apartment = models.BooleanField(
        null=True,
        blank=True,
        help_text='For room change: True = same apartment, False = different apartment',
    )

    removal_notes = models.TextField(blank=True)
    removal_reason = models.CharField(max_length=100, blank=True)
    target_room = models.ForeignKey(
        Room,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='student_requests_target_room',
        help_text='For add student request: room selected during approval',
    )

    swap_with_student = models.ForeignKey(
        Student,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='swap_requests_as_partner',
        help_text='For swap requests: the other student whose room/bed is being swapped',
    )

    target_region = models.ForeignKey(
        Region,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='incoming_transfer_requests',
        help_text='For region_transfer requests: the destination region',
    )

    class TransferScope(models.TextChoices):
        SAME_REGION = 'same_region', _('מעבר בתוך האזור הנוכחי')
        CROSS_REGION = 'cross_region', _('מעבר לאזור אחר')

    transfer_scope = models.CharField(
        max_length=20,
        choices=TransferScope.choices,
        null=True,
        blank=True,
        help_text='For room/apartment transfer requests: whether the move stays '
                  'inside the student\'s current region or crosses regions',
    )
    source_region = models.ForeignKey(
        Region,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='outgoing_transfer_requests',
        help_text='Snapshot of the student\'s region at request-creation time',
    )
    destination_regions = models.ManyToManyField(
        Region,
        blank=True,
        related_name='destination_transfer_requests',
        help_text='For cross-region transfers: destination regions selected by the central admin',
    )
    current_assignment_snapshot = models.JSONField(
        null=True,
        blank=True,
        help_text='Snapshot of the student\'s bed assignment at request-creation time',
    )
    final_assignment = models.ForeignKey(
        BedAssignment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='finalized_requests',
        help_text='The bed assignment actually created when this request was approved',
    )

    student_data = models.JSONField(blank=True, default=dict)

    priority = models.CharField(
        max_length=20,
        choices=Priority.choices,
        default=Priority.NORMAL,
    )
    request_number = models.CharField(max_length=30, unique=True, null=True, blank=True)

    class Meta:
        verbose_name = _('בקשת סטודנט')
        verbose_name_plural = _('בקשות סטודנט')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', '-created_at']),
            models.Index(fields=['request_type']),
        ]

    def __str__(self):
        student_label = self.student.full_name if self.student else '(no student)'
        return f"{self.get_request_type_display()} - {student_label} - {self.get_status_display()}"


class AssistedAllocationAudit(models.Model):
    """
    Audit trail for staff actions taken from the Assisted Allocation
    workbench: manual assignment, manual override (bypassing a hard
    compatibility rule), and apartment/building configuration changes.

    No general-purpose audit/history mechanism exists elsewhere in this
    codebase (no django-simple-history/reversion) - this one model is
    written from three call sites (see api/views.py) rather than
    introducing a per-model history table for each of Student, BedAssignment,
    Building and Apartment.
    """

    class ActionType(models.TextChoices):
        MANUAL_ASSIGNMENT = 'manual_assignment', _('שיבוץ ידני')
        MANUAL_OVERRIDE = 'manual_override', _('שיבוץ בחריגה')
        CONFIG_CHANGE = 'config_change', _('שינוי הגדרת דירה/בניין')

    action_type = models.CharField(max_length=30, choices=ActionType.choices)
    actor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assisted_allocation_actions',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    student = models.ForeignKey(
        Student,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assisted_allocation_actions',
    )
    bed_assignment = models.ForeignKey(
        BedAssignment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assisted_allocation_audit_entries',
    )
    building = models.ForeignKey(
        Building,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assisted_allocation_audit_entries',
    )
    apartment = models.ForeignKey(
        Apartment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assisted_allocation_audit_entries',
    )

    previous_state = models.JSONField(default=dict, blank=True)
    new_state = models.JSONField(default=dict, blank=True)
    # List of {"code": ..., "label": ...} - only populated for MANUAL_OVERRIDE.
    overridden_rules = models.JSONField(default=list, blank=True)
    note = models.TextField(blank=True)

    class Meta:
        verbose_name = _('פעולת שיבוץ מסייע')
        verbose_name_plural = _('פעולות שיבוץ מסייע')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['student', '-created_at']),
            models.Index(fields=['action_type', '-created_at']),
        ]

    def __str__(self):
        student_label = self.student.full_name if self.student else '(no student)'
        return f"{self.get_action_type_display()} - {student_label}"

