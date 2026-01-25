"""
DORMIFY - Admin Configuration
This gives you a FREE admin panel!
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import (
    User, Region, Building, Apartment, Room, Student,
    Transfer, AllocationRun, ImportBatch, RegionInbox
)


# ===========================================
# USER ADMIN
# ===========================================
@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ['email', 'first_name', 'last_name', 'role', 'region', 'is_active']
    list_filter = ['role', 'region', 'is_active']
    search_fields = ['email', 'first_name', 'last_name']
    ordering = ['email']

    fieldsets = BaseUserAdmin.fieldsets + (
        ('Role & Region', {'fields': ('role', 'region', 'phone')}),
    )


# ===========================================
# REGION ADMIN
# ===========================================
@admin.register(Region)
class RegionAdmin(admin.ModelAdmin):
    list_display = ['id', 'name', 'name_en', 'is_active']
    search_fields = ['name', 'name_en']


# ===========================================
# BUILDING ADMIN
# ===========================================
@admin.register(Building)
class BuildingAdmin(admin.ModelAdmin):
    list_display = ['name', 'region', 'floors', 'apartments_per_floor', 'is_active']
    list_filter = ['region', 'is_active']
    search_fields = ['name']


# ===========================================
# APARTMENT ADMIN
# ===========================================
@admin.register(Apartment)
class ApartmentAdmin(admin.ModelAdmin):
    list_display = ['number', 'building', 'floor', 'room_count', 'is_reserved', 'is_active']
    list_filter = ['building__region', 'building', 'is_reserved', 'is_active']
    search_fields = ['number']


# ===========================================
# ROOM ADMIN
# ===========================================
@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ['name', 'apartment', 'capacity', 'current_occupancy', 'is_active']
    list_filter = ['apartment__building__region', 'apartment__building', 'is_active']
    search_fields = ['name']


# ===========================================
# STUDENT ADMIN
# ===========================================
@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = ['student_id', 'first_name', 'last_name', 'gender', 'religion', 'region', 'is_assigned', 'is_priority']
    list_filter = ['region', 'gender', 'religion', 'is_priority']
    search_fields = ['student_id', 'first_name', 'last_name', 'email']

    def is_assigned(self, obj):
        return obj.assigned_room is not None
    is_assigned.boolean = True
    is_assigned.short_description = 'משובץ'


# ===========================================
# TRANSFER ADMIN
# ===========================================
@admin.register(Transfer)
class TransferAdmin(admin.ModelAdmin):
    list_display = ['student', 'from_room', 'to_room', 'status', 'requested_by', 'created_at']
    list_filter = ['status', 'student__region']
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