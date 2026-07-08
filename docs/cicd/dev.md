# ShopHive: Development Pipeline Documentation

> Related documentation: [Staging Pipeline](./staging.md)

---

## 1. Development Pipeline

### 1.1 What It Does

The development pipeline triggers on every push to `dev`. It runs security scans in parallel, builds Docker images, pushes them to Docker Hub, copies the compose file to the EC2 server via SCP, deploys via SSH, and verifies the application is running with a health check.

### 1.2 Pipeline Flow

```
gitleaks
├── sast
├── dependency-scan     --> build --> trivy-image --> deploy --> health-check
└── trivy-fs
```

### 1.3 Job Descriptions

#### `gitleaks` — Secret Scan

The first job to run; every other job depends on it. Gitleaks scans the entire Git history for hardcoded secrets — API keys, passwords, tokens, or any sensitive string that should never have been committed to the repository.

`fetch-depth: 0` is passed to the checkout step so Gitleaks scans the full commit history rather than just the latest commit. This catches secrets committed months earlier and never removed.

#### `sast` — Static Application Security Testing

Runs after Gitleaks passes. Bandit is run against the Django backend source code. Bandit is an open-source SAST tool developed by the Python Code Quality Authority (PyCQA). It parses Python source files into an Abstract Syntax Tree and runs security plugins against the code structure, rather than performing simple text searches.

It catches issues such as:

- Hardcoded passwords
- Use of `eval()` or `exec()`
- SQL injection patterns
- Insecure deserialization with `pickle`
- Use of weak cryptography

Command used:

```bash
bandit -r backend -f json -o bandit-report.json \
  --severity-level medium \
  --confidence-level medium || true
```

The `|| true` at the end means the pipeline continues even if Bandit finds issues and exits with a non-zero code. In development, the goal is to surface issues without blocking every push. In staging and production, `|| true` is removed to hard-block on findings.

The JSON report is uploaded as an artifact and remains downloadable from the Actions run page for 7 days.

#### `dependency-scan` — Dependency Vulnerability Scan

Also runs in parallel after Gitleaks. Two tools are used:

- `pip-audit` scans `backend/requirements.txt` against the Python Advisory Database for known CVEs in Python packages.
- `npm audit` scans the React frontend `package.json` against the npm security advisory database for vulnerabilities in Node packages.

Both use `|| true` in development for the same reason as Bandit — warn but do not block. Both reports are uploaded as a single artifact.

#### `trivy-fs` — Trivy Filesystem Scan

Also runs in parallel after Gitleaks. Trivy scans the entire repository filesystem — source code, dependency lock files, Dockerfiles, and configuration files — for known CVEs before anything is built.

Running this scan before the build catches vulnerabilities at the source level. If a lock file references a package with a known CVE, this surfaces before time is spent building an image that would fail the image scan regardless.

`exit-code: 0` is used in development so the job warns without blocking. In staging and production, `exit-code: 1` hard-blocks on HIGH and CRITICAL findings.

#### `build` — Build and Push Docker Images

Waits for `sast`, `dependency-scan`, and `trivy-fs` to all pass before running — all three security gates must be green before anything is built.

A short SHA tag is generated from the first seven characters of the commit SHA so every image is traceable to the exact commit that produced it. Docker Hub authentication uses secrets from the `development` environment, and Docker Buildx is used with GitHub Actions cache for efficient layer caching.

Each image receives two tags on every build:

| Tag               | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `dev-<short-sha>` | Immutable — tied to the exact commit, used by the Trivy image scan |
| `dev-latest`      | Mutable — always points to the most recent build, used by EC2      |

#### `trivy-image` — Trivy Image Scan

After images are pushed to Docker Hub, they are scanned with Trivy. This differs from the filesystem scan — it scans inside the built Docker image, including base image layers and all OS-level packages installed by the Dockerfile.

For example, if the base image (`python:3.13-alpine`) has a CVE in a bundled library, the filesystem scan would not catch it because that library only exists inside the built image. The image scan does catch it.

Backend and frontend images are scanned separately, with both reports uploaded as artifacts. `exit-code: 0` is used in development.

#### `deploy` — Deploy to Development EC2

The deploy job consists of three steps:

1. **Checkout** — the repository is checked out on the GitHub runner so the compose file is available to copy.
2. **SCP compose files to EC2** — `appleboy/scp-action` copies `compose.dev.yml` and the `nginx/` directory from the GitHub runner directly to `~/shophive` on the EC2 server. This guarantees the compose file on the server always matches what is in the repository, removing the need to manually SSH in to update it.
3. **SSH deploy** — the pipeline connects to the EC2 server and:
   1. Writes the `.env` file from the `DEV_ENV_FILE` GitHub secret — this is how all environment variables reach the server securely on every deploy.
   2. Pulls the latest images with `docker compose pull`.
   3. Restarts all services with `docker compose up -d --remove-orphans`.
   4. Prunes dangling images with `docker image prune -f` to keep disk usage clean.

**How the `.env` file reaches EC2:**

