# Karppom Kalakkuvom · கற்போம், கலக்குவோம்!

An offline-first Tamil math tutor built for the Codebenders ACE Builders Hackathon. It teaches one-variable linear equations from the Tamil Nadu Class 8 Mathematics syllabus using original Tamil explanations and exercises.

- **Adaptive practice.** Follow-up questions respond to the learner's answers, including common mistakes such as subtracting from only one side of an equation.
- **Shared-device progress.** Three sample profiles keep separate histories. A learner can open a read-only Tamil summary for a parent, teacher, or volunteer.
- **Offline learning and reconnect.** After the first download, practice, authored hints, and progress work offline. Pending answers sync to SQLite on reconnect.
- **Online doubts.** Type a question or upload a photo of one equation. Review and edit the extracted equation before asking for a Tamil hint and a check question.

## Run locally

You need Python 3. Node.js and Playwright are only required for tests.

```sh
git clone https://github.com/MassGethu/Karppom-Kalakkuvom.git
cd Karppom-Kalakkuvom
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python manage.py migrate
DJANGO_DEBUG=1 python manage.py runserver 127.0.0.1:8000
```

If you already have the project, start in its folder and skip the clone. On subsequent runs, activate the virtual environment and start the server. Run migrations again after pulling changes that add migrations.

Open [the local app](http://127.0.0.1:8000/). If port 8000 is busy, check whether the app is already running there or use port 8001. Press `Ctrl+C` to stop the server.

### Enable live AI

Set `OPENAI_API_KEY` in the server's environment before starting Django. For Bash or Zsh, the following prompts for the key without displaying it or putting it in shell history:

```sh
printf 'OpenAI API key: '
IFS= read -rs OPENAI_API_KEY
printf '\n'
export OPENAI_API_KEY
DJANGO_DEBUG=1 python manage.py runserver 127.0.0.1:8000
```

`TUTOR_AI_MODEL` optionally overrides the configured model. Without a key, typed doubts receive authored Tamil fallback hints, and local practice still works. Live photo recognition needs a configured provider and connectivity. Use synthetic learner profiles and equation photos for the demo.

The local database defaults to `data/progress.sqlite3`. Set `TUTOR_SQLITE_PATH` to use another SQLite file. Keep credentials and local databases outside version control.

## Demo walkthrough

1. Open the app online and wait for the Tamil offline-ready indicator. Select a sample learner and read the worked example.
2. On the first diagnostic, choose to subtract from only one side. Follow the balance explanation and probe. Use a second profile and choose the correct operation to see a different path.
3. Try an online doubt with a clear photo containing one equation. Compare the extracted equation with the image, correct it if necessary, and request a Tamil hint.
4. Disconnect, reopen the app, and save a practice answer. Open the adult summary and return to the same activity.
5. Reconnect and check that the pending answer syncs. The sync tests verify that replay does not create duplicate rows.

## Verification

```sh
python -m pytest -q
node --test tutor/static/js/*.test.mjs
```

For browser checks, install Playwright into the virtual environment. Run the checks with the development server running. The sync check reads the server's SQLite file, so run it from the same checkout with the same `TUTOR_SQLITE_PATH` if you override the default.

```sh
python -m pip install playwright
python -m playwright install chromium
python tests/e2e/check_cold_offline.py
python tests/e2e/check_sync.py
```

The local Chromium audit verified adaptive practice, cold offline launch, separate progress, duplicate-free sync, and live Tamil hints from typed and photo doubts after equation confirmation. Some older browser scripts still assume a previous interface or outbox behavior. Photo transcription can misread symbols. Independent Tamil review, physical Android testing over HTTPS, and a full upgrade from the original Phase 1 release remain unverified.

See the [product requirements](docs/PRD.md), [architecture](docs/ARCHITECTURE.md), and [verification plan](docs/TEST_PLAN.md).
