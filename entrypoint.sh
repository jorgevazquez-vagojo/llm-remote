#!/bin/sh
# Fix ownership of mounted volumes (they may be owned by root)
# This runs as root before switching to appuser
chown -R appuser:appuser /app/data 2>/dev/null || true
chown -R appuser:appuser /shared 2>/dev/null || true

# Switch to non-root user and run the app
exec su-exec appuser node src/index.js
