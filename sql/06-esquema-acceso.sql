-- ===========================================================================
--  06 · Esquema de asilo_acceso  (ms-gateway)
-- ---------------------------------------------------------------------------
--  Las cuentas del personal. Dos tablas:
--    usuarios            quien puede entrar, con que rol y en que estado
--    bitacora_usuarios   todo lo que se le hizo a cada cuenta, y quien
--
--  Antes vivian en ms-gateway/usuarios.json, horneado en la imagen: para dar
--  de alta a alguien habia que editar el archivo y reconstruir. Ahora las
--  gestiona el ADMINISTRADOR en caliente, y el gateway las consulta en cada
--  peticion.
--
--  Las cuentas no se borran nunca: se desactivan. No lo garantiza el codigo
--  del gateway sino el motor: usr_acceso no tiene permiso de DELETE (ver
--  01-bases-y-usuarios.sh). Por eso la bitacora puede colgar de usuarios con
--  una clave foranea sin miedo a quedar huerfana.
--
--  Ni la bitacora ni ninguna otra tabla guarda una clave, ni temporal ni
--  hasheada, salvo usuarios.clave_hash.
-- ===========================================================================

-- El cliente mysql con que el entrypoint de la imagen ejecuta este archivo no
-- habla utf8mb4 por defecto: sin esta linea lee la siembra como latin1 y
-- 'Fundación' se guarda doblemente codificada. Es el unico esquema que siembra
-- texto con tildes desde SQL; los otros siembran desde Python.
SET NAMES utf8mb4;

USE asilo_acceso;

