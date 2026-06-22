# Troubleshooting

This is the central troubleshooting reference for the project. Each section corresponds to a phase of the DevOps setup. Errors are organized by topic so new entries can be added under the relevant section as the project grows.

---

## Table of Contents

- [Docker](#docker)
  - [Backend and Database](#backend-and-database)
  - [Frontend](#frontend)
- [CI/CD](#cicd)
- [Kubernetes](#kubernetes)
- [Infrastructure](#infrastructure)

---

## Docker

### Backend and Database

#### `exec: python: not found`

**Full error:** `/entrypoint.sh: 22: exec: python: not found`

**Cause:** The `python:3.13-slim` image does not include a `python` binary — only `python3`. Any command using `python` directly will fail.

**Fix:** Replace all occurrences of `python` with `python3` in `Dockerfile`, `entrypoint.sh`, and `Makefile`. Then rebuild the image:

```bash
docker compose build --no-cache
```

---

#### `connection to server at "localhost", port 5432 failed`

**Cause:** Inside a Docker container, `localhost` refers to the container itself — not to any other service. Django was attempting to connect to PostgreSQL on its own loopback interface, where nothing was listening.

**Fix:** Set `POSTGRES_HOST` in `.env` to the Compose service name:

```env
POSTGRES_HOST=postgres
```

Docker Compose automatically resolves service names to their internal IP addresses over the shared network.

---

#### `22 unapplied migration(s)`

**Cause:** The database tables had not been created because migrations were never executed.

**Fix:** Set the migration flag in `.env` and restart the containers:

```env
ENABLE_MIGRATE=true
```

The entrypoint script will run `python3 manage.py migrate` on the next startup.

---

#### Backend starts before PostgreSQL is ready

**Cause:** `depends_on` in Docker Compose only controls the start order of containers. It does not wait for the service inside the container to be ready to accept connections.

**Fix:** Add a healthcheck to the `postgres` service and configure the backend to wait for it:

```yaml
postgres:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 30s

backend:
  depends_on:
    postgres:
      condition: service_healthy
```

---

#### PostgreSQL healthcheck always fails

**Cause:** Typo in the healthcheck command — `pg_isredy` instead of `pg_isready`.

**Fix:** Correct the command:

```yaml
test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
```

---

#### Dockerfile changes not reflected after restart

**Cause:** Running `docker compose down` followed by `docker compose up` does not rebuild the image. Docker reuses the previously cached image, so any changes to the `Dockerfile` or application code are not picked up.

**Fix:** Use the `build` target from the Makefile, which forces a full rebuild:

```bash
make build
```

This runs `docker compose down && docker compose build --no-cache && docker compose up -d`.

---

#### Django admin loads without CSS after switching to Gunicorn

**Cause:** Gunicorn is a WSGI server — it serves only the Python application. Unlike Django's development server, it has no mechanism for serving static files. After switching to Gunicorn, requests to `/static/` returned 404.

**Fix:** Add Nginx to serve static and media files directly from shared volumes. See the [Static Files and Gunicorn](./docker.md#static-files-and-gunicorn) section in the main documentation for the full implementation.

---

## Django

#### CSRF verification failed — Origin checking failed

**Full error:**
```
Forbidden (403)
CSRF verification failed. Request aborted.
Origin checking failed - http://localhost:8000 does not match any trusted origins.
```

**Cause:** Since Django 4.0, `ALLOWED_HOSTS` alone is not sufficient for CSRF validation. When a request passes through Nginx, Django sees the origin as `http://localhost:8000` and rejects it unless that origin is explicitly listed in `CSRF_TRUSTED_ORIGINS`.

**Fix:** Add `CSRF_TRUSTED_ORIGINS` to `settings.py`, driven by an environment variable so it works across environments without code changes:

```python
CSRF_TRUSTED_ORIGINS = os.environ.get(   
    "CSRF_TRUSTED_ORIGINS", "http://localhost,http://localhost:8000"
).split(",")
```

In `.env`:

```env
CSRF_TRUSTED_ORIGINS=http://localhost,http://localhost:8000
```  

When deploying to a real domain, update `.env` only:

```env
CSRF_TRUSTED_ORIGINS=https://yourdomain.com
```
---

### Frontend

> Coming Soon..!!

---

## CI/CD

> Coming Soon..!!

---

## Kubernetes

> Coming Soon..!!

---

## Infrastructure

> Coming Soon..!!
