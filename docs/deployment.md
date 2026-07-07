# ShopHive — CI/CD Documentation

> This document covers the development pipeline in full detail. Staging and production pipelines are coming soon.

---

## Architecture Overview

ShopHive follows a three-environment CI/CD strategy mapped to Git branches and tags:

| Trigger                            | Environment | Infrastructure                      |
| ---------------------------------- | ----------- | ----------------------------------- |
| Push to `main`                     | Development | EC2 Dev Server (Docker Compose)     |
| Merge to `staging`                 | Staging/QA  | EC2 Staging Server (Docker Compose) |
| Git tag `v*.*.*` + manual approval | Production  | AWS ECR + ECS/CodeDeploy            |

I created three separate workflow files under `.github/workflows/` to keep each environment's pipeline isolated and independently configurable:

```
.github/
└── workflows/
    ├── dev.yml          # triggers on push to dev
    ├── staging.yml      # triggers on push to staging branch (coming soon)
    └── prod.yml         # triggers on git tag v*.*.* (coming soon)
```

---

## GitHub Environment Setup

Before the pipelines work, I set up environments in GitHub to scope secrets and variables per environment.

### Step 1 — Create environments

I go to my repository on GitHub, then navigate to **Settings → Environments → New environment** and create three environments:

- `development`
- `staging`
- `production`

### Step 2 — Add variables (non-sensitive config)

For each environment I go to **Environment → Variables → Add variable** and add image names and other config values that are safe to expose.

### Step 3 — Add secrets (sensitive values)

For each environment I go to **Environment → Secrets → Add secret** and add credentials — Docker Hub tokens, SSH keys, AWS keys, and the `.env` file contents.

**Rule I follow:**

- Variables (`vars.*`): non-sensitive configuration — image names, ports, environment names, log levels
- Secrets (`secrets.*`): passwords, tokens, API keys, SSH private keys, certificates, `.env` file contents

### Full secrets and variables reference

| Secret                  | Environment          |
| ----------------------- | -------------------- |
| `DOCKERHUB_USERNAME`    | development, staging |
| `DOCKERHUB_TOKEN`       | development, staging |
| `DEV_EC2_HOST`          | development          |
| `DEV_EC2_USER`          | development          |
| `DEV_EC2_SSH_KEY`       | development          |
| `DEV_ENV_FILE`          | development          |
| `SLACK_WEBHOOK_URL`     | development          |
| `STAGING_EC2_HOST`      | staging              |
| `STAGING_EC2_SSH_KEY`   | staging              |
| `AWS_ACCOUNT_ID`        | production           |
| `AWS_ACCESS_KEY_ID`     | production           |
| `AWS_SECRET_ACCESS_KEY` | production           |
| `CODEDEPLOY_S3_BUCKET`  | production           |

| Variable         | Environment | Value               |
| ---------------- | ----------- | ------------------- |
| `BACKEND_IMAGE`  | development | `shophive-backend`  |
| `FRONTEND_IMAGE` | development | `shophive-frontend` |

---

## Development Pipeline

### What it does

The dev pipeline triggers on every push to `dev`. It runs security scans in parallel, builds Docker images, pushes them to Docker Hub, copies the compose file to the EC2 server via SCP, deploys via SSH, and verifies the app is running with a health check.

### Pipeline flow

```
gitleaks
├── sast
├── dependency-scan     --> build --> trivy-image --> deploy --> health-check
└── trivy-fs

```

---

### Job descriptions

#### gitleaks — Secret Scan

This is the first job that runs and everything else depends on it. I use Gitleaks to scan the entire Git history for hardcoded secrets — API keys, passwords, tokens, or any sensitive string that should never have been committed to the repository.

I pass `fetch-depth: 0` to the checkout step so Gitleaks scans all commits in history, not just the latest one. If a secret was committed three months ago and never removed, this catches it.

---

#### sast — Static Application Security Testing

After Gitleaks passes, I run Bandit against the Django backend source code. Bandit is an open-source SAST tool developed by the Python Code Quality Authority (PyCQA). It works by parsing Python source files into an Abstract Syntax Tree and running security plugins against the code structure — it does not do simple text searches.

It catches issues like:

- Hardcoded passwords
- Use of `eval()` or `exec()`
- SQL injection patterns
- Insecure deserialization with `pickle`
- Use of weak cryptography

The command I run:

```bash
bandit -r backend -f json -o bandit-report.json \
  --severity-level medium \
  --confidence-level medium || true
```

