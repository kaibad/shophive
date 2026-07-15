# ShopHive Production Pipeline

## Overview

The production pipeline builds, scans, signs, and pushes container images to AWS ECR whenever a Git tag matching `v*.*.*` is pushed. It follows a different path from the dev and staging pipelines by design: production images are pushed to a private registry (ECR, not Docker Hub), authentication uses short-lived federated credentials instead of static keys, and the actual deployment step is deliberately manual rather than automated.

**Trigger:** `push: tags: ["v*.*.*"]`, with an optional `workflow_dispatch` fallback that requires an explicit `confirm: deploy` input to prevent accidental manual runs.

---

## Pipeline Stages

| Stage            | Purpose                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `guard`          | Validates the trigger — blocks manual runs unless `confirm` is explicitly set to `deploy`.                                                             |
| `secrets-scan`   | Gitleaks scan across full repo history for leaked credentials.                                                                                         |
| `code-scan`      | Dependency and filesystem vulnerability scans (`pip-audit`, `npm audit`, Trivy FS) for backend and frontend, matrixed.                                 |
| `build-and-push` | Builds each image, tags it for ECR, scans it with Trivy, pushes it, captures its digest, signs it with cosign, generates and attests a CycloneDX SBOM. |

### Why some staging-pipeline steps were intentionally dropped in production

**Bandit (backend SAST)** — removed from the production pipeline. Bandit's findings depend only on source code, not on environment or time. Production tags are cut from code that has already merged and been scanned through the staging pipeline, so re-running Bandit against identical source adds no new signal. It remains in staging, where it catches issues on new code as it lands.

**Local Trivy image scan** — removed as a hard pre-push gate. ECR repositories have scan-on-push enabled at the infrastructure level, so every image pushed by this pipeline is scanned server-side regardless of whether CI scans it first. Running Trivy locally in CI duplicated that work and added scan time to every run.

> **Tradeoff:** previously, a failed local scan blocked the push. That gate has moved downstream — the pipeline now pushes unconditionally, and ECR's scan-on-push results should be checked for a given tag before promoting it to any environment.

**Kept unchanged:** Gitleaks, pip-audit, npm audit, and Trivy filesystem scans remain in the production pipeline. Unlike Bandit, these check against vulnerability databases that update daily — a dependency that was clean in staging can have a new CVE disclosed by the time a tag is cut days later. They're cheap to run (seconds to low minutes), so re-running them at each stage is worth it independent of whether the source itself changed.

---

## Authentication: Moving from Static Keys to OIDC

### The problem

The pipeline originally authenticated to AWS using long-lived static credentials:

```yaml
- name: Configure AWS Credentials
  uses: aws-actions/configure-aws-credentials@v6.1.0
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: ${{ secrets.AWS_REGION }}
```

This carries real downsides for a production pipeline specifically:

- **No expiration.** A static access key/secret pair is valid until someone manually rotates or revokes it — potentially indefinitely if a leak goes unnoticed.
- **Not scoped to the workflow.** The key works from anywhere it's copied to — a laptop, a different repo, a different branch. Nothing ties it to "only GitHub Actions, only this repo, only tag pushes."
- **Sits in secrets at rest, permanently.** Even if never leaked, it's a standing credential in GitHub's secret store rather than something minted fresh per run and discarded afterward.

### The fix: GitHub OIDC federation

Instead of a stored key, GitHub mints a short-lived, cryptographically signed identity token for the specific job run, tied to the repository, ref, and workflow. AWS IAM trusts GitHub's OIDC provider and exchanges that token for temporary session credentials, which expire automatically (typically within an hour). The IAM role's trust policy restricts exactly which repository and context is allowed to assume it — so even if a workflow run were compromised, the blast radius is bounded by AWS, not by convention.

**Changes made to the workflow:**

- `configure-aws-credentials` now uses `role-to-assume` (an IAM role ARN) instead of static access keys.
- Manual `docker login` via `aws ecr get-login-password` is replaced by `aws-actions/amazon-ecr-login`, which performs the ECR auth token exchange using the already-assumed role.
- The registry endpoint is read from `steps.ecr-login.outputs.registry` rather than stored as a secret.
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` secrets are no longer used and can be deleted once the OIDC path is confirmed working.

### AWS setup (manual, console-based)

1. **Add GitHub's OIDC identity provider to IAM** (one-time per AWS account):
   - IAM → Identity providers → Add provider
   - Provider type: OpenID Connect
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`

2. **Create the IAM role**:
   - IAM → Roles → Create role → Trusted entity type: Web identity
   - Identity provider: the one created above
   - GitHub organization / repository: filled in; **branch field left blank** (see note below)

