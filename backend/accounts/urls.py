from django.urls import path

from .views import StaffUserListCreateView


urlpatterns = [
    path(
        "staff-users/",
        StaffUserListCreateView.as_view(),
        name="staff-user-list-create",
    ),

]