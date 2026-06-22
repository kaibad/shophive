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

## Troubleshooting

The following errors were encountered during this setup. For root causes and fixes, see [TROUBLESHOOTING.md](./troubleshooting.md).

- `/entrypoint.sh: exec: python: not found`
- `connection to server at "localhost", port 5432 failed`
- `22 unapplied migration(s)`
- Backend starts before PostgreSQL is ready
- PostgreSQL healthcheck always fails
- Dockerfile changes not reflected after restart
- Django admin loads without CSS after switching to Gunicorn
