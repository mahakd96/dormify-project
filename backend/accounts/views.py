from django.contrib.auth import get_user_model

from rest_framework import generics
from rest_framework.permissions import (
    IsAuthenticated,
)
from .permissions import IsStaffManager
from .serializers import StaffUserSerializer


User = get_user_model()


class StaffUserListCreateView(
    generics.ListCreateAPIView
):
    serializer_class = StaffUserSerializer

    permission_classes = [
        IsAuthenticated,
        IsStaffManager,
    ]

    def get_queryset(self):
        queryset = (
            User.objects
            .select_related("region")
            .order_by("first_name", "last_name", "email")
        )

        current_manager = self.request.user

        manager_role = getattr(
            current_manager,
            "role",
            None,
        )

        if manager_role == "central_admin":
            return queryset

        manager_region_id = getattr(
            current_manager,
            "region_id",
            None,
        )

        return (
            queryset
            .filter(
                region_id=manager_region_id
            )
            .exclude(
                role="central_admin"
            )
        )
