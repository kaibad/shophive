# ShopHive: Staging Pipeline Documentation

---

## 1. Overview

The staging pipeline builds on the development pipeline's foundation with additional gates: Dockerfile linting with Hadolint, hard-blocking security scans, SBOM generation, Cosign image signing, and a manual approval checkpoint before deployment.

It follows the same overall structure as the development pipeline, with several important differences aimed at enforcing stricter quality and security gates before code reaches the QA environment:

- Triggers on push to the `qa` branch.
- Deploys to the staging EC2 server using `STAGING_EC2_HOST` and `STAGING_EC2_SSH_KEY`.
- Trivy scans use `exit-code: 1` to hard-block on HIGH and CRITICAL findings.
- Bandit and pip-audit also hard-block rather than warn.
- Adds Dockerfile linting with Hadolint.
- Adds SBOM generation and image signing with Cosign.
- Adds a manual approval gate before deployment.
- Intended for QA team testing before merge to production.

For the base pipeline structure — Gitleaks, Bandit, dependency scanning, and the overall environment setup see the [Development Pipeline documentation](./dev.md).

---

## 2. Resolving npm Audit Vulnerabilities

### 2.1 Problem

The GitHub Actions staging pipeline was failing at the dependency security scan step. The failure was caused by:

```bash
npm audit --audit-level high --json > npm-audit.json
```

This command returned exit code `1` because high-severity vulnerabilities were detected:

```
12 vulnerabilities (1 low, 4 moderate, 7 high)

Error: Process completed with exit code 1.
```

Since the pipeline is configured as a security gate, the build correctly failed when high-severity vulnerabilities were found.

### 2.2 Investigation Process

**Step 1 — Downloaded the npm audit report from GitHub Actions artifacts.**

The workflow was already generating an audit report at `frontend/npm-audit.json`. The artifact was downloaded from the failed run and analyzed:

```json
{
  "high": 7,
  "moderate": 4,
  "low": 1,
  "critical": 0,
  "total": 12
}
```

**Step 2 — Identified the vulnerable dependencies.**

Direct dependencies:

| Package            | Installed Version | Affected Range | Severity |
| ------------------ | ----------------- | -------------- | -------- |
| `react-router-dom` | 7.9.5             | 7.0.0 – 7.11.0 | High     |
| `vite`             | 7.1.7             | 7.0.0 – 7.3.3  | High     |

Transitive dependencies also flagged: `flatted`, `minimatch`, `picomatch`, `rollup`, `brace-expansion`, `ajv`, `js-yaml`, `@babel/core`. These were not installed directly — they were pulled in by other dependencies.

**Step 3 — Checked installed package versions.**

```bash
npm list react-router-dom react-router vite rollup
```

The dependency tree was initially empty because dependencies had not been installed. After running:

```bash
npm install
npm list --depth=0
```

the output confirmed:

```
react-router-dom@7.9.5
vite@7.2.2
```

Both versions were still inside the vulnerable ranges.

**Step 4 — Updated the dependencies.**

Checked the latest available versions:

```bash
npm view react-router-dom version
npm view vite version
```

```
react-router-dom: 7.18.1
vite: 8.1.3
```

Updated:

```bash
npm install react-router-dom@latest vite@latest
```

This reduced the vulnerability count from 12 (7 high) to 6 (2 high).

**Step 5 — Vite 8 dependency conflict.**

After upgrading Vite to version 8, npm reported a peer dependency conflict:

```
Could not resolve dependency:

peer vite "^5.2.0 || ^6 || ^7"
from @tailwindcss/vite@4.1.17
```

The cause was that `@tailwindcss/vite@4.1.17` and `@vitejs/plugin-react@5.1.0` did not yet support Vite 8.

**Step 6 — Downgraded Vite to a supported version.**

```bash
npm install vite@7.3.6
```

**Step 7 — Regenerated the dependency tree.**

The existing `package-lock.json` still contained vulnerable dependency versions:

```bash
rm -rf node_modules package-lock.json
npm install
```

This regenerated `node_modules/` and `package-lock.json` with updated dependency versions.

**Step 8 — Verified security status.**

```bash
npm audit
```

```
found 0 vulnerabilities
```

```bash
npm audit fix
npm audit
```

