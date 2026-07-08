# 1. Architecture Overview

ShopHive follows a three-environment CI/CD strategy mapped to Git branches and tags:

| Trigger                            | Environment | Infrastructure                      |
| ---------------------------------- | ----------- | ----------------------------------- |
| Push to `dev`                      | Development | EC2 Dev Server (Docker Compose)     |
| Merge to `qa`                      | Staging/QA  | EC2 Staging Server (Docker Compose) |
| Git tag `v*.*.*` + manual approval | Production  | AWS ECR + ECS/CodeDeploy            |

Three separate workflow files live under `.github/workflows/` to keep each environment's pipeline isolated and independently configurable:

```
.github/
└── workflows/
    ├── dev.yml          # triggers on push to dev
    ├── staging.yml      # triggers on push to qa branch
    └── prod.yml         # triggers on git tag v*.*.*
```

This document covers the **Development** pipeline in full. See the [Staging Pipeline documentation](./staging.md) for the QA environment.

---

## 2. GitHub Environment Setup

Before the pipelines can run, environments are configured in GitHub to scope secrets and variables per environment.

### Step 1 — Create Environments

Navigate to **Settings → Environments → New environment** and create three environments:

- `development`
- `staging`
- `production`

### Step 2 — Add Variables (Non-Sensitive Configuration)

For each environment, go to **Environment → Variables → Add variable** and add image names and other configuration values that are safe to expose.

### Step 3 — Add Secrets (Sensitive Values)

For each environment, go to **Environment → Secrets → Add secret** and add credentials — Docker Hub tokens, SSH keys, AWS keys, and `.env` file contents.

**Rule followed:**

- **Variables** (`vars.*`) — non-sensitive configuration: image names, ports, environment names, log levels.
- **Secrets** (`secrets.*`) — passwords, tokens, API keys, SSH private keys, certificates, `.env` file contents.

### Secrets and Variables Reference

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

## 3. Each Pipeline

- See the [Development Pipeline documentation](./dev.md) for the Dev environment workflow.
- See the [Staging/QA Pipeline documentation](./staging.md) for the Staging environment workflow.
- See the [Production Pipeline documentation](./prod.md) for the Production environment workflow.
