from django.contrib.auth import get_user_model

from rest_framework import generics
from rest_framework.permissions import (
    IsAuthenticated,
)
from .permissions import IsStaffManager
from .serializers import StaffUserSerializer
from api.throttling import StaffCreateRateThrottle


User = get_user_model()


class StaffUserListCreateView(
    generics.ListCreateAPIView
):
    serializer_class = StaffUserSerializer

    permission_classes = [
        IsAuthenticated,
        IsStaffManager,
    ]

    # G3-10: throttle account creation specifically - this is the only
    # remaining account-creation endpoint since G3-01 removed public
    # /auth/register/. GET (list) is unaffected: throttle_classes here
    # applies to the whole view, but StaffCreateRateThrottle's rate is
    # generous enough (see DEFAULT_THROTTLE_RATES) that normal list
    # polling is not affected in practice; only sustained bulk POSTs would
    # approach it.
    throttle_classes = [StaffCreateRateThrottle]

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
