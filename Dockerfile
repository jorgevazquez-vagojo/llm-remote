FROM node:20-alpine

LABEL maintainer="Redegal <jorge@redegal.com>"
LABEL description="LLM Remote — Encrypted Telegram ↔ AI Bridge"

WORKDIR /app

# su-exec for dropping privileges after fixing volume permissions
RUN apk add --no-cache su-exec

# Install dependencies first (cache layer)
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy source
COPY src/ src/
COPY .env.example .env.example
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Data directory for audit logs, schedules, ssh config
RUN mkdir -p /app/data

# Create non-root user for security
RUN addgroup -g 1001 appuser && adduser -u 1001 -G appuser -s /bin/sh -D appuser
RUN chown -R appuser:appuser /app

VOLUME /app/data

ENV NODE_ENV=production

# Entrypoint fixes volume permissions then drops to appuser
ENTRYPOINT ["/entrypoint.sh"]
