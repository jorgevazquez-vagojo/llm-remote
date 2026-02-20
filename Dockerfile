FROM node:20-alpine

LABEL maintainer="Redegal <jorge@redegal.com>"
LABEL description="LLM Remote — Encrypted Telegram ↔ AI Bridge"

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy source
COPY src/ src/
COPY .env.example .env.example

# Data directory for audit logs, schedules, ssh config
RUN mkdir -p /app/data

# Create non-root user for security
RUN addgroup -g 1001 appuser && adduser -u 1001 -G appuser -s /bin/sh -D appuser
RUN chown -R appuser:appuser /app
USER appuser

VOLUME /app/data

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
