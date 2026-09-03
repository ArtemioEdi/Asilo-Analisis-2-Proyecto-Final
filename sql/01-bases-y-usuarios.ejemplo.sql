-- ===========================================================================
--  Asilo de Ancianos "Cabeza de Algodon"
--  01 · Bases de datos, usuarios y permisos   ·   ARCHIVO DE REFERENCIA
-- ---------------------------------------------------------------------------
--  ESTE ARCHIVO NO SE EJECUTA. Es la documentacion legible del modelo de
--  permisos, para leerlo sin tener que leer shell.
--
--  El que MySQL ejecuta de verdad es 01-bases-y-usuarios.sh, que corre estas
--  mismas sentencias pero tomando las claves del entorno del contenedor
--  (BD_CLAVE_VIGIA, BD_CLAVE_PASTILLERO y BD_CLAVE_CAJA), que el compose
--  llena desde el archivo .env, que no se versiona. Aqui aparecen como
--  marcadores: CAMBIE_ESTA_CLAVE_*.
--
--  Se hizo asi porque MySQL ejecuta los archivos .sql literalmente, sin
--  expandir variables: dejar este archivo como .sql obligaba a escribir las
--  tres claves dentro y versionarlas. Los otros tres archivos del esquema
--  (02, 03 y 04) si son .sql de verdad, porque no contienen ninguna clave.
--
--  Se conserva el patron "database per service": cada microservicio tiene su
--  propia base y su propio usuario, y NINGUNO puede leer ni escribir la base
--  de otro. Lo que se comparte es la instancia de MySQL, no los datos.
--
--      base                usuario           servicio
--      -----------------   ---------------   --------------
--      asilo_vigia         usr_vigia         ms-vigia
--      asilo_pastillero    usr_pastillero    ms-pastillero
--      asilo_caja          usr_caja          ms-caja
--
--  Para comprobar que el aislamiento es real:
--      docker compose exec bd-asilo \
--        mysql -u usr_caja -p"$BD_CLAVE_CAJA" \
--        -e "SELECT COUNT(*) FROM asilo_vigia.validaciones;"
--      -- ERROR 1142 (42000): SELECT command denied to user 'usr_caja'@'...'
-- ===========================================================================

-- --- Bases -----------------------------------------------------------------
-- utf8mb4 en la base y en la intercalacion: los nombres de los internos
-- llevan tildes (Rosalia Menchu Coy, Transito Xicara Tzoc) y con otra
-- codificacion se guardan rotos.
CREATE DATABASE IF NOT EXISTS asilo_vigia
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS asilo_pastillero
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS asilo_caja
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- Usuarios --------------------------------------------------------------
-- '%' y no 'localhost': cada microservicio se conecta desde su propio
-- contenedor, o sea desde otra direccion dentro de la red de Docker.
--
-- Las claves reales NO estan aqui: el script .sh las toma de las variables
-- BD_CLAVE_VIGIA, BD_CLAVE_PASTILLERO y BD_CLAVE_CAJA.
CREATE USER IF NOT EXISTS 'usr_vigia'@'%'
    IDENTIFIED BY 'CAMBIE_ESTA_CLAVE_VIGIA';
CREATE USER IF NOT EXISTS 'usr_pastillero'@'%'
    IDENTIFIED BY 'CAMBIE_ESTA_CLAVE_PASTILLERO';
CREATE USER IF NOT EXISTS 'usr_caja'@'%'
    IDENTIFIED BY 'CAMBIE_ESTA_CLAVE_CAJA';

-- --- Permisos --------------------------------------------------------------
-- Cada usuario, solo sobre su base. No se otorga CREATE, DROP ni ALTER: el
-- esquema lo definen los archivos 02, 03 y 04, no la aplicacion.
GRANT SELECT, INSERT, UPDATE, DELETE ON asilo_vigia.*      TO 'usr_vigia'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON asilo_pastillero.* TO 'usr_pastillero'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON asilo_caja.*       TO 'usr_caja'@'%';

FLUSH PRIVILEGES;
