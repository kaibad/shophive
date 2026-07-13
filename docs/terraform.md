# Terraform: ShopHive Infrastructure

I use this document to explain how I have organized Terraform in the ShopHive repository, and to give myself, and anyone else working on this, a clear reference for initializing, planning, applying, and maintaining the infrastructure.

## Overview

I manage AWS infrastructure for ShopHive using a modular Terraform design. The root module, `terraform/`, wires together reusable modules for VPC, EC2, security groups, IAM, and ECR, so each concern stays isolated and easy to reason about on its own.

## Repository Layout

The Terraform code and related scripts follow this layout:

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

I will update this section if I add new modules or environment files later.

## Provider and Backend

In `providers.tf`, I pin the Terraform `required_version` to `>= 1.6` and use the `hashicorp/aws` provider at `~> 5.0`. The `aws` provider block reads its region from `var.aws_region`.

For state, `backend.tf` configures a remote backend using S3 for storage and DynamoDB for locking. My current configuration uses the bucket `my-shophive-terraform-state`, the key `infra/terraform.tfstate`, the region `ap-south-1`, and the DynamoDB table `terraform-locks`, with encryption enabled. Before I ever run `terraform init`, I make sure this S3 bucket and DynamoDB table already exist and are properly access-controlled.

## Root Variables

I declare the key variables in `terraform/variables.tf`: `aws_region`, `environment`, and `project_name` as strings; `vpc_cidr`, `instance_type`, `ami_id`, and `key_name` as strings that vary by environment; `allowed_ip` as the string CIDR permitted for SSH; and `app_port` as a number that defaults to 80.

## Modules

### VPC Module

This module takes `project_name`, `environment`, and `cidr_block` as inputs, and returns `vpc_id`, `public_subnet_id`, and `availability_zone` as outputs. It creates an `aws_vpc` with DNS support enabled, an `aws_internet_gateway` for public internet access, an `aws_subnet` in the first available availability zone, an `aws_route_table` routing to the internet gateway, and the `aws_route_table_association` that links the subnet to that route table.

### Security Group Module

This module takes `project_name`, `environment`, `vpc_id`, `allowed_ip`, and `app_port` as inputs, and returns a single `security_group_id` output. Ingress is restricted to SSH on port 22 from `allowed_ip`, HTTP on port 80 open to `0.0.0.0/0`, HTTPS on port 443 open to `0.0.0.0/0`, and a dynamic rule for the application port whenever `app_port` is not 80. Egress allows all outbound traffic to `0.0.0.0/0`.

### IAM Module

This module takes only `project_name` as input and returns `instance_profile_name` as output. It creates an `aws_iam_role` for EC2 with a trust policy scoped to `ec2.amazonaws.com`, attaches the `AmazonEC2ContainerRegistryReadOnly` policy so instances can pull Docker images from ECR and the `AmazonSSMManagedInstanceCore` policy for Systems Manager and Session Manager access, and wraps the role in an `aws_iam_instance_profile`.

### EC2 Module

This module takes `project_name`, `environment`, `subnet_id`, `security_group_id`, `iam_instance_profile`, `ami_id`, `instance_type`, and `key_name` as inputs, and returns `instance_id` and `public_ip` as outputs. It creates an `aws_instance` with a 20GB gp3 root volume, a public IP assignment, a user data bootstrap from `scripts/dev-install.sh`, and an auto-generated `Name` tag in the form `${project_name}-${environment}-server`.

### ECR Module

This module takes `project_name` and `environment` as inputs and returns a `repository_url` output. It creates an ECR repository for Docker image storage, and it is only instantiated for the production environment.

## How Dev and Staging Share the Same VPC

I intentionally create a single VPC in the root module, `module "vpc"`, and reuse its outputs across multiple EC2 module instances rather than provisioning a separate VPC per environment. In `terraform/main.tf`, I instantiate two EC2 modules: `module "ec2_dev"` with `environment = "dev"`, and `module "ec2_staging"` with `environment = "staging"`. Both reference `module.vpc.public_subnet_id` and `module.security_group.security_group_id`, so the dev and staging instances land in the same VPC and subnet and share the same security group.

I did this to keep networking simple and avoid duplicating infrastructure while the project is still small. If I need to isolate dev and staging into separate VPCs later, I can instantiate the VPC module once per environment and rewire the corresponding EC2 module inputs.

## Environment-Specific Configuration

### Development (dev.tfvars)

