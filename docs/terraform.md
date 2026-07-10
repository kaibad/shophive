# Terraform: ShopHive Infrastructure

I use this document to explain how I have organized Terraform in the ShopHive repository, and to give myself (and anyone else working on this) a clear reference for initializing, planning, applying, and maintaining the infrastructure.

## Table of Contents

- Overview
- Repository Layout and Modules
- Provider and Backend
- Root Variables and Outputs
- How Dev and Staging Share the Same VPC
- Typical Workflows
- Example terraform.tfvars
- GitHub Actions and CI Notes
- Troubleshooting and Tips

## Overview

I manage AWS infrastructure for ShopHive using a modular Terraform design. The root module (`terraform/`) wires together reusable modules for VPC, EC2, security groups, IAM, and ECR, so each concern stays isolated and easy to reason about on its own.

## Repository Layout

Here is the layout I follow for the Terraform code and related scripts:

```
terraform/
├── backend.tf
├── providers.tf
├── main.tf
├── variables.tf
├── outputs.tf
├── terraform.tfvars
├── dev.tfvars
├── staging.tfvars
├── prod.tfvars
└── modules/
    ├── vpc/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── ec2/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── security_group/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    ├── iam/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    └── ecr/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf

scripts/
└── dev/
    └── dev-install.sh   # bootstrap script used by EC2 user_data
```

If I add new modules or environment files later, I will update this section so it stays accurate.

## Provider and Backend

In `providers.tf`, I pin the Terraform required_version to `>= 1.6` and use the `hashicorp/aws` provider at `~> 5.0`. The `aws` provider block reads its region from `var.aws_region`.

For state, `backend.tf` configures a remote backend using S3 for storage and DynamoDB for locking. My current configuration is:

- bucket: `my-shophive-terraform-state`
- key: `infra/terraform.tfstate`
- region: `ap-south-1`
- dynamodb_table: `terraform-locks`
- encrypt: `true`

Before I ever run `terraform init`, I make sure this S3 bucket and DynamoDB table already exist and are properly access-controlled.

## Root Variables

I declare the key variables in `terraform/variables.tf`:

- `aws_region` (string)
- `environment` (string)
- `project_name` (string)
- `vpc_cidr` (string)
- `instance_type` (string)
- `ami_id` (string)
- `key_name` (string)
- `allowed_ip` (string) — allowed SSH CIDR
- `app_port` (number, default 80)

## Module Inputs and Outputs

For `modules/vpc`, I pass in `project_name`, `environment`, and `cidr_block`, and I get back `vpc_id`, `public_subnet_id`, and `availability_zone`.

For `modules/security_group`, I pass in `project_name`, `environment`, `allowed_ip`, and `app_port`, and I get back `security_group_id`.

For `modules/iam`, I pass in `project_name` and get back `instance_profile_name`.

For `modules/ec2`, I pass in `project_name`, `environment`, `subnet_id`, `security_group_id`, `iam_instance_profile`, `ami_id`, `instance_type`, and `key_name`. This module creates an `aws_instance` tagged with `Name = "${project_name}-${environment}-server"`.

## How Dev and Staging Share the Same VPC

I intentionally create a single VPC in the root module (`module "vpc"`) and reuse its outputs across multiple EC2 module instances rather than provisioning a separate VPC per environment. In `terraform/main.tf`, I instantiate two EC2 modules: `module "ec2_dev"` with `environment = "dev"`, and `module "ec2_staging"` with `environment = "staging"`.

Both of these EC2 modules reference `module.vpc.public_subnet_id` and `module.security_group.security_group_id`, so the dev and staging instances land in the same VPC and subnet and share the same security group. I did this to keep networking simple and avoid duplicating infrastructure while the project is still small. If I need to isolate dev and staging into separate VPCs later, I can instantiate the vpc module once per environment and rewire the corresponding EC2 module inputs.

## Typical Workflows

### 1. Initialize

I run this once per working directory, or any time I change the backend or provider configuration:

```
terraform init
```

This configures the S3/DynamoDB backend and downloads the required providers.

### 2. Format and Validate

I run these in CI before planning:

```
terraform fmt -recursive
terraform validate
```

### 3. Plan

I can pass variables via `-var` flags, a `-var-file`, or let Terraform auto-load `terraform.tfvars`. Example using explicit flags:

```
terraform plan \
  -var="aws_region=ap-south-1" \
  -var="environment=shared" \
  -var="project_name=shophive" \
  -var="vpc_cidr=10.0.0.0/16" \
  -var="ami_id=ami-0123456789abcdef0" \
  -var="instance_type=t3.micro" \
  -var="key_name=my-key"
```

I use `environment=shared` (or a similar value) when I am working with a single VPC shared across dev and staging. In practice, I prefer keeping a `terraform.tfvars` file around so I don't have to retype these values on every run.

### 4. Apply

```
terraform apply -var-file="terraform.tfvars"
```

### 5. Destroy

```
terraform destroy -var-file="terraform.tfvars"
```

## Example terraform.tfvars

This is the starting point I copy and adjust for a given environment:

