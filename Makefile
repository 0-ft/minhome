.PHONY: up up-tunnel up-dev down down-tunnel down-dev logs logs-dev reload

up:
	docker compose up -d $(if $(BUILD),--build)

up-tunnel:
	docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d $(if $(BUILD),--build)

up-dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d $(if $(BUILD),--build)

down:
	docker compose down --remove-orphans

down-tunnel:
	docker compose -f docker-compose.yml -f docker-compose.tunnel.yml down

down-dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml down

logs:
	docker compose logs -f

logs-dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f

reload:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml restart server


