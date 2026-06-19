# Project Structure Setup

## Overview

This document explains the directory structure of the ShopHive project, including the purpose of each folder, why it exists, and how it supports the project's DevOps workflow.

The structure is designed to separate application code, infrastructure, deployment configurations, and documentation, making the project easier to maintain, scale, and deploy.

---

## Project Structure

```text
shophive/
├── backend/
├── frontend/
├── nginx/
├── docs/
├── k8s/
├── helm/
├── terraform/
├── docker-compose.yml
├── docker-compose.prod.yml
├── local-installation-guide.md
└── project-specification-doc.md
```

---

## Backend

```text
backend/
```

### What

Contains the Django backend application, APIs, business logic, database models, and authentication functionality.

### Why

Separates backend services from frontend code to follow a clean service-oriented architecture.

### How

The backend is containerized using Docker and served by Gunicorn in production.

Example contents:

```text
backend/
├── Dockerfile
├── manage.py
├── requirements.txt
├── .env
└── app/
```

---

## Frontend

```text
frontend/
```

### What

Contains the React/Vite frontend application.

### Why

Keeps user interface code isolated from backend services.

### How

The frontend is built into static assets and served through Nginx in production.

Example contents:

```text
frontend/
├── Dockerfile
├── package.json
├── src/
└── public/
```

---

## Nginx

```text
nginx/
```

### What

Stores Nginx configuration files used as a reverse proxy.

### Why

Nginx handles incoming traffic, serves frontend static files, and forwards API requests to Django.

### How

Example contents:

```text
nginx/
├── nginx.conf
└── .gitkeep
```

---

## Docs

```text
docs/
```

### What

Contains project documentation.

### Why

Centralizes technical documentation, architecture decisions, deployment procedures, and troubleshooting guides.

### How

Example contents:

```text
docs/
├── architecture.md
├── deployment-guide.md
├── project-structure.md
└── troubleshooting.md
```

---

## Kubernetes

```text
k8s/
```

### What

Stores raw Kubernetes manifests.

### Why

Provides deployment definitions for Kubernetes clusters.

### How

Example contents:

```text
k8s/
├── backend-deployment.yaml
├── frontend-deployment.yaml
├── ingress.yaml
├── postgres.yaml
└── redis.yaml
```

---

## Helm

```text
helm/
```

### What

Contains Helm charts for packaging and deploying Kubernetes resources.

### Why

Helm simplifies Kubernetes deployments and environment management.

### How

Example contents:

```text
helm/
└── shophive/
    ├── Chart.yaml
    ├── values.yaml
    └── templates/
```

---

## Terraform

```text
terraform/
```

### What

Contains Infrastructure as Code (IaC) definitions.

### Why

Allows cloud resources to be provisioned and managed in a reproducible manner.

### How

Example contents:

```text
terraform/
├── main.tf
├── variables.tf
├── outputs.tf
└── providers.tf
```

---

## Docker Compose

### Development

```text
docker-compose.yml
```

Used for local development.

Provides:

* Django backend
* React frontend
* PostgreSQL database
* Redis cache

### Production

```text
docker-compose.prod.yml
```

Used for production-like deployments.

Provides:

* Nginx reverse proxy
* Gunicorn application server
* PostgreSQL database
* Redis cache

---

## Benefits of This Structure

### Separation of Concerns

Application code, infrastructure, deployment configurations, and documentation are organized independently.

### Scalability

New services and infrastructure components can be added without affecting the existing structure.

### Maintainability

Developers can quickly locate configuration files, source code, and deployment manifests.

### DevOps Readiness

The structure aligns with modern DevOps practices including:

* Docker containerization
* Kubernetes orchestration
* Helm package management
* Terraform infrastructure provisioning
* CI/CD integration

---

## Future Enhancements

Planned additions include:

* GitHub Actions CI/CD pipelines
* Monitoring with Prometheus and Grafana
* Logging with ELK or Loki
* Kubernetes Ingress Controller
* Cloud deployment using Terraform

This structure provides a solid foundation for both development and production environments while supporting future scaling and DevOps automation efforts.