```
aws_region     = "ap-south-1"
environment    = "shared"
project_name   = "shophive"
vpc_cidr       = "10.0.0.0/16"
instance_type  = "t3.micro"
ami_id         = "ami-0123456789abcdef0"
key_name       = "my-key"
allowed_ip     = "203.0.113.0/32"
app_port       = 80
```

## GitHub Actions and CI Notes

In CI, I run `terraform fmt`, `terraform validate`, and `terraform plan` on every pull request so I catch formatting and configuration issues before merge. I restrict `apply` to the protected `main` branch, and I authenticate using short-lived credentials through OIDC role assumption rather than long-lived AWS keys. This means my workflow needs a secret like `AWS_ROLE_ARN` pointing at a role that trusts GitHub's OIDC provider. I keep the IAM permissions on that role as narrow as possible, and I avoid attaching broad managed policies, especially for anything touching production.

### State and Concurrency

My backend uses an S3 bucket for state storage and a DynamoDB table for locking, which prevents concurrent applies from corrupting the state file. I make sure the `terraform-locks` table exists and that whichever identity is running Terraform (locally or in CI) has permission to read and write to it.

## Best Practices I Follow

I keep secrets out of the repository entirely, relying on environment variables or a secret store instead of committing them. I use separate `.tfvars` files, or workspaces, to isolate distinct deployments when I can't provision fully separate AWS accounts. Where possible, I prefer separate AWS accounts, or at minimum separate VPCs, for production versus non-production workloads. I try to write a short README inside each module describing its inputs, outputs, and behavior, since that makes reuse much easier later. In CI, I always run `fmt`, `validate`, and a `plan` sanity check before anything gets close to `apply`.

## Troubleshooting

If I see "No valid credential sources found," it usually means AWS credentials aren't configured for the CLI or CI environment — I check environment variables, the local profile, or confirm the instance role if I'm running on EC2.

If backend initialization fails, it's often because the S3 bucket or DynamoDB table referenced in `backend.tf` doesn't exist yet. I either create them manually first or use a small bootstrapping workspace dedicated to creating them.

If I see unexpected diffs on `plan`, I check for drift, default values that changed, or provider version differences. `terraform state` and `terraform import` are my usual tools for reconciling state against resources that already exist.

## Useful Commands

**Setup**

```
terraform init
terraform providers lock -platform=linux_amd64   # optional: lock provider checksums
```

**Formatting and validation**

```
terraform fmt -recursive
terraform validate
```

**Planning and applying**

```
terraform plan -var-file="terraform.tfvars"
terraform plan -var-file="dev.tfvars" -out=dev.tfplan
terraform plan -out=tfplan -var-file="terraform.tfvars"
terraform apply "tfplan"
terraform apply -var-file="terraform.tfvars"
terraform apply "dev.tfplan"
```

**State and workspaces**

```
terraform workspace list
terraform workspace new <name>
terraform workspace select <name>
terraform state list
terraform state show <resource>
terraform state rm <resource>   # use carefully
```

**Importing existing resources**

```
terraform import module.vpc.aws_vpc.main vpc-12345678
```

**Destroying**

```
terraform destroy -var-file="terraform.tfvars"
```

**Debugging**

```
TF_LOG=DEBUG terraform plan -var-file="terraform.tfvars"
terraform plan -refresh=false -var-file="terraform.tfvars"
```

**CI / non-interactive**

```
terraform plan -input=false -lock=true -var-file="terraform.tfvars" -out=ci.tfplan
terraform apply -input=false ci.tfplan
```

I prefer `-var-file` or `TF_VAR_*` environment variables over embedding values directly on the command line, and I always run `fmt` and `validate` before `plan` in CI. Using `plan -out` to save a plan file, then applying that exact file, is how I keep CI/CD applies reproducible.

---

## Per-Environment Command Reference

I keep this section as a quick copy-paste reference for dev, staging, and production workflows.

**Change into the Terraform directory**

```
cd terraform
```

**Initialize and check**

```
terraform init
terraform fmt -recursive
terraform validate
```

**Dev**

```
terraform plan -var-file="dev.tfvars" -out=dev.tfplan
terraform apply "dev.tfplan"
```

**Staging**

```
terraform plan -var-file="staging.tfvars" -out=staging.tfplan
terraform apply "staging.tfplan"
```

**Production** (ECR resources are only created when `environment = "prod"`)

```
terraform plan -var-file="prod.tfvars" -out=prod.tfplan
terraform apply "prod.tfplan"
```

**Quick interactive apply**

```
terraform apply -var-file="dev.tfvars"
```

**terraform.tfvars is auto-loaded**

```
terraform plan   # loads terraform.tfvars automatically, no -var-file needed
```

**Environment variables**

```
export TF_VAR_allowed_ip="203.0.113.5/32"
terraform plan -var-file="dev.tfvars"
```

**Workspaces and state**

```
terraform workspace list
terraform workspace new <name>
terraform workspace select <name>
terraform state list
terraform state show <resource>
terraform state rm <resource>   # use carefully
```

**Import existing resources**

