"""Django settings for the Last-Mile Tutor vertical slice.

Minimal configuration: no database, no external services.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# DEV FALLBACK ONLY: set DJANGO_SECRET_KEY in any real deployment.
SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY",
    "dev-only-insecure-key-do-not-use-in-production",
)

# Safe default: DEBUG is off unless explicitly enabled via env var.
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"

ALLOWED_HOSTS = ["localhost", "127.0.0.1"]

INSTALLED_APPS = [
    "django.contrib.staticfiles",
    "tutor",
]

MIDDLEWARE = [
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# SQLite holds the learner progress events and installation sessions.
SQLITE_PATH = Path(os.environ.get("TUTOR_SQLITE_PATH", BASE_DIR / "data" / "progress.sqlite3"))
# Create the parent directory at import time so a fresh checkout can open the database.
os.makedirs(SQLITE_PATH.parent, exist_ok=True)

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": SQLITE_PATH,
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "ta"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"


# Online doubt tutor: one server-side provider. The API key is NOT a setting;
# tutor/ai.py reads OPENAI_API_KEY from the environment at call time.
TUTOR_AI_PROVIDER = os.environ.get("TUTOR_AI_PROVIDER", "openai")
TUTOR_AI_BASE_URL = os.environ.get("TUTOR_AI_BASE_URL", "https://api.openai.com/v1")
TUTOR_AI_MODEL = os.environ.get("TUTOR_AI_MODEL", "gpt-4o-mini")
TUTOR_AI_TIMEOUT_SECONDS = int(os.environ.get("TUTOR_AI_TIMEOUT_SECONDS", "12"))

