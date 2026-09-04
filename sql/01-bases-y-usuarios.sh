#!/bin/bash
# ===========================================================================
#  Asilo de Ancianos "Cabeza de Algodon"
#  01 · Bases de datos, usuarios y permisos
# ---------------------------------------------------------------------------
#  Este archivo NO contiene ninguna clave: las toma del entorno del
#  contenedor, que el compose llena desde el archivo .env (no versionado).
#  Por eso es un .sh y no un .sql: MySQL ejecuta los .sql tal cual, sin
#  expandir variables, y habria que escribir las claves dentro.
#
#  El entrypoint de la imagen de MySQL corre todo lo que hay en
#  /docker-entrypoint-initdb.d una sola vez: cuando el volumen de datos esta
#  vacio. Para volver a ejecutarlo:
#
#      docker compose down -v && docker compose up -d
#
#  Las sentencias que ejecuta estan documentadas, con claves de marcador, en
#  01-bases-y-usuarios.ejemplo.sql, que es el que se lee para entender el
#  modelo de permisos sin tener que leer shell.
#
#  Se conserva el patron "database per service": cada microservicio tiene su
#  propia base y su propio usuario, y NINGUNO puede leer ni escribir la base
#  de otro. Lo que se comparte es la instancia de MySQL, no los datos.
#
#      base                usuario           servicio
#      -----------------   ---------------   --------------
#      asilo_vigia         usr_vigia         ms-vigia
#      asilo_pastillero    usr_pastillero    ms-pastillero
#      asilo_caja          usr_caja          ms-caja
#      asilo_consultas     usr_consultas     ms-consultas
#
#  Nota sobre como lo ejecuta el entrypoint: si el archivo tiene permiso de
#  ejecucion lo corre como un proceso aparte; si no, lo carga con "." dentro
#  de su propio shell. Por eso todo el trabajo va dentro de una funcion y no
#  se usa "set -e" global: asi no se alteran las opciones del shell del
#  entrypoint cuando el archivo se carga en vez de ejecutarse.
# ===========================================================================

asilo_crear_bases_y_usuarios() {
    local faltantes=""
    local nombre
    for nombre in MYSQL_ROOT_PASSWORD BD_CLAVE_VIGIA BD_CLAVE_PASTILLERO BD_CLAVE_CAJA BD_CLAVE_CONSULTAS; do
        if [ -z "$(eval "printf '%s' \"\${$nombre:-}\"")" ]; then
            faltantes="$faltantes $nombre"
        fi
    done
    if [ -n "$faltantes" ]; then
        echo "[01-bases-y-usuarios] ERROR: faltan variables de entorno:$faltantes" >&2
        echo "[01-bases-y-usuarios] Copie .env.ejemplo a .env y complete las claves." >&2
        return 1
    fi

    echo "[01-bases-y-usuarios] creando las cuatro bases y sus usuarios..."

    # Durante la inicializacion el servidor todavia no escucha en la red: se
    # entra por el socket local. Las claves viajan por la entrada estandar,
    # no como argumentos, para que no queden a la vista en la lista de
    # procesos del contenedor.
    mysql --protocol=socket -u root -p"${MYSQL_ROOT_PASSWORD}" <<SQL
-- --- Bases -------------------------------------------------------------
-- utf8mb4 en la base y en la intercalacion: los nombres de los internos
-- llevan tildes (Rosalia Menchu Coy, Transito Xicara Tzoc) y con otra
-- codificacion se guardan rotos.
CREATE DATABASE IF NOT EXISTS asilo_vigia
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS asilo_pastillero
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS asilo_caja
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS asilo_consultas
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- Usuarios ----------------------------------------------------------
-- '%' y no 'localhost': cada microservicio se conecta desde su propio
-- contenedor, o sea desde otra direccion dentro de la red de Docker.
CREATE USER IF NOT EXISTS 'usr_vigia'@'%'      IDENTIFIED BY '${BD_CLAVE_VIGIA}';
CREATE USER IF NOT EXISTS 'usr_pastillero'@'%' IDENTIFIED BY '${BD_CLAVE_PASTILLERO}';
CREATE USER IF NOT EXISTS 'usr_caja'@'%'       IDENTIFIED BY '${BD_CLAVE_CAJA}';
CREATE USER IF NOT EXISTS 'usr_consultas'@'%'  IDENTIFIED BY '${BD_CLAVE_CONSULTAS}';

-- --- Permisos ----------------------------------------------------------
-- Cada usuario, solo sobre su base. No se otorga CREATE, DROP ni ALTER: el
-- esquema lo definen los archivos 02, 03, 04 y 05, no la aplicacion.
GRANT SELECT, INSERT, UPDATE, DELETE ON asilo_vigia.*      TO 'usr_vigia'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON asilo_pastillero.* TO 'usr_pastillero'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON asilo_caja.*       TO 'usr_caja'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON asilo_consultas.*  TO 'usr_consultas'@'%';

FLUSH PRIVILEGES;
SQL

    local estado=$?
    if [ "$estado" -ne 0 ]; then
        echo "[01-bases-y-usuarios] ERROR: MySQL rechazo las sentencias." >&2
        return "$estado"
    fi
    echo "[01-bases-y-usuarios] listo: asilo_vigia, asilo_pastillero, asilo_caja y asilo_consultas."
}

asilo_crear_bases_y_usuarios
