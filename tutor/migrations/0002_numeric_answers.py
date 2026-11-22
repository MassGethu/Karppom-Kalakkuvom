"""Allow numeric answers: step_id becomes nullable and value is added.

Existing choice rows keep their step_id and get value NULL.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tutor", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="progressevent",
            name="step_id",
            field=models.CharField(blank=True, max_length=64, null=True),
        ),
        migrations.AddField(
            model_name="progressevent",
            name="value",
            field=models.IntegerField(blank=True, null=True),
        ),
    ]
