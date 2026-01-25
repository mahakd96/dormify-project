"""
DORMIFY - Main URL Configuration
"""

from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse


def home(request):
    return JsonResponse({
        'message': 'Dormify API is running!',
        'messageHe': 'שרת Dormify פעיל!',
        'version': '1.0.0',
        'endpoints': {
            'admin': '/admin/',
            'api': '/api/',
            'auth': '/api/auth/',
            'students': '/api/students/',
            'buildings': '/api/buildings/',
            'transfers': '/api/transfers/',
            'allocation': '/api/allocation/',
            'upload': '/api/upload/excel/',
        }
    })

urlpatterns = [
    path('', home, name='home'),
    path('admin/', admin.site.urls),
    path('api/', include('api.urls')),
]