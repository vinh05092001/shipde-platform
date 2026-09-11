FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    bash \
    procps \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11

RUN curl -fsSL https://antigravity.google/cli/install.sh | bash

ENV PATH="/root/.local/bin:$PATH"

WORKDIR /workspace

CMD ["agy"]
