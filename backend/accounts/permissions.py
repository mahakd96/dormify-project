from rest_framework.permissions import BasePermission


MANAGER_ROLES = {
    "central_admin",
    "region_boss",
}


class IsStaffManager(BasePermission):
    """
    Only central and regional managers can access
    the staff-management API.
    """

    message = (
        "Only a central or regional manager "
        "may manage system users."
    )

    def has_permission(self, request, view):
        user = request.user

        return bool(
            user
            and user.is_authenticated
            and getattr(user, "role", None)
            in MANAGER_ROLES
        )