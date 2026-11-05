FROM node:22-alpine AS base
WORKDIR /app

RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npx prisma generate
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
