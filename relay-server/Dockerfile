FROM node:20-alpine

# better-sqlite3 needs build tools; su-exec for runtime privilege drop
RUN apk add --no-cache python3 make g++ su-exec

WORKDIR /app

COPY package.json ./
RUN npm install --production

# Cache-bust: deploy script passes --build-arg CACHE_BUST=$(date +%s) to
# ensure COPY picks up changed frontend/relay files every deploy.
ARG CACHE_BUST=0
COPY . .

# Message DB lives in a volume mount
RUN mkdir -p /data

# SEC-04: Create non-root user
RUN addgroup -S app && adduser -S app -G app
RUN chown -R app:app /app /data

EXPOSE 3500

# Fix /data volume permissions at startup (host volume may be root-owned),
# then drop to non-root 'app' user
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "index.js"]
