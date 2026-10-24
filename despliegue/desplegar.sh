#!/usr/bin/env bash
# ===========================================================================
#  Asilo de Ancianos "Cabeza de Algodon"
#  despliegue/desplegar.sh · Pone o actualiza la instancia publica
# ---------------------------------------------------------------------------
#  Corre DENTRO del servidor (Ubuntu 24.04), como azureuser, con sudo. Se
#  puede repetir cuantas veces haga falta: cada paso mira primero si ya esta
#  hecho.
#
#    bash desplegar.sh            despliega la rama main
#    bash desplegar.sh v1.0       despliega una rama o etiqueta cualquiera
#
#  Que hace, en orden:
#    1. Instala Docker Engine y el plugin de Compose desde el repositorio
#       oficial de Docker, si faltan, y agrega azureuser al grupo docker.
#    2. Crea un swap de 2 GB si no hay: 4 GiB alcanzan para correr el stack,
#       pero no siempre para construir las seis imagenes a la vez.
#    3. Clona o actualiza el repositorio en ~/saaca y se pone en la referencia
#       pedida.
#    4. Si no existe ~/saaca/.env, lo genera aqui mismo con openssl, igual
#       que el ciclo del README, mas DOMINIO, MODO_DEMOSTRACION=0 (sin datos
#       ni cuentas de demostracion) y ADMIN_CLAVE_INICIAL, la clave con que
#       entra por primera vez la cuenta admin. Esa clave no se imprime nunca:
#       al terminar dice como leerla. Si ya existe no lo toca: las
#       claves de MySQL se usan una sola vez, al crear el volumen, y cambiarlas
#       dejaria a los servicios fuera de su propia base. Ninguna clave sale de
#       este servidor.
#    5. Levanta el stack con la capa de produccion, espera con un tope a que
#       todo este sano y comprueba que https://$DOMINIO responda 200.
#    6. Deja respaldar.sh en el cron de azureuser, todos los dias a las 03:00
#       de Guatemala. Si la linea ya estaba, la reemplaza: nunca la duplica.
#
#  Todo el trabajo esta dentro de main(), que se llama en la ultima linea.
#  Bash lee los guiones a medida que los ejecuta, y el paso 3 puede
#  reescribir este mismo archivo cuando se corre como ~/saaca/despliegue/
#  desplegar.sh: con la funcion, bash ya lo leyo entero antes de empezar.
# ===========================================================================
set -euo pipefail