```
terraform import module.vpc.aws_vpc.main vpc-12345678
```

**Destroy**

```
terraform destroy -var-file="dev.tfvars"
```

**Non-interactive CI usage**

```
terraform plan -input=false -lock=true -var-file="dev.tfvars" -out=ci.tfplan
terraform apply -input=false ci.tfplan
```

**Debugging and verbosity**

```
TF_LOG=DEBUG terraform plan -var-file="dev.tfvars"
terraform plan -refresh=false -var-file="dev.tfvars"
```

**AWS CLI helpers**

```
# list key pairs in the configured region
aws ec2 describe-key-pairs --region ap-south-1 --query "KeyPairs[].KeyName"

# find my public IP, for allowed_ip
curl -s https://checkip.amazonaws.com
```

I prefer `-var-file` for environment-specific values (`dev.tfvars`, `staging.tfvars`, `prod.tfvars`), and I only keep `terraform.tfvars` around for local, non-sensitive default values. I never commit secrets or private keys; CI secrets and OIDC role assumption handle that instead. Saving a plan with `-out` and applying that exact plan file is how I keep every CI/CD run reproducible.

## .tfvars Files — Purpose and Usage

**terraform.tfvars** holds optional default values that Terraform auto-loads. I use it for local development defaults or examples, and I never put secrets in it. It requires no `-var-file` flag; a plain `terraform plan` picks it up automatically.

**dev.tfvars** holds the dev environment values (`environment = "dev"`), typically a smaller instance type, a dev AMI, a dev key pair, and sometimes a wider `allowed_ip` for convenience. My reproducible flow is:

```
terraform plan -var-file="dev.tfvars" -out=dev.tfplan
terraform apply "dev.tfplan"

# destroy
terraform plan -destroy -var-file="dev.tfvars" -out=dev-destroy.tfplan
terraform apply "dev-destroy.tfplan"
```

**staging.tfvars** holds values that mirror production more closely, since staging is where I validate changes before they reach prod.

```
terraform plan -var-file="staging.tfvars" -out=staging.tfplan
terraform apply "staging.tfplan"

# destroy
terraform plan -destroy -var-file="staging.tfvars" -out=staging-destroy.tfplan
terraform apply "staging-destroy.tfplan"
```

**prod.tfvars** holds production values. Because the root module conditionally creates the ECR module when `environment == "prod"`, applying with `prod.tfvars` is what triggers ECR creation. I always review this file carefully before applying, and I keep it free of secrets, relying on CI secrets or a secured, uncommitted `terraform.tfvars` instead.

```
terraform plan -var-file="prod.tfvars" -out=prod.tfplan
terraform apply "prod.tfplan"

# destroy
terraform plan -destroy -var-file="prod.tfvars" -out=prod-destroy.tfplan
terraform apply "prod-destroy.tfplan"
```

## Annotated GitHub Actions Workflow

Below is the workflow I use for CI: it plans on pull requests and applies on pushes to `main`. I've commented each step so I remember why it's there.

```yaml
name: Terraform Infrastructure

# Triggers: PRs and pushes to main, scoped to changes under terraform/
on:
  pull_request:
    branches: [main]
    paths: ["terraform/**"]
  push:
    branches: [main]
    paths: ["terraform/**"]

permissions:
  id-token: write # required for OIDC role assumption
  contents: read

env:
  AWS_REGION: ap-south-1
  TERRAFORM_VERSION: 1.6.6

jobs:
  terraform-plan:
    name: Terraform Plan (PRs)
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    defaults:
      run:
        working-directory: terraform
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: ${{ env.TERRAFORM_VERSION }}

      - name: Configure AWS Credentials (OIDC role)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }} # role must already exist and trust GitHub's OIDC provider
          aws-region: ${{ env.AWS_REGION }}

      - name: Terraform Format Check
        run: terraform fmt -check

      - name: Terraform Init
        run: terraform init -input=false

      - name: Terraform Validate
        run: terraform validate

      - name: Terraform Plan
        run: terraform plan -var-file="dev.tfvars"

  terraform-apply:
    name: Terraform Apply (main)
    runs-on: ubuntu-latest
    if: github.event_name == 'push'
    defaults:
      run:
        working-directory: terraform
    environment:
      name: production-approval # optional: gates apply behind a manual approval
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: ${{ env.TERRAFORM_VERSION }}

      - name: Configure AWS Credentials (OIDC role)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Terraform Init
        run: terraform init -input=false

      - name: Terraform Apply
        run: terraform apply -auto-approve -var-file="dev.tfvars" # swap to prod.tfvars for production applies
```

The plan job runs on pull requests to validate formatting and show me what would change. The apply job runs on pushes to `main` and sits behind an environment gate (`production-approval`) so nothing applies without a manual approval. This workflow assumes `AWS_ROLE_ARN` is already set as a repository secret, pointing at a role permitted to operate against the S3 backend and create the resources this configuration defines. For multi-environment CI, I could either add a `workflow_dispatch` input to choose which `.tfvars` file to use, or split this into separate apply jobs per environment.
