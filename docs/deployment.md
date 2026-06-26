# cicd

1. CI/CD Architecture 

Branch → Environment Mapping

dev push -> Development -> EC2 Dev Server

dev → staging mergeStaging/QA -> EC2 Staging Server

Git tag v*.*.* + manual approvalProduction -> AWS Native (ECR + ECS/CodeDeploy)


create dev and staging brach

Pipeline Overview
Dev — fast feedback loop, push to Docker Hub, SSH deploy to dev EC2.
Staging — same flow but triggered on merge to staging, deploys to staging EC2. QA team tests here.
Production — tag-triggered, images go to ECR (not Docker Hub), deployment via AWS CodePipeline → CodeDeploy with a manual approval gate in between.

```bash
.github/
└── workflows/
    ├── ci-dev.yml          # dev branch push
    ├── ci-staging.yml      # staging branch push (after merge)
    └── ci-prod.yml         # tag push v*.*.* + manual approval

```

## Github secrets

Step 1: Create Environments
Open your GitHub repository.
Go to Settings → Environments.
Click New environment.
Create the following environments:
development
staging
production


Step 2: Add Variables (non-sensitive)

For each environment, go to:

Environment → Variables → Add variable


Step 3: Add Secrets (sensitive)

Go to:

Environment → Secrets → Add secret



| Secret                  | Used In      |
| ----------------------- | ------------ |
| `DOCKERHUB_USERNAME`    | dev, staging |
| `DOCKERHUB_TOKEN`       | dev, staging |
| `DEV_EC2_HOST`          | dev          |
| `DEV_EC2_SSH_KEY`       | dev          |
| `STAGING_EC2_HOST`      | staging      |
| `STAGING_EC2_SSH_KEY`   | staging      |
| `AWS_ACCOUNT_ID`        | prod         |
| `AWS_ACCESS_KEY_ID`     | prod         |
| `AWS_SECRET_ACCESS_KEY` | prod         |
| `CODEDEPLOY_S3_BUCKET`  | prod         |

Step 4: Use the Environment in GitHub Actions

```
name: Deploy

on:
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest

    environment: development   # change to staging or production

    env:
      APP_ENV: ${{ vars.APP_ENV }}
      DB_HOST: ${{ vars.DB_HOST }}
      DB_NAME: ${{ vars.DB_NAME }}
      DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
      JWT_SECRET: ${{ secrets.JWT_SECRET }}
      API_KEY: ${{ secrets.API_KEY }}

    steps:
      - uses: actions/checkout@v4

      - name: Print environment
        run: |
          echo "Environment: $APP_ENV"
          echo "Database: $DB_HOST/$DB_NAME"

```

Best practice
Variables (vars): Use for non-sensitive configuration (URLs, ports, log levels, environment names).
Secrets (secrets): Use for passwords, API keys, tokens, certificates, and other sensitive values.
Configure protection rules for the production environment (such as required reviewers) to prevent accidental deployments.


Bandit is an open-source Static Application Security Testing (SAST) tool designed specifically to find common security issues in Python code.  Developed by the Python Code Quality Authority (PyCQA), it operates by parsing source files into an Abstract Syntax Tree (AST) and running specialized security plugins against the code structure rather than performing simple text searches. 

In GitHub Actions workflows, Bandit is commonly integrated to automate security scanning on every push or pull request.  It identifies vulnerabilities such as hardcoded passwords, insecure deserialization (e.g., pickle), SQL injection, and the use of dangerous functions like eval() or exec().  The tool outputs findings categorized by severity (Low, Medium, High) and confidence levels, often generating JSON reports that can be uploaded as artifacts for review. 

Bandit (SAST)
bandit -r backend -f json -o bandit-report.json \
  --severity-level medium \
  --confidence-level medium || true

The || true means:

Run Bandit.
Even if Bandit finds issues and returns an error code, convert it to success.

Bandit (SAST)
bandit -r backend -f json -o bandit-report.json \
  --severity-level medium \
  --confidence-level medium || true

The || true means:

Run Bandit.
Even if Bandit finds issues and returns an error code, convert it to success.

# REFERENCES

- SECURITY IN PIPELINE: https://youtu.be/ZUquwnJnfNw?si=kpxbcQ3MJAyJLy7y



# ShopHive — Dev Pipeline Documentation

## Overview

This document covers the full development CI/CD pipeline for ShopHive — what was built, what questions came up during the process, how they were resolved, and the final pipeline configuration.

---

## What We Built

