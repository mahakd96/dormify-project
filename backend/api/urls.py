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
    
    # Allocation
    path('allocation/run/', views.run_allocation, name='run-allocation'),
    path('allocation/history/', views.allocation_history, name='allocation-history'),
    
    # Include router URLs
    path('', include(router.urls)),
]
