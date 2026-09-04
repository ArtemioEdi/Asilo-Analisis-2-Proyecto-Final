#!/bin/bash
# Bases de datos, usuarios y permisos del asilo Cabeza de Algodon.
#
# No contiene ninguna clave: las toma del entorno, que el compose llena desde
# el .env. Por eso es un .sh y no un .sql: MySQL ejecuta los .sql tal cual, sin
# expandir variables, y habria que escribir las claves dentro. El mismo modelo
# de permisos, legible y con claves de marcador, esta en
# 01-bases-y-usuarios.ejemplo.sql.
#
# Corre UNA SOLA VEZ, con el volumen de datos vacio. Para repetirlo:
#     docker compose down -v && docker compose up -d
#
#     base                usuario           servicio
#     -----------------   ---------------   --------------
#     asilo_vigia         usr_vigia         ms-vigia
#     asilo_pastillero    usr_pastillero    ms-pastillero
#     asilo_caja          usr_caja          ms-caja
#     asilo_consultas     usr_consultas     ms-consultas
#
# Todo el trabajo va dentro de una funcion y sin "set -e" global: si el archivo
# no tiene permiso de ejecucion, el entrypoint lo carga con "." dentro de su
# propio shell, y un "set -e" ahi le cambiaria las opciones.

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