```hcl
aws_region    = "ap-south-1"
environment   = "dev"
project_name  = "shophive"
vpc_cidr      = "10.10.0.0/16"
instance_type = "t3.micro"          # smallest type for cost savings
ami_id        = "ami-0f58b397bc5c1f2e8"
key_name      = "mumbai"            # SSH key pair in ap-south-1
allowed_ip    = "0.0.0.0/0"         # allow SSH from anywhere
app_port      = 80
```

Dev uses a minimal `t3.micro` instance at roughly $10/month, allows public SSH access for convenience, and runs a single instance, which is sufficient for testing.

### Staging (staging.tfvars)

```hcl
aws_region    = "ap-south-1"
environment   = "staging"
project_name  = "shophive"
vpc_cidr      = "10.20.0.0/16"
instance_type = "t3.small"          # medium tier for realistic load testing
ami_id        = "ami-0f58b397bc5c1f2e8"
key_name      = "mumbai"
allowed_ip    = "0.0.0.0/0"
app_port      = 80
```

Staging steps up to a `t3.small` instance at roughly $20/month, mirrors production closely, and is where I validate changes before they reach prod.

### Production (prod.tfvars)

```hcl
aws_region    = "ap-south-1"
environment   = "prod"
project_name  = "shophive"
vpc_cidr      = "10.30.0.0/16"
instance_type = "t3.medium"         # production tier
ami_id        = "ami-0f58b397bc5c1f2e8"
key_name      = "mumbai"
allowed_ip    = "0.0.0.0/0"         # TODO: restrict to office IP
app_port      = 80
```

Production runs a `t3.medium` instance at roughly $50/month and is the only environment for which the ECR module is created, since ECR creation is conditional on `environment == "prod"`. Two action items remain open here: restricting `allowed_ip` to my office or CI/CD server IP, for example `203.0.113.5/32`, and confirming the S3 backend is fully set up for remote state management.

## Working with Terraform

I run `terraform init` once per working directory, or any time I change the backend or provider configuration. This configures the S3/DynamoDB backend and downloads the required providers. Before planning, I run `terraform fmt -recursive` and `terraform validate` to catch formatting and configuration issues early.

For planning and applying, my day-to-day flow per environment looks like this:

```
cd terraform
terraform init
terraform fmt -recursive
terraform validate

# dev
terraform plan -var-file="dev.tfvars" -out=dev.tfplan
terraform apply "dev.tfplan"

# staging
terraform plan -var-file="staging.tfvars" -out=staging.tfplan
terraform apply "staging.tfplan"

# production (ECR resources are only created when environment = "prod")
terraform plan -var-file="prod.tfvars" -out=prod.tfplan
terraform apply "prod.tfplan"
```

Saving a plan with `-out` and then applying that exact plan file is how I keep every apply reproducible, both locally and in CI. For a quicker interactive apply I sometimes skip the saved plan file and run `terraform apply -var-file="dev.tfvars"` directly. If `terraform.tfvars` is present, a plain `terraform plan` loads it automatically, without needing a `-var-file` flag; I reserve that file for local, non-sensitive defaults.

To destroy an environment, I mirror the same pattern in reverse:

```
terraform plan -destroy -var-file="dev.tfvars" -out=dev-destroy.tfplan
terraform apply "dev-destroy.tfplan"
```

For state and workspace inspection, I rely on:

```
terraform workspace list
terraform workspace new <name>
terraform workspace select <name>
terraform state list
terraform state show <resource>
terraform state rm <resource>   # use carefully
terraform import module.vpc.aws_vpc.main vpc-12345678
```

When I need to override a single value without touching a `.tfvars` file, I export it as a `TF_VAR_*` environment variable, for example:

```
export TF_VAR_allowed_ip="203.0.113.5/32"
terraform plan -var-file="dev.tfvars"
```

For debugging, I use `TF_LOG=DEBUG terraform plan -var-file="dev.tfvars"` for verbose provider output, and `terraform plan -refresh=false -var-file="dev.tfvars"` when I want to skip a state refresh. In CI, I run everything non-interactively:

```
terraform plan -input=false -lock=true -var-file="dev.tfvars" -out=ci.tfplan
terraform apply -input=false ci.tfplan
```

Two AWS CLI commands I use often alongside this workflow are `aws ec2 describe-key-pairs --region ap-south-1 --query "KeyPairs[].KeyName"` to list key pairs in the region, and `curl -s https://checkip.amazonaws.com` to find my current public IP for the `allowed_ip` variable.

## Purpose of Each .tfvars File

