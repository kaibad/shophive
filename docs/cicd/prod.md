## Production Pipeline

Coming soon.

Will follow a different deployment path from dev and staging:

- Triggers on Git tags matching `v*.*.*`
- Images pushed to AWS ECR instead of Docker Hub
- Deployment via AWS CodeDeploy with a manual approval gate before any traffic shifts
- Uses `appspec.yml` and `scripts/deploy.sh` for CodeDeploy lifecycle hooks
- IAM policy scoped to CI user with least-privilege permissions
- All Trivy, Bandit, and dependency scans hard-block on any HIGH or CRITICAL finding

steps ==============

Production Pipeline: Removed Steps
Bandit (backend job)
Removed. Bandit is a SAST tool — its findings depend only on source code, not on environment or time. Production tags are cut from code already merged and scanned through the staging (qa) pipeline, so re-running Bandit against the same source in production adds no new signal. It remains in the staging pipeline, where it catches issues on new code.
Local Trivy image scan (backend + frontend jobs)
Removed. ECR repositories have scan-on-push enabled at the infrastructure level (Terraform), so every image pushed by this pipeline is scanned server-side regardless of whether CI scans it first. Running Trivy against the image locally in CI duplicated that work and added scan time to every run.
Tradeoff: previously, a failed local scan blocked the push. That gate is now removed — the pipeline pushes unconditionally, and the check moves downstream. Before promoting an image via Helm deploy, check ECR scan findings for that tag.
Kept unchanged
Gitleaks, pip-audit, npm audit, and Trivy filesystem scans remain in the production pipeline. Unlike Bandit, these check against vulnerability databases that update daily — a dependency clean in staging can have a new CVE disclosed by the time a tag is cut days later. They're cheap to run (seconds to low minutes), so re-running them at each stage is worth it independent of whether the source changed.

```
Let's say you push tag v0.1.0. Note: your trigger is tags: ["v*.*.*"], which requires three dot-separated segments .
What happens, step by step:

git tag v0.1.0 && git push origin v0.1.0
The workflow fires. GITHUB_REF_NAME is set to v0.1.0.
In build-backend, the Generate Image Tag step (id: version) runs:

   tag=v0.1.0
written to $GITHUB_OUTPUT, so steps.version.outputs.tag = v0.1.0.
4. The image builds and gets tagged as <ECR_REPO_URL>/<BACKEND_ECR_REPO>:v0.1.0.
5. The Push Backend Image to ECR step (id: push) pushes it, parses the digest out of the push output, e.g.:
   digest=sha256:a1b2c3d4e5f6...
so steps.push.outputs.digest = sha256:a1b2c3d4e5f6....
6. At the job level, the outputs block republishes both:
yaml   outputs:
     tag: v0.1.0
     digest: sha256:a1b2c3d4e5f6...

Anything with needs: build-backend can now reference these as needs.build-backend.outputs.tag and needs.build-backend.outputs.digest.

Concretely, in a downstream job:
yamlnotify-deploy-ready:
  needs: [build-backend, build-frontend]
  runs-on: ubuntu-latest
  steps:
    - name: Print what was built
      run: |
        echo "Backend image: ${{ needs.build-backend.outputs.tag }}"
        echo "Backend digest: ${{ needs.build-backend.outputs.digest }}"
would print:
Backend image: v0.1.0
Backend digest: sha256:a1b2c3d4e5f6...
That digest is the piece that matters most for your manual Helm deploy — the tag v0.1.0 could theoretically get re-pushed to point at a different image later, but the digest is immutable and always identifies the exact image that was built, scanned, and signed in this specific run.
```

================ecr

namespace/repo-name

1. create a ecr repo like shophive-prod/backend and shophive-prod/froentend

view push commands

1. initial prod.yml

