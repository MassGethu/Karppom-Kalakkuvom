"""Views for the Last-Mile Tutor slice.

Static shell, manifest, service worker and content pack are served from
files inside the tutor app. Nothing here touches external services.
"""

from pathlib import Path

from django.conf import settings
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie

APP_DIR = Path(__file__).resolve().parent
SW_PATH = APP_DIR / "static" / "sw.js"
PACK_PATH = APP_DIR / "content" / "pack-v1.json"
PACK_V2_PATH = APP_DIR / "content" / "pack-v2.json"


@ensure_csrf_cookie
def index(request):
    """Mobile-first Tamil shell page; the app mounts into #app."""
    return render(request, "tutor/index.html", {})


def selftest(request):
    """DEBUG-only browser self-test page for the IndexedDB storage module."""
    if not settings.DEBUG:
        raise Http404
    return render(request, "tutor/selftest.html", {})


def manifest(request):
    """Minimal web app manifest (no icons yet)."""
    data = {
        "name": "இறுதி-நொடி ஆசிரியர்",
        "short_name": "ஆசிரியர்",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "lang": "ta",
        "background_color": "#ffffff",
        "theme_color": "#1d4ed8",
        "icons": [],
    }
    return JsonResponse(
        data,
        content_type="application/manifest+json",
        json_dumps_params={"ensure_ascii": False},
    )


def service_worker(request):
    """Serve sw.js from the root scope so it controls the whole app."""
    response = HttpResponse(
        SW_PATH.read_bytes(),
        content_type="application/javascript",
    )
    response["Service-Worker-Allowed"] = "/"
    response["Cache-Control"] = "no-cache"
    return response


def pack(request):
    """Serve the versioned content pack JSON."""
    response = HttpResponse(
        PACK_PATH.read_bytes(),
        content_type="application/json",
    )
    response["Cache-Control"] = "no-cache"
    return response


def pack_v2(request):
    """Serve the pack-v2 content pack JSON, same mechanism as pack()."""
    response = HttpResponse(
        PACK_V2_PATH.read_bytes(),
        content_type="application/json",
    )
    response["Cache-Control"] = "no-cache"
    return response
