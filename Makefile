BACKEND := backend
VENV    := $(BACKEND)/.venv
DB      ?= postgresql://entreno:entreno@localhost:5432/entreno

.PHONY: setup dev test db-reset seed

setup:
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install -U pip
	$(VENV)/bin/pip install -r $(BACKEND)/requirements-dev.txt

dev:
	cd $(BACKEND) && $(CURDIR)/$(VENV)/bin/uvicorn app:app --reload --port 8000

test:
	node --test frontend/js/timer.test.mjs
	cd $(BACKEND) && DATABASE_URL="$(DB)" $(CURDIR)/$(VENV)/bin/pytest

# Recrea la BD local desde cero (solo local: la URL apunta a localhost).
db-reset:
	psql "$(DB)" -c "drop schema if exists public cascade; create schema public;"
	psql "$(DB)" -f db/schema.sql
	psql "$(DB)" -f db/seed.sql

# Reaplica solo los datos del plan (idempotente).
seed:
	psql "$(DB)" -f db/seed.sql
