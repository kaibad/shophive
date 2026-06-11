# DevOps Project Requirements

- [ ] Blue-Green Deployment in Kubernetes

- [ ] Secure CI/CD Pipeline

- [ ] Use self-managed Kubernetes (MicroK8s preferred over EKS)

- [ ] Frontend Deployment:
  - [ ] Amazon S3

- [ ] Backend Deployment:
  - [ ] EC2

- [ ] Database:
  - [ ] PostgreSQL/MySQL on EC2 OR Amazon RDS
  - [ ] Database Backups

- [ ] Implement Least Privilege Access

- [ ] End-to-End Automation

- [ ] Kubernetes Best Practices:
  - [ ] Resource Requests and Limits
  - [ ] ConfigMaps
  - [ ] Secrets
  - [ ] HashiCorp Vault / AWS Secrets Manager
  - [ ] Cluster Monitoring
  - [ ] Logging
  - [ ] Observability
  - [ ] Namespace Separation (dev, staging, prod)
  - [ ] Persistent Volumes (PV)
  - [ ] Persistent Volume Claims (PVC)
  - [ ] Rolling Update Strategy
  - [ ] Blue-Green Deployment Strategy
  - [ ] Non-Root Containers
  - [ ] Read-Only Filesystem (where applicable)

- [ ] AIOps for Monitoring and Alerting

- [ ] Auto Scaling:
  - [ ] Scale up to 5 Pods
  - [ ] Scale up to 5 Nodes
  - [ ] Alert via Slack and/or Email if scaling exceeds threshold

- [ ] Security:
  - [ ] RBAC
  - [ ] IAM Roles
  - [ ] Service Accounts
  - [ ] GitHub OIDC Authentication
  - [ ] Container Image Scanning (Trivy)
  - [ ] Base Image Hardening

- [ ] Ingress Controller

- [ ] Kubernetes Tools:
  - [ ] Helm
  - [ ] ArgoCD

- [ ] Kubernetes Health Checks:
  - [ ] Liveness Probe
  - [ ] Readiness Probe
  - [ ] Startup Probe

- [ ] Terraform for Infrastructure Provisioning:
  - [ ] VPC
  - [ ] Public Subnets
  - [ ] Private Subnets
  - [ ] Route Tables
  - [ ] Security Groups
  - [ ] EC2
  - [ ] S3
  - [ ] RDS (Optional)
  - [ ] Bastion Host (or VPN Access)
  - [ ] Kubernetes resources managed manually

- [ ] GitHub as Single Source of Truth:
  - [ ] Application Code
  - [ ] Terraform Code
  - [ ] Helm Charts
  - [ ] Dockerfiles
  - [ ] Kubernetes Manifests
  - [ ] CI/CD Pipelines
  - [ ] Documentation

- [ ] Terraform Remote Backend:
  - [ ] S3 Backend
  - [ ] DynamoDB State Locking

- [ ] Terraform CI/CD Pipeline:
  - [ ] Pull Request Validation Pipeline
  - [ ] Branch Protection Rules
  - [ ] terraform fmt
  - [ ] terraform validate
  - [ ] Security Scan (Checkov/tfsec)
  - [ ] terraform plan
  - [ ] Manual Approval (Production)
  - [ ] terraform apply
  - [ ] Update Remote State

- [ ] Environment Strategy:
  - [ ] Development
  - [ ] Staging
  - [ ] Production

- [ ] Terraform State File Security:
  - [ ] No Secrets in State File
  - [ ] Encrypt Backend
  - [ ] Restricted Access

- [ ] Infrastructure Automation:
  - [ ] No need to 100% automate the infra
  - [ ] Secure Credential Management
  - [ ] No Hardcoded Secrets
  - [ ] IAM Roles / GitHub OIDC Authentication

- [ ] Storage & Recovery:
  - [ ] S3 Versioning
  - [ ] Database Backup Strategy

- [ ] Documentation:
  - [ ] Architecture Diagram
  - [ ] CI/CD Flow Diagram
  - [ ] Deployment Guide
  - [ ] Troubleshooting Guide
  - [ ] Runbook
