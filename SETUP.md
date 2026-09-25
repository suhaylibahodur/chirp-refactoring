# Chirp — Developer Setup

## Prerequisites
- Node — version is pinned in `.nvmrc`. With nvm: `nvm install && nvm use`.
- pnpm — enable via Corepack (version is pinned in `package.json`): `corepack enable`.
- No system `protoc` or database server needed (proto uses a bundled compiler; DB is SQLite).

## 1. Install
    pnpm install

## 2. Environment
    cp .env.example .env
    # edit secrets as needed

## 3. Generate proto code (required — output is git-ignored)
    pnpm proto:generate

## 4. Database (SQLite)
    pnpm db:generate   # only after changing packages/db-schema
    pnpm db:migrate
    pnpm db:seed

## 5. Run
    pnpm dev            # all apps
    pnpm dev:api        # api only (HTTP :3001, gRPC :50051)
    pnpm dev:user       # user client :3000
    pnpm dev:admin      # admin client :3002

## 6. Validate
    pnpm typecheck
    pnpm lint
    pnpm test:unit
    pnpm build
    pnpm test:e2e       # builds, boots api, runs Playwright

## Notes
- Git hooks (Husky) install automatically on `pnpm install`.
- Pre-commit runs Biome on staged files; pre-push runs typecheck + lint on affected packages.
