"""
DORMIFY - API URLs
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

# Create router for ViewSets
router = DefaultRouter()
router.register(r'regions', views.RegionViewSet, basename='region')
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
    path('api/allocation/results/', views.allocation_results),

    # Include router URLs
    path('', include(router.urls)),
]