A complete GitHub Actions CI/CD pipeline for the `main` branch that:

- Scans for secrets, code vulnerabilities, and dependency issues before anything is built
- Scans the filesystem with Trivy before build and the Docker images after build
- Builds and pushes backend and frontend Docker images to Docker Hub
- Deploys to a dev EC2 instance via SSH
- Runs a post-deploy health check
- Rolls back automatically if the health check fails
- Sends a Slack notification if anything in the pipeline fails

---

## Pipeline Flow

```
gitleaks
├── sast             ┐
├── dependency-scan  ├──► build ──► trivy-image ──► deploy ──► health-check
└── trivy-fs         ┘                                               │
                                                         ┌───────────┴───────────┐
                                                    (pass) ✅              (fail) ❌
                                                                     rollback + slack notify
```

### Jobs summary

| Job | Purpose | Blocks |
|---|---|---|
| `gitleaks` | Scan for hardcoded secrets | Everything |
| `sast` | Bandit static analysis on Django backend | `build` |
| `dependency-scan` | pip-audit + npm audit | `build` |
| `trivy-fs` | Trivy filesystem scan (source + deps) | `build` |
| `build` | Build and push Docker images to Docker Hub | `trivy-image` |
| `trivy-image` | Trivy scan on pushed backend/frontend images | `deploy` |
| `deploy` | SSH into EC2, pull images, run docker compose | `health-check` |
| `health-check` | curl the app, retry 12x over 2 minutes | `rollback` (on fail) |
| `rollback` | Re-tag dev-previous → dev-latest, restart compose | — |
| `notify` | Slack alert with run URL if any job fails | — |

---

## Questions and Confusions — How They Were Resolved

### 1. "Should I add Trivy FS scan and Trivy image scan?"

**Confusion:** The original pipeline had Gitleaks, Bandit, and pip-audit/npm-audit but no Trivy at all.

**Resolution:** Two Trivy jobs were added at different points in the pipeline:

- `trivy-fs` runs **before build** — scans source code and filesystem for CVEs
- `trivy-image` runs **after build** — scans the actual Docker images that were pushed to Docker Hub

Both use `exit-code: 0` in the dev pipeline, meaning they warn but never block. This is intentional — dev pipelines should surface issues without stopping every push. Staging and prod pipelines will use `exit-code: 1` to hard-block on HIGH/CRITICAL findings.

---

### 2. "Should I hardcode image names or use GitHub environment variables?"

**Confusion:** The original pipeline had this at the top of the workflow:

```yaml
env:
  BACKEND_IMAGE: kailashbadu/shophive-backend
  FRONTEND_IMAGE: kailashbadu/shophive-frontend
```

This mixed the Docker Hub username and image name together as a hardcoded string.

**Resolution:** Split them so each part is managed separately and securely:

- `DOCKERHUB_USERNAME` (`kailashbadu`) stored as a **GitHub Secret** in the `development` environment — it's a credential, not config
- `BACKEND_IMAGE` (`shophive-backend`) and `FRONTEND_IMAGE` (`shophive-frontend`) stored as **GitHub Variables** in the `development` environment — they're config, not secrets

The full image reference in the workflow becomes:

```yaml
${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.BACKEND_IMAGE }}:${{ steps.version.outputs.tag }}
```

This also means the top-level `env:` block is removed entirely from the workflow file.

---

### 3. "Will docker compose up rebuild postgres and nginx — will that slow things down?"

**Confusion:** The concern was that running `docker compose up` on EC2 during deploy would trigger slow rebuilds of postgres and nginx.

**Resolution:** No — postgres (`postgres:15-alpine`) and nginx (`nginx:alpine`) are pre-built public images. They only pull from Docker Hub if not already cached, which is fast. There is no build step for them.

The only things that were slow were the `build:` contexts for backend and frontend in the original `docker-compose.yml`. The fix is to replace those with `image:` references pointing to the pre-built Docker Hub images:

```yaml
# docker-compose.yml on EC2
backend:
  image: kailashbadu/shophive-backend:dev-latest

frontend:
  image: kailashbadu/shophive-frontend:dev-latest
```

Now `docker compose pull` + `docker compose up -d` on EC2 is just pulling pre-built images and restarting containers — fast and correct.

The recommended approach is to keep the local `docker-compose.yml` with `build:` contexts for local development, and use a `docker-compose.prod.yml` override on EC2 that swaps in image references.

---

### 4. "How does the .env file get onto EC2?"

