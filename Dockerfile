FROM node:20-alpine
RUN mkdir -p /app/src/engine/logs
WORKDIR /app/src/engine
COPY src/engine/package*.json ./
# Copy config to /app/config
COPY src/config /app/src/config/
RUN npm install
COPY src/engine .
EXPOSE 3002
CMD ["node", "servicesLauncher.js"]