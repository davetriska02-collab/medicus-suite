# © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
# GP Forge orchestrator — zero runtime dependencies, so there is nothing to npm-install.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production
EXPOSE 8089
# Runs the fail-closed egress guard at startup before listening (see src/index.js).
CMD ["node", "src/index.js"]
