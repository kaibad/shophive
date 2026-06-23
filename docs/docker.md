# Dockerizing the Application

## Part 1: Backend, Database, and Nginx

This document covers the full containerization of the backend application, including environment configuration, multi-stage builds, service orchestration with Docker Compose, static file handling, and common troubleshooting steps.

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Environment Configuration](#environment-configuration)
3. [Entrypoint Script](#entrypoint-script)
4. [Backend Dockerfile](#backend-dockerfile)
5. [Docker Compose](#docker-compose)
6. [Nginx Configuration](#nginx-configuration)
7. [Makefile](#makefile)
8. [Architecture Overview](#architecture-overview)
9. [Static Files and Gunicorn](#static-files-and-gunicorn)
10. [Troubleshooting](#troubleshooting)

---

## Project Structure

```
project-root/
├── .env
├── compose.yml
├── Makefile
├── backend/
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── requirements.txt
│   └── ...
└── nginx/
    └── default.conf
```

---

## Environment Configuration

All environment variables are stored in a single `.env` file at the project root.

```env
# Django
SECRET_KEY=your-secret-key
DEBUG=True

# Database
POSTGRES_DB=mydb
POSTGRES_USER=myuser
POSTGRES_PASSWORD=password
POSTGRES_HOST=db
POSTGRES_PORT=5432

# Startup flags
ENABLE_MIGRATE=true
ENABLE_COLLECTSTATIC=true

DJANGO_SUPERUSER_USERNAME=admin
DJANGO_SUPERUSER_EMAIL=admin@example.com
DJANGO_SUPERUSER_PASSWORD=admin

```

**Why root-level `.env`?**

Docker Compose automatically reads `.env` from the same directory as `compose.yml`. Placing it at the root means:

- A single source of truth for all service configuration.
- No duplicated variable definitions across backend, database, or shared services.
- Simpler path management — no need to reference nested `.env` files.

---

## Entrypoint Script

`backend/entrypoint.sh` runs before the main application process. It handles database migrations and static file collection at container startup, controlled by environment flags so behaviour can be toggled without rebuilding the image.

```bash
#!/bin/sh

set -e

echo "Starting Django backend..."

if [ "$ENABLE_MIGRATE" = "true" ]; then
    echo "Running migrations..."
    python3 manage.py migrate
fi

if [ "$ENABLE_COLLECTSTATIC" = "true" ]; then
    echo "Collecting static files..."
    python3 manage.py collectstatic --noinput
fi

if [ "$DJANGO_SUPERUSER_USERNAME" != "" ]; then
    echo "Creating superuser..."
    python3 manage.py createsuperuser \
        --noinput \
        --username $DJANGO_SUPERUSER_USERNAME \
        --email $DJANGO_SUPERUSER_EMAIL || true
fi

echo "Starting server..."

exec "$@"
```

The `exec "$@"` at the end passes control to the `CMD` defined in the Dockerfile, so the entrypoint does not replace the main process — it prepares the environment for it.

---

## Backend Dockerfile

A multi-stage build is used to keep the final image lean. Dependencies are installed in a builder stage and only the compiled packages are copied into the runtime image.

```dockerfile
# Stage 1: Build dependencies
FROM python:3.13-slim AS builder
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --upgrade pip && pip install --no-cache-dir -r requirements.txt

# Stage 2: Runtime image
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
RUN useradd --create-home --shell /bin/bash appuser
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.13/site-packages/ /usr/local/lib/python3.13/site-packages/
COPY --from=builder /usr/local/bin/ /usr/local/bin/
COPY --chown=appuser:appuser . .
COPY --chown=appuser:appuser entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER appuser
EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["gunicorn", "backend.wsgi:application", "--bind", "0.0.0.0:8000"]
```

Key decisions:

- `python:3.13-slim` reduces image size by excluding unnecessary system packages.
- A non-root `appuser` is created to follow the principle of least privilege.
- `PYTHONDONTWRITEBYTECODE` and `PYTHONUNBUFFERED` are set to avoid `.pyc` files and ensure logs appear in real time.
- Gunicorn is used as the production WSGI server instead of Django's development server.

---

## Docker Compose

`compose.yml` defines three services: the PostgreSQL database, the Django backend, and Nginx.

```yaml
services:
  postgres:
    image: postgres:15-alpine
    container_name: dev_postgres
    restart: always
    env_file:
      - .env
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: django_backend
    restart: unless-stopped
    env_file:
      - .env
    environment:
      SECRET_KEY: ${SECRET_KEY}
      DEBUG: ${DEBUG}
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_HOST: ${POSTGRES_HOST}
      POSTGRES_PORT: ${POSTGRES_PORT}
    volumes:
      - ./backend:/app
      - static_volume:/app/staticfiles
      - media_volume:/app/media
    depends_on:
      postgres:
        condition: service_healthy
    expose:
      - "8000"

  nginx:
    image: nginx:alpine
    ports:
      - "8000:8000"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - static_volume:/app/staticfiles:ro
      - media_volume:/app/media:ro
    depends_on:
      - backend

volumes:
  postgres_data:
  static_volume:
  media_volume:
```

Notable configuration choices:

- The `postgres` healthcheck uses `pg_isready` to confirm the database is accepting connections before the backend starts. The `depends_on` condition `service_healthy` enforces this.
- The backend uses `expose` instead of `ports`, meaning port 8000 is reachable only within the Docker network — Nginx is the sole public entry point.
- Shared named volumes (`static_volume`, `media_volume`) allow Nginx to serve files that Django collects at startup.

---

## Nginx Configuration

`nginx/default.conf` configures Nginx as a reverse proxy and static file server.

```nginx
server {
    listen 8000;

    location /static/ {
        alias /app/staticfiles/;
    }

    location /media/ {
        alias /app/media/;
    }

    location / {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Nginx handles:

- Serving static files directly from the shared volume without hitting Django.
- Serving uploaded media files in the same way.
- Forwarding all other requests to Gunicorn over the internal Docker network.

---

## Makefile

The Makefile provides a consistent interface for common container operations.

```makefile
.PHONY: up down restart logs seed superuser shell build

up:
	docker compose up -d

down:
	docker compose down

restart:
	docker compose down && docker compose up -d

build:
	docker compose down && docker compose build --no-cache && docker compose up -d

logs:
	docker compose logs -f

seed:
	docker compose exec backend python3 seed.py

superuser:
	docker compose exec backend python3 manage.py createsuperuser

shell:
	docker compose exec backend python3 manage.py shell
```

When Dockerfile changes are made, use `make build` to force a full image rebuild. Running `make down` followed by `make up` will reuse the old cached image and changes will not take effect.

---

## Architecture Overview

```
Client
  |
  | :80
  v
Nginx
  |
  |-- /static/*  --> static_volume (served directly)
  |-- /media/*   --> media_volume  (served directly)
  |
  | internal :8000
  v
Gunicorn
  |
  v
Django
  |
  v
PostgreSQL
```

The backend container is not exposed to the host. Only Nginx is publicly accessible on port 80. Static and media files are served by Nginx directly from shared Docker volumes, bypassing the application layer entirely.

---

## Static Files and Gunicorn

### Problem

Django's built-in development server serves static files automatically. When the application was switched to Gunicorn for production, the Django admin panel lost all styling.

Gunicorn is a WSGI server — it serves the Python application only. It has no mechanism for serving static files.

The following errors appeared in container logs:

```
Not Found: /static/admin/css/base.css
Not Found: /static/admin/js/theme.js
Not Found: /static/admin/css/dashboard.css
```

### Solution

A production-grade setup was implemented by adding Nginx as a reverse proxy responsible for serving all static and media content.

**Step 1: Enable `collectstatic` in the entrypoint**

```bash
if [ "$ENABLE_COLLECTSTATIC" = "true" ]; then
    echo "Collecting static files..."
    python3 manage.py collectstatic --noinput
fi
```

Static files are gathered into `/app/staticfiles` at container startup.

**Step 2: Switch from `runserver` to Gunicorn**

```dockerfile
# Before
CMD ["python3", "manage.py", "runserver", "0.0.0.0:8000"]

# After
CMD ["gunicorn", "backend.wsgi:application", "--bind", "0.0.0.0:8000"]
```

**Step 3: Share volumes between backend and Nginx**

Both services mount the same named volumes so Nginx can read the files Django wrote:

```yaml
volumes:
  - static_volume:/app/staticfiles
  - media_volume:/app/media
```

**Step 4: Remove direct port exposure from backend**

```yaml
# Before
ports:
  - "8000:8000"

# After
expose:
  - "8000"
```

---

## Another probelem is that after building the size of the image is not that small, so i decided to use distroless/hardened image.

The core problem you started with: image size

My current image is 299MB using python:3.13-slim with multi-stage builds. I already did the right things (multi-stage, slim base, non-root user, combining mutiple run commmands) but still ended up large because python:3.13-slim still carries a lot of Debian baggage — apt, dpkg, libc utilities, shells, and hundreds of packages which i will never use.

**Why DHI fixes this**

Docker Hardened Images are built from the ground up to contain only what's needed to run our app — no package manager, no shell, no extra system utilities. This directly attacks image size from the base layer up.

The size comparison roughly looks like:

python:3.13-slim ( current)~130MB base → 299MB final

dhi.io/python:3.13-alpine3.21~20–30MB base → expected ~80–120MB final

**Why we converted entrypoint.sh to entrypoint.py**

The shell script requires /bin/sh to exist in the runtime image. But the whole point of DHI is that the runtime image has no shell — that's what makes it hardened and minimal. If we kept the .sh script, we'd be forced to use the -dev variant (which has a shell) as our runtime, and i'd lose most of the size and security benefit.

By writing the entrypoint in Python, we can use the fully stripped-down DHI runtime because Python is the one thing our app actually needs.

**The security angle**

Smaller images also mean a smaller attack surface. No shell means an attacker who gets code execution inside your container can't just run sh or bash to poke around. Near-zero CVEs means your scanner (Trivy, Docker Scout, etc.) won't flag the base image with a wall of vulnerabilities. This matters when you're deploying to production or pitching DevOps work on a CV.

**entrypoint.py**

```python
#!/usr/bin/env python3
"""
Django entrypoint — replaces entrypoint.sh
Runs migrations, collectstatic, creates superuser, then execs gunicorn.
"""
import os
import sys
import subprocess

def run(cmd):
    """Run a manage.py command, exit on failure."""
    result = subprocess.run([sys.executable, "manage.py"] + cmd)
    if result.returncode != 0:
        sys.exit(result.returncode)

def main():
    print("Starting Django backend...")

    if os.environ.get("ENABLE_MIGRATE") == "true":
        print("Running migrations...")
        run(["migrate"])

    if os.environ.get("ENABLE_COLLECTSTATIC") == "true":
        print("Collecting static files...")
        run(["collectstatic", "--noinput"])

    username = os.environ.get("DJANGO_SUPERUSER_USERNAME")
    if username:
        print("Creating superuser...")
        email = os.environ.get("DJANGO_SUPERUSER_EMAIL", "")
        # --noinput reads DJANGO_SUPERUSER_PASSWORD from env automatically
        subprocess.run(
            [sys.executable, "manage.py", "createsuperuser",
             "--noinput", "--username", username, "--email", email]
        )
        # Ignore non-zero exit (superuser may already exist)

    if os.environ.get("ENABLE_SEED") == "true":          
        print("Seeding database...")
        run(["shell", "--command", "exec(open('seed.py').read())"])

    print("Starting server...")
    # exec() replaces this process entirely — PID 1 becomes gunicorn
    # argv[1:] forwards whatever CMD passes in (e.g. gunicorn args)
    args = sys.argv[1:]
    if not args:
        args = ["gunicorn", "backend.wsgi:application", "--bind", "0.0.0.0:8000"]

    os.execvp(args[0], args)

if __name__ == "__main__":
    main()

```

```Dockerfile

# ============================================================
# Stage 1: Builder
# ============================================================
FROM dhi.io/python:3.13-alpine3.21-dev AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/venv/bin:$PATH"

WORKDIR /app

RUN python -m venv /app/venv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ============================================================
# Stage 2: Runtime — fully hardened, distroless-style
# nonroot (UID 65532) by default
# ca-certificates included
# Near-zero CVEs
# ============================================================
FROM dhi.io/python:3.13-alpine3.21

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/venv/bin:$PATH"

WORKDIR /app

# Venv from builder (all deps, self-contained)
COPY --from=builder /app/venv /app/venv

# App source + Python entrypoint (no shell needed)
COPY --chown=65532:65532 . .
COPY --chown=65532:65532 entrypoint.py /entrypoint.py

# Clean up any cached bytecode from the COPY
RUN find /app -type f -name "*.pyc" -delete \
    && find /app -type d -name "__pycache__" -delete

USER 65532

EXPOSE 8000

# Python directly as PID 1 — no shell wrapper
ENTRYPOINT ["python", "/entrypoint.py"]
CMD ["gunicorn", "backend.wsgi:application", "--bind", "0.0.0.0:8000"]

```

- os.execvp(args[0], args) at the end is the Python equivalent of exec "$@" in your shell script — it replaces the current process rather than spawning a child, so gunicorn becomes PID 1 directly. This means signals (SIGTERM, SIGINT) go straight to gunicorn, which is correct behavior for containers.

- sys.executable is used instead of hardcoding python3 — it always points to the exact Python binary that's running the entrypoint, so it correctly uses the venv's Python when calling manage.py.

- The ENTRYPOINT ["python", "/entrypoint.py"] with CMD ["gunicorn", ...] means CMD args are forwarded as sys.argv[1:] into the entrypoint, same pattern as your old exec "$@".

**What we did:**

- Switched base image from python:3.13-slim to dhi.io/python:3.13-alpine3.21 (Docker Hardened Image)

- Converted entrypoint.sh to entrypoint.py because DHI runtime has no shell (/bin/sh), so shell scripts can't run

- Used venv pattern instead of copying /usr/local/lib and /usr/local/bin — cleaner and self-contained copy to runtime stage

- Added ENABLE_SEED to entrypoint so database seeding is controlled via .env

- Removed bind mount ./backend:/app from compose — it was overwriting the venv built inside the image at runtime


**Why:**

- Size — went from 299MB → 205MB by using a minimal hardened base

- Security — no shell, no pip, no package manager in runtime = smaller attack surface, near-zero CVEs

- DHI runtime has no shell — any RUN command or .sh script fails, so everything that needs a shell must happen in the builder stage

- Bind mount was killing the container — Docker was mounting the empty host ./backend folder over /app, wiping the venv that was built inside the image, so gunicorn couldn't start → nginx got no response → 502

---

## Troubleshooting

The following errors were encountered during this setup. For root causes and fixes, see [TROUBLESHOOTING.md](./troubleshooting.md).

- `/entrypoint.sh: exec: python: not found`
- `connection to server at "localhost", port 5432 failed`
- `22 unapplied migration(s)`
- Backend starts before PostgreSQL is ready
- PostgreSQL healthcheck always fails
- Dockerfile changes not reflected after restart
- Django admin loads without CSS after switching to Gunicorn