```
up to date, audited 171 packages
found 0 vulnerabilities
```

### 2.3 Final Result

| Metric   | Before | After |
| -------- | ------ | ----- |
| Total    | 12     | 0     |
| High     | 7      | 0     |
| Moderate | 4      | 0     |
| Low      | 1      | 0     |
| Critical | 0      | 0     |

### 2.4 Changes Made

Dependency changes:

- Updated `react-router-dom`
- Updated `vite`
- Regenerated `package-lock.json`
- Updated transitive dependencies automatically

Commands used:

```bash
npm audit
npm list --depth=0
npm view react-router-dom version
npm view vite version
npm install react-router-dom@latest vite@latest
npm install vite@7.3.6
rm -rf node_modules package-lock.json
npm install
npm audit fix
npm audit
```

### 2.5 Verification

The dependency security scan in GitHub Actions now passes, since:

```bash
npm audit --audit-level high
```

returns exit code `0`, and no high-severity vulnerabilities remain.

---

## 3. Dockerfile Linting with Hadolint

Hadolint is a linter specifically for Dockerfiles. It checks a Dockerfile against Docker best practices and catches issues such as:

- Using `latest` tags instead of pinned versions (non-reproducible builds)
- Missing `--no-install-recommends` or not cleaning up package caches (bloats image size)
- Running as root instead of a non-root `USER`
- Using `ADD` when `COPY` would be safer and more predictable
- Not combining `RUN` layers efficiently
- Leaking secrets via `ARG` or build arguments
- Improper `CMD`/`ENTRYPOINT` usage

Hadolint is rule-based (built on ShellCheck for the shell-script portions), so it does not catch runtime vulnerabilities the way Trivy does — it is purely concerned with how the Dockerfile itself is written. It is a good complement to Trivy: Hadolint checks the build instructions, while Trivy checks what ends up inside the resulting image.

```yaml
hadolint:
  name: Dockerfile Lint (Hadolint)
  runs-on: ubuntu-latest
  needs: gitleaks
  steps:
    - name: Checkout repo
      uses: actions/checkout@v7

    - name: Run Hadolint on Backend Dockerfile
      uses: hadolint/hadolint-action@v3.1.0
      with:
        dockerfile: backend/Dockerfile
        output-file: hadolint-backend.txt
        no-fail: true

    - name: Run Hadolint on Frontend Dockerfile
      uses: hadolint/hadolint-action@v3.1.0
      with:
        dockerfile: frontend/Dockerfile
        output-file: hadolint-frontend.txt
        no-fail: true

    - name: Upload Hadolint Reports
      if: always()
      uses: actions/upload-artifact@v7
      with:
        name: hadolint-report-staging
        path: |
          hadolint-backend.txt
          hadolint-frontend.txt
        retention-days: 14
```

---

## 4. Build Stage: Docker Build and Push

### 4.1 Overview

The build stage creates Docker images for the backend and frontend applications and pushes them to Docker Hub after all preceding security checks pass.

### 4.2 Steps Performed

1. **Checkout repository** — downloads the latest source code.
2. **Generate image tag** — creates a unique Docker image tag from the Git commit SHA, in the format `staging-<short-sha>`.
3. **Docker Hub login** — authenticates using configured GitHub secrets.
4. **Setup Docker Buildx** — enables advanced build features and layer caching.
5. **Build and push backend image** — builds the backend image from the `backend` directory and pushes it with tags `staging-<commit-sha>` and `latest-staging`, using GitHub Actions cache to speed up future builds.
6. **Build and push frontend image** — builds the frontend image from the `frontend` directory and pushes it with the same tagging scheme, also using GitHub Actions cache.

### 4.3 Output

The build stage exports the backend image digest, the frontend image digest, and the generated image tag. These outputs are consumed by the later SBOM, signing, and deployment stages.

