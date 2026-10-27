# Small, non-root image for a Stremio add-on.
# Base pinned to a Node LTS release; bump it deliberately.
FROM node:24.22.1-alpine3.24

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies first so this layer is cached between code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# The official Node image ships an unprivileged "node" user.
USER node

ENV PORT=7100
EXPOSE 7100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/manifest.json').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "src/server.js"]
