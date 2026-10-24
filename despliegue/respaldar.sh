#!/usr/bin/env bash
# ===========================================================================
#  Asilo de Ancianos "Cabeza de Algodon"
#  despliegue/respaldar.sh · Respaldo diario de la base
# ---------------------------------------------------------------------------
#  Corre DENTRO del servidor, como azureuser. desplegar.sh lo deja en el cron
#  todos los dias a las 03:00, hora de Guatemala; tambien se puede correr a
#  mano:
#
#    bash ~/saaca/despliegue/respaldar.sh
#
#  Vuelca las cinco bases con mysqldump, con los mismos parametros que la
#  instancia de sql/instancia/ (--databases con las cinco nombradas, nunca
#  --all-databases: no se llevan los usuarios de MySQL ni sus claves), lo
#  comprime y lo deja en ~/respaldos/ con la fecha y la hora en el nombre.
#  Conserva los ultimos 7 y borra los anteriores.
#
#  El volcado se escribe primero en un archivo temporal y solo se renombra si
#  salio completo: un respaldo a medias con nombre de respaldo bueno es peor
#  que ninguno, porque nadie sabe que esta roto hasta que hace falta.
#
#  Como se restaura: README, seccion 12.
# ===========================================================================
set -euo pipefail

DESTINO=${DESTINO:-$HOME/saaca}
RESPALDOS=${RESPALDOS:-$HOME/respaldos}
CONSERVAR=${CONSERVAR:-7}
BASES="asilo_vigia asilo_pastillero asilo_caja asilo_consultas asilo_acceso"

cd "$DESTINO"
mkdir -p "$RESPALDOS"
chmod 700 "$RESPALDOS"
umask 077

# La fecha del nombre es la de Guatemala, aunque el servidor viva en UTC: a
# las 03:00 de alla ya es otro dia aca, y el respaldo del 24 se llamaria 25.
FECHA=$(TZ=America/Guatemala date +%Y-%m-%d_%H%M)
ARCHIVO="$RESPALDOS/asilo-$FECHA.sql.gz"
TEMPORAL="$ARCHIVO.parcial"
trap 'rm -f "$TEMPORAL"' EXIT

# La clave de root no sale del contenedor: mysqldump la toma de la variable
# de entorno que ya tiene bd-asilo.
docker compose -f docker-compose.yml -f docker-compose.produccion.yml exec -T bd-asilo \
  sh -c "mysqldump -uroot -p\"\$MYSQL_ROOT_PASSWORD\" --databases $BASES \
         --default-character-set=utf8mb4 --single-transaction --skip-dump-date 2>/dev/null" \
  | gzip -9 > "$TEMPORAL"

# Completo de verdad: el gzip se lee entero y mysqldump escribio su ultima
# linea. Sin esto, una base caida a mitad del volcado dejaria un archivo
# valido para gzip pero cortado.
gzip -t "$TEMPORAL"
if ! gzip -dc "$TEMPORAL" | tail -n 1 | grep -q "^-- Dump completed"; then
  echo "$(date -Is) FALLA: el volcado salio incompleto; se conserva el respaldo anterior" >&2
  exit 1
fi
mv "$TEMPORAL" "$ARCHIVO"

# Los ultimos $CONSERVAR, por fecha en el nombre (que ordena igual que el
# tiempo), y nada mas.
ls -1 "$RESPALDOS"/asilo-*.sql.gz | sort | head -n -"$CONSERVAR" | xargs -r rm -f

echo "$(date -Is) respaldo $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1)); quedan $(ls -1 "$RESPALDOS"/asilo-*.sql.gz | wc -l)"