The `|| true` at the end means: run Bandit, and even if it finds issues and exits with a non-zero code, treat it as success so the pipeline continues. In dev I want to surface issues without blocking every push. In staging and prod I will remove `|| true` to hard-block on findings.

The JSON report is uploaded as an artifact and is downloadable from the Actions run page for 7 days.

---

#### dependency-scan — Dependency Vulnerability Scan

Also runs in parallel after Gitleaks. I run two tools here:

`pip-audit` scans `backend/requirements.txt` against the Python Advisory Database for known CVEs in Python packages.

`npm audit` scans the React frontend `package.json` against the npm security advisory database for vulnerabilities in Node packages.

Both use `|| true` in dev for the same reason as Bandit — warn but do not block. Both reports are uploaded as a single artifact.

---

#### trivy-fs — Trivy Filesystem Scan

Also runs in parallel after Gitleaks. I use Trivy to scan the entire repository filesystem — source code, dependency lock files, Dockerfiles, and configuration files — for known CVEs before anything gets built.

Running this before the build means I catch vulnerabilities at the source level. If a lock file references a package with a known CVE, I want to know before spending time building an image that will fail the image scan anyway.

I use `exit-code: 0` in dev so it warns but never blocks. In staging and prod I will set `exit-code: 1` to hard-block on HIGH and CRITICAL findings.

---

#### build — Build and Push Docker Images

This job waits for `sast`, `dependency-scan`, and `trivy-fs` to all pass before it runs. All three security gates must be green before I build anything.

I generate a short SHA tag from the first 7 characters of the commit SHA so every image is traceable to the exact commit that produced it. I log in to Docker Hub using secrets from the `development` environment and use Docker Buildx with GitHub Actions cache for efficient layer caching.

Each image gets two tags on every build:

| Tag               | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `dev-<short-sha>` | Immutable — tied to the exact commit, used by Trivy image scan |
| `dev-latest`      | Mutable — always points to the most recent build, used by EC2  |

---

#### trivy-image — Trivy Image Scan

After the images are pushed to Docker Hub, I scan them with Trivy. This is different from the filesystem scan — it scans inside the built Docker image, including base image layers and all OS-level packages installed by the Dockerfile.

For example, if my base image (`python:3.13-alpine`) has a CVE in a bundled library, the filesystem scan would not catch it because that library only exists inside the image. The image scan catches it.

I scan both the backend and frontend images separately and upload both reports as artifacts. `exit-code: 0` in dev.

---

#### deploy — Deploy to Dev EC2

The deploy job has three steps:

**Step 1 — Checkout.** I check out the repo on the GitHub runner so the compose file is available to copy.

**Step 2 — SCP compose files to EC2.** I use `appleboy/scp-action` to copy `compose.dev.yml` and the `nginx/` directory from the GitHub runner directly to `~/shophive` on the EC2 server. This means the compose file on the server always matches exactly what is in the repository — I never have to manually SSH in to update it.

**Step 3 — SSH deploy.** I SSH into the EC2 server and run:

1. Write the `.env` file from the `DEV_ENV_FILE` GitHub secret — this is how all environment variables reach the server securely on every deploy
2. Pull the latest images with `docker compose pull`
3. Restart all services with `docker compose up -d --remove-orphans`
4. Prune dangling images with `docker image prune -f` to keep disk usage clean

**How the .env file gets to EC2:**

I store the entire contents of my `.env` file as a single GitHub Secret called `DEV_ENV_FILE` in the `development` environment. I go to **Settings → Environments → development → Secrets → Add secret**, set the name to `DEV_ENV_FILE`, and paste the raw file contents as the value — no quotes, no escaping, exactly as the file looks locally:

```
SECRET_KEY=django-insecure-xxxxxxxxxxxxxxxx
DEBUG=False

DB_NAME=shophive
DB_USER=postgres
DB_PASSWORD=yourpassword
DB_HOST=postgres
DB_PORT=5432
```

On every deploy the pipeline writes this to `~/shophive/.env` on the server with:

```bash
echo "$DEV_ENV_FILE" > .env
```

I never need to manually SSH into the server to update environment variables. I update the secret in GitHub and the next deploy picks it up automatically.

---

#### health-check — Post-Deploy Verification

After deploy, I SSH back into the EC2 server and poll the `/api/health/` endpoint up to 12 times with a 10-second wait between each attempt — 2 minutes total.