3. **Set the trust policy by hand:**

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Principal": {
           "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
         },
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
             "token.actions.githubusercontent.com:sub": "repo:kaibad/shophive:environment:production"
           }
         }
       }
     ]
   }
   ```

   **Note on the branch field:** the console's guided branch/tag field generates a `ref:refs/heads/...` or `ref:refs/tags/...` style condition. Since `build-and-push` runs under `environment: production`, GitHub issues the token with the subject `repo:kaibad/shophive:environment:production` — not a ref-based subject. A console-generated `ref` condition will never match this token shape and will silently block role assumption, so the trust policy's `sub` condition is written by hand to match the environment-based claim instead.

4. **Attach a least-privilege ECR push policy:**

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "ecr:GetAuthorizationToken",
         "Resource": "*"
       },
       {
         "Effect": "Allow",
         "Action": [
           "ecr:BatchCheckLayerAvailability",
           "ecr:GetDownloadUrlForLayer",
           "ecr:BatchGetImage",
           "ecr:PutImage",
           "ecr:InitiateLayerUpload",
           "ecr:UploadLayerPart",
           "ecr:CompleteLayerUpload"
         ],
         "Resource": [
           "arn:aws:ecr:ap-south-1:<ACCOUNT_ID>:repository/shophive-prod/backend",
           "arn:aws:ecr:ap-south-1:<ACCOUNT_ID>:repository/shophive-prod/frontend"
         ]
       }
     ]
   }
   ```

   `ecr:GetAuthorizationToken` must remain scoped to `Resource: "*"` — this is an ECR API constraint, not a scoping choice; the action doesn't support resource-level restriction. Everything else is scoped to the two production repositories.

5. **Store the role ARN as a GitHub environment secret:**
   - Settings → Environments → `production` → Environment secrets
   - Name: `AWS_ECR_PUSH_ROLE_ARN`
   - Value: the role's ARN (`arn:aws:iam::<ACCOUNT_ID>:role/shophive-prod-ecr-push`)

### Validating OIDC independently

A standalone `workflow_dispatch`-only workflow (`validate-oidc.yml`) was added to test the trust policy, role, and secret chain in isolation — assuming the role and calling `sts get-caller-identity` — without running the full production pipeline. This significantly shortens the debug loop when troubleshooting trust policy issues, since failures surface in seconds rather than after several minutes of unrelated build/scan steps.

---

## Branch Strategy Change: Removing the QA Branch

Maintaining a separate long-lived `qa` branch added unnecessary complexity — extra pull requests and merge commits with no corresponding value, since the branch existed purely to gate staging deploys.

**Change:** the staging pipeline's trigger moved from `push: branches: [qa]` to `push: branches: [main]`. Merges into `main` now trigger staging automatically; once staging passes, a release tag (`vX.Y.Z`) is created manually to trigger production.

**Issue encountered:** after retargeting the trigger, the pipeline began failing with _"Branch 'main' is not allowed to deploy to staging due to environment protection rules."_ This was not a workflow YAML issue — GitHub Environments (`staging`, `staging-deploy-approval`) had branch-deployment policies still restricted to the old `qa` branch, configured separately under **Settings → Environments → [environment] → Deployment branches and tags**. GitHub enforces these rules before a job with `environment:` is permitted to run, independent of the workflow file itself.

**Resolution:** updated each affected environment's deployment branch policy to permit `main` (or removed branch-level restriction entirely, since `qa` no longer exists as a concept in the new flow).

---

## Deployment: Docker Compose

Production runs via Docker Compose on an EC2 host, pulling signed images from ECR by tag.

```yaml
services:
  postgres:
    image: postgres:15-alpine
    container_name: prod_postgres
    restart: always
    env_file:
      - .env
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    # No host port mapping in prod — RDS is the intended long-term target;
    # this remains only for environments still running Postgres in-container.

  volume-init:
    image: busybox
    container_name: volume_init
    user: root
    command:
      - sh
      - -c
      - chown -R 65532:65532 /app/media /app/staticfiles
    volumes:
      - static_volume:/app/staticfiles
      - media_volume:/app/media

  backend:
    image: ${ECR_REGISTRY}/shophive-prod/backend:${IMAGE_TAG}
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
    image: ${ECR_REGISTRY}/shophive-prod/frontend:${IMAGE_TAG}
    container_name: react_frontend
    restart: unless-stopped
    environment:
      VITE_DJANGO_BASE_URL: ${VITE_DJANGO_BASE_URL}
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
      - "443:443"
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

`ECR_REGISTRY` and `IMAGE_TAG` are supplied via `.env` on the deploy host, keeping which image version is running independent of the compose file itself.

In GitHub Actions, strategy.matrix lets a single job definition run multiple times in parallel, each with different variable values substituted in — instead of writing the same job twice (or more) with only small differences.

```yml
strategy:
  matrix:
    component: [backend, frontend]
