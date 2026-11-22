"""Root URL configuration: delegates everything to the tutor app."""

from pathlib import Path

from django.conf import settings
from django.urls import include, path, re_path
from django.views.static import serve

urlpatterns = [
    path("", include("tutor.urls")),
    # Serves tutor/static with DEBUG off for this local single-service demo; not for production hosting.
    re_path(
        r"^static/(?P<path>.*)$",
        serve,
        {"document_root": Path(settings.BASE_DIR) / "tutor" / "static"},
        name="static",
    ),
]
