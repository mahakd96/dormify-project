"""
DORMIFY - Admin Configuration
This gives you a FREE admin panel!
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import (
    User, Region, Building, Apartment, Room, Bed, Student, BedAssignment,
    MovementRequest, Transfer, AllocationRun, ImportBatch, RegionInbox, DormType
)


# ===========================================
# USER ADMIN
# ===========================================
@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ['email', 'first_name', 'last_name', 'role', 'region']
    list_filter = ['first_name', 'last_name', 'role', 'region']
    search_fields = ['email', 'first_name', 'last_name', 'region__name', 'role']
    ordering = ['role']

    fieldsets = BaseUserAdmin.fieldsets + (
        ('Role & Region', {'fields': ('role', 'region', 'phone')}),
    )


# ===========================================
# REGION ADMIN
# ===========================================
@admin.register(Region)
class RegionAdmin(admin.ModelAdmin):
    list_display = ['id', 'name']
    search_fields = ['name']

# ===========================================
# DORM TYPE ADMIN
# ===========================================
@admin.register(DormType)
class DormTypeAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'region']
    list_filter = ['region']
    search_fields = ['name', 'region__name']
    ordering = ['code']


# ===========================================
# BUILDING ADMIN
# ===========================================
@admin.register(Building)
class BuildingAdmin(admin.ModelAdmin):
    list_display = ['number', 'dorm_type', 'is_active']
    list_filter = ['dorm_type', 'is_active']
    search_fields = ['dorm_type__name']
    ordering = ['number']

# ===========================================
# APARTMENT ADMIN
@admin.register(Apartment)
class ApartmentAdmin(admin.ModelAdmin):
    list_display = [
        'number',
        'building',
        'category',
        'apartment_type',
        'room_count',
        'apartment_capacity',
        'is_active',
        'inactive_reason',
    ]
    list_filter = [
        'building__dorm_type__region',
        'building',
        'category',
        'apartment_type',
        'is_active',
        'inactive_reason',
    ]
    search_fields = ['number', 'building__dorm_type__name']
    ordering = ['building', 'number']

# ===========================================
# ROOM ADMIN
# ===========================================
@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ['name', 'apartment', 'capacity', 'current_occupancy', 'is_active']
    list_filter = ['apartment__building__dorm_type__region', 'apartment__building', 'is_active']
    search_fields = ['name', 'apartment__number', 'apartment__building__number']
    ordering = ['apartment', 'name']

# ===========================================
# BED ADMIN
# ===========================================
@admin.register(Bed)
class BedAdmin(admin.ModelAdmin):
    list_display = ['label', 'room', 'is_occupied']
    list_filter = ['room__apartment__building__dorm_type__region', 'room']
    search_fields = ['label', 'room__name', 'room__apartment__number']
    ordering = ['room', 'label']

# ===========================================
# STUDENT ADMIN
# ===========================================
@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = [
        'student_id',
        'first_name',
        'last_name',
        'gender',
        'requested_religion',
        'religious',
        'accepted_dorm_type',
        'is_assigned',
        'is_priority',
    ]
    list_filter = [
        'gender',
        'requested_religion',
        'religious',
        'accepted_dorm_type',
        'is_priority',
    ]
    search_fields = [
        'student_id',
        'business_partner_id',
        'first_name',
        'last_name',
        'email',
    ]
    readonly_fields = ['created_at', 'updated_at']

    def is_assigned(self, obj):
        return obj.assigned_room is not None
    is_assigned.boolean = True
    is_assigned.short_description = 'משובץ'

# ===========================================
# BED ASSIGNMENT ADMIN
# ===========================================
@admin.register(BedAssignment)
class BedAssignmentAdmin(admin.ModelAdmin):
    list_display = [
        'student',
        'bed',
        'status',
        'assignment_type',
        'assigned_by',
        'assigned_at',
        'ended_at',
    ]
    list_filter = [
        'status',
        'assignment_type',
        'bed__room__apartment__building__dorm_type__region',
        'assigned_by',
    ]
    search_fields = [
        'student__student_id',
        'student__first_name',
        'student__last_name',
        'bed__label',
        'bed__room__name',
    ]
    readonly_fields = ['assigned_at']
    ordering = ['-assigned_at']
# ===========================================
# MOVEMENT REQUEST ADMIN
# ===========================================
@admin.register(MovementRequest)
class MovementRequestAdmin(admin.ModelAdmin):
    list_display = [
        'student',
        'movement_type',
        'status',
        'from_assignment',
        'to_bed',
        'requested_by',
        'approved_by',
        'created_at',
        'reviewed_at',
        'completed_at',
    ]
    list_filter = [
        'movement_type',
        'status',
        'to_bed__room__apartment__building__dorm_type__region',
        'requested_by',
        'approved_by',
        'created_at',
    ]
    search_fields = [
        'student__student_id',
        'student__first_name',
        'student__last_name',
        'reason',
        'to_bed__label',
        'to_bed__room__name',
    ]
    readonly_fields = ['created_at', 'reviewed_at', 'completed_at']
    ordering = ['-created_at']

# ===========================================
# TRANSFER ADMIN
# ===========================================
@admin.register(Transfer)
class TransferAdmin(admin.ModelAdmin):
    list_display = ['student', 'from_room', 'to_room', 'status', 'requested_by', 'created_at']
    list_filter = ['status', 'student']
    search_fields = ['student__first_name', 'student__last_name', 'student__student_id']
    readonly_fields = ['created_at', 'updated_at']


# ===========================================
# ALLOCATION RUN ADMIN
# ===========================================
@admin.register(AllocationRun)
class AllocationRunAdmin(admin.ModelAdmin):
    list_display = ['region', 'run_by', 'status', 'students_processed', 'successful_assignments', 'started_at']
    list_filter = ['region', 'status']
    readonly_fields = ['started_at', 'completed_at']


# ===========================================
# IMPORT BATCH ADMIN
# ===========================================
@admin.register(ImportBatch)
class ImportBatchAdmin(admin.ModelAdmin):
    list_display = ['id', 'filename', 'uploaded_by', 'total_students', 'status', 'created_at']
    list_filter = ['status', 'created_at']
    search_fields = ['filename']
    readonly_fields = ['created_at']


# ===========================================
# REGION INBOX ADMIN
# ===========================================
@admin.register(RegionInbox)
class RegionInboxAdmin(admin.ModelAdmin):
    list_display = ['id', 'region', 'batch', 'students_count', 'status', 'created_at']
    list_filter = ['region', 'status', 'created_at']
    readonly_fields = ['created_at', 'viewed_at', 'processed_at']


# Customize admin site
admin.site.site_header = 'Dormify Admin - ניהול מעונות'
admin.site.site_title = 'Dormify'
admin.site.index_title = 'ברוכים הבאים לניהול מעונות הטכניון'