**Confusion:** The pipeline deploys via SSH and runs `docker compose up`, but `docker-compose.yml` depends on a `.env` file for database credentials, Django secret key, and other config. There was no mechanism to get that file onto the server.

**Resolution:** Store the entire `.env` file contents as a single GitHub Secret called `DEV_ENV_FILE` in the `development` environment. During the deploy step, write it to disk on EC2 before running compose:

```yaml
- name: Deploy via SSH
  uses: appleboy/ssh-action@v1.2.0
  with:
    host: ${{ secrets.DEV_EC2_HOST }}
    username: ${{ secrets.DEV_EC2_USER }}
    key: ${{ secrets.DEV_EC2_SSH_KEY }}
    envs: DEV_ENV_FILE
    script: |
      echo "$DEV_ENV_FILE" > .env
      docker compose pull
      docker compose up -d --remove-orphans
  env:
    DEV_ENV_FILE: ${{ secrets.DEV_ENV_FILE }}
```

The `envs` parameter passes the env var into the SSH session so the script can access it.

---

### 5. "What happens if the deploy fails — there was no rollback"

**Confusion:** If a bad image was deployed and the app broke, there was no way to recover automatically.

**Resolution:** A two-step rollback strategy was added:

**Step 1 — Snapshot before deploy.** Before pulling new images, tag the current `dev-latest` as `dev-previous`:

```bash
docker tag kailashbadu/shophive-backend:dev-latest \
           kailashbadu/shophive-backend:dev-previous || true
```

The `|| true` prevents failure on first deploy when no previous image exists yet.

**Step 2 — Rollback job.** A separate `rollback` job runs only `if: failure()` after `health-check`. It re-tags `dev-previous` back to `dev-latest` and restarts compose:

```bash
docker tag kailashbadu/shophive-backend:dev-previous \
           kailashbadu/shophive-backend:dev-latest

docker compose up -d --remove-orphans
```

---

### 6. "There was no health check after deploy"

**Confusion:** The pipeline was deploying but had no way to verify the app was actually running after the containers started.

**Resolution:** A `health-check` job was added after `deploy`. It SSHes into EC2 and polls `/api/health/` up to 12 times with a 10-second delay between attempts (2 minutes total):

```bash
for i in $(seq 1 12); do
  if curl -sf http://localhost/api/health/ > /dev/null; then
    echo "✅ Health check passed"
    exit 0
  fi
  sleep 10
done
exit 1
```

This requires a `/api/health/` endpoint in Django:

```python
from django.http import JsonResponse

def health(request):
    return JsonResponse({"status": "ok"})
```

If the health check fails after 2 minutes, the job exits with code 1, which triggers the `rollback` job and the `notify` job.

---

### 7. "Trivy image scan reports were not being uploaded"

**Confusion:** The FS scan had an artifact upload step but the image scan jobs had no artifact upload — so scan results were visible in logs but not downloadable or auditable after the run.

**Resolution:** Added `output:` parameter to both Trivy image scan steps and a single upload artifact step that collects both reports:

```yaml
- name: Upload Trivy image reports
  uses: actions/upload-artifact@v4
  if: always()
  with:
    name: trivy-image-report-dev
    path: |
      trivy-backend-image.txt
      trivy-frontend-image.txt
    retention-days: 7
```

`if: always()` ensures reports are uploaded even if the scan step fails.

---

## GitHub Environment Setup

All secrets and variables live under **Settings → Environments → development** in the repository.

### Secrets

| Secret | Value |
|---|---|
| `DOCKERHUB_USERNAME` | `kailashbadu` |
| `DOCKERHUB_TOKEN` | Docker Hub access token |
| `DEV_EC2_HOST` | EC2 public IP address |
| `DEV_EC2_USER` | `ubuntu` |
| `DEV_EC2_SSH_KEY` | Contents of your `.pem` private key |
| `DEV_ENV_FILE` | Full contents of your `.env` file |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL |

### Variables

| Variable | Value |
|---|---|
| `BACKEND_IMAGE` | `shophive-backend` |
| `FRONTEND_IMAGE` | `shophive-frontend` |

---

## EC2 Setup Requirements

Before the pipeline can deploy, the EC2 instance needs:

- Docker and Docker Compose installed
- `~/shophive/` directory created
- `docker-compose.yml` present using `image:` references (not `build:` contexts) for backend and frontend
- The EC2 security group allowing inbound HTTP (port 80) so the health check can reach `localhost`

