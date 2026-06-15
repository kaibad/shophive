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
