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

### Permission Denied on Docker Volume (`/app/media`, `/app/staticfiles`)

**Problem**
Django running as non-root user (`65532`) inside a DHI hardened container couldn't write to `/app/media` and `/app/staticfiles` because Docker volumes are initialized as root-owned by default.

PermissionError: [Errno 13] Permission denied: '/app/media/products'

**Why It Happens**
Docker named volumes are created with `root:root` ownership. When the volume is mounted into the container, it overrides the directory ownership set in theDockerfile — even if you used `chown` during the image build.

***Failed Approaches***

- `chown` in Dockerfile Stage 2 → volume mount overrides it at runtime
- `os.chmod` in `entrypoint.py` → user `65532` can't chmod root-owned dirs
- `RUN chown` in DHI runtime stage → no shell (`/bin/sh`) available

***Fix: Volume Init Container***
Add a temporary `busybox` container that runs as root, chowns the volumes, then exits — before the backend starts.

```yaml
volume-init:
  image: busybox
  user: root
  command: ["sh", "-c", "chown -R 65532:65532 /app/media /app/staticfiles"]
  volumes:
    - static_volume:/app/staticfiles
    - media_volume:/app/media

backend:
  depends_on:
    postgres:
      condition: service_healthy
    volume-init:
      condition: service_completed_successfully  # wait for chown to finish
```

**Key Takeaway**
When running as non-root inside Docker, always initialize volume ownership using an init container — not the app Dockerfile or entrypoint.

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

## React Frontend Refresh 404 Error (Docker + Nginx)

### Error

The frontend works when navigating normally, but refreshing a route gives a 404 error.

Example:

Works:

```text
http://localhost/
```

Works:

```text
Clicking a React Link to:
/dashboard
```

Fails after browser refresh:

```text
http://localhost/dashboard
```

Error:

```text
404 Not Found
nginx
```

---

### Why This Happens

React applications using React Router are **Single Page Applications (SPA)**.

The browser does not request a new HTML page when changing routes. React handles routing internally.

Example:

```text
/dashboard
/profile
/settings
```

are handled by React Router.

However, when refreshing:

```text
GET /dashboard
```

the request goes directly to Nginx.

Nginx checks the filesystem:

```text
/usr/share/nginx/html/dashboard
```

but this file does not exist.

The React build only contains:

```text
/usr/share/nginx/html/
├── index.html
├── assets/
└── favicon.ico
```

Since `/dashboard` is not a real file, Nginx returns:

```text
404 Not Found
```

---

### Solution

Configure Nginx to always return `index.html` when a route does not exist.

Add:

```nginx
server {
    listen 80;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

The important part:

```nginx
try_files $uri $uri/ /index.html;
```

means:

1. Check if the requested file exists.
2. Check if the requested directory exists.
3. Otherwise return `index.html`.

Example:

```text
/dashboard
       |
       v
Does /dashboard exist?
       |
       No
       |
       v
Return index.html
       |
       v
React Router handles /dashboard
```

---

### Docker Setup

Frontend Dockerfile:

```dockerfile
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

Frontend Nginx config:

```nginx
server {
    listen 80;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

### Troubleshooting Steps

**1. Check frontend container logs**

```bash
docker compose logs frontend
```

---

**2. Verify Nginx config inside container**

Enter the frontend container:

```bash
docker compose exec frontend sh
```

Check config:

```bash
cat /etc/nginx/conf.d/default.conf
```

You should see:

```nginx
try_files $uri $uri/ /index.html;
```

---

**Test React build files**

Inside the container:

```bash
ls /usr/share/nginx/html
```

Expected:

```text
index.html
assets/
```

---

**Rebuild after config changes**

```bash
docker compose build --no-cache frontend
```

Restart:

```bash
docker compose up -d
```

---

### Final Request Flow

After fixing:

```text
Browser
   |
   v
Nginx Reverse Proxy
   |
   v
Frontend Nginx
   |
   ├── /assets/...  -> static files
   |
   └── /dashboard   -> index.html
                         |
                         v
                  React Router
```

Now refreshing any React route works correctly:

```text
http://localhost/
http://localhost/dashboard
http://localhost/profile
http://localhost/settings
```

---

## CI/CD

> Coming Soon..!!

---

## Kubernetes

> Coming Soon..!!

---

## Infrastructure

> Coming Soon..!!