The entire contents of the `.env` file are stored as a single GitHub Secret named `DEV_ENV_FILE` in the `development` environment, added via **Settings → Environments → development → Secrets → Add secret**, with the raw file contents pasted as the value exactly as they appear locally — no quotes, no escaping:

```
SECRET_KEY=django-insecure-xxxxxxxxxxxxxxxx
DEBUG=False

DB_NAME=shophive
DB_USER=postgres
DB_PASSWORD=yourpassword
DB_HOST=postgres
DB_PORT=5432
```

On every deploy, the pipeline writes this to `~/shophive/.env` on the server:

```bash
echo "$DEV_ENV_FILE" > .env
```

There is never a need to manually SSH into the server to update environment variables — the GitHub secret is updated, and the next deploy picks it up automatically.

#### `health-check` — Post-Deploy Verification

After deployment, the pipeline connects to the EC2 server and polls the `/api/health/` endpoint up to twelve times, with a ten-second wait between each attempt — two minutes total.

If the endpoint responds with HTTP 200, the health check passes and the pipeline succeeds. If it never responds within two minutes, the job exits with code 1.

---

## 2. EC2 Server Setup (One-Time)

Before the pipeline can deploy for the first time, the following is performed on the EC2 instance:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Create docker group and add ubuntu user
sudo groupadd docker
sudo usermod -aG docker ubuntu
newgrp docker

# Create the project directory
mkdir -p ~/shophive

# Verify Docker works without sudo
docker ps
docker compose version
```

The EC2 security group must allow inbound HTTP on port 80 so the health check can reach `http://localhost/api/health/`.

The `.env` file does not need to be placed on the server manually — the pipeline writes it on every deploy.

---

## 3. Compose File Strategy

Two compose files are maintained:

- `compose.yml` — used locally, contains `build:` contexts for backend and frontend to allow local building and testing.
- `compose.dev.yml` — used on EC2, references pre-built Docker Hub images instead of building.

```yaml
# compose.dev.yml
services:
  backend:
    image: kailashbadu/shophive-backend:dev-latest

  frontend:
    image: kailashbadu/shophive-frontend:dev-latest
```

The pipeline copies `compose.dev.yml` to the server on every deploy, so it always stays in sync with the repository.

When `docker compose up` runs on EC2, `postgres`, `nginx`, and `volume-init` are all pre-built public images — they pull from Docker Hub with no build step and no significant delay. Only backend and frontend are custom images, and those are already built and pushed to Docker Hub before the deploy step runs.

---

## 4. Artifacts Produced Per Run

Every run produces downloadable scan reports under the Artifacts section of the Actions run page.

| Artifact                 | Job               | Contents                                   | Retention |
| ------------------------ | ----------------- | ------------------------------------------ | --------- |
| `bandit-report-dev`      | `sast`            | Bandit JSON report                         | 7 days    |
| `dependency-report-dev`  | `dependency-scan` | pip-audit JSON + npm-audit JSON            | 7 days    |
| `trivy-fs-report-dev`    | `trivy-fs`        | Trivy filesystem scan table                | 7 days    |
| `trivy-image-report-dev` | `trivy-image`     | Trivy backend + frontend image scan tables | 7 days    |

---

## 5. Security Tool Reference

**Gitleaks** — scans Git history for hardcoded secrets using pattern matching against known secret formats, run against the full commit history with `fetch-depth: 0`.

**Bandit** — open-source SAST tool for Python by the Python Code Quality Authority (PyCQA). Parses source files into an Abstract Syntax Tree and runs security plugins against the code structure rather than performing simple text searches.

**pip-audit** — audits Python dependencies in `requirements.txt` against the Python Advisory Database for known CVEs.

**npm audit** — audits Node.js dependencies against the npm security advisory database for known vulnerabilities.

**Trivy (Aqua Security)** — a comprehensive vulnerability scanner covering:

- `trivy fs` — scans source code, lock files, and configuration for CVEs before build.
- `trivy image` — scans built Docker images, including base image layers and installed OS packages.

---

## 6. Full `dev.yml`