The `.env` file is written by the pipeline on every deploy — it does not need to be manually placed on the server.

---

## Artifacts Produced Per Run

| Artifact | Job | Contents |
|---|---|---|
| `bandit-report-dev` | `sast` | Bandit JSON report |
| `dependency-report-dev` | `dependency-scan` | pip-audit JSON + npm-audit JSON |
| `trivy-fs-report-dev` | `trivy-fs` | Trivy filesystem scan table |
| `trivy-image-report-dev` | `trivy-image` | Trivy backend + frontend image scan tables |

All artifacts are retained for 7 days.

---

## Image Tagging Strategy

Each build produces two tags per image:

| Tag | Example | Purpose |
|---|---|---|
| `dev-<short-sha>` | `dev-a1b2c3d` | Immutable — tied to exact commit |
| `dev-latest` | `dev-latest` | Mutable — always points to most recent build |
| `dev-previous` | `dev-previous` | Created on EC2 during deploy — used for rollback |

The `dev-<short-sha>` tag is what Trivy image scans use. The EC2 server runs off `dev-latest`.

---

## Final `dev.yml` Pipeline

```yaml
name: Development Pipeline

on:
  push:
    branches: [main]

jobs:
  # ── SECRET SCANNING ────────────────────────────────────────────────────────
  gitleaks:
    name: Secret Scan (Gitleaks)
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run Gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  # ── SAST ───────────────────────────────────────────────────────────────────
  sast:
    name: SAST (Bandit)
    runs-on: ubuntu-latest
    needs: gitleaks
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.13"

      - name: Install Bandit
        run: pip install bandit

      - name: Run Bandit
        run: |
          bandit -r backend -f json -o bandit-report.json \
            --severity-level medium --confidence-level medium || true

      - name: Upload Bandit report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: bandit-report-dev
          path: bandit-report.json
          retention-days: 7

  # ── DEPENDENCY SCAN ────────────────────────────────────────────────────────
  dependency-scan:
    name: Dependency Vulnerability Scan
    runs-on: ubuntu-latest
    needs: gitleaks
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.13"

      - name: pip-audit
        run: |
          pip install pip-audit
          pip-audit -r backend/requirements.txt --format json \
            --output pip-audit.json || true

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: npm audit
        working-directory: frontend
        run: |
          npm install
          npm audit --audit-level high --json > npm-audit.json || true

      - name: Upload dependency reports
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: dependency-report-dev
          path: |
            pip-audit.json
            frontend/npm-audit.json
          retention-days: 7

  # ── TRIVY FILESYSTEM SCAN ──────────────────────────────────────────────────
  trivy-fs:
    name: Trivy Filesystem Scan
    runs-on: ubuntu-latest
    needs: gitleaks
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Run Trivy FS scan
        uses: aquasecurity/trivy-action@0.28.0
        with:
          scan-type: fs
          scan-ref: .
          format: table
          severity: HIGH,CRITICAL
          exit-code: 0
          output: trivy-fs-results.txt

      - name: Upload Trivy FS report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: trivy-fs-report-dev
          path: trivy-fs-results.txt
          retention-days: 7

  # ── BUILD ──────────────────────────────────────────────────────────────────
  build:
    name: Build Docker Images
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
        uses: actions/checkout@v4

      - name: Generate image tag
        id: version
        run: |
          SHORT_SHA=${GITHUB_SHA::7}
          echo "tag=dev-${SHORT_SHA}" >> $GITHUB_OUTPUT

      - name: Docker Login
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Setup Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build and push backend image
        uses: docker/build-push-action@v6
        with:
          context: ./backend
          push: true
          tags: |
            ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.BACKEND_IMAGE }}:${{ steps.version.outputs.tag }}
            ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.BACKEND_IMAGE }}:dev-latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build and push frontend image
        uses: docker/build-push-action@v6
        with:
          context: ./frontend
          push: true
          tags: |
            ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.FRONTEND_IMAGE }}:${{ steps.version.outputs.tag }}
            ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.FRONTEND_IMAGE }}:dev-latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # ── TRIVY IMAGE SCAN ───────────────────────────────────────────────────────
  trivy-image:
    name: Trivy Image Scan
    runs-on: ubuntu-latest
    environment: development
    needs: build
    steps:
      - name: Scan backend image
        uses: aquasecurity/trivy-action@0.28.0
        with:
          scan-type: image
          image-ref: ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.BACKEND_IMAGE }}:${{ needs.build.outputs.tag }}
          format: table
          severity: HIGH,CRITICAL
          exit-code: 0
          output: trivy-backend-image.txt

      - name: Scan frontend image
        uses: aquasecurity/trivy-action@0.28.0
        with:
          scan-type: image
          image-ref: ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.FRONTEND_IMAGE }}:${{ needs.build.outputs.tag }}
          format: table
          severity: HIGH,CRITICAL
          exit-code: 0
          output: trivy-frontend-image.txt

      - name: Upload Trivy image reports
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: trivy-image-report-dev
          path: |
            trivy-backend-image.txt
            trivy-frontend-image.txt
          retention-days: 7

  # ── DEPLOY ─────────────────────────────────────────────────────────────────
  deploy:
    name: Deploy to Dev EC2
    runs-on: ubuntu-latest
    environment: development
    needs: trivy-image
    steps:
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

            # Write .env from GitHub secret
            echo "$DEV_ENV_FILE" > .env

            # Snapshot current images for rollback
            docker tag \
              ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.BACKEND_IMAGE }}:dev-latest \
              ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.BACKEND_IMAGE }}:dev-previous 2>/dev/null || true

            docker tag \
              ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.FRONTEND_IMAGE }}:dev-latest \
              ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.FRONTEND_IMAGE }}:dev-previous 2>/dev/null || true

            # Pull new images and restart
            docker compose pull
            docker compose up -d --remove-orphans
            docker image prune -f
        env:
          DEV_ENV_FILE: ${{ secrets.DEV_ENV_FILE }}

  # ── HEALTH CHECK ───────────────────────────────────────────────────────────
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
            echo "Waiting for app to be ready..."
            for i in $(seq 1 12); do
              if curl -sf http://localhost/api/health/ > /dev/null; then
                echo "✅ Health check passed"
                exit 0
              fi
              echo "Attempt $i/12 failed, retrying in 10s..."
              sleep 10
            done
            echo "❌ Health check failed after 2 minutes"
            exit 1

  # ── ROLLBACK ───────────────────────────────────────────────────────────────
  rollback:
    name: Rollback on Failure
    runs-on: ubuntu-latest
    environment: development
    needs: health-check
    if: failure()
    steps:
      - name: Rollback to previous images
        uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.DEV_EC2_HOST }}
          username: ${{ secrets.DEV_EC2_USER }}
          key: ${{ secrets.DEV_EC2_SSH_KEY }}
          script: |
            set -e
            cd ~/shophive

            echo "⚠️ Rolling back to previous images..."

            docker tag \
              ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.BACKEND_IMAGE }}:dev-previous \
              ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.BACKEND_IMAGE }}:dev-latest

            docker tag \
              ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.FRONTEND_IMAGE }}:dev-previous \
              ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.FRONTEND_IMAGE }}:dev-latest

            docker compose up -d --remove-orphans
            echo "✅ Rollback complete"

  # ── NOTIFY ─────────────────────────────────────────────────────────────────
  notify:
    name: Notify on Failure
    runs-on: ubuntu-latest
    needs: [gitleaks, sast, dependency-scan, trivy-fs, build, trivy-image, deploy, health-check]
    if: failure()
    steps:
      - name: Send Slack notification
        uses: slackapi/slack-github-action@v2.1.0
        with:
          webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": "❌ *Dev pipeline failed*",
              "attachments": [
                {
                  "color": "danger",
                  "fields": [
                    {
                      "title": "Repository",
                      "value": "${{ github.repository }}",
                      "short": true
                    },
                    {
                      "title": "Branch",
                      "value": "${{ github.ref_name }}",
                      "short": true
                    },
                    {
                      "title": "Triggered by",
                      "value": "${{ github.actor }}",
                      "short": true
                    },
                    {
                      "title": "Run URL",
                      "value": "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
                      "short": false
                    }
                  ]
                }
              ]
            }
```






====================


3:29 PM
Go to your repo on GitHub and follow these steps:

Settings → Environments → development → Add secret

Name:  DEV_ENV_FILE
Value: (paste your entire .env file contents here)
Like this:

SECRET_KEY=django-insecure-xxxxxxxxxxxxxxxx
DEBUG=False

DB_NAME=shophive
DB_USER=postgres
DB_PASSWORD=yourpassword
DB_HOST=postgres
DB_PORT=5432
That's it. Just paste the raw .env contents as the secret value — no quotes, no escaping, exactly as the file looks on your local machine.

If you don't have a development environment yet: Settings → Environments → New environment → name it development → then add the secret there.
