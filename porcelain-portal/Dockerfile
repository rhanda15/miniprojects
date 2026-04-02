FROM node:22-alpine

RUN apk add --no-cache python3 make g++ pkg-config

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
