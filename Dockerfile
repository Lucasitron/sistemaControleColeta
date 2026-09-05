FROM node:22-slim

RUN apt-get update && apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    libxfixes3 \
    libxrender1 \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=false \
    PORT=1213

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev
RUN npx puppeteer browsers install chrome

COPY . .

RUN mkdir -p data .wwebjs_auth_nova .wwebjs_cache

EXPOSE 1213

CMD ["node", "src/server.js"]