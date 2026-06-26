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


