.PHONY: up down restart logs build vprune sprune \
	tf-init tf-fmt tf-validate \
	tf-plan-dev tf-apply-dev tf-destroy-dev \
	tf-plan-staging tf-apply-staging tf-destroy-staging \
	tf-plan-prod tf-apply-prod tf-destroy-prod

TF_DIR := terraform

up:
	docker compose up -d

down:
	docker compose down

restart:
	docker compose down
	docker compose up -d

logs:
	docker compose logs -f

build:
	docker compose down && docker compose build --no-cache && docker compose up -d

vprune:
	docker volume prune -a

sprune:
	docker system prune -a

# --- Terraform ---

tf-init:
	cd $(TF_DIR) && terraform init

tf-fmt:
	cd $(TF_DIR) && terraform fmt -recursive

tf-validate:
	cd $(TF_DIR) && terraform validate

# Dev
tf-plan-dev:
	cd $(TF_DIR) && terraform plan -var-file="dev.tfvars" -out=dev.tfplan

tf-apply-dev:
	cd $(TF_DIR) && terraform apply "dev.tfplan"

tf-destroy-dev:
	cd $(TF_DIR) && terraform plan -destroy -var-file="dev.tfvars" -out=dev-destroy.tfplan
	cd $(TF_DIR) && terraform apply "dev-destroy.tfplan"

# Staging
tf-plan-staging:
	cd $(TF_DIR) && terraform plan -var-file="staging.tfvars" -out=staging.tfplan

tf-apply-staging:
	cd $(TF_DIR) && terraform apply "staging.tfplan"

tf-destroy-staging:
	cd $(TF_DIR) && terraform plan -destroy -var-file="staging.tfvars" -out=staging-destroy.tfplan
	cd $(TF_DIR) && terraform apply "staging-destroy.tfplan"

# Production (ECR resources are only created when environment = "prod")
tf-plan-prod:
	cd $(TF_DIR) && terraform plan -var-file="prod.tfvars" -out=prod.tfplan

tf-apply-prod:
	cd $(TF_DIR) && terraform apply "prod.tfplan"

tf-destroy-prod:
	cd $(TF_DIR) && terraform plan -destroy -var-file="prod.tfvars" -out=prod-destroy.tfplan
	cd $(TF_DIR) && terraform apply "prod-destroy.tfplan"