If the endpoint responds with HTTP 200, the health check passes and the pipeline succeeds. If it never responds after 2 minutes, the job exits with code 1.

---

## EC2 Server Setup (one-time)

Before the pipeline can deploy for the first time, I do the following on the EC2 instance:

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

## Compose File Strategy

I maintain two compose files:

- `compose.yml` — used locally, contains `build:` contexts for backend and frontend so I can build and test locally
- `compose.dev.yml` — used on EC2, references pre-built Docker Hub images instead of building

```yaml
# compose.dev.yml
services:
  backend:
    image: kailashbadu/shophive-backend:dev-latest

  frontend:
    image: kailashbadu/shophive-frontend:dev-latest
```

The pipeline copies `compose.dev.yml` to the server on every deploy, so it always stays in sync with the repository.

When `docker compose up` runs on EC2, postgres, nginx, and volume-init are all pre-built public images — they pull from Docker Hub with no build step and no significant delay. Only backend and frontend are custom images, and those are already built and pushed to Docker Hub before the deploy step runs.

---

## Artifacts Produced Per Run

Every run produces downloadable scan reports under the Artifacts section of the Actions run page.

| Artifact                 | Job               | Contents                                   | Retention |
| ------------------------ | ----------------- | ------------------------------------------ | --------- |
| `bandit-report-dev`      | `sast`            | Bandit JSON report                         | 7 days    |
| `dependency-report-dev`  | `dependency-scan` | pip-audit JSON + npm-audit JSON            | 7 days    |
| `trivy-fs-report-dev`    | `trivy-fs`        | Trivy filesystem scan table                | 7 days    |
| `trivy-image-report-dev` | `trivy-image`     | Trivy backend + frontend image scan tables | 7 days    |

---

## Security Tool Reference

### Gitleaks

Scans Git history for hardcoded secrets using pattern matching against known secret formats. Runs against full commit history with `fetch-depth: 0`.

### Bandit

Open-source SAST tool for Python by the Python Code Quality Authority (PyCQA). Parses source files into an Abstract Syntax Tree and runs security plugins against the code structure rather than doing simple text searches.

### pip-audit

Audits Python dependencies in `requirements.txt` against the Python Advisory Database for known CVEs.

### npm audit

Audits Node.js dependencies against the npm security advisory database for known vulnerabilities.

### Trivy (Aqua Security)

A comprehensive vulnerability scanner covering:

- `trivy fs` — scans source code, lock files, and config for CVEs before build
- `trivy image` — scans built Docker images including base image layers and installed OS packages

---

## References

- Security in CI/CD pipelines: https://youtu.be/ZUquwnJnfNw?si=kpxbcQ3MJAyJLy7y

---

## Final dev.yml

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
          GITHUB_TOKEN: ${{secrets.GITHUB_TOKEN}}

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
    name: Trivy filesystem Scan
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

      - name: Upload Trivy Fs Report
        uses: actions/upload-artifact@v7
        if: always()
        with:
          name: trivy-fs-report-dev
          path: trivy-fs-results.txt
          retention-days: 7

  build:
    name: Build Docker Image and push to doker hub
    runs-on: ubuntu-latest
    environment: development
    needs:
      - sast
      - dependency-scan
      - trivy-fs
    outputs:
      tag: ${{ steps.version.outputs.tag}}
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
          username: ${{secrets.DOCKERHUB_USERNAME}}
          password: ${{secrets.DOCKERHUB_TOKEN}}

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

      - name: Upload Trivy Fs Report
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
    name: Health check
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

## Staging Pipeline

Coming soon.

Will follow the same structure as dev with the following differences:

- Triggers on push to the `qa` branch
- Deploys to the staging EC2 server using `STAGING_EC2_HOST` and `STAGING_EC2_SSH_KEY`
- Trivy scans will use `exit-code: 1` to hard-block on HIGH and CRITICAL findings
- Bandit and pip-audit will also hard-block rather than warn
- Intended for QA team testing before merge to production

---

## Production Pipeline

Coming soon.

Will follow a different deployment path from dev and staging:

- Triggers on Git tags matching `v*.*.*`
- Images pushed to AWS ECR instead of Docker Hub
- Deployment via AWS CodeDeploy with a manual approval gate before any traffic shifts
- Uses `appspec.yml` and `scripts/deploy.sh` for CodeDeploy lifecycle hooks
- IAM policy scoped to CI user with least-privilege permissions
- All Trivy, Bandit, and dependency scans hard-block on any HIGH or CRITICAL finding
