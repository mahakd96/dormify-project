from django.contrib.auth import get_user_model

from rest_framework import serializers


User = get_user_model()


class StaffUserSerializer(
    serializers.ModelSerializer
):
    name = serializers.CharField(
        write_only=True,
        required=True,
        max_length=255,
    )

    regionId = serializers.CharField(
        source="region_id",
        required=False,
        allow_null=True,
        allow_blank=True,
    )

    regionName = (
        serializers.SerializerMethodField()
    )

    regionNameEn = (
        serializers.SerializerMethodField()
    )

    password = serializers.CharField(
        write_only=True,
        required=True,
        min_length=8,
        trim_whitespace=False,
    )

    class Meta:
        model = User

        fields = (
            "id",
            "name",
            "email",
            "password",
            "role",
            "regionId",
            "regionName",
            "regionNameEn",
        )

        read_only_fields = (
            "id",
            "regionName",
            "regionNameEn",
        )

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # 'name' is write_only so super() omits it; inject the read-facing value.
        data["name"] = instance.get_full_name() or instance.email
        return data

    def get_regionName(self, user):
        region = getattr(
            user,
            "region",
            None,
        )

        if region is None:
            return None

        return getattr(
            region,
            "name",
            None,
        )

    def get_regionNameEn(self, user):
        region = getattr(
            user,
            "region",
            None,
        )

        if region is None:
            return None

        return (
            getattr(region, "name_en", None)
            or getattr(
                region,
                "nameEn",
                None,
            )
            or getattr(
                region,
                "name",
                None,
            )
        )

    def validate_email(self, email):
        normalized_email = (
            email.strip().lower()
        )

        email_exists = User.objects.filter(
            email__iexact=normalized_email
        ).exists()

        if email_exists:
            raise serializers.ValidationError(
                "A user with this email "
                "address already exists."
            )

        return normalized_email

    def validate(self, attributes):
        # Convert 'name' → first_name / last_name for the User model.
        raw_name = attributes.pop("name", "").strip()
        parts = raw_name.split(" ", 1)
        attributes["first_name"] = parts[0]
        attributes["last_name"] = parts[1] if len(parts) > 1 else ""

        request = self.context["request"]
        current_manager = request.user

        requested_role = attributes.get(
            "role"
        )

        requested_region_id = attributes.get(
            "region_id"
        )

        manager_role = getattr(
            current_manager,
            "role",
            None,
        )

        if manager_role == "region_boss":
            if requested_role != "employee":
                raise serializers.ValidationError(
                    {
                        "role": (
                            "A regional manager "
                            "may create employee "
                            "accounts only."
                        )
                    }
                )

            manager_region_id = getattr(
                current_manager,
                "region_id",
                None,
            )

            if manager_region_id is None:
                raise serializers.ValidationError(
                    (
                        "The regional manager "
                        "is not assigned to a region."
                    )
                )

            # Never trust the region sent by
            # the frontend for a regional manager.
            attributes["region_id"] = (
                manager_region_id
            )

        elif requested_role == "central_admin":
            attributes["region_id"] = None

        elif not requested_region_id:
            raise serializers.ValidationError(
                {
                    "regionId": (
                        "A region is required "
                        "for this role."
                    )
                }
            )

        return attributes

    def create(self, validated_data):
        password = validated_data.pop(
            "password"
        )

        model_field_names = {
            field.name
            for field
            in User._meta.get_fields()
        }

        # Necessary when the project uses
        # AbstractUser and still has username.
        if (
            "username" in model_field_names
            and not validated_data.get(
                "username"
            )
        ):
            validated_data["username"] = (
                validated_data["email"]
            )

        user = User(**validated_data)

        # Never store a raw password.
        user.set_password(password)

        user.save()

        return user