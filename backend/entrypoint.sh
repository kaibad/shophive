#!/bin/sh

set -e

echo "Starting Django backend..."

# Run migrations if enabled
if [ "$ENABLE_MIGRATE" = "true" ]; then
    echo "Running migrations..."
    python3 manage.py migrate
fi


# Collect static files if enabled
if [ "$ENABLE_COLLECTSTATIC" = "true" ]; then
    echo "Collecting static files..."
    python3 manage.py collectstatic --noinput
fi

# create django superuser
if [ "$DJANGO_SUPERUSER_USERNAME" != "" ]; then
    echo "Creating superuser..."
    python3 manage.py createsuperuser \
        --noinput \
        --username $DJANGO_SUPERUSER_USERNAME \
        --email $DJANGO_SUPERUSER_EMAIL || true
fi

# execute seed

echo "Starting server..."

exec "$@"
