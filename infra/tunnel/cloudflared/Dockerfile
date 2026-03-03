FROM cloudflare/cloudflared:latest AS cloudflared

FROM alpine:3.20

RUN apk add --no-cache ca-certificates sed

COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
