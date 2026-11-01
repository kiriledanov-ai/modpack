FROM node:20-alpine
WORKDIR /app
COPY package.json index.js ./
ENV NODE_ENV=production PORT=8787 DATA_DIR=/app/data
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 8787
VOLUME ["/app/data"]
CMD ["node", "index.js"]
