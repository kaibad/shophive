#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# ShopHive production deploy script
#
# Usage:
#   ./deploy.sh --registry <ecr-registry>
# ---------------------------------------------------------------------------

REGION="ap-south-1"
COMPOSE_FILE="compose.prod.yml"

usage() {
    echo "Usage: $0 --registry <ecr-registry>"
    exit 1
}

REGISTRY=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --registry)
            REGISTRY="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown argument: $1"
            usage
            ;;
    esac
done

if [[ -z "$REGISTRY" ]]; then
    echo "Error: --registry is required." >&2
    usage
fi

echo "==> Logging in to ECR ($REGISTRY) in $REGION"
aws ecr get-login-password --region "$REGION" \
    | docker login --username AWS --password-stdin "$REGISTRY"

echo "==> Starting containers"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans