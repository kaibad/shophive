#!/bin/bash
set -euo pipefail

# Install dependencies and snapd
sudo apt update -y
sudo apt install -y snapd

# Ensure snap path is available
sudo snap install core || true

# Install microk8s
sudo snap install microk8s --classic

# Add ubuntu user to microk8s group
sudo usermod -aG microk8s ubuntu || true
sudo chown -f -R ubuntu ~/.kube || true

# Enable basic services
sudo microk8s enable dns storage

# Wait for cluster services to become ready (best-effort)
sleep 10
sudo microk8s status --wait-ready || true

# Print status
sudo microk8s kubectl get nodes || true