```yaml
name: Production pipeline

on:
  push:
    tags: ["v*.*.*"]

concurrency:
  group: prod-pipeline-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read
  id-token: write # OIDC role assumption into AWS, and cosign keyless signing

jobs:
  secret-scan:
    name: Gitleaks
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

  build-backend:
    name: Scan, Build, Push, Sign (backend)
    needs: secret-scan
    runs-on: ubuntu-latest
    environment: production
    outputs:
      tag: ${{ steps.version.outputs.tag }}
      digest: ${{ steps.push.outputs.digest }}
    steps:
      - name: Checkout repo
        uses: actions/checkout@v7

      - name: Setup Python
        uses: actions/setup-python@v6
        with:
          python-version: "3.13"

      - name: Install Bandit and pip-audit
        run: pip install bandit pip-audit

      - name: pip audit
        run: pip-audit -r backend/requirements.txt --format json --output pip-audit.json

      - name: Run Trivy FS scan
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          scan-type: fs
          scan-ref: backend
          format: table
          severity: HIGH,CRITICAL
          exit-code: 1
          output: trivy-fs-backend.txt

      - name: Run Hadolint
        uses: hadolint/hadolint-action@v3.1.0
        with:
          dockerfile: backend/Dockerfile
          output-file: hadolint-backend.txt
          no-fail: true

      - name: Upload Source Scan Reports
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: scan-reports-prod-backend
          path: |
            trivy-fs-backend.txt
            hadolint-backend.txt
          if-no-files-found: warn
          retention-days: 30

      - name: Generate Image Tag
        id: version
        run: echo "tag=${GITHUB_REF_NAME}" >> $GITHUB_OUTPUT

      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v6.1.0
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Log in to ECR
        run: |
          aws ecr get-login-password --region ${{ secrets.AWS_REGION }} | docker login --username AWS --password-stdin ${{ secrets.ECR_REGISTRY_ENDPOINT }}

      - name: Setup Buildx
        uses: docker/setup-buildx-action@v4

      - name: Build Backend Image (local only)
        uses: docker/build-push-action@v7
        with:
          context: ./backend
          push: false
          load: true
          tags: |
            ${{ secrets.ECR_REGISTRY_ENDPOINT }}/${{ vars.BACKEND_ECR_REPO }}:${{ steps.version.outputs.tag }}
            ${{ secrets.ECR_REGISTRY_ENDPOINT }}/${{ vars.BACKEND_ECR_REPO }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Push Backend Image to ECR
        id: push
        run: |
          docker push ${{ secrets.ECR_REGISTRY_ENDPOINT }}/${{ vars.BACKEND_ECR_REPO }}:${{ steps.version.outputs.tag }}
          PUSH_OUTPUT=$(docker push ${{ secrets.ECR_REGISTRY_ENDPOINT }}/${{ vars.BACKEND_ECR_REPO }}:latest)
          DIGEST=$(echo "$PUSH_OUTPUT" | grep -oP 'sha256:[a-f0-9]{64}' | head -1)
          echo "digest=${DIGEST}" >> $GITHUB_OUTPUT

      - name: Generate Backend SBOM (CycloneDX)
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          scan-type: image
          image-ref: ${{ secrets.ECR_REGISTRY_ENDPOINT }}/${{ vars.BACKEND_ECR_REPO }}:${{ steps.version.outputs.tag }}
          format: cyclonedx
          output: sbom-backend.cdx.json

      - name: Upload Backend SBOM
        uses: actions/upload-artifact@v7
        with:
          name: sbom-prod-backend
          path: sbom-backend.cdx.json
          retention-days: 90

      - name: Install cosign
        uses: sigstore/cosign-installer@v3

      - name: Sign Backend Image (keyless, GitHub OIDC)
        run: |
          cosign sign --yes \
            ${{ secrets.ECR_REGISTRY_ENDPOINT }}/${{ vars.BACKEND_ECR_REPO }}@${{ steps.push.outputs.digest }}

  build-frontend:
    name: Scan, Build, Push, Sign (frontend)
    needs: secret-scan
    runs-on: ubuntu-latest
    environment: production
    outputs:
      tag: ${{ steps.version.outputs.tag }}
      digest: ${{ steps.push.outputs.digest }}
    steps:
      - name: Checkout repo
        uses: actions/checkout@v7

      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: 22

      - name: npm audit
        working-directory: frontend
        run: |
          npm install
          npm audit --audit-level high --json > npm-audit.json

      - name: Run Trivy FS scan
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          scan-type: fs
          scan-ref: frontend
          format: table
          severity: HIGH,CRITICAL
          exit-code: 1
          output: trivy-fs-frontend.txt

      - name: Run Hadolint
        uses: hadolint/hadolint-action@v3.1.0
        with:
          dockerfile: frontend/Dockerfile
          output-file: hadolint-frontend.txt
          no-fail: true

      - name: Upload Source Scan Reports
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: scan-reports-prod-frontend
          path: |
            frontend/npm-audit.json
            trivy-fs-frontend.txt
            hadolint-frontend.txt
          if-no-files-found: warn
          retention-days: 30

      - name: Generate Image Tag
        id: version
        run: echo "tag=${GITHUB_REF_NAME}" >> $GITHUB_OUTPUT

      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v6.1.0
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Log in to ECR
        run: |
          aws ecr get-login-password --region ${{ secrets.AWS_REGION }} | docker login --username AWS --password-stdin ${{ secrets.ECR_REGISTRY_ENDPOINT }}

      - name: Setup Buildx
        uses: docker/setup-buildx-action@v4

      - name: Build Frontend Image (local only)
        uses: docker/build-push-action@v7
        with:
          context: ./frontend
          push: false
          load: true
          tags: |
            ${{ secrets.ECR_REGISTRY_ENDPOINT }}/${{ vars.FRONTEND_ECR_REPO }}:${{ steps.version.outputs.tag }}
            ${{ secrets.ECR_REGISTRY_ENDPOINT }}/${{ vars.FRONTEND_ECR_REPO }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Push Frontend Image to ECR
        id: push
        run: |
          docker push ${{ secrets.ECR_REGISTRY_ENDPOINT }}/${{ vars.FRONTEND_ECR_REPO }}:${{ steps.version.outputs.tag }}
          PUSH_OUTPUT=$(docker push ${{ secrets.ECR_REGISTRY_ENDPOINT }}/${{ vars.FRONTEND_ECR_REPO }}:latest)
          DIGEST=$(echo "$PUSH_OUTPUT" | grep -oP 'sha256:[a-f0-9]{64}' | head -1)
          echo "digest=${DIGEST}" >> $GITHUB_OUTPUT

      - name: Generate Frontend SBOM (CycloneDX)
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          scan-type: image
          image-ref: ${{ secrets.ECR_REGISTRY_ENDPOINT }}/${{ vars.FRONTEND_ECR_REPO }}:${{ steps.version.outputs.tag }}
          format: cyclonedx
          output: sbom-frontend.cdx.json

      - name: Upload Frontend SBOM
        uses: actions/upload-artifact@v7
        with:
          name: sbom-prod-frontend
          path: sbom-frontend.cdx.json
          retention-days: 90

      - name: Install cosign
        uses: sigstore/cosign-installer@v3

      - name: Sign Frontend Image (keyless, GitHub OIDC)
        run: |
          cosign sign --yes \
            ${{ secrets.ECR_REGISTRY_ENDPOINT }}/${{ vars.FRONTEND_ECR_REPO }}@${{ steps.push.outputs.digest }}
```

