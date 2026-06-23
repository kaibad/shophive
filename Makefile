.PHONY: manage down restart logs superuser

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
