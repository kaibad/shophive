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
11. [Hardened/Distroless Images](#hardeneddistroless-images)
12. [Image Scanning and Pushing to Docker Hub](#image-scanning-and-pushing-to-docker-hub)
13. [Push to Registry](#push-to-registry)
14. [`.dockerignore`](#dockerignore)
15. [Troubleshooting](#troubleshooting)



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

## Hardened/Distroless Images

**Another probelem is that after building the size of the image is not that small, so i decided to use distroless/hardened image.**

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

## Image Scanning and pushing to dockerhub

**scan**
```bash
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy image shophive-backend:latest
```
**add below in the backend/Dockerfile**
```bash
# remove pip
pip uninstall pip -y    # remove pip from venv after installing deps
```

### Push to registry

```bash
# Tag with your Docker Hub username
docker tag shophive-backend:latest kailashbadu/shophive-backend:latest

# Login
docker login

# Push
docker push kailashbadu/shophive-backend:latest
```
---
## .dockerignore

A .dockerignore file was missing in the previous setup. After adding it, the Docker image size was reduced by approximately 20 MB, resulting in a smaller and more efficient build.

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

---
## Part 2: Dockerizing Frontend

This section explains how to containerize the React (Vite) frontend application and integrate it with the Django backend using Docker Compose.

The frontend setup uses:

* **Node.js Alpine** image to build the React application
* **Nginx Alpine** image to serve the production build
* **Docker Compose** to connect frontend, backend, database, and Nginx services

---

### 1. Frontend Dockerfile

The Dockerfile uses a multi-stage build:

1. Build the React application using Node.js.
2. Serve the generated static files using Nginx.

```Dockerfile
# =========================================
# Stage 1: Build React (Vite) Application
# =========================================
ARG NODE_VERSION=24.14.0-alpine
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
ARG VITE_DJANGO_BASE_URL
RUN npm run build

# =========================================
# Stage 2: Serve with nginx
# =========================================
FROM nginx:alpine AS runner
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```
---

### 2. Nginx Configuration

Create:

```
nginx/default.conf
```

```nginx
server {
    listen 80;

    location / {
        proxy_pass http://frontend:80;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
**explanation**

The Nginx container acts as the entry point.

Traffic flow:

```
Browser
   |
   |
   v
Nginx :80
   |
   |
   v
React Frontend Container
```

The `proxy_pass` directive forwards requests to the frontend service.

---

### 3. Frontend Docker Compose Service

```yaml
frontend:
  build:
    context: ./frontend
    dockerfile: Dockerfile
    args:
      VITE_DJANGO_BASE_URL: ${VITE_DJANGO_BASE_URL}
  container_name: react_frontend
  restart: unless-stopped
  env_file:
    - .env
  environment:
    VITE_DJANGO_BASE_URL: ${VITE_DJANGO_BASE_URL}
  expose:
    - "80"
  depends_on:
    - backend
```

---
### Image Scanning and pushing to dockerhub

**scan**
```bash
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy image shophive-frontend:latest
```

### Push to registry

```bash
# Tag with your Docker Hub username
docker tag shophive-frontend:latest kailashbadu/shophive-frontend:latest

# Login
docker login

# Push
docker push kailashbadu/shophive-frontend:latest
```


##  Complete Docker Compose Configuration (Dev)

The final `compose.yml` connects:

* PostgreSQL database
* Django backend
* React frontend
* Nginx reverse proxy

```yaml
services:
  postgres:
    image: postgres:15-alpine
    container_name: dev_postgres
    restart: always
    env_file:
      - .env
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL","pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  volume-init:
    image: busybox
    container_name: volume_init
    user: root
    command:
      [
        "sh",
        "-c",
        "chown -R 65532:65532 /app/media /app/staticfiles"
      ]
    volumes:
      - static_volume:/app/staticfiles
      - media_volume:/app/media
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
      DB_NAME: ${DB_NAME}
      DB_USER: ${DB_USER}
      DB_PASSWORD: ${DB_PASSWORD}
      DB_HOST: ${DB_HOST}
      DB_PORT: ${DB_PORT}
    volumes:
      - static_volume:/app/staticfiles
      - media_volume:/app/media
    depends_on:
      postgres:
        condition: service_healthy
      volume-init:
        condition: service_completed_successfully
    expose:
      - "8000"
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        VITE_DJANGO_BASE_URL: ${VITE_DJANGO_BASE_URL}
    container_name: react_frontend
    restart: unless-stopped
    env_file:
      - .env
    environment:
      VITE_DJANGO_BASE_URL:
        ${VITE_DJANGO_BASE_URL}
    expose:
      - "80"
    depends_on:
      - backend
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "8000:8000"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - static_volume:/app/staticfiles:ro
      - media_volume:/app/media:ro
    depends_on:
      - frontend
      - backend
volumes:
  postgres_data:
  static_volume:
  media_volume:
```

---

## Application Architecture (Dev)

After starting the containers:

```
                    Browser
                       |
                       |
                       v
                 Nginx Container
                  Ports 80/8000
                       |
          -----------------------------
          |                           |
          v                           v

 React Frontend                 Django Backend
  nginx:alpine                  gunicorn/django

                                      |
                                      |
                                      v

                              PostgreSQL Database


Static Files  ---> static_volume
Media Files   ---> media_volume
Database      ---> postgres_data
```

---

## Accessing Services

| Service        | URL                     |
| -------------- | ----------------------- |
| React Frontend | `http://localhost`      |
| Django Backend | `http://localhost:8000` |
| PostgreSQL     | `localhost:5432`        |

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
- Permission Denied on Docker Volume (`/app/media`, `/app/staticfiles`)
- React Frontend Refresh 404 Error (Docker + Nginx)


---

# Production Deployment

This document covers deploying ShopHive to a production server (AWS EC2) using pre-built Docker images from Docker Hub.

---

## Architecture Overview

```
Browser
   |
   | :80 (frontend + API)
   | :8000 (backend API direct)
   v
Nginx (reverse proxy)
   |
   |-- /api/*      --> Django Backend (internal :8000)
   |-- /admin/*    --> Django Backend (internal :8000)
   |-- /static/*   --> static_volume (served directly)
   |-- /media/*    --> media_volume (served directly)
   |-- /*          --> React Frontend (internal :80)
         |
         v
   React Frontend Container
         |
         v (relative /api/* calls)
   Django Backend (Gunicorn)
         |
         v
   PostgreSQL Database
```

Key decisions:
- Nginx is the single public entry point on ports 80 and 8000.
- The frontend calls `/api/...` as a relative URL — no hardcoded IP or port.
- Nginx on port 80 proxies `/api/`, `/admin/`, `/media/`, `/static/` to the backend and serves everything else from the React container.
- Backend and frontend containers are never directly exposed to the internet.

---

## Server Setup

### Requirements

- Ubuntu 22.04 or later
- Docker and Docker Compose installed
- Port 80 and 8000 open in the EC2 security group inbound rules

### Install Docker on EC2

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker ubuntu
newgrp docker
```

---

## Project Structure on Server

Only three things are needed on the server — no source code required:

```
~/app/
├── compose.yml
├── .env
└── nginx/
    └── default.conf
```

Images are pulled from Docker Hub at deploy time.

---

## Environment Configuration

`.env` on the production server:

```env
# Django
SECRET_KEY=your-production-secret-key
DEBUG=False
DB_NAME=ecommerce_db
DB_USER=ecommerce_user
DB_PASSWORD=strongpassword
DB_HOST=postgres
DB_PORT=5432

# Startup flags
ENABLE_MIGRATE=true
ENABLE_COLLECTSTATIC=true
ENABLE_SEED=false
DJANGO_SUPERUSER_USERNAME=admin
DJANGO_SUPERUSER_EMAIL=admin@example.com
DJANGO_SUPERUSER_PASSWORD=strongadminpassword

# CORS / CSRF
CSRF_TRUSTED_ORIGINS=http://<your-server-ip>,http://<your-server-ip>:8000

# Frontend — empty string so frontend uses relative URLs
VITE_DJANGO_BASE_URL=
```

> **Note:** `VITE_DJANGO_BASE_URL` must be empty. The frontend uses relative
> API calls (`/api/...`) which nginx proxies to the backend. Hardcoding an IP
> here has no effect at runtime since Vite bakes this value into the JS bundle
> at build time — it must be set correctly when the image is built locally,
> not on the server.

---

## Nginx Configuration

`nginx/default.conf` handles all routing for both ports:

```nginx
# ── Backend API (port 8000) ───────────────────────────────────
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

# ── Frontend + API proxy (port 80) ───────────────────────────
server {
    listen 80;

    # API calls from React frontend
    location /api/ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Django admin
    location /admin/ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Media files uploaded by users/seeder
    location /media/ {
        alias /app/media/;
    }

    # Django collected static files
    location /static/ {
        alias /app/staticfiles/;
    }

    # Everything else → React SPA
    location / {
        proxy_pass http://frontend:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

> **Why `/media/` on port 80?**
> The React frontend fetches product images via relative paths (`/media/...`).
> Without this block on port 80, nginx would forward those requests to the
> React container which has no media files — resulting in broken images.
> The `alias` directive serves files directly from the shared `media_volume`.

---

## Docker Compose

`compose.yml` on the production server uses pre-built images from Docker Hub:

```yaml
services:
  postgres:
    image: postgres:15-alpine
    container_name: dev_postgres
    restart: always
    env_file:
      - .env
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  volume-init:
    image: busybox
    container_name: volume_init
    user: root
    command:
      ["sh", "-c", "chown -R 65532:65532 /app/media /app/staticfiles"]
    volumes:
      - static_volume:/app/staticfiles
      - media_volume:/app/media

  backend:
    image: kailashbadu/shophive-backend:v0.0.1
    container_name: django_backend
    restart: unless-stopped
    env_file:
      - .env
    environment:
      SECRET_KEY: ${SECRET_KEY}
      DEBUG: ${DEBUG}
      DB_NAME: ${DB_NAME}
      DB_USER: ${DB_USER}
      DB_PASSWORD: ${DB_PASSWORD}
      DB_HOST: postgres
      DB_PORT: 5432
    volumes:
      - static_volume:/app/staticfiles
      - media_volume:/app/media
    depends_on:
      postgres:
        condition: service_healthy
      volume-init:
        condition: service_completed_successfully
    expose:
      - "8000"

  frontend:
    image: kailashbadu/shophive-frontend:v0.0.2
    container_name: react_frontend
    restart: unless-stopped
    expose:
      - "80"
    depends_on:
      - backend

  nginx:
    image: nginx:alpine
    container_name: nginx_proxy
    restart: unless-stopped
    ports:
      - "80:80"
      - "8000:8000"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - static_volume:/app/staticfiles:ro
      - media_volume:/app/media:ro
    depends_on:
      - frontend
      - backend

volumes:
  postgres_data:
  static_volume:
  media_volume:
```

---

## Building and Pushing Images

Run these commands on your **local development machine** before deploying.

### Backend

```bash
docker build -t kailashbadu/shophive-backend:v0.0.1 ./backend
docker push kailashbadu/shophive-backend:v0.0.1
```

### Frontend

The frontend image must be built with `VITE_DJANGO_BASE_URL` set to an empty
string so the JS bundle uses relative API calls:

```bash
docker build \
  --no-cache \
  --build-arg VITE_DJANGO_BASE_URL= \
  -t kailashbadu/shophive-frontend:v0.0.2 \
  ./frontend

# Verify no localhost:8000 is baked in — should print 0
docker run --rm kailashbadu/shophive-frontend:v0.0.2 \
  grep -c "localhost:8000" /usr/share/nginx/html/assets/*.js

docker push kailashbadu/shophive-frontend:v0.0.2
```

> **Always verify before pushing.** The JS bundle is immutable after build.
> If the wrong URL is baked in, the only fix is a rebuild and push.

### Bumping the tag

Always increment the image tag when pushing a new build:

```
v0.0.1 → v0.0.2 → v0.0.3 ...
```

Docker will not re-pull an image if the tag already exists locally. A new tag
guarantees the server pulls the correct updated image.

---

## Deploying on EC2

### First deploy

```bash
# SSH into EC2
ssh -i your-key.pem ubuntu@<your-server-ip>

# Create app directory
mkdir ~/app && cd ~/app

# Create nginx config directory
mkdir nginx

# Copy or create compose.yml, .env, nginx/default.conf
# (see sections above for content)

# Pull and start all services
docker compose up -d
```

### Updating frontend image

```bash
# Update image tag in compose.yml, then:
docker compose pull frontend
docker compose up -d --force-recreate frontend
```

### Updating nginx config

Since `nginx/default.conf` is a volume mount, no rebuild is needed:

```bash
sudo vim nginx/default.conf
docker compose restart nginx
```

### Updating backend image

```bash
docker compose pull backend
docker compose up -d --force-recreate backend
```

### Full redeploy

```bash
docker compose down
docker rmi kailashbadu/shophive-frontend:v0.0.2 \
           kailashbadu/shophive-backend:v0.0.1 --force
docker compose up -d
```

---

## Accessing Services

| Service          | URL                          |
|------------------|------------------------------|
| React Frontend   | `http://<server-ip>`         |
| Django API       | `http://<server-ip>/api/`    |
| Django Admin     | `http://<server-ip>/admin/`  |
| Backend (direct) | `http://<server-ip>:8000`    |

---

## Troubleshooting

### CORS error — `localhost:8000` in browser console

**Cause:** Frontend image was built without passing `VITE_DJANGO_BASE_URL=`
as a build arg, or with a hardcoded IP. The JS bundle has `localhost:8000`
baked in.

**Fix:** Rebuild the frontend image with an empty build arg and push a new tag:

```bash
docker build --no-cache \
  --build-arg VITE_DJANGO_BASE_URL= \
  -t kailashbadu/shophive-frontend:v0.0.3 \
  ./frontend
docker push kailashbadu/shophive-frontend:v0.0.3
```

Update the tag in `compose.yml` and redeploy.

---

### Broken product images — media files not loading on frontend

**Cause:** The port 80 nginx server block was missing a `/media/` location,
so image requests went to the React container instead of the media volume.

**Fix:** Add to the port 80 server block in `nginx/default.conf`:

```nginx
location /media/ {
    alias /app/media/;
}
```

Then restart nginx:

```bash
docker compose restart nginx
```

---

### 502 Bad Gateway on backend

**Cause:** Backend container crashed or hasn't started yet.

**Fix:**

```bash
docker compose logs backend
docker compose restart backend
```

---

### Permission denied on `/app/media` or `/app/staticfiles`

**Cause:** Docker named volumes are created as root-owned. The backend runs
as user `65532` (DHI nonroot) and cannot write to root-owned directories.

**Fix:** The `volume-init` service handles this by running `chown` as root
before the backend starts. If it still fails, recreate the volumes:

```bash
docker compose down
docker volume rm shophive_media_volume shophive_static_volume
docker compose up -d
```

---

### Docker pulls old image despite pushing a new build

**Cause:** Same image tag already exists locally. Docker skips the pull.

**Fix:** Delete the local image and pull fresh:

```bash
docker rmi kailashbadu/shophive-frontend:v0.0.2 --force
docker compose up -d
```

Or always bump the tag on every new build.


