.PHONY: up up-tunnel up-dev up-dev-tunnel up-hybrid up-hybrid-tunnel down down-tunnel down-dev down-dev-tunnel down-hybrid down-hybrid-tunnel logs logs-tunnel logs-dev logs-dev-tunnel logs-hybrid logs-hybrid-tunnel reload reload-bridge logs-bridge

up:
	docker compose up -d $(if $(BUILD),--build)

up-tunnel:
	docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d $(if $(BUILD),--build)

up-dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d $(if $(BUILD),--build)

up-dev-tunnel:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.tunnel.yml up -d $(if $(BUILD),--build)

up-hybrid:
	docker compose -f docker-compose.yml -f docker-compose.hybrid.yml up -d $(if $(BUILD),--build)

up-hybrid-tunnel:
	docker compose -f docker-compose.yml -f docker-compose.hybrid.yml -f docker-compose.tunnel.yml up -d $(if $(BUILD),--build)

down:
	docker compose down --remove-orphans

down-tunnel:
	docker compose -f docker-compose.yml -f docker-compose.tunnel.yml down

down-dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml down

down-dev-tunnel:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.tunnel.yml down

down-hybrid:
	docker compose -f docker-compose.yml -f docker-compose.hybrid.yml down

down-hybrid-tunnel:
	docker compose -f docker-compose.yml -f docker-compose.hybrid.yml -f docker-compose.tunnel.yml down

logs:
	docker compose logs -f

logs-tunnel:
	docker compose -f docker-compose.yml -f docker-compose.tunnel.yml logs -f

logs-dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f

logs-dev-tunnel:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.tunnel.yml logs -f

logs-hybrid:
	docker compose -f docker-compose.yml -f docker-compose.hybrid.yml logs -f

logs-hybrid-tunnel:
	docker compose -f docker-compose.yml -f docker-compose.hybrid.yml -f docker-compose.tunnel.yml logs -f

reload:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml restart server

reload-bridge:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml restart voice-bridge

logs-bridge:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f voice-bridge


