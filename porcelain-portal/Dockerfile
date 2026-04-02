FROM node:22-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN /usr/local/bin/npm ci

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
