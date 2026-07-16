FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2

ARG APP_VERSION=0.1.0
ARG VCS_REF=unknown
ARG PUBLIC_REPOSITORY_URL=https://github.com/humblemat810/llm-wiki
ARG PUBLIC_DOCUMENTATION_URL=https://github.com/humblemat810/llm-wiki/blob/main/RUNBOOK.md
LABEL org.opencontainers.image.title="LLM Field Notes" \
      org.opencontainers.image.description="A document-to-knowledge-graph workspace with inspectable evidence and Obsidian projections." \
      org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.source="$PUBLIC_REPOSITORY_URL" \
      org.opencontainers.image.documentation="$PUBLIC_DOCUMENTATION_URL" \
      org.opencontainers.image.licenses="CC-BY-4.0"

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8000
ENV BUILD_REVISION=$VCS_REF
ENV PUBLIC_REPOSITORY_URL=$PUBLIC_REPOSITORY_URL
STOPSIGNAL SIGTERM

COPY --chown=node:node . .

USER node

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node --input-type=module -e "import { parseConfiguredBoundedInteger } from './server.mjs'; const setting = parseConfiguredBoundedInteger('PORT', process.env.PORT, { defaultValue: 8000, max: 65535 }); if (!setting.valid) process.exit(1); fetch('http://127.0.0.1:' + setting.value + '/readyz').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "server.mjs"]
