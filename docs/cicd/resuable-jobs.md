# Reusable Workflow: Build and Push Images

## Overview

This project uses a **GitHub Actions reusable workflow** instead of defining the Docker build and push steps directly inside every CI/CD pipeline.

The reusable workflow is responsible for:

- Building backend and frontend Docker images.
- Logging into Docker Hub.
- Generating a consistent image tag.
- Pushing images to Docker Hub.
- Returning the generated image tag and image digests to the calling workflow.

The workflow accepts the following inputs:

| Input         | Description                                                         |
| ------------- | ------------------------------------------------------------------- |
| `environment` | GitHub Environment to use (e.g., development, staging, production). |
| `tag-prefix`  | Prefix added to the generated Docker image tag.                     |

It also returns:

- `tag`
- `backend_digest`
- `frontend_digest`

These outputs can be used by deployment workflows to deploy the exact image versions that were built.

---

# Difference Between a Reusable Workflow and a Regular Pipeline

## Regular Pipeline

In a regular GitHub Actions workflow, every workflow contains its own build logic.

Example:

```
CI Workflow
 ├── Checkout
 ├── Docker Login
 ├── Setup Buildx
 ├── Build Backend
 ├── Build Frontend
 └── Push Images
```

If another workflow (such as staging or production) also needs to build images, the same steps must be copied again.

This leads to duplicated YAML files.

---

## Reusable Workflow

With a reusable workflow, the build logic exists in only one file.

```
CI Workflow
        │
        ▼
Reusable Build Workflow
 ├── Checkout
 ├── Generate Tag
 ├── Docker Login
 ├── Setup Buildx
 ├── Build Backend
 ├── Build Frontend
 └── Push Images
        │
        ▼
Outputs
 ├── Image Tag
 ├── Backend Digest
 └── Frontend Digest
```

The main workflow simply calls the reusable workflow and receives the outputs instead of repeating the build steps.

---

# Advantages

## 1. Eliminates Duplicate Code

The Docker build logic is written only once.

Without reusable workflows:

- CI workflow contains Docker build steps.
- Staging workflow contains the same Docker build steps.
- Production workflow contains the same Docker build steps.

With a reusable workflow:

- All workflows call the same build workflow.

This follows the **DRY (Don't Repeat Yourself)** principle.

---

## 2. Easier Maintenance

If the build process changes (for example, upgrading Docker Buildx or changing image tags), the update is made in a single file.

Every workflow automatically uses the updated process.

---

## 3. Consistent Builds

Since every environment uses the same reusable workflow, all images are built using identical commands, caching strategy, and tagging rules.

This reduces configuration drift between environments.111

---

## 4. Reusable Across Multiple Workflows

The same workflow can be used for:

- Development
- Staging
- Production
- Release pipelines
- Manual deployments

Only the inputs need to change.

Example:

```
environment: development
tag-prefix: dev
```

```
environment: staging
tag-prefix: stage
```

```
environment: production
tag-prefix: prod
```

---

## 5. Better Separation of Responsibilities

The reusable workflow focuses only on building Docker images.

The calling workflow is responsible for:

- Running tests
- Deploying applications
- Sending notifications
- Managing approvals

This keeps workflows smaller and easier to understand.

---

## 6. Reusable Outputs

The workflow returns useful outputs such as:

- Generated image tag
- Backend image digest
- Frontend image digest

Deployment workflows can deploy the exact images that were built, ensuring consistency and traceability.

---

## 7. Standardized Docker Image Tagging

The workflow automatically generates image tags using:

```
<tag-prefix>-<short_commit_sha>
```

Example:

```
dev-a1b2c3d
stage-a1b2c3dfein11
00000prod-a1b2c3d
```

This makes it easy to identify which commit produced a specific Docker image.

---

# Disadvantages

## 1. More Files to Navigate

Instead of seeing the complete pipeline in one workflow, developers may need to open both:

- The calling workflow
- The reusable workflow

to understand the full execution flow.

---

## 2. Slightly More Complex for Beginners

Reusable workflows introduce concepts such as:

- `workflow_call`
- Inputs
- Outputs

These require a basic understanding of how workflows communicate with each other.

---

## 3. Shared Changes Affect All Callers

Since multiple workflows use the same reusable workflow, changes to it impact every caller.

A mistake in the reusable workflow can affect development, staging, and production pipelines simultaneously.

---

## 4. Less Flexibility for Workflow-Specific Logic

If one environment requires a different build process, the reusable workflow may need additional inputs or conditional logic.

Too many special cases can make the reusable workflow harder to maintain.

---

# Why This Approach Was Chosen

This project uses a reusable workflow because the Docker build process is identical across environments.

Using a reusable workflow provides:

- A single source of truth for Docker image builds.
- Reduced code duplication.
- Easier maintenance.
- Consistent image generation.
- Standardized tagging.
- Reusable outputs for deployment workflows.

This approach results in a cleaner, more maintainable, and scalable CI/CD pipeline as the project grows.
