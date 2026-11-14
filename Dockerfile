FROM node:24-slim

RUN corepack enable && corepack prepare pnpm@12.18.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile && pnpm build

ENV NODE_ENV=production
EXPOSE 4096

ENTRYPOINT ["node", "/app/packages/cli/dist/index.js"]
CMD ["serve", "--host", "0.0.0.0", "--port", "4096"]