The problem
Both jobs authenticate to AWS using long-lived static credentials:

```yaml
- name: Configure AWS Credentials
  uses: aws-actions/configure-aws-credentials@v6.1.0
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: ${{ secrets.AWS_REGION }}
This has real downsides for a production pipeline specifically:
```

No expiration. A static access key/secret pair is valid until someone manually rotates or revokes it — could be indefinitely if a leak goes unnoticed.
Not scoped to this workflow. The key works from anywhere it's copied to — a local laptop, a different repo, a different branch. There's nothing tying it to "only GitHub Actions, only this repo, only tag pushes."
Sits in secrets at rest, always. Even if never leaked, it's a permanent credential sitting in GitHub's secret store rather than something minted fresh per run and discarded after.
There's also a live typo bug independent of the OIDC question: secrets.AWS_ACCCESS_KEY_ID (triple C) won't match a real secret name, so this step is currently failing auth regardless.

Your permissions: block already declares id-token: write, and the comment even says "OIDC role assumption into AWS" — the intent was there, it just wasn't wired up in the actual steps.
What OIDC changes
Instead of a stored key, GitHub mints a short-lived, cryptographically signed identity token for the specific job run (tied to repo, branch/tag ref, and workflow). AWS's IAM trusts GitHub's OIDC provider and assumes a role in exchange for that token — no secret ever stored, and the resulting session credentials expire automatically (typically within an hour). The IAM role's trust policy can restrict exactly which repo/ref is allowed to assume it (e.g. only repo:404bad/shophive:ref:refs/tags/v\*), so even if a workflow run is compromised, the blast radius is scoped by AWS, not by convention.
What needs to change in the YAML:

configure-aws-credentials switches from aws-access-key-id/aws-secret-access-key to role-to-assume (an IAM role ARN)
Manual docker login via aws ecr get-login-password is replaced by aws-actions/amazon-ecr-login, which handles the ECR auth token exchange using the already-assumed role
References to secrets.ECR_REGISTRY_ENDPOINT become steps.ecr-login.outputs.registry, since the login action returns the registry URI rather than you having to store it as a secret
AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY secrets can be deleted from the repo entirely once this is confirmed working

write this part in a separate script echo "## Vulnerability Scan Summary" >> $GITHUB_STEP_SUMMARY

          echo "### Trivy scans" >> $GITHUB_STEP_SUMMARY
          for f in trivy-fs-results.txt trivy-backend-image.txt trivy-frontend-image.txt; do
            if [ ! -f "$f" ]; then
              echo "- \$f\: not generated (step may have failed before writing output)" >> $GITHUB_STEP_SUMMARY
              continue
            fi
            if grep -qE "HIGH|CRITICAL" "$f"; then
              COUNT=$(grep -oE "HIGH|CRITICAL" "$f" | wc -l)
              echo "- ⚠️ \$f\: $COUNT HIGH/CRITICAL finding(s)" >> $GITHUB_STEP_SUMMARY
              echo '<details><summary>Full report</summary>' >> $GITHUB_STEP_SUMMARY
              echo '' >> $GITHUB_STEP_SUMMARY
              echo '```' >> $GITHUB_STEP_SUMMARY
              cat "$f" >> $GITHUB_STEP_SUMMARY
              echo '```' >> $GITHUB_STEP_SUMMARY
              echo '</details>' >> $GITHUB_STEP_SUMMARY
              echo "::warning::Vulnerabilities found in $f — see job summary for details"
            else
              echo "- \$f\: no HIGH/CRITICAL findings" >> $GITHUB_STEP_SUMMARY
            fi
          done

          echo "### Bandit (SAST)" >> $GITHUB_STEP_SUMMARY
          if [ -f bandit-report.json ]; then
            COUNT=$(jq '.results | length' bandit-report.json)
            if [ "$COUNT" -gt 0 ]; then
              echo "- ⚠️ \bandit-report.json\: $COUNT finding(s)" >> $GITHUB_STEP_SUMMARY
              echo "::warning::Bandit found $COUNT issue(s) — see scan-reports-dev artifact"
            else
              echo "- \bandit-report.json\: no findings" >> $GITHUB_STEP_SUMMARY
            fi
          else
            echo "- \bandit-report.json\: not generated" >> $GITHUB_STEP_SUMMARY
          fi

          echo "### pip-audit" >> $GITHUB_STEP_SUMMARY
          if [ -f pip-audit.json ]; then
            COUNT=$(jq '[.dependencies[]?.vulns[]?] | length' pip-audit.json)
            if [ "$COUNT" -gt 0 ]; then
              echo "- ⚠️ \pip-audit.json\: $COUNT vulnerable dependency finding(s)" >> $GITHUB_STEP_SUMMARY
              echo "::warning::pip-audit found $COUNT vulnerability finding(s) — see scan-reports-dev artifact"
            else
              echo "- \pip-audit.json\: no findings" >> $GITHUB_STEP_SUMMARY
            fi
          else
            echo "- \pip-audit.json\: not generated" >> $GITHUB_STEP_SUMMARY
          fi

          echo "### npm audit" >> $GITHUB_STEP_SUMMARY
          if [ -f frontend/npm-audit.json ]; then
            HIGH=$(jq '.metadata.vulnerabilities.high // 0' frontend/npm-audit.json)
            CRITICAL=$(jq '.metadata.vulnerabilities.critical // 0' frontend/npm-audit.json)
            TOTAL=$((HIGH + CRITICAL))
            if [ "$TOTAL" -gt 0 ]; then
              echo "- ⚠️ \npm-audit.json\: $HIGH high, $CRITICAL critical" >> $GITHUB_STEP_SUMMARY
              echo "::warning::npm audit found $HIGH high / $CRITICAL critical finding(s) — see scan-reports-dev artifact"
            else
              echo "- \npm-audit.json\: no high/critical findings" >> $GITHUB_STEP_SUMMARY
            fi
          else
            echo "- \npm-audit.json\: not generated" >> $GITHUB_STEP_SUMMARY
          fi

