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



# REFERENCES

- SECURITY IN PIPELINE: https://youtu.be/ZUquwnJnfNw?si=kpxbcQ3MJAyJLy7y


