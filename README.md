# Karppom Kalakkuvom · கற்போம், கலக்குவோம்!

An offline-first Tamil math tutor built for the Codebenders ACE Builders Hackathon. It teaches one-variable linear equations from the Tamil Nadu Class 8 Mathematics syllabus using original Tamil explanations and exercises.

- Practice works offline after the first download. The app adapts follow-up questions to learners' answers and stores progress separately for three sample profiles on a shared device.
- The learner can open a read-only Tamil progress summary for a parent, teacher, or volunteer. Pending answers sync to SQLite on reconnect.
- When online, learners can ask a typed doubt or submit a synthetic equation photo. They confirm the extracted equation before requesting a Tamil hint. Authored help is available when the provider is unavailable.

## Run locally

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python manage.py migrate
DJANGO_DEBUG=1 python manage.py runserver
```

Open [the local app](http://127.0.0.1:8000/). Wait for offline readiness before disconnecting. Use localhost for development or HTTPS on a phone.

Set `OPENAI_API_KEY` in the server environment to enable live text and photo requests. `TUTOR_AI_MODEL` overrides the default model. Use synthetic learners and equation photos for demonstrations. The development server's SQLite database is kept in `data/` by default. Set `TUTOR_SQLITE_PATH` to use another location.

## Verify

```sh
python -m pytest -q
node --test tutor/static/js/*.test.mjs
```

For browser checks, install Playwright and Chromium, then run these commands while the development server is running.

```sh
python -m pip install playwright
python -m playwright install chromium
python tests/e2e/check_cold_offline.py
python tests/e2e/check_sync.py
python tests/e2e/check_doubt.py
```

Set `LIVE_PROVIDER=1` when running the doubt check to include the live provider path. Independent Tamil review and physical Android testing over HTTPS remain pending.

See the [project requirements](docs/PRD.md), [architecture](docs/ARCHITECTURE.md), and [verification plan](docs/TEST_PLAN.md).