```yaml
name: Development pipeline

on:
  push:
    branches: [dev]

jobs:
  # SECRET SCANNING
  gitleaks:
    name: Secret Scan (Gitleaks)
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repo
        uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - name: Run Gitleaks
        uses: gitleaks/gitleaks-action@v3
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  # SAST AND DEPENDENCY SECURITY
  sast:
    name: SAST (Bandit)
    runs-on: ubuntu-latest
    needs: gitleaks

    steps:
      - name: Checkout repo
        uses: actions/checkout@v7

      - name: Setup Python
        uses: actions/setup-python@v6
        with:
          python-version: "3.13"

      - name: Install Bandit
        run: |
          pip install bandit

      - name: Run Bandit
        run: |
          bandit -r backend -f json -o bandit-report.json --severity-level medium --confidence-level medium || true

      - name: Upload Bandit Report
        uses: actions/upload-artifact@v7
        with:
          name: bandit-report-dev
          path: bandit-report.json
          retention-days: 7

  dependency-scan:
    name: Dependency Vulnerability Scan
    runs-on: ubuntu-latest
    needs: gitleaks

    steps:
      - name: Checkout repo
        uses: actions/checkout@v7

      - name: Setup Python
        uses: actions/setup-python@v6
        with:
          python-version: "3.13"

      - name: pip audit
        run: |
          pip install pip-audit
          pip-audit -r backend/requirements.txt --format json --output pip-audit.json || true

      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: 22

      - name: npm audit
        working-directory: frontend
        run: |
          npm install
          npm audit --audit-level high --json > npm-audit.json || true

      - name: Upload dependency reports
        uses: actions/upload-artifact@v7
        with:
          name: dependency-report-dev
          path: |
            pip-audit.json
            frontend/npm-audit.json
          retention-days: 7

  trivy-fs:
    name: Trivy Filesystem Scan
    runs-on: ubuntu-latest
    needs: gitleaks
    steps:
      - name: Checkout repo
        uses: actions/checkout@v7

      - name: Run Trivy FS scan
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          scan-type: fs
          scan-ref: .
          format: table
          severity: HIGH,CRITICAL
          exit-code: 0
          output: trivy-fs-results.txt

      - name: Upload Trivy FS Report
        uses: actions/upload-artifact@v7
        if: always()
        with:
          name: trivy-fs-report-dev
          path: trivy-fs-results.txt
          retention-days: 7

  build:
    name: Build Docker Images and Push to Docker Hub
    runs-on: ubuntu-latest
    environment: development
    needs:
      - sast
      - dependency-scan
      - trivy-fs
    outputs:
      tag: ${{ steps.version.outputs.tag }}
    steps:
      - name: Checkout repo
        uses: actions/checkout@v7

      - name: Generate Image Tag
        id: version
        run: |
          SHORT_SHA=${GITHUB_SHA::7}
          echo "tag=dev-${SHORT_SHA}" >> $GITHUB_OUTPUT

      - name: Docker Login
        uses: docker/login-action@v4
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Setup Buildx
        uses: docker/setup-buildx-action@v4

      - name: Build and push Backend Image
        uses: docker/build-push-action@v7
        with:
          context: ./backend
          push: true
          tags: |
            ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.BACKEND_IMAGE }}:${{ steps.version.outputs.tag }}
            ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.BACKEND_IMAGE }}:latest-dev
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build and Push Frontend Image
        uses: docker/build-push-action@v7
        with:
          context: ./frontend
          push: true
          tags: |
            ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.FRONTEND_IMAGE }}:${{ steps.version.outputs.tag }}
            ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.FRONTEND_IMAGE }}:latest-dev
          cache-from: type=gha
          cache-to: type=gha,mode=max

  trivy-image:
    name: Trivy Image Scan
    runs-on: ubuntu-latest
    environment: development
    needs: build
    steps:
      - name: Scan Backend Image
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          scan-type: image
          image-ref: ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.BACKEND_IMAGE }}:${{ needs.build.outputs.tag }}
          format: table
          severity: HIGH,CRITICAL
          exit-code: 0
          output: trivy-backend-image.txt

      - name: Scan Frontend Image
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          scan-type: image
          image-ref: ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.FRONTEND_IMAGE }}:${{ needs.build.outputs.tag }}
          format: table
          severity: HIGH,CRITICAL
          exit-code: 0
          output: trivy-frontend-image.txt

      - name: Upload Trivy Image Reports
        uses: actions/upload-artifact@v7
        if: always()
        with:
          name: trivy-image-report-dev
          path: |
            trivy-backend-image.txt
            trivy-frontend-image.txt
          retention-days: 7

  deploy:
    name: Deployment to the Development Server
    runs-on: ubuntu-latest
    needs:
      - trivy-image
    environment: development
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Copy compose files to EC2
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.DEV_EC2_HOST }}
          username: ${{ secrets.DEV_EC2_USER }}
          key: ${{ secrets.DEV_EC2_SSH_KEY }}
          source: "compose.dev.yml,nginx/,scripts/"
          target: "~/shophive"

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.DEV_EC2_HOST }}
          username: ${{ secrets.DEV_EC2_USER }}
          key: ${{ secrets.DEV_EC2_SSH_KEY }}
          envs: DEV_ENV_FILE
          script: |
            set -e
            cd ~/shophive

            echo "$DEV_ENV_FILE" > .env

            docker compose -f compose.dev.yml pull
            docker compose -f compose.dev.yml up -d --remove-orphans
            docker image prune -f
        env:
          DEV_ENV_FILE: ${{ secrets.DEV_ENV_FILE }}

  health-check:
    name: Health Check
    runs-on: ubuntu-latest
    environment: development
    needs: deploy
    steps:
      - name: Check app health
        uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.DEV_EC2_HOST }}
          username: ${{ secrets.DEV_EC2_USER }}
          key: ${{ secrets.DEV_EC2_SSH_KEY }}
          script: |
            cd ~/shophive
            ./scripts/dev/healthcheck.sh
```

---

## 7. References

- Security in CI/CD pipelines: [https://youtu.be/ZUquwnJnfNw](https://youtu.be/ZUquwnJnfNw?si=kpxbcQ3MJAyJLy7y)

---

## 8. Next Steps

See the [Staging Pipeline documentation](./staging.md) for the QA environment workflow.
