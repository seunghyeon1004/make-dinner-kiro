FROM node:22-slim

WORKDIR /app

# Install with devDependencies: the build needs tsc and esbuild. NODE_ENV is set after
# the build, because NODE_ENV=production would make npm ci skip them.
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["npm", "start"]