```yaml
build:
  name: Build Docker Images and push to Docker Hub
  runs-on: ubuntu-latest
  environment: staging
  needs:
    - sast
    - dependency-scan
    - trivy-fs
    - hadolint
  outputs:
    tag: ${{ steps.version.outputs.tag }}
    backend_digest: ${{ steps.build-backend.outputs.digest }}
    frontend_digest: ${{ steps.build-frontend.outputs.digest }}
  steps:
    - name: Checkout repo
      uses: actions/checkout@v7

    - name: Generate Image Tag
      id: version
      run: |
        SHORT_SHA=${GITHUB_SHA::7}
        echo "tag=staging-${SHORT_SHA}" >> $GITHUB_OUTPUT

    - name: Docker Login
      uses: docker/login-action@v4
      with:
        username: ${{ secrets.DOCKERHUB_USERNAME }}
        password: ${{ secrets.DOCKERHUB_TOKEN }}

    - name: Setup Buildx
      uses: docker/setup-buildx-action@v4

    - name: Build and push Backend Image
      id: build-backend
      uses: docker/build-push-action@v7
      with:
        context: ./backend
        push: true
        tags: |
          ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.BACKEND_IMAGE }}:${{ steps.version.outputs.tag }}
          ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.BACKEND_IMAGE }}:latest-staging
        cache-from: type=gha
        cache-to: type=gha,mode=max

    - name: Build and Push Frontend Image
      id: build-frontend
      uses: docker/build-push-action@v7
      with:
        context: ./frontend
        push: true
        tags: |
          ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.FRONTEND_IMAGE }}:${{ steps.version.outputs.tag }}
          ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.FRONTEND_IMAGE }}:latest-staging
        cache-from: type=gha
        cache-to: type=gha,mode=max
```

---

## 5. Trivy Image Scan

### 5.1 What Is Trivy?

Trivy is an open-source container security scanner by Aqua Security. It checks Docker images for known vulnerabilities (CVEs) in OS packages and application dependencies.

### 5.2 Why This Job Is Used

The `trivy-image` job scans the backend and frontend Docker images before deployment to detect security risks. It prevents images with HIGH or CRITICAL vulnerabilities from being released.

### 5.3 Job Flow

1. Runs after the `build` job completes.
2. Scans the backend and frontend Docker images using Trivy.
3. Checks only HIGH and CRITICAL vulnerabilities.
4. Fails the pipeline if serious vulnerabilities are found.
5. Uploads scan reports as GitHub Actions artifacts for review.

### 5.4 Key Settings

- `scan-type: image` — scans Docker images.
- `severity: HIGH,CRITICAL` — reports only serious issues.
- `exit-code: 1` — fails the job when vulnerabilities are detected.
- `output` — saves scan results to report files.
- `retention-days: 14` — keeps reports for 14 days.

Trivy works as a security gate in this pipeline to ensure only safer container images are deployed.

```yaml
trivy-image:
  name: Trivy Image Scan
  runs-on: ubuntu-latest
  environment: staging
  needs: build
  steps:
    - name: Scan Backend Image
      uses: aquasecurity/trivy-action@v0.36.0
      with:
        scan-type: image
        image-ref: ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.BACKEND_IMAGE }}:${{ needs.build.outputs.tag }}
        format: table
        severity: HIGH,CRITICAL
        exit-code: 1
        output: trivy-backend-image.txt

    - name: Scan Frontend Image
      uses: aquasecurity/trivy-action@v0.36.0
      with:
        scan-type: image
        image-ref: ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.FRONTEND_IMAGE }}:${{ needs.build.outputs.tag }}
        format: table
        severity: HIGH,CRITICAL
        exit-code: 1
        output: trivy-frontend-image.txt

    - name: Upload Trivy Image Reports
      uses: actions/upload-artifact@v7
      if: always()
      with:
        name: trivy-image-report-staging
        path: |
          trivy-backend-image.txt
          trivy-frontend-image.txt
        retention-days: 14
```

### 5.5 Resolving a Trivy Image Scan Failure

The pipeline failed at the Trivy image scan step because Trivy detected HIGH and CRITICAL vulnerabilities in the backend Docker image.

The Trivy image report artifact was downloaded from GitHub Actions and analyzed. The issue was caused by vulnerable Alpine OS packages inside the image, including:

- `openssl`
- `libssl3`
- `libcrypto3`
- `expat`
- `musl`
- `sqlite-libs`
- `zlib`

The Python dependencies themselves were clean; the vulnerabilities originated from the base image:

```dockerfile
FROM dhi.io/python:3.13-alpine3.21
```

The fix was to add an Alpine package update step during the Docker build process:

```dockerfile
RUN apk update && apk upgrade
```

