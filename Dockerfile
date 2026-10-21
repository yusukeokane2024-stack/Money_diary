FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
ENV NODE_ENV=production PORT=3000 DB_FILE=/data/money.db
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
