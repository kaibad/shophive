#!/bin/bash
set -euo pipefail

echo "Waiting for app to be ready..."

for i in $(seq 1 12); do
    if curl -sf http://localhost/api/health/ > /dev/null; then
        echo " Health check passed"
        exit 0
    fi

    echo "Attempt $i/12 failed, retrying in 10s..."
    sleep 10
done

echo " Health check failed after 2 minutes"
exit 
