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
