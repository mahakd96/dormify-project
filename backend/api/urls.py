"""
DORMIFY - API URLs
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'regions', views.RegionViewSet, basename='region')
router.register(r'dorm-types', views.DormTypeViewSet, basename='dorm-type')
router.register(r'buildings', views.BuildingViewSet, basename='building')
router.register(r'students', views.StudentViewSet, basename='student')
router.register(r'transfers', views.TransferViewSet, basename='transfer')

urlpatterns = [
    # Authentication
    path('auth/login/', views.login_view, name='login'),
    path('auth/register/', views.register_view, name='register'),
    path('auth/me/', views.me_view, name='me'),
    path('auth/change-password/', views.change_password_view, name='change-password'),

    # Statistics
    path('statistics/', views.statistics, name='statistics'),

    # Excel Upload & Split
    path('upload/excel/', views.upload_excel, name='upload-excel'),
    path('upload/additions-excel/', views.upload_additions_excel, name='upload-additions-excel'),
    path('batches/', views.list_batches, name='list-batches'),

    # Region Inbox
    path('inbox/', views.region_inbox, name='region-inbox'),
    path('inbox/latest/', views.region_inbox_latest, name='region-inbox-latest'),
    path('inbox/<int:inbox_id>/viewed/', views.mark_inbox_viewed, name='mark-inbox-viewed'),
    path('inbox/<int:inbox_id>/processed/', views.mark_inbox_processed, name='mark-inbox-processed'),

    # Allocation
    path('allocation/run/', views.run_allocation, name='run-allocation'),
    path('allocation/history/', views.allocation_history, name='allocation-history'),
    path('allocation/summary/', views.allocation_summary, name='allocation-summary'),
    path('allocation/results/', views.allocation_results, name='allocation-results'),
    path('analysis/', views.analysis_data, name='analysis'),

    # What-If Building Inactivation
    path(
        'what-if/building-inactivation/simulate/',
        views.what_if_building_inactivation_simulate,
        name='what-if-building-inactivation-simulate'
    ),
    path(
        'what-if/building-inactivation/confirm/',
        views.what_if_building_inactivation_confirm,
        name='what-if-building-inactivation-confirm'
    ),

    # Manual room assignment actions used by BuildingsPage
    path('room-assignments/assign/', views.assign_student_room, name='assign-student-room'),
    path('room-assignments/move/', views.move_student_room, name='move-student-room'),
    path('room-assignments/unassign/', views.unassign_student_room, name='unassign-student-room'),
    path('room-assignments/swap/', views.swap_students_rooms, name='swap-students-rooms'),

    # ViewSet routes
    path('', include(router.urls)),
]
