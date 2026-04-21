.PHONY: help up down logs restart build clean db-seed db-push fetch

help:
	@echo "Gym Capacity Monitor - Befehle"
	@echo "=============================="
	@echo ""
	@echo "Docker:"
	@echo "  make up             - Starten (ohne Cron)"
	@echo "  make up-with-cron   - Starten MIT integriertem Cron-Service"
	@echo "  make down           - Stoppen"
	@echo "  make restart        - Neustarten"
	@echo "  make logs           - Logs anschauen"
	@echo "  make logs-web       - Web-App Logs"
	@echo "  make logs-db        - Datenbank Logs"
	@echo "  make ps             - Status anzeigen"
	@echo "  make clean          - Alles löschen (inkl. Volumes)"
	@echo ""
	@echo "Database:"
	@echo "  make db-push        - Migrations durchführen"
	@echo "  make db-seed        - Mit Testdaten füllen"
	@echo ""
	@echo "API:"
	@echo "  make fetch          - Fetch-Endpoint manuell aufrufen"
	@echo ""

# Docker Commands
up:
	docker-compose up -d
	@echo "✓ Services gestartet (ohne Cron)"
	@echo "  → Dashboard: http://localhost:3000"

up-with-cron:
	docker-compose --profile with-cron up -d
	@echo "✓ Services gestartet MIT Cron"
	@echo "  → Daten werden alle 5 Min abgerufen"

down:
	docker-compose down

restart:
	docker-compose restart

logs:
	docker-compose logs -f

logs-web:
	docker-compose logs -f web

logs-db:
	docker-compose logs -f postgres

logs-cron:
	docker-compose logs -f cron

ps:
	docker-compose ps

build:
	docker-compose build

rebuild:
	docker-compose down && docker-compose build && docker-compose up -d

clean:
	docker-compose down -v
	@echo "✓ Alle Daten gelöscht"

# Database Commands
db-push:
	docker-compose exec web npx prisma db push
	@echo "✓ Migrations durchgeführt"

db-seed:
	docker-compose exec web npx prisma db seed
	@echo "✓ Testdaten eingefügt"

# API Commands
fetch:
	curl -X POST http://localhost:3000/api/fetch -H "Content-Type: application/json" && echo ""