Show more

Architected modular bash script for vulnerability summary reporting
Architected modular bash script for vulnerability summary reporting
Now update the workflow step to call it instead of the inline block:

Edited a file, viewed a file
Edited a file, viewed a file
Good — it looks like this already went through in the file. The workflow step now just calls the script:

Viewed a file, read a file
Viewed a file, read a file
Two things to do when you commit this:

Put the script at scripts/summarize-scans.sh in your repo (same relative path your Copy compose files to EC2 step already uploads from scripts/, so it lives alongside your other deploy scripts).
Make sure the executable bit survives the commit: git update-index --chmod=+x scripts/summarize-scans.sh after git add, or just chmod +x scripts/summarize-scans.sh before staging — git tracks the executable bit, and it's easy to lose if the file gets copied/re-created without it. The workflow step calls it as bash scripts/summarize-scans.sh rather than ./scripts/summarize-scans.sh, so the executable bit isn't strictly required for the workflow to run, but it's good practice for consistency with your other scripts.

Summarize scans
SH

Dev pipeline
YML
1784009942368_image.png
this is my prod piepline instead fo hard coded credentials lets use oidc ... first write what is the probelm then what shoudl be done ans then write the yml file

Thought for 3s
Thought for 3s
That image is your GitHub profile page, not the pipeline file — but I have the current production pipeline from our work above, so I'll go ahead and convert that one to OIDC.

View current production-pipeline.yml before converting to OIDC
View current production-pipeline.yml before converting to OIDC
The problem
Right now both jobs authenticate to AWS with AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY — long-lived static credentials stored as GitHub secrets. That has a few concrete downsides:

They don't expire on their own. If one leaks (accidental commit, log output, compromised runner), it's valid until someone manually rotates or revokes it — could be indefinitely if nobody notices.
They're not scoped to this workflow. Any workflow, branch, or person with repo secret access can use the same key. There's no way to say "only this repo, only this workflow, only tag pushes" with a static key — the IAM policy attached to it is the only boundary.
\*\*Rotation is manual to
Claude’s response was interrupted.

## Production Pipeline Coming soon. Will follow a different deployment path from dev and staging: - Triggers on Git tags matching `v*.*.*` - Images pushed to AWS ECR instead of Docker Hub - Deployment via AWS CodeDeploy with a manual approval gate before any traffic shifts - Uses `appspec.yml` an

pasted

haha sorry that was mistake this is the current prod.yml

Prepared to analyze configuration file and propose security improvements
Prepared to analyze configuration file and propose security improvements
The problem
Both jobs authenticate to AWS using long-lived static credentials:

yaml

- name: Configure AWS Credentials
  uses: aws-actions/configure-aws-credentials@v6.1.0
  with:
  aws-access-key-id: ${{ secrets.AWS_ACCCESS_KEY_ID }}
  aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
  aws-region: ${{ secrets.AWS_REGION }}
  This has real downsides for a production pipeline specifically:

