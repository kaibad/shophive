## Production Pipeline

Coming soon.

Will follow a different deployment path from dev and staging:

- Triggers on Git tags matching `v*.*.*`
- Images pushed to AWS ECR instead of Docker Hub
- Deployment via AWS CodeDeploy with a manual approval gate before any traffic shifts
- Uses `appspec.yml` and `scripts/deploy.sh` for CodeDeploy lifecycle hooks
- IAM policy scoped to CI user with least-privilege permissions
- All Trivy, Bandit, and dependency scans hard-block on any HIGH or CRITICAL finding

```

```
