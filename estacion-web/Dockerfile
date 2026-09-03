FROM nginx:1.27-alpine

ENV TZ=America/Guatemala
RUN apk add --no-cache tzdata

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html estilos.css app.js /usr/share/nginx/html/

EXPOSE 80
HEALTHCHECK --interval=20s --timeout=4s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/salud || exit 1