CREATE TABLE IF NOT EXISTS usuarios (
    usuario               VARCHAR(32)   NOT NULL,
    nombre                VARCHAR(120)  NOT NULL,
    rol                   VARCHAR(20)   NOT NULL,
    -- bcrypt siempre mide 60 caracteres.
    clave_hash            CHAR(60)      NOT NULL,
    -- 1 mientras la clave sea temporal: recien dada de alta, restablecida o
    -- reactivada. El gateway solo emite un token de cambio de clave hasta que
    -- la persona elija la suya.
    debe_cambiar_clave    TINYINT(1)    NOT NULL DEFAULT 1,
    clave_temporal_vence  DATETIME      NULL,
    -- Va dentro del token. Cada vez que cambia la clave, el rol o el estado
    -- se incrementa, y todo token emitido antes deja de servir al instante.
    version_sesion        INT           NOT NULL DEFAULT 1,
    activo                TINYINT(1)    NOT NULL DEFAULT 1,

    -- Toda la autoria sale del token de quien hizo el cambio, nunca del
    -- cuerpo de la peticion. 'sistema' es la siembra inicial.
    creado_en             DATETIME      NOT NULL,
    creado_por            VARCHAR(32)   NOT NULL,
    actualizado_en        DATETIME      NULL,
    actualizado_por       VARCHAR(32)   NULL,
    desactivado_en        DATETIME      NULL,
    desactivado_por       VARCHAR(32)   NULL,
    motivo_desactivacion  VARCHAR(200)  NULL,
    ultimo_ingreso        DATETIME      NULL,

    CONSTRAINT pk_usuarios PRIMARY KEY (usuario),
    -- Minusculas, digitos, punto, guion bajo y guion; de 3 a 32; empieza con
    -- letra. La 'c' hace la comparacion sensible a mayusculas: la
    -- intercalacion de la base es _ci y sin ella 'Admin' pasaria.
    CONSTRAINT ck_usuarios_usuario
        CHECK (REGEXP_LIKE(usuario, '^[a-z][a-z0-9._-]{2,31}$', 'c')),
    CONSTRAINT ck_usuarios_rol
        CHECK (rol IN ('MEDICO', 'ENFERMERIA', 'ADMINISTRACION', 'FUNDACION',
                       'LABORATORIO', 'FARMACIA', 'ADMINISTRADOR')),
    CONSTRAINT ck_usuarios_version CHECK (version_sesion >= 1),
    -- Una clave definitiva no vence; solo la temporal.
    CONSTRAINT ck_usuarios_temporal
        CHECK (debe_cambiar_clave = 1 OR clave_temporal_vence IS NULL),
    -- Una cuenta activa no tiene datos de desactivacion, y una desactivada
    -- los tiene todos, motivo incluido. Igual que el egreso de un interno:
    -- que la coherencia la imponga el motor evita cuentas a medio desactivar.
    CONSTRAINT ck_usuarios_desactivacion CHECK (
        (activo = 1 AND desactivado_en IS NULL AND desactivado_por IS NULL
                    AND motivo_desactivacion IS NULL) OR
        (activo = 0 AND desactivado_en IS NOT NULL AND desactivado_por IS NOT NULL
                    AND motivo_desactivacion IS NOT NULL)),

    INDEX idx_usuarios_rol (rol, activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS bitacora_usuarios (
    id         BIGINT        NOT NULL AUTO_INCREMENT,
    usuario    VARCHAR(32)   NOT NULL,
    accion     VARCHAR(20)   NOT NULL,
    -- Sale del token, nunca del cuerpo de la peticion. Sin clave foranea: la
    -- siembra la firma 'sistema', que no es una cuenta.
    hecho_por  VARCHAR(32)   NOT NULL,
    en         DATETIME      NOT NULL,
    -- Que cambio, en palabras. Nunca una clave.
    detalle    VARCHAR(255)  NULL,

    CONSTRAINT pk_bitacora_usuarios PRIMARY KEY (id),
    CONSTRAINT fk_bitacora_usuarios_usuario
        FOREIGN KEY (usuario) REFERENCES usuarios (usuario),
    CONSTRAINT ck_bitacora_usuarios_accion
        CHECK (accion IN ('ALTA', 'EDICION', 'RESTABLECIMIENTO', 'DESACTIVACION',
                          'REACTIVACION', 'CAMBIO_DE_CLAVE')),

    INDEX idx_bitacora_usuarios_usuario (usuario, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
--  Siembra: el personal de demostracion
-- ---------------------------------------------------------------------------
--  Los mismos siete que vivian en usuarios.json, con exactamente los mismos
--  hashes, asi que las claves documentadas en el README siguen sirviendo.
--  Entran con clave definitiva (debe_cambiar_clave = 0) para que la
--  demostracion y pruebas.sh no tropiecen con el cambio obligatorio.
--
--  Para regenerar un hash:
--    docker compose run --rm --entrypoint node ms-gateway -e "console.log(require('bcryptjs').hashSync('LA_CLAVE',10))"
INSERT INTO usuarios
    (usuario, nombre, rol, clave_hash, debe_cambiar_clave, creado_en, creado_por)
VALUES
    ('medico',         'Dr. Angel Maltez',         'MEDICO',
     '$2a$10$3NiJ6wDavB8ZFIq5IQ6sDOh/CTWKtySBpm37iT6hgQOQqXPt8zvC2', 0, NOW(), 'sistema'),
    ('enfermeria',     'Enf. Lucia Cabrera',       'ENFERMERIA',
     '$2a$10$4dBU8uVC5Yk62HMMMBqWi.dQfmAc0v8bSvp37CQzYMu8SohDYJcbW', 0, NOW(), 'sistema'),
    ('administracion', 'Marta Solis',              'ADMINISTRACION',
     '$2a$10$TfAfArMu0mKMjiD/R52IHu5jp9a9PDer3s3g5kMK6OrtOr.VTmNgq', 0, NOW(), 'sistema'),
    ('fundacion',      'Fundación Manos Unidas',   'FUNDACION',
     '$2a$10$/BDMqaJ2vi67RtCQbThF.uJXX8i6tVW7nGEN7DyjyKPXUevmiiJS.', 0, NOW(), 'sistema'),
    ('laboratorio',    'Lab. Clínico Central',     'LABORATORIO',
     '$2a$10$syASm78x1JMgELgNm.tkI.j8/NJNWObuawvAY1/NcAgwLrk7DSvYu', 0, NOW(), 'sistema'),
    ('farmacia',       'Farmacia de la Fundación', 'FARMACIA',
     '$2a$10$3IGpX6ftQX5n8bgoEhzMXexVVmhowWnmQMCNG5B8NT4uWxNvmvggi', 0, NOW(), 'sistema'),
    ('admin',          'Ing. Dolores Ramirez',     'ADMINISTRADOR',
     '$2b$10$tjuRELdJTHZhUewPhkCdi.RuYGgVrPYNZVYHL0CEfb9CZ.LfqvKrG', 0, NOW(), 'sistema');

INSERT INTO bitacora_usuarios (usuario, accion, hecho_por, en, detalle)
SELECT usuario, 'ALTA', 'sistema', NOW(),
       CONCAT('Siembra inicial con rol ', rol, '.')
FROM usuarios
ORDER BY usuario;
