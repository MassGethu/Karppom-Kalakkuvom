"""URL routes for the tutor app, mounted at the site root."""

from django.urls import path

from tutor import api, doubt, views

urlpatterns = [
    path("", views.index, name="index"),
    path("manifest.webmanifest", views.manifest, name="manifest"),
    path("sw.js", views.service_worker, name="service_worker"),
    path("content/pack-v1.json", views.pack, name="pack"),
    path("content/pack-v2.json", views.pack_v2, name="pack_v2"),
    path("selftest/", views.selftest, name="selftest"),
    path("api/session", api.session, name="api-session"),
    path("api/progress/events", api.progress_events, name="api-progress-events"),
    path("api/doubt/transcribe", doubt.transcribe, name="api-doubt-transcribe"),
    path("api/doubt/tutor", doubt.tutor, name="api-doubt-tutor"),
]