No expiration. A static access key/secret pair is valid until someone manually rotates or revokes it — could be indefinitely if a leak goes unnoticed.
Not scoped to this workflow. The key works from anywhere it's copied to — a local laptop, a different repo, a different branch. There's nothing tying it to "only GitHub Actions, only this repo, only tag pushes."
Sits in secrets at rest, always. Even if never leaked, it's a permanent credential sitting in GitHub's secret store rather than something minted fresh per run and discarded after.
There's also a live typo bug independent of the OIDC question: secrets.AWS_ACCCESS_KEY_ID (triple C) won't match a real secret name, so this step is currently failing auth regardless.
Your permissions: block already declares id-token: write, and the comment even says "OIDC role assumption into AWS" — the intent was there, it just wasn't wired up in the actual steps.

What OIDC changes
Instead of a stored key, GitHub mints a short-lived, cryptographically signed identity token for the specific job run (tied to repo, branch/tag ref, and workflow). AWS's IAM trusts GitHub's OIDC provider and assumes a role in exchange for that token — no secret ever stored, and the resulting session credentials expire automatically (typically within an hour). The IAM role's trust policy can restrict exactly which repo/ref is allowed to assume it (e.g. only repo:404bad/shophive:ref:refs/tags/v\*), so even if a workflow run is compromised, the blast radius is scoped by AWS, not by convention.

What needs to change in the YAML:

configure-aws-credentials switches from aws-access-key-id/aws-secret-access-key to role-to-assume (an IAM role ARN)
Manual docker login via aws ecr get-login-password is replaced by aws-actions/amazon-ecr-login, which handles the ECR auth token exchange using the already-assumed role
References to secrets.ECR_REGISTRY_ENDPOINT become steps.ecr-login.outputs.registry, since the login action returns the registry URI rather than you having to store it as a secret
AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY secrets can be deleted from the repo entirely once this is confirmed working
The updated file

Created a file, ran a command, read a file
Created a file, ran a command, read a file

Production pipeline converted to use OIDC-based AWS auth instead of static credentials
production-pipeline.yml

Overwrite production-pipeline.yml with OIDC version

Script

Presented file
Done
What you need to set up before this runs:

IAM role (in Terraform, alongside your existing ECR/VPC resources) with a trust policy allowing sts:AssumeRoleWithWebIdentity from GitHub's OIDC provider, scoped to your repo and tag ref — something like the sub condition repo:404bad/shophive:ref:refs/tags/v\*.
New secret: AWS_ECR_PUSH_ROLE_ARN — the ARN of that role.
Delete old secrets once confirmed working: AWS_ACCESS_KEY_ID (well, AWS_ACCCESS_KEY_ID as it was mistyped), AWS_SECRET_ACCESS_KEY, and ECR_REGISTRY_ENDPOINT (no longer needed — the login action supplies the registry URI as an output).
Region moved from a secret to a plain env var at the top (AWS_REGION: ap-south-1) — region isn't sensitive, so it doesn't belong in secrets.

===================

Step 1: Add GitHub's OIDC provider to IAM (one-time, per AWS account)
Most accounts don't have this yet. Check first — if you've never set up OIDC with GitHub Actions before, you need it.

Console: IAM → Identity providers → Add provider

Provider type: OpenID Connect
Provider URL: https://token.actions.githubusercontent.com
Audience: sts.amazonaws.com
CLI equivalent:

Step 2: Create the IAM role with a trust policy scoped to your repo/tag
Save this as trust-policy.json (replace <ACCOUNT_ID>):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:404bad/shophive:ref:refs/tags/v*"
        }
      }
    }
  ]
}
```

Console equivalent: IAM → Roles → Create role → Trusted entity type: Web identity → Identity provider: the one from Step 1 → Audience: sts.amazonaws.com → GitHub organization/repo/ref fields (the console has dedicated fields for this, so you don't need to hand-write the sub condition yourself).

Step 3: Attach a least-privilege permissions policy (ECR push only)

create inline policy

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

Note the ecr:GetAuthorizationToken action has to allow Resource: "\*" — this is an ECR API quirk, that particular action doesn't support resource-level restriction, but everything else is scoped down to just your two repos.

Step 4: Get the role ARN and add it as a secret
arn:aws:iam::290657649733:role/shophive-prod-ecr-push

That value goes into the AWS_ECR_PUSH_ROLE_ARN GitHub secret, exactly like before.

References: https://youtu.be/Sdzd4N6L5Hg?si=oYSTqjz8OkGPmpvd, https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws
