# Single image: builds the React client, then runs the Node API which also serves the built client.
FROM node:22-alpine AS web
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=web /app/client/dist /app/client/dist
EXPOSE 4000
USER node
CMD ["node", "src/index.js"]
