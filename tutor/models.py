"""Persistence for installation sessions and learner progress events."""

import secrets

from django.db import models


def new_installation_id():
    """Server-generated installation identifier (32 hex characters)."""
    return secrets.token_hex(16)


class Installation(models.Model):
    """One browser installation. Only the SHA-256 of its token is stored."""

    id = models.CharField(primary_key=True, max_length=32, default=new_installation_id)
    token_hash = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "tutor_installation"


class ProgressEvent(models.Model):
    """One learner answer event replayed from the client outbox."""

    installation = models.ForeignKey(Installation, on_delete=models.CASCADE)
    event_id = models.CharField(max_length=64)
    profile_id = models.CharField(max_length=32)
    sequence = models.PositiveIntegerField()
    item_id = models.CharField(max_length=16)
    instance_id = models.CharField(max_length=64)
    # Choice events carry step_id; numeric events carry value. Exactly one is set.
    step_id = models.CharField(max_length=64, null=True, blank=True)
    value = models.IntegerField(null=True, blank=True)
    correct = models.BooleanField()
    assistance = models.CharField(max_length=16)
    reason_code = models.CharField(max_length=32)
    pack_version = models.CharField(max_length=4)
    policy_version = models.CharField(max_length=4)
    created_at_client = models.CharField(max_length=40)
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "tutor_progress_event"
        constraints = [
            models.UniqueConstraint(
                fields=["installation", "event_id"],
                name="uniq_install_event",
            ),
            models.UniqueConstraint(
                fields=["installation", "profile_id", "sequence"],
                name="uniq_install_profile_sequence",
            ),
        ]