```

This tells GitHub Actions: run this job twice, once with matrix.component = backend and once with matrix.component = frontend. Both runs execute in parallel, as separate job instances, each with its own logs, its own runner, its own pass/fail status.

Anywhere in the job you reference ${{ matrix.component }}, it gets substituted with whichever value that particular run got assigned.

**Why it's used**

Without matrix, if you wanted to build both backend and frontend images, you'd either:

1. Duplicate the entire job twice (build-backend, build-frontend) — same steps, copy-pasted, only the image name/context differing, or
2. Write one job that loops over both components sequentially inside a single run: block — which means frontend has to wait for backend to fully finish before starting, even though they're completely independent of each other.

Matrix solves both problems: one job definition, no duplication, and both variants run simultaneously rather than one after another — so your total pipeline time is closer to "however long the slowest one takes" instead of "sum of both."

**Why it matters practically**

1. Speed: parallel execution instead of sequential, meaningful savings once you have more than one or two variants.
2. DRY: one job definition instead of maintaining near-duplicate jobs that drift out of sync over time.
3. Independent pass/fail: if the frontend build fails, you see that clearly as its own failed matrix leg, without it being buried inside a combined job's logs alongside a passing backend build.
4. Scales cleanly: adding a third component later means adding one line to the matrix array, not writing a whole new job.

### Deploy script

```bash
#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# ShopHive production deploy script
#
# Usage:
#   ./deploy.sh --registry <ecr-registry>
# ---------------------------------------------------------------------------

REGION="ap-south-1"
COMPOSE_FILE="compose.prod.yml"

usage() {
    echo "Usage: $0 --registry <ecr-registry>"
    exit 1
}

REGISTRY=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --registry)
            REGISTRY="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown argument: $1"
            usage
            ;;
    esac
done

if [[ -z "$REGISTRY" ]]; then
    echo "Error: --registry is required." >&2
    usage
fi

echo "==> Logging in to ECR ($REGISTRY) in $REGION"
aws ecr get-login-password --region "$REGION" \
    | docker login --username AWS --password-stdin "$REGISTRY"

echo "==> Starting containers"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
```

`ECR_REGISTRY` and `IMAGE_TAG` referenced in `compose.prod.yml` are expected to already be present in `.env` on the deploy host, so the compose file resolves them without needing to pass them through the script's arguments.

### Host prerequisites (test EC2)

Before running the deploy script on a fresh instance:

```bash
# Docker
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"

# AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

Then run the deploy script:

```bash
./deploy.sh --registry <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com
```

---

## Why Production Deployment Is Manual

The production pipeline stops at pushing signed, scanned images to ECR — it does not automatically deploy them. Deployment is a deliberate, manual step. This is intentional, not a gap to be automated away later:

- **A human checkpoint before customer-facing traffic changes.** Automated build/scan/sign stages catch known classes of issues, but they can't judge business timing, readiness of dependent services, or whether now is the right moment to ship. A manual trigger keeps a person in the loop for the one step with real customer impact.
- **Decouples "artifact is ready" from "artifact is live."** A tag being built, scanned, and pushed doesn't obligate an immediate deploy. Images can be promoted whenever it makes sense — outside peak hours, after a dependent fix lands, or once a related staging issue is resolved — without needing to re-run or hold open a CI pipeline.
- **Reduces blast radius of a single mistake.** A bad tag pushed to ECR is inert until someone deliberately deploys it. Fully automated production deploys mean a bad tag becomes a live incident the moment CI finishes, with no opportunity to intervene.
- **Matches current infrastructure maturity.** Production deployment orchestration (health checks, rollback, traffic shifting) isn't fully built out yet. Manual deploys via Compose are appropriate for the current scale and avoid automating a process that isn't fully hardened.
- **Simple to override when needed.** For emergencies (e.g. a hotfix), a manual deploy takes minutes to run directly on the host — no pipeline redesign required to move fast when it matters.

---

## Next Steps

The next phase of work moves each environment (dev, staging, production) from Docker Compose on individual EC2 hosts to Kubernetes-based deployment, building on the existing MicroK8s cluster and Helm chart work.
