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

This reduces configuration drift between environments.

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
stage-a1b2c3d
prod-a1b2c3d
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

# Why This Approach Was Chosen (Originally)

This project originally used reusable workflows because the Docker build process was identical across environments.

Using a reusable workflow provided:

- A single source of truth for Docker image builds.
- Reduced code duplication.
- Easier maintenance.
- Consistent image generation.
- Standardized tagging.
- Reusable outputs for deployment workflows.

On paper this looked like the cleaner, more maintainable, more scalable choice. In practice it created a runner-scheduling problem that outweighed those benefits, documented below.

---

# The Problem: Waiting for Runner

Once the dev and staging pipelines were fully split into reusable workflows (secret scan, scan suite, build, image scan, SBOM and signing, deploy), each pipeline run was made up of six to seven separate jobs, because every single `uses: ./.github/workflows/reusable-*.yml` call is its own job in GitHub Actions, and every job has to be scheduled onto its own fresh runner before any of its steps can execute.

The pipelines were wired mostly with sequential `needs:`, so a run looked like this:

```
gitleaks → scan-suite → build → trivy-image → sbom-and-sign → approval → deploy
```

Every arrow in that chain is a point where the workflow stops and waits for GitHub to hand it a new runner, even for jobs that had no real dependency on the job before it. In the Actions UI this shows up as the job sitting in "Waiting for a runner to pick up this job..." for a stretch of time before any actual work starts. With seven jobs chained end to end, that provisioning delay was being paid seven times per run, on top of the actual work being done, and most of that waiting had nothing to do with how long the scans or the build itself took.

---

# What We Tried First: Parallelizing the Reusable Workflow Calls

The first fix was to stop chaining jobs that didn't actually need each other's output. For example, `scan-suite` was set to `needs: gitleaks` even though it never used anything gitleaks produced, so the two were split to run in parallel instead. Similarly, `sbom-and-sign` only needed the image digests from `build`, not the result of `trivy-image`, so those two were also made to run side by side instead of one after the other.

This shortened the critical path. Dev went from six sequential hops down to three (gitleaks, then build, then deploy), and staging went from seven down to five. It genuinely reduced wall-clock time.

**Why it didn't fully solve the problem:** parallelizing jobs doesn't reduce how many runners a pipeline run needs, it just asks for more of them at the same time instead of asking for them one after another. If GitHub's runner pool (or the account's concurrent job limit) is the actual bottleneck, spreading jobs out in parallel can make the "waiting for a runner" symptom worse in the short term, not better, since now several jobs are competing for a runner slot simultaneously instead of queuing politely one at a time. The total number of runner requests per pipeline run stayed exactly the same, we just changed the shape of the wait instead of removing it.

---

# What We Tried Second: Scanning Images Before Push and Merging Gitleaks Into Scan Suite

Two more changes followed:

1. The Trivy image scan was moved to happen against the image while it still only exists in the runner's local Docker daemon (`push: false, load: true`), so scanning now happens before the image ever reaches Docker Hub instead of after. This closed a real security gap (a vulnerable image could previously sit in the registry before the scan result came back), and as a side effect it folded the separate `trivy-image` job into the `build` job, removing one more job from the graph.
2. Gitleaks was folded into `scan-suite` as its first step (behind an `include-gitleaks` toggle so dev could keep gitleaks as a fast, minimal, standalone gate while staging used the merged version), which removed another standalone job from staging.

This got staging down to three jobs and dev down to four.

**Why this still wasn't the real fix:** these changes helped because they removed jobs that were doing genuinely separable work and merged them into a job that was already going to run anyway. But the underlying assumption up to this point was still "keep the reusable workflow structure, just call fewer of them." Every remaining `uses:` call was still its own job, still its own runner request, and still paying provisioning latency that had nothing to do with the actual scan or build time. The reusable-workflow pattern itself, one file per job, was the source of the extra runner requests, and no amount of rearranging `needs:` around that pattern could get the job count down to what the pipeline actually required.

---

# The Final Fix: Removing the Reusable Workflow Layer

The actual fix was to stop calling reusable workflows for anything that didn't strictly require its own job, and write the steps directly into `dev.yml` and `staging.yml` instead. A reusable workflow call and a native job with inline steps do the same work, but only the reusable workflow call forces GitHub to treat it as a separate job with its own runner, purely because of how `workflow_call` is implemented, not because the work itself needed isolating.

The only thing that genuinely cannot be inlined is the manual approval gate in staging, because environment protection rules (the pause-for-approval behavior) only apply at the job level, not the step level. Everything else, secret scanning, SAST and dependency checks, image build, image scan, push, SBOM generation, and cosign signing, runs as steps inside a single job because none of it needs to be isolated from the rest, it just needs to happen in the right order.

## New Dev Pipeline

```
pipeline (one job, one runner)
 ├── Checkout
 ├── Gitleaks               (blocking)
 ├── Bandit / pip-audit / npm audit / Trivy FS   (advisory, continue-on-error)
 ├── Upload source scan reports
 ├── Generate tag
 ├── Build backend + frontend images (local only, not pushed yet)
 ├── Trivy image scan       (advisory, exit-code 0)
 ├── Upload image scan reports
 ├── Push backend + frontend images
 ├── Deploy to EC2
 └── Health check
```

One job means one runner request for the entire pipeline. Gitleaks still runs first and still blocks everything after it, so a leaked secret stops the run immediately instead of wasting time on the rest of the steps.

## New Staging Pipeline

```
build-scan-sign (one job, one runner)
 ├── Checkout
 ├── Gitleaks               (blocking)
 ├── Bandit / pip-audit / npm audit / Trivy FS / Hadolint   (blocking)
 ├── Upload source scan reports
 ├── Generate tag
 ├── Build backend + frontend images (local only, not pushed yet)
 ├── Trivy image scan       (blocking, exit-code 1)
 ├── Upload image scan reports
 ├── Push backend + frontend images
 ├── Generate SBOMs
 └── Cosign sign both images
        │
        ▼
approval (separate job, required for the environment protection gate)
        │
        ▼
deploy (separate job, staging secrets)
 ├── Checkout
 ├── Copy compose files to EC2
 └── Deploy via SSH
```

Staging needs three jobs at minimum: the approval gate has to be its own job to get the pause-for-approval behavior, and deploy has to be separate from approval because they use different environments with different secrets. Everything before the approval gate is a single job, because it's all strictly sequential work anyway, each step in that chain either gates the next one or feeds it a value the next one needs.

---

# Trade-offs of the New Approach

This is a deliberate step away from the DRY principle described earlier in this document. Dev and staging now duplicate the build, scan, and push steps instead of sharing one reusable workflow, so a change to the build process (say, upgrading Buildx or changing the tagging scheme) now has to be made in both files instead of one. That's a real cost, and it's the opposite of point 1 and point 2 under Advantages above.

The trade was accepted because the runner-queue overhead was a bigger practical problem than the duplication is. Two workflow files with some repeated steps are easy enough to keep in sync by hand at this project's size, and the reusable-workflow files are still sitting in the repository unused, so nothing is lost if a third environment (say, production) gets added later and the DRY approach becomes worth revisiting. If this project grows to the point where the duplication genuinely becomes painful to maintain, composite actions (`uses: ./.github/actions/build-image`) are worth a look, since they can be dropped into a job's steps without forcing a new job the way `workflow_call` does.
