# Ecommerce Project Deployment Guide
### Stack: React (Vite) + Django REST Framework + PostgreSQL (Docker) on AWS EC2 (Ubuntu)

---

## Prerequisites

- AWS EC2 instance running Ubuntu 24.x
- Security group with inbound rules open for:
  - Port **22** (SSH)
  - Port **80** (HTTP)
  - Port **3000–8100** (Custom TCP, for dev/testing)
- SSH access to the instance

---

## Step 1 — System Dependencies

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx python3 python3-pip python3.14-venv
```

---

## Step 2 — Install Node.js via NVM

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.5/install.sh | bash
. "$HOME/.nvm/nvm.sh"
nvm install 24
node -v   # v24.x.x
npm -v    # 11.x.x
```

---

## Step 3 — Install Docker and Run PostgreSQL Container

```bash
sudo apt install docker.io -y
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ubuntu
newgrp docker

docker run -d \
  --name postgres \
  -e POSTGRES_DB=ecommerce_db \
  -e POSTGRES_USER=ecommerce_user \
  -e POSTGRES_PASSWORD=yourpassword \
  -p 5432:5432 \
  postgres:15

# Verify it's running
docker ps
```

---

## Step 4 — Backend Setup (Django)

### 4.1 Create Virtual Environment

```bash
cd ~/app/ecommerce-project-react-django/backend
python3 -m venv venv
source venv/bin/activate
```

### 4.2 Install Dependencies

```bash
pip install -r requirements.txt
pip install djangorestframework-simplejwt requests  # missing from requirements.txt
```

### 4.3 Create .env File

```bash
nano .env
```

```env
DB_NAME=ecommerce_db
DB_USER=ecommerce_user
DB_PASSWORD=yourpassword
DB_HOST=localhost
DB_PORT=5432
```

### 4.4 Update settings.py

Make sure the following are set in `backend/settings.py`:

```python
ALLOWED_HOSTS = ['*']

INSTALLED_APPS = [
    ...
    'corsheaders',
    'rest_framework',
    'rest_framework_simplejwt',
    'store',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',  # must be first
    ...
]

CORS_ALLOW_ALL_ORIGINS = True  # boolean, not a list

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')
```

### 4.5 Run Migrations and Collect Static

```bash
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py createsuperuser
```

### 4.6 Seed Product Data (Optional)

```bash
cat > seed.py << 'EOF'
import os
import django
import requests
from django.core.files.base import ContentFile
from django.utils.text import slugify

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

from store.models import Product, Category

products = [
    {'category': 'Electronics', 'name': 'Wireless Headphones', 'description': 'High quality wireless headphones.', 'price': 99.99, 'image_url': 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400'},
    {'category': 'Electronics', 'name': 'Bluetooth Speaker', 'description': 'Portable bluetooth speaker.', 'price': 49.99, 'image_url': 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=400'},
    {'category': 'Electronics', 'name': 'Smart Watch', 'description': 'Feature-rich smartwatch.', 'price': 199.99, 'image_url': 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400'},
    {'category': 'Clothing', 'name': 'Running Shoes', 'description': 'Lightweight running shoes.', 'price': 79.99, 'image_url': 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400'},
    {'category': 'Clothing', 'name': 'Cotton T-Shirt', 'description': 'Premium cotton t-shirt.', 'price': 19.99, 'image_url': 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400'},
    {'category': 'Home & Kitchen', 'name': 'Coffee Maker', 'description': 'Automatic coffee maker.', 'price': 129.99, 'image_url': 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400'},
    {'category': 'Home & Kitchen', 'name': 'Air Fryer', 'description': 'Digital air fryer 5.8qt.', 'price': 89.99, 'image_url': 'https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=400'},
]

for p in products:
    cat, _ = Category.objects.get_or_create(name=p['category'], defaults={'slug': slugify(p['category'])})
    product, created = Product.objects.get_or_create(name=p['name'], defaults={'category': cat, 'description': p['description'], 'price': p['price']})
    if created:
        try:
            response = requests.get(p['image_url'], timeout=10)
            if response.status_code == 200:
                product.image.save(f"{slugify(p['name'])}.jpg", ContentFile(response.content), save=True)
                print(f"Created with image: {p['name']}")
        except Exception as e:
            print(f"Created (image error): {p['name']} - {e}")
    else:
        print(f"Already exists: {p['name']}")

print("Seeding done!")
EOF

python seed.py
```

### 4.7 Start the backend server

```bash
python manage.py runserver 0.0.0.0:8000
# or
python manage.py runserver

```


---

## Step 5 — Frontend Setup (React + Vite)

### 5.1 Install Dependencies

```bash
cd ~/app/ecommerce-project-react-django/frontend
npm install
```

### 5.2 Create .env File

```bash
nano .env
```

```env
VITE_DJANGO_BASE_URL=http://YOUR_EC2_PUBLIC_IP
```

> Use port 80 (no port suffix) so all requests go through Nginx.

### 5.3 Build for Production

```bash
npm run build
# Output goes to frontend/dist/
```

---

## Step 6 — Gunicorn Setup (Systemd Service)

```bash
source ~/app/ecommerce-project-react-django/backend/venv/bin/activate
pip install gunicorn
```

Create the service file:

```bash
sudo nano /etc/systemd/system/ecommerce.service
```