`terraform.tfvars` holds optional default values that Terraform auto-loads. I use it for local development defaults or examples, and I never put secrets in it. `dev.tfvars` holds the dev environment values, including `environment = "dev"`, typically a smaller instance type, a dev AMI, a dev key pair, and sometimes a wider `allowed_ip` for convenience. `staging.tfvars` holds values that mirror production closely, since staging is where I validate changes before they reach prod. `prod.tfvars` holds production values, and applying with this file is what triggers ECR creation, since the root module conditionally creates the ECR module only when `environment == "prod"`. I always review this file carefully before applying, and I keep it free of secrets, relying on CI secrets or a secured, uncommitted `terraform.tfvars` instead.

## GitHub Actions Workflow

Below is the workflow I use for CI: it plans on pull requests and applies on pushes to `main`.

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

The plan job runs on pull requests to validate formatting and show what would change. The apply job runs on pushes to `main` and sits behind an environment gate, `production-approval`, so nothing applies without a manual approval. This workflow assumes `AWS_ROLE_ARN` is already set as a repository secret, pointing at a role permitted to operate against the S3 backend and create the resources this configuration defines. I authenticate using short-lived credentials through OIDC role assumption rather than long-lived AWS keys, and I keep the IAM permissions on that role as narrow as possible, avoiding broad managed policies, especially for anything touching production. For multi-environment CI, I could either add a `workflow_dispatch` input to choose which `.tfvars` file to use, or split this into separate apply jobs per environment.

## Best Practices I Follow

I keep secrets out of the repository entirely, relying on environment variables or a secret store instead of committing them. I use separate `.tfvars` files, or workspaces, to isolate distinct deployments when I can't provision fully separate AWS accounts, and where possible I prefer separate AWS accounts, or at minimum separate VPCs, for production versus non-production workloads. I try to write a short README inside each module describing its inputs, outputs, and behavior, since that makes reuse much easier later. In CI, I always run `fmt`, `validate`, and a `plan` sanity check before anything gets close to `apply`, and I use `-var-file` or `TF_VAR_*` environment variables over embedding values directly on the command line.

## Troubleshooting

If I see "No valid credential sources found," it usually means AWS credentials aren't configured for the CLI or CI environment, so I check environment variables, the local profile, or confirm the instance role if I'm running on EC2. If backend initialization fails, it's often because the S3 bucket or DynamoDB table referenced in `backend.tf` doesn't exist yet; I either create them manually first or use a small bootstrapping workspace dedicated to creating them. If I see unexpected diffs on `plan`, I check for drift, default values that changed, or provider version differences, and I reach for `terraform state` and `terraform import` to reconcile state against resources that already exist.

My backend uses an S3 bucket for state storage and a DynamoDB table for locking, which prevents concurrent applies from corrupting the state file. I make sure the `terraform-locks` table exists and that whichever identity is running Terraform, locally or in CI, has permission to read and write to it.

## Infrastructure Summary

Each shared environment, meaning dev and staging together, provisions one VPC in the 10.x.0.0/16 range, one internet gateway, one public subnet, one route table routing to the internet gateway, one security group covering SSH, HTTP, and HTTPS, and one IAM role with its instance profile. When `environment = "dev"`, this adds a single `t3.micro` EC2 instance tagged `shophive-dev-server`. When `environment = "staging"`, this adds a single `t3.small` EC2 instance tagged `shophive-staging-server`. When `environment = "prod"`, this adds a single `t3.medium` EC2 instance tagged `shophive-prod-server`, along with an ECR repository for Docker images.

The network layout follows the same shape across environments: a VPC in the 10.10.0.0/16, 10.20.0.0/16, or 10.30.0.0/16 range depending on environment, containing an internet gateway and a public subnet in the 10.x.1.0/24 range. The relevant EC2 instance for that environment sits in the public subnet, and the shared security group permits SSH on port 22 from `allowed_ip`, HTTP on port 80 and HTTPS on port 443 from `0.0.0.0/0`, and all egress traffic outbound.

When EC2 instances launch, they run `scripts/dev/dev-install.sh` via user data, which updates system packages, installs Docker and Docker Compose, pulls and starts the application containers, and configures the required environment variables.

**Note:** I did not use Terraform in this project. I initially planned to use it and made an effort to implement it, but I ran into some complications and wasn't able to complete that part. For this project, I provisioned the infrastructure manually instead.

Going forward, I plan to learn the missing concepts around using Terraform across multiple environments and incorporate it into future projects.

Thank you.
