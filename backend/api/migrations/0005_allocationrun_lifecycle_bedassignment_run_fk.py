"""
Migration 0005: Allocation lifecycle statuses + BedAssignment run FK

Adds:
  - AllocationRun.status max_length 20 → 30 (fits 'cancellation_requested')
  - AllocationRun.status new choices: queued, cancellation_requested, stopped, deleted, approved
  - BedAssignment.allocation_run FK (nullable) so cleanup can target a specific run
"""

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0004_alter_building_options_alter_room_options_and_more'),
    ]

    operations = [
        # 1. Widen the status column so 'cancellation_requested' (22 chars) fits
        migrations.AlterField(
            model_name='allocationrun',
            name='status',
            field=models.CharField(
                choices=[
                    ('queued', 'בתור'),
                    ('running', 'רץ'),
                    ('cancellation_requested', 'מבוקשת עצירה'),
                    ('stopped', 'עצר'),
                    ('completed', 'הושלם'),
                    ('failed', 'נכשל'),
                    ('deleted', 'נמחק'),
                    ('approved', 'אושר'),
                ],
                default='queued',
                max_length=30,
            ),
        ),

        # 2. Add the FK from BedAssignment → AllocationRun (nullable, SET_NULL)
        migrations.AddField(
            model_name='bedassignment',
            name='allocation_run',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='bed_assignments',
                to='api.allocationrun',
            ),
        ),
    ]
