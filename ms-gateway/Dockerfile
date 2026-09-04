FROM node:20-alpine

ENV TZ=America/Guatemala \
    NODE_ENV=production

RUN apk add --no-cache tzdata

WORKDIR /app

# "npm ci" y no "npm install": instala exactamente las versiones del
# package-lock.json y falla si no concuerda, para que la imagen sea
# reproducible. Van antes que el codigo para reutilizar la capa de
# dependencias mientras el lock no cambie.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY server.js usuarios.json ./

EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=4s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:8080/salud || exit 1

CMD ["node", "server.js"]