REPO_URL=${REPO_URL:-https://github.com/ArtemioEdi/Asilo-Analisis-2-Proyecto-Final.git}
DESTINO=${DESTINO:-$HOME/saaca}
DOMINIO_POR_DEFECTO=saaca-asilo.northcentralus.cloudapp.azure.com
# Topes de espera, en segundos. El primer arranque construye las imagenes
# aparte; esto cuenta desde que el "up" termina.
TOPE_SANO=${TOPE_SANO:-420}
TOPE_HTTPS=${TOPE_HTTPS:-180}
# !override en los archivos de compose existe desde la 2.24.4.
COMPOSE_MINIMO=2.24.4

paso()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
listo() { printf '  \033[0;32mOK\033[0m    %s\n' "$*"; }
nota()  { printf '  \033[0;33m..\033[0m    %s\n' "$*"; }
falla() { printf '  \033[0;31mFALLA\033[0m %s\n' "$*" >&2; exit 1; }

instalar_docker() {
  paso "1. Docker Engine y Docker Compose"
  if command -v docker >/dev/null 2>&1 && sudo docker compose version >/dev/null 2>&1; then
    listo "ya instalados: $(sudo docker --version)"
  else
    nota "instalando desde download.docker.com"
    sudo apt-get update -qq
    sudo apt-get install -y -qq ca-certificates curl git >/dev/null
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc
    . /etc/os-release
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
      | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
    sudo apt-get update -qq
    sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
      docker-buildx-plugin docker-compose-plugin >/dev/null
    sudo systemctl enable --now docker >/dev/null 2>&1
    listo "instalado: $(sudo docker --version)"
  fi

  if id -nG "$USER" | tr ' ' '\n' | grep -qx docker; then
    listo "$USER ya esta en el grupo docker"
  else
    sudo usermod -aG docker "$USER"
    listo "$USER agregado al grupo docker (vale desde la proxima sesion de ssh)"
  fi

  # En esta misma sesion el grupo nuevo todavia no cuenta: se usa sudo
  # mientras docker no responda sin el.
  if docker info >/dev/null 2>&1; then DOCKER=(docker); else DOCKER=(sudo docker); fi

  local version
  version=$("${DOCKER[@]}" compose version --short | sed 's/^v//')
  if [ "$(printf '%s\n%s\n' "$COMPOSE_MINIMO" "$version" | sort -V | head -n1)" = "$COMPOSE_MINIMO" ]; then
    listo "Docker Compose $version soporta !override (hace falta $COMPOSE_MINIMO o posterior)"
  else
    falla "Docker Compose $version no soporta !override; hace falta $COMPOSE_MINIMO o posterior"
  fi
}

crear_swap() {
  paso "2. Swap"
  if [ -n "$(swapon --show --noheadings)" ]; then
    listo "ya hay swap: $(swapon --show --noheadings | awk '{print $1, $3}' | paste -sd' ')"
    return
  fi
  if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile >/dev/null
  fi
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  listo "swap de 2 GB en /swapfile, tambien en /etc/fstab"
}

traer_codigo() {
  local ref=$1
  paso "3. Codigo en $DESTINO ($ref)"
  if [ -d "$DESTINO/.git" ]; then
    git -C "$DESTINO" fetch --quiet --prune --tags --force origin
  elif [ -e "$DESTINO" ]; then
    # Una copia sin .git solo puede venir de "git archive" + scp. No hay de
    # donde actualizarla: se despliega tal cual esta.
    nota "$DESTINO existe pero no es un clon de git; se despliega la copia tal cual"
    return
  else
    git clone --quiet "$REPO_URL" "$DESTINO" \
      || falla "no se pudo clonar $REPO_URL. Si el repositorio es privado, copie el codigo con git archive y scp"
  fi
  # La copia del servidor no se edita a mano: lo que diga el repositorio
  # manda. El .env esta en .gitignore y no se toca.
  if git -C "$DESTINO" show-ref --verify --quiet "refs/remotes/origin/$ref"; then
    git -C "$DESTINO" checkout --quiet --force -B "$ref" "origin/$ref"
  elif git -C "$DESTINO" rev-parse --verify --quiet "$ref^{commit}" >/dev/null; then
    git -C "$DESTINO" checkout --quiet --force --detach "$ref"
  else
    falla "no existe la rama ni la etiqueta '$ref' en $REPO_URL"
  fi
  listo "en $ref: $(git -C "$DESTINO" log -1 --format='%h %s')"
}

preparar_env() {
  paso "4. Archivo .env"
  local env="$DESTINO/.env"
  if [ -f "$env" ]; then
    listo "ya existe; no se toca"
  else
    # umask antes de crearlo: el archivo nace legible solo por azureuser.
    (
      umask 077
      cp "$DESTINO/.env.ejemplo" "$env"
      for v in GATEWAY_SECRETO BD_CLAVE_ROOT BD_CLAVE_VIGIA BD_CLAVE_PASTILLERO \
               BD_CLAVE_CAJA BD_CLAVE_CONSULTAS BD_CLAVE_ACCESO; do
        sed -i "s|^$v=$|$v=$(openssl rand -hex 24)|" "$env"
      done
      # La instalacion publica es real: nada sembrado y una sola cuenta.
      sed -i "s|^MODO_DEMOSTRACION=.*|MODO_DEMOSTRACION=0|" "$env"
      sed -i "s|^ADMIN_CLAVE_INICIAL=$|ADMIN_CLAVE_INICIAL=$(openssl rand -hex 12)|" "$env"
      printf '\n# Nombre publico. Lo usan Caddy para el certificado y el gateway\n# para el origen permitido.\nDOMINIO=%s\n' \
        "${DOMINIO:-$DOMINIO_POR_DEFECTO}" >> "$env"
    )
    listo "generado con openssl rand -hex 24 (permisos 600)"
  fi
  grep -qE '^GATEWAY_SECRETO=.+' "$env" || falla "el .env no tiene GATEWAY_SECRETO"
  grep -qE '^DOMINIO=.+' "$env" || falla "el .env no tiene DOMINIO; agreguelo a mano"
  # Con MODO_DEMOSTRACION=0 el gateway no arranca sin la clave inicial. Se
  # dice antes, aqui, y sin mostrar el valor.
  if grep -qE '^MODO_DEMOSTRACION=0' "$env" && ! grep -qE '^ADMIN_CLAVE_INICIAL=.{12,}' "$env"; then
    falla "MODO_DEMOSTRACION=0 y falta ADMIN_CLAVE_INICIAL en el .env (genere una con openssl rand -hex 12)"
  fi
  MODO=$(grep -E '^MODO_DEMOSTRACION=' "$env" | cut -d= -f2 | tr -d "\r\"'")
  listo "MODO_DEMOSTRACION=${MODO:-1}"
  DOMINIO=$(grep -E '^DOMINIO=' "$env" | cut -d= -f2- | tr -d "\r\"'")
  listo "DOMINIO=$DOMINIO"
}

levantar() {
  paso "5. Levantar el stack"
  cd "$DESTINO"
  local compose=("${DOCKER[@]}" compose -f docker-compose.yml -f docker-compose.produccion.yml)

  for vol in saaca-caddy-datos saaca-caddy-config; do
    "${DOCKER[@]}" volume inspect "$vol" >/dev/null 2>&1 || "${DOCKER[@]}" volume create "$vol" >/dev/null
  done
  listo "volumenes de Caddy presentes (fuera del alcance de down -v)"

  "${compose[@]}" up -d --build --remove-orphans

  nota "esperando a que todo este sano (tope: ${TOPE_SANO}s)"
  local limite=$((SECONDS + TOPE_SANO)) pendientes
  while :; do
    # Caddy no tiene healthcheck: alcanza con que este corriendo. El resto
    # debe estar "healthy".
    pendientes=$("${compose[@]}" ps -a --format '{{.Service}} {{.State}} {{.Health}}' \
      | awk '!($2 == "running" && ($3 == "healthy" || $1 == "caddy")) {print $1 "(" $2 " " $3 ")"}' \
      | paste -sd' ')
    [ -z "$pendientes" ] && break
    if [ $SECONDS -ge $limite ]; then
      "${compose[@]}" ps
      falla "pasaron ${TOPE_SANO}s y siguen sin estar sanos: $pendientes"
    fi
    sleep 5
  done
  listo "los ocho contenedores estan arriba y sanos"

  # Lo primero que hace Caddy al arrancar con un nombre nuevo es pedir el
  # certificado; puede tardar un poco.
  nota "esperando https://$DOMINIO (tope: ${TOPE_HTTPS}s)"
  limite=$((SECONDS + TOPE_HTTPS))
  local codigo
  while :; do
    codigo=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMINIO/" || true)
    [ "$codigo" = "200" ] && break
    if [ $SECONDS -ge $limite ]; then
      "${compose[@]}" logs --tail 30 caddy
      falla "https://$DOMINIO respondio '$codigo' en vez de 200"
    fi
    sleep 5
  done
  listo "https://$DOMINIO responde 200 con certificado valido"
}

programar_respaldo() {
  paso "6. Respaldo diario"
  local marca="# saaca: respaldo diario de la base"
  # Las 03:00 de Guatemala, en la hora del servidor (que vive en UTC). Lo
  # calcula date y no una cuenta a mano: si el servidor cambiara de zona, la
  # linea seguiria cayendo a las 03:00 de alla.
  local hora
  hora=$(date -d 'TZ="America/Guatemala" 03:00' +%H)
  local linea="0 $((10#$hora)) * * * bash $DESTINO/despliegue/respaldar.sh >> $HOME/respaldos/respaldar.log 2>&1 $marca"
  mkdir -p "$HOME/respaldos"
  # Todo lo que ya habia en el cron, menos la linea de este respaldo, y la
  # linea nueva al final. Correrlo dos veces deja una sola.
  { crontab -l 2>/dev/null | grep -vF "$marca" || true; echo "$linea"; } | crontab -
  listo "cron: $(crontab -l | grep -cF "$marca") linea, a las $((10#$hora)):00 del servidor (03:00 en Guatemala)"
}

main() {
  local ref=${1:-main}
  instalar_docker
  crear_swap
  traer_codigo "$ref"
  preparar_env
  levantar
  programar_respaldo
  printf '\n\033[1;32mDesplegado %s en https://%s\033[0m\n' "$ref" "$DOMINIO"
  if [ "${MODO:-1}" = "0" ]; then
    printf 'Instalacion real. La clave inicial de admin no se muestra; para leerla:\n'
    printf '    grep ADMIN_CLAVE_INICIAL %s/.env\n' "$DESTINO"
  fi
}

main "$@"; exit
