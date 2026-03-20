FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY index.js ./
COPY lib/ ./lib/
RUN groupadd -r patrol && useradd -r -g patrol -d /app -s /sbin/nologin patrol
RUN chown -R patrol:patrol /app
USER patrol
CMD ["node", "index.js"]
