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
router.register(r'apartments', views.ApartmentViewSet, basename='apartment')
router.register(r'rooms', views.RoomViewSet, basename='room')
router.register(r'beds', views.BedViewSet, basename='bed')
router.register(r'students', views.StudentViewSet, basename='student')
router.register(r'transfers', views.TransferViewSet, basename='transfer')
router.register(r'requests', views.StudentRequestViewSet, basename='student-request')

urlpatterns = [
    # Authentication
    path('auth/login/', views.login_view, name='login'),
    # G3-01: public self-registration removed - see accounts.urls
    # (/api/staff-users/) for the authorized staff-creation path.
    path('auth/refresh/', views.refresh_view, name='token-refresh'),
    path('auth/logout/', views.logout_view, name='logout'),
    path('auth/me/', views.me_view, name='me'),
    path('auth/change-password/', views.change_password_view, name='change-password'),
    path('auth/change-email/', views.change_email_view, name='change-email'),
    # Statistics
    path('statistics/', views.statistics, name='statistics'),

    # Operational homepage (post-login landing page)
    path('home/', views.home_dashboard, name='home-dashboard'),

    # Excel Upload & Split
    path('upload/excel/', views.upload_excel, name='upload-excel'),
    path('upload/additions-excel/', views.upload_additions_excel, name='upload-additions-excel'),
    path('batches/', views.list_batches, name='list-batches'),

    # Upload batch lifecycle (init handshake + status/stop/delete controls)
    path('upload/batches/init/', views.init_import_batch, name='init-import-batch'),
    path('upload/batches/<int:batch_id>/status/', views.get_import_batch_status, name='import-batch-status'),
    path('upload/batches/<int:batch_id>/stop/', views.stop_import_batch, name='import-batch-stop'),
    path(
        'upload/batches/<int:batch_id>/stop-and-delete/',
        views.stop_and_delete_import_batch,
        name='import-batch-stop-and-delete',
    ),
    path('upload/batches/<int:batch_id>/delete/', views.delete_import_batch, name='import-batch-delete'),

    # Region Inbox
    path('inbox/', views.region_inbox, name='region-inbox'),
    path('inbox/latest/', views.region_inbox_latest, name='region-inbox-latest'),
    path('inbox/<int:inbox_id>/viewed/', views.mark_inbox_viewed, name='mark-inbox-viewed'),
    path('inbox/<int:inbox_id>/processed/', views.mark_inbox_processed, name='mark-inbox-processed'),

    # Allocation - legacy synchronous endpoint (kept for backward compat)
    path('allocation/run/', views.run_allocation, name='run-allocation'),
    path('allocation/history/', views.allocation_history, name='allocation-history'),
    path('allocation/summary/', views.allocation_summary, name='allocation-summary'),
    path('allocation/results/', views.allocation_results, name='allocation-results'),

    # Allocation lifecycle (async: start → poll → preview / stop-and-save / cancel / delete)
    path('allocation/start/', views.start_allocation_run, name='allocation-start'),
    path('allocation/runs/active/', views.get_active_allocation_run, name='allocation-active-run'),
    path('allocation/runs/<int:run_id>/', views.get_allocation_run_detail, name='allocation-run-detail'),
    path(
        'allocation/runs/<int:run_id>/preview/',
        views.get_allocation_run_preview,
        name='allocation-run-preview',
    ),
    path('allocation/runs/<int:run_id>/stop/', views.stop_allocation_run, name='allocation-run-stop'),
    path(
        'allocation/runs/<int:run_id>/stop-and-save/',
        views.stop_and_save_allocation_run,
        name='allocation-run-stop-and-save',
    ),
    path('allocation/runs/<int:run_id>/delete/', views.delete_allocation_run, name='allocation-run-delete'),
    path(
        'allocation/runs/<int:run_id>/retry-unassigned/',
        views.retry_unassigned_allocation_run,
        name='allocation-run-retry-unassigned',
    ),
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
    # What-If Availability Control: buildings, apartments, rooms
    path(
        'what-if/availability/simulate/',
        views.what_if_availability_simulate,
        name='what-if-availability-simulate'
    ),
    path(
        'what-if/availability/confirm/',
        views.what_if_availability_confirm,
        name='what-if-availability-confirm'
    ),

    # Manual room assignment actions used by BuildingsPage
    path('room-assignments/assign/', views.assign_student_room, name='assign-student-room'),
    path('room-assignments/move/', views.move_student_room, name='move-student-room'),
    path('room-assignments/unassign/', views.unassign_student_room, name='unassign-student-room'),
    path('room-assignments/swap/', views.swap_students_rooms, name='swap-students-rooms'),

    # Assisted Allocation workbench (accessibility + unassigned students)
    path('assisted-allocation/queue/', views.assisted_allocation_queue, name='assisted-allocation-queue'),
    path(
        'assisted-allocation/students/<int:pk>/detail/',
        views.assisted_allocation_student_detail,
        name='assisted-allocation-student-detail',
    ),
    path(
        'assisted-allocation/students/<int:pk>/recommendations/',
        views.assisted_allocation_recommendations,
        name='assisted-allocation-recommendations',
    ),
    path(
        'assisted-allocation/students/<int:pk>/override-check/',
        views.assisted_allocation_override_check,
        name='assisted-allocation-override-check',
    ),
    path(
        'assisted-allocation/students/<int:pk>/assign/',
        views.assisted_allocation_assign,
        name='assisted-allocation-assign',
    ),
    path(
        'assisted-allocation/students/<int:pk>/override/',
        views.assisted_allocation_override,
        name='assisted-allocation-override',
    ),

    # Reports
    path('reports/dormify-report/',            views.dormify_report,            name='dormify-report'),
    path('reports/student-allocation-report/', views.student_allocation_report, name='student-allocation-report'),
    path('reports/student-actions-report/',    views.student_actions_report,    name='student-actions-report'),
    path('reports/capacity-report/',           views.capacity_report,           name='capacity-report'),
    path('reports/manual-review-report/',      views.manual_review_report,      name='manual-review-report'),

    # ViewSet routes
    path('', include(router.urls)),
]