```ini
[Unit]
Description=Django Gunicorn for Ecommerce
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/app/ecommerce-project-react-django/backend
EnvironmentFile=/home/ubuntu/app/ecommerce-project-react-django/backend/.env
ExecStart=/home/ubuntu/app/ecommerce-project-react-django/backend/venv/bin/gunicorn backend.wsgi:application --bind 127.0.0.1:8000
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl start ecommerce
sudo systemctl enable ecommerce
sudo systemctl status ecommerce
```

---

## Step 7 — Nginx Configuration

```bash
sudo nano /etc/nginx/sites-available/ecommerce
```

```nginx
server {
    listen 80;
    server_name YOUR_EC2_PUBLIC_IP;

    # React frontend
    root /home/ubuntu/app/ecommerce-project-react-django/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Django API
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Django admin
    location /admin/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
    }

    # Django static files
    location /static/ {
        alias /home/ubuntu/app/ecommerce-project-react-django/backend/staticfiles/;
    }

    # Media files
    location /media/ {
        alias /home/ubuntu/app/ecommerce-project-react-django/backend/media/;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/ecommerce /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Fix Nginx Permissions

Nginx runs as `www-data` and cannot read files inside `/home/ubuntu` by default:

```bash
chmod o+x /home/ubuntu
chmod o+x /home/ubuntu/app
chmod o+x /home/ubuntu/app/ecommerce-project-react-django
chmod o+x /home/ubuntu/app/ecommerce-project-react-django/frontend
chmod o+x /home/ubuntu/app/ecommerce-project-react-django/frontend/dist
chmod -R o+r /home/ubuntu/app/ecommerce-project-react-django/frontend/dist
```

---

## Step 8 — Verify Everything is Running

```bash
sudo systemctl status ecommerce    # Gunicorn
sudo systemctl status nginx        # Nginx
docker ps                          # PostgreSQL
```

Access the app:

| URL | What |
|-----|------|
| `http://YOUR_EC2_PUBLIC_IP` | React frontend |
| `http://YOUR_EC2_PUBLIC_IP/admin/` | Django admin |
| `http://YOUR_EC2_PUBLIC_IP/api/` | REST API |

---

## Quick Status Commands

```bash
# Restart everything
sudo systemctl restart ecommerce
sudo systemctl restart nginx

# View logs
sudo journalctl -u ecommerce -n 50 --no-pager
sudo tail -20 /var/log/nginx/error.log

# Kill anything on port 8000
sudo fuser -k 8000/tcp
```

---

## What We Did Wrong & Troubleshooting

### 1. `python3-venv` not installed
**Error:** `The virtual environment was not created successfully because ensurepip is not available`  
**Fix:** `sudo apt install python3.14-venv -y`

---

### 2. `djangorestframework-simplejwt` missing from requirements.txt
**Error:** `ModuleNotFoundError: No module named 'rest_framework_simplejwt'`  
**Fix:** `pip install djangorestframework-simplejwt`  
The project's `requirements.txt` was incomplete — always check for missing packages after `pip install -r requirements.txt`.

---

### 3. `CORS_ALLOW_ALL_ORIGINS` was set to a list instead of a boolean
**Wrong:**
```python
CORS_ALLOW_ALL_ORIGINS = ["http://localhost:3000"]
```
**Correct:**
```python
CORS_ALLOW_ALL_ORIGINS = True
```
This caused CORS headers to be missing from API responses, breaking signup/login from the browser.

---

### 4. `corsheaders` missing from `INSTALLED_APPS`
Even though `CorsMiddleware` was in `MIDDLEWARE`, the app wasn't in `INSTALLED_APPS`. Both are required for `django-cors-headers` to work.

---

### 5. `STATIC_ROOT` not set
**Error:** `ImproperlyConfigured: You're using the staticfiles app without having set the STATIC_ROOT setting`  
**Fix:** Add to `settings.py`:
```python
STATIC_ROOT = BASE_DIR / 'staticfiles'
```
Then run `python manage.py collectstatic --noinput`.

---

### 6. Nginx `Permission denied` on frontend dist
**Error:** `stat() "/home/ubuntu/.../dist/index.html" failed (13: Permission denied)`  
**Cause:** Nginx runs as `www-data` which has no access to `/home/ubuntu` by default.  
**Fix:** Add execute permission on each directory in the path:
```bash
chmod o+x /home/ubuntu
chmod o+x /home/ubuntu/app
# ... and so on down to dist/
chmod -R o+r .../frontend/dist
```

---

### 7. Frontend calling port 8000 directly
**Problem:** `VITE_DJANGO_BASE_URL=http://3.x.x.x:8000` — the browser was trying to hit Gunicorn directly, which is bound to `127.0.0.1` (localhost only) and not accessible externally.  
**Fix:** Set `VITE_DJANGO_BASE_URL=http://YOUR_EC2_PUBLIC_IP` (port 80) so all requests go through Nginx, which proxies to Gunicorn internally.

---

### 8. Port 8000 already in use when starting Gunicorn
**Error:** `[Errno 98] Address already in use`  
**Cause:** `python manage.py runserver` was still running in the background.  
**Fix:** `sudo fuser -k 8000/tcp` then restart the service.

---

### 9. `requests` module not installed
**Error:** `ModuleNotFoundError: No module named 'requests'`  
**Fix:** `pip install requests`  
Not part of Django's default packages — needs explicit install when using it in scripts.

---

### 10. Admin panel black boxes (missing CSS)
**Cause:** `/static/` location block was missing from Nginx config, so Django admin CSS/JS wasn't being served.  
**Fix:** Add to Nginx config:
```nginx
location /static/ {
    alias /home/ubuntu/.../backend/staticfiles/;
}
```
And run `python manage.py collectstatic --noinput` first.
