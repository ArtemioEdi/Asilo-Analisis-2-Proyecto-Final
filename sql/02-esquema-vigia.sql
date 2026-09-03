-- ===========================================================================
--  02 · Esquema de asilo_vigia  (ms-vigia · farmacovigilancia)
-- ---------------------------------------------------------------------------
--  Una sola tabla: la bitacora de dictamenes. El vademecum y las reglas
--  clinicas NO viven en la base: son la base de conocimiento del servicio y
--  estan en vademecum.py, versionadas junto al codigo que las aplica.
--
--  Convenciones de los tres esquemas:
--    · dinero            DECIMAL(10,2), nunca FLOAT
--    · fechas y horas    DATETIME
--    · identificadores   VARCHAR con largo definido
--    · estados           VARCHAR con CHECK (y no ENUM: CHECK es portable a
--                        SQL Server y Oracle, que el enunciado tambien
--                        admite, y se lee igual de claro)
--    · motor             InnoDB, con claves foraneas declaradas de verdad
-- ===========================================================================

USE asilo_vigia;

CREATE TABLE IF NOT EXISTS validaciones (
    -- Folio legible del dictamen: FV-2026-XXXXXXXX
    folio             VARCHAR(24)   NOT NULL,
    paciente_id       VARCHAR(16)   NOT NULL,
    principio_activo  VARCHAR(64)   NOT NULL,
    veredicto         VARCHAR(16)   NOT NULL,
    puntaje_riesgo    SMALLINT      NOT NULL,
    -- Quien pidio la validacion. Sale del token de sesion, nunca del cuerpo
    -- de la peticion.
    solicitado_por    VARCHAR(120),
    -- El dictamen completo tal como se le devolvio a quien lo pidio, para
    -- poder auditar despues con que datos se decidio.
    dictamen          JSON          NOT NULL,
    creado_en         DATETIME      NOT NULL,

    CONSTRAINT pk_validaciones PRIMARY KEY (folio),
    -- Redundante con la clave primaria, pero explicita: dos dictamenes no
    -- pueden compartir folio. Antes el folio se armaba con COUNT(*)+1 y dos
    -- validaciones simultaneas generaban el mismo numero.
    CONSTRAINT uq_validaciones_folio UNIQUE (folio),
    CONSTRAINT ck_validaciones_veredicto
        CHECK (veredicto IN ('APROBADO', 'ADVERTENCIA', 'BLOQUEADO')),
    CONSTRAINT ck_validaciones_puntaje
        CHECK (puntaje_riesgo BETWEEN 0 AND 100),

    -- La bitacora se consulta por interno y en orden de fecha descendente.
    INDEX idx_validaciones_paciente (paciente_id, creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