This updates system packages with available security patches and improves the container image's security posture. After rebuilding the image and rerunning the pipeline, Trivy verified the updated image successfully.

---

## 6. SBOM Generation and Image Signing

**SBOM (Software Bill of Materials)**

An SBOM is a detailed inventory of all components, libraries, and dependencies used in a software application. It helps organizations understand what exists inside their software and quickly identify affected components when vulnerabilities are discovered.

Example:

Application: payment-service

Components:

- Python 3.12
- Flask 3.0
- OpenSSL 3.0
- Requests 2.31

SBOM answers: "What is inside my software?"

Common SBOM formats: SPDX, CycloneDX, Image Signing

Image signing provides authenticity and integrity for container images. It proves that an image was created by a trusted source and has not been modified after signing.

Example:

```
payment-service:v1
        |
        |
     Signature
```

Before deployment, the platform verifies the signature:

Valid Signature -> Deploy
Invalid Signature -> Reject

Common tools: Cosign, Notary,

How SBOM and Image Signing Work Together

A secure CI/CD pipeline usually follows this flow:

```
Source Code
     |
     v
Build Container Image
     |
     +----------------+
     |                |
     v                v
Generate SBOM     Security Scan
     |
     v
Sign Image
     |
     v
Deploy Application
```

SBOM provides visibility into the software contents, while image signing ensures the software image is trusted and unchanged.

Difference Between SBOM, Dependency Scan, Audit, and Trivy

| Item             | Purpose                                                  | Answers                                             |
| ---------------- | -------------------------------------------------------- | --------------------------------------------------- |
| SBOM             | Lists software components                                | What is inside my application?                      |
| Dependency Scan  | Finds vulnerable dependencies                            | Are my libraries affected by known vulnerabilities? |
| Dependency Audit | Checks dependency policies, licenses, and risks          | Are my dependencies acceptable?                     |
| Trivy            | Security scanner for images, filesystems, and Kubernetes | Are there vulnerabilities or misconfigurations?     |

## Example Workflow

| Step | Activity                                                                |
| ---- | ----------------------------------------------------------------------- |
| 1    | Developer builds a container image                                      |
| 2    | SBOM is generated to record all packages                                |
| 3    | Trivy scans the image for vulnerabilities                               |
| 4    | Image is signed using Cosign                                            |
| 5    | Production verifies the signature and security checks before deployment |

**_Summary_**

SBOM = Software inventory
Image Signing = Trust verification
Dependency Scan = Vulnerability detection
Dependency Audit = Dependency compliance check
Trivy = Security scanning tool

### 6.1 What Is This Job?

The `sbom-and-sign` job improves container security by generating a Software Bill of Materials (SBOM) and digitally signing the Docker images. It runs after the Docker image build and the Trivy vulnerability scan.

### 6.2 Why It Is Needed

**SBOM** — a list of all software components inside a container image. It helps to:

- Track dependencies and packages
- Identify vulnerable components quickly
- Improve software supply chain visibility
- Support security audits

This job generates SBOM files for the backend and frontend images in CycloneDX format:

```
sbom-backend.cdx.json
sbom-frontend.cdx.json
```

Reports are uploaded as GitHub Actions artifacts and retained for 30 days.

**Image signing** — the job uses Cosign to sign Docker images. Image signing ensures:

- The image was created by a trusted CI/CD pipeline
- The image has not been modified after build
- Deployment systems can verify image authenticity

Cosign uses GitHub OIDC keyless signing, so no private signing key needs to be stored in GitHub Secrets.

### 6.3 Security Flow

```
Build Images
     │
     ▼
Trivy Scan
     │
     ▼
Generate SBOM
     │
     ▼
Sign Images with Cosign
     │
     ▼
Deploy Trusted Images
```

### 6.4 Summary

This job secures the container supply chain by creating an inventory of image components (SBOM), providing transparency about dependencies, and signing images to verify authenticity before deployment.

