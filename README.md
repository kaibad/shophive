# ShopHive

ShopHive is a full-stack e-commerce application built with Django, React, and modern DevOps practices.

This repository contains application source code, containerization setup, infrastructure configuration, and deployment resources.

---

# Documentation

All detailed documentation is maintained inside the `docs/` directory.

---

## Local Setup

[Local Setup Guide](./docs/local-setup.md)

Explains how to set up the development environment locally, including:

- Required software installation
- Environment variable configuration
- Backend setup
- Frontend setup
- Database configuration
- Running the application locally
- Development workflow

---

## Architecture

[Architecture Documentation](./docs/architecture.md)

Explains the overall system architecture, application components, service communication flow, and technology decisions.

---

## Project Structure

[Project Structure Documentation](./docs/project-structure.md)

Explains the repository folder organization, purpose of each directory, and the reasoning behind the project structure.

---

## Docker Setup

[Docker Documentation](./docs/docker.md)

Explains containerization strategy, Dockerfiles, Docker images, containers, and development/production Docker workflows.

---

## Deployment

[Deployment Documentation](./docs/cicd)

Explains application deployment processes, environments, and production deployment workflow.

---

## Kubernetes

[Kubernetes Documentation](./docs/kubernetes.md)

Explains Kubernetes resources, deployments, services, networking, configuration management, and cluster deployment.

---

## Helm

[Helm Documentation](./docs/helm.md)

Explains Helm charts, templates, values files, and Kubernetes application packaging.

---

## Terraform

[Terraform Documentation](./docs/terraform.md)

Explains Infrastructure as Code setup, cloud resource provisioning, Terraform workflow, and infrastructure management.

---

## Troubleshooting

[Troubleshooting Guide](./docs/troubleshooting.md)

Contains common development and deployment issues, debugging steps, and solutions.

---

# Documentation Structure

```text
docs/
├── local-setup.md
├── architecture.md
├── project-structure.md
├── docker.md
├── deployment.md
├── kubernetes.md
├── helm.md
├── terraform.md
└── troubleshooting.md
```

---

# Quick Start

For local development:

```bash
git clone <repository-url>

cd shophive

docker compose up --build
```

For production deployment:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Refer to the documentation guides above for detailed setup and deployment instructions.