```yaml
sbom-and-sign:
  name: Generate SBOM and Sign Images
  runs-on: ubuntu-latest
  environment: staging
  permissions:
    contents: read
    id-token: write
  needs:
    - build
    - trivy-image
  steps:
    - name: Generate Backend SBOM (CycloneDX)
      uses: aquasecurity/trivy-action@v0.36.0
      with:
        scan-type: image
        image-ref: ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.BACKEND_IMAGE }}:${{ needs.build.outputs.tag }}
        format: cyclonedx
        output: sbom-backend.cdx.json

    - name: Generate Frontend SBOM (CycloneDX)
      uses: aquasecurity/trivy-action@v0.36.0
      with:
        scan-type: image
        image-ref: ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.FRONTEND_IMAGE }}:${{ needs.build.outputs.tag }}
        format: cyclonedx
        output: sbom-frontend.cdx.json

    - name: Upload SBOMs
      uses: actions/upload-artifact@v7
      with:
        name: sbom-staging
        path: |
          sbom-backend.cdx.json
          sbom-frontend.cdx.json
        retention-days: 30

    - name: Install cosign
      uses: sigstore/cosign-installer@v3

    - name: Docker Login
      uses: docker/login-action@v4
      with:
        username: ${{ secrets.DOCKERHUB_USERNAME }}
        password: ${{ secrets.DOCKERHUB_TOKEN }}

    - name: Sign Backend Image (keyless, GitHub OIDC)
      run: |
        cosign sign --yes \
          ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.BACKEND_IMAGE }}@${{ needs.build.outputs.backend_digest }}

    - name: Sign Frontend Image (keyless, GitHub OIDC)
      run: |
        cosign sign --yes \
          ${{ secrets.DOCKERHUB_USERNAME }}/${{ vars.FRONTEND_IMAGE }}@${{ needs.build.outputs.frontend_digest }}
```

### 6.5 Note on OIDC Permissions

Interactive prompts asking to click a link and log in occur because Cosign keyless signing is waiting for an interactive OIDC authentication flow. That behavior is convenient for local development but is not suitable inside GitHub Actions.

For GitHub Actions, GitHub's OIDC identity token should be used instead, so that signing is completely automatic. This requires adding OIDC permissions, either at the top of the workflow or scoped to the `sbom-and-sign` job:

```yaml
permissions:
  contents: read
  id-token: write
```

The critical permission is `id-token: write`. Without it, Cosign cannot obtain a GitHub OIDC token automatically.

---

## 7. Manual Approval Gate

This pattern uses GitHub Actions Environments as a deployment gate. The `approval` job itself performs no meaningful action — it exists only to force the workflow to pause until someone approves it.

### 7.1 Flow

```
trivy-image
    │
    ├──────────────┐
    │              │
sbom-and-sign      │
    │              │
    └──────► approval (waits for manual approval)
                    │
            Reviewer clicks Approve
                    │
                    ▼
                 deploy
```

### 7.2 How It Works

```yaml
approval:
  name: Manual Approval for Staging Deploy
  runs-on: ubuntu-latest
  needs:
    - trivy-image
    - sbom-and-sign
  environment: staging-deploy-approval
  steps:
    - name: Approval checkpoint
      run: echo "Approved for staging deployment."
```

The important line is `environment: staging-deploy-approval`. When GitHub encounters this, it checks the environment named `staging-deploy-approval`. If that environment has required reviewers configured, GitHub will:

1. Run `trivy-image`.
2. Run `sbom-and-sign`.
3. Reach the `approval` job and pause the workflow.
4. Display "Waiting for approval" and notify the required reviewers, if notifications are enabled.
5. Wait until one of the reviewers approves.
6. Run the `approval` job.
7. Continue to the `deploy` job.

### 7.3 Configuration

Navigate to **Repository → Settings → Environments** and create an environment named exactly `staging-deploy-approval`. Configure **Required reviewers**, adding individual reviewers or a team, then save.

### 7.4 What the Reviewer Sees

In the Actions page, the workflow will appear roughly as follows:

```
[done] Build
[done] Scan
[paused] Manual Approval for Staging Deploy — Waiting for review
[skipped] Deployment to the Staging Server — Skipped until approval
```

The reviewer opens the workflow, selects **Review deployments**, then either **Approve and deploy** or rejects the run.

- If rejected, the workflow stops and the `deploy` job never starts.
- If approved, the `approval` job completes almost instantly, and because `deploy` depends on `approval`, deployment begins.

### 7.5 Why Use a Separate Approval Job

Rather than attaching the approval directly to the `deploy` job's environment, the approval step is isolated into its own job. Benefits:

- Security scans complete first, so reviewers only approve deployments that have already passed scanning.
- The `staging` deployment environment can retain its own secrets and protection rules, separate from the approval gate.

### 7.6 Deploy Job

```yaml
deploy:
  name: Deployment to the Staging Server
  runs-on: ubuntu-latest
  needs: approval
  environment: staging
  steps:
    - name: Checkout repo
      uses: actions/checkout@v7

    - name: Copy compose files to EC2
      uses: appleboy/scp-action@v0.1.7
      with:
        host: ${{ secrets.STAGING_EC2_HOST }}
        username: ${{ secrets.STAGING_EC2_USER }}
        key: ${{ secrets.STAGING_EC2_SSH_KEY }}
        source: "compose.staging.yml,nginx/,scripts/"
        target: "~/shophive"

    - name: Deploy via SSH
      uses: appleboy/ssh-action@v1.2.0
      with:
        host: ${{ secrets.STAGING_EC2_HOST }}
        username: ${{ secrets.STAGING_EC2_USER }}
        key: ${{ secrets.STAGING_EC2_SSH_KEY }}
        envs: STAGING_ENV_FILE
        script: |
          set -e
          cd ~/shophive

          echo "$STAGING_ENV_FILE" > .env

          docker compose -f compose.staging.yml pull
          docker compose -f compose.staging.yml up -d --remove-orphans
          docker image prune -f
      env:
        STAGING_ENV_FILE: ${{ secrets.STAGING_ENV_FILE }}
```

---

## 8. Branch Protection

### 8.1 Goal

- `qa` only accepts changes from `dev`.
- `main` only accepts changes from `qa`.
- Both require passing status checks and pull request approvals.

GitHub branch protection rules can enforce reviews, status checks, and merge restrictions, but they cannot directly enforce that a pull request's source branch must be exactly `dev` or `qa`. The closest achievable setup combines native branch protection with a validation workflow.

### 8.2 Branch: `qa`

Configure branch protection for `qa`:

- Require a pull request before merging
- Require one or more approving reviews
- Dismiss stale approvals when new commits are pushed (recommended)
- Require status checks to pass before merging
- Require branches to be up to date before merging
- Require conversation resolution before merging
- Restrict who can push directly (optional but recommended)
- Do not allow force pushes
- Do not allow deletions

This ensures all changes go through a reviewed pull request.

### 8.3 Branch: `main`

Apply the same protections:

- Require pull request
- Require approvals
- Require status checks
- Require branch to be up to date
- Require conversation resolution
- Restrict direct pushes

### 8.4 Restricting the Source Branch

GitHub does not have a built-in setting equivalent to "only allow PRs into `qa` from `dev`" or "only allow PRs into `main` from `qa`." To enforce this, a validation workflow is used as a required status check.

**For pull requests into `qa`:**

```yaml
name: Validate PR Source

on:
  pull_request:
    branches: [qa]

jobs:
  check-source:
    runs-on: ubuntu-latest
    steps:
      - name: Verify source branch
        run: |
          if [ "${{ github.head_ref }}" != "dev" ]; then
            echo "PRs into qa must come from dev."
            exit 1
          fi
```

**For pull requests into `main`:**

```yaml
name: Validate PR Source

on:
  pull_request:
    branches: [main]

jobs:
  check-source:
    runs-on: ubuntu-latest
    steps:
      - name: Verify source branch
        run: |
          if [ "${{ github.head_ref }}" != "qa" ]; then
            echo "PRs into main must come from qa."
            exit 1
          fi
```

These workflows are then added as required status checks in the branch protection rules for `qa` and `main` respectively.

This configuration effectively blocks pull requests such as `feature → qa`, `hotfix → qa`, or `dev2 → qa`, and only allows `dev → qa`. The same principle applies to `main`, allowing only `qa → main`.

---

## 9. Next Steps

See the [Development Pipeline documentation](./dev.md) for the foundational pipeline structure this staging workflow extends.

Once a release is validated in staging, promotion to production follows a Git tag (`v*.*.*`) combined with a manual approval step, deploying to AWS ECR and ECS/CodeDeploy. Full production pipeline documentation will be published in [prod.md](./prod.md).

```

```
