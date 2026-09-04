-- ===========================================================================
--  05 · Esquema de asilo_consultas  (ms-consultas)
-- ---------------------------------------------------------------------------
--  La cadena clinica completa que pide el enunciado, en cuatro tablas:
--
--    solicitudes   el medico general remite al interno a un especialista
--    visitas       la fundacion agenda, el especialista atiende y llena la
--                  ficha medica
--    examenes      lo que el especialista manda a hacer en esa visita
--    indicaciones  lo que el especialista receta en esa visita
--
--  Las cuatro cuelgan una de otra: una solicitud produce una visita, y una
--  visita produce examenes e indicaciones. Las claves foraneas lo hacen
--  cumplir, no la aplicacion.
--
--  Mismas convenciones que los otros tres esquemas: InnoDB, utf8mb4,
--  DECIMAL para lo numerico sensible, DATETIME para fechas, y VARCHAR con
--  CHECK para los estados.
-- ===========================================================================

USE asilo_consultas;

-- ---------------------------------------------------------------------------
--  La remision: el medico general pide que a un interno lo vea un especialista
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS solicitudes (
    -- SOL-2026-XXXXXXXX
    id                      VARCHAR(24)   NOT NULL,
    paciente_id             VARCHAR(16)   NOT NULL,
    motivo                  TEXT          NOT NULL,
    especialidad_solicitada VARCHAR(80),
    -- Quien acompaña al interno a la cita. En un asilo casi nunca va solo.
    enfermero_acompanante   VARCHAR(120),
    -- Sale del token de quien remite, nunca del cuerpo de la peticion.
    solicitado_por          VARCHAR(120),
    creada_en               DATETIME      NOT NULL,

    estado                  VARCHAR(16)   NOT NULL DEFAULT 'PENDIENTE',

    -- Lo que llena la fundacion al agendar. Nulo mientras esta PENDIENTE.
    medico_asignado         VARCHAR(120),
    especialidad_asignada   VARCHAR(80),
    agendada_para           DATETIME      NULL,
    agendada_por            VARCHAR(120),

    CONSTRAINT pk_solicitudes PRIMARY KEY (id),
    CONSTRAINT ck_solicitudes_estado
        CHECK (estado IN ('PENDIENTE', 'AGENDADA', 'ATENDIDA', 'CANCELADA')),

    INDEX idx_solicitudes_paciente (paciente_id, creada_en),
    INDEX idx_solicitudes_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
--  La consulta en si: es la ficha medica del enunciado
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visitas (
    -- VM-2026-XXXXXXXX
    id              VARCHAR(24)   NOT NULL,
    solicitud_id    VARCHAR(24)   NOT NULL,
    paciente_id     VARCHAR(16)   NOT NULL,
    fecha_visita    DATETIME      NOT NULL,
    motivo          TEXT,
    medico_tratante VARCHAR(120),
    especialidad    VARCHAR(80),
    diagnostico     TEXT,
    observaciones   TEXT,
    estado          VARCHAR(12)   NOT NULL DEFAULT 'ABIERTA',
    creada_en       DATETIME      NOT NULL,

    CONSTRAINT pk_visitas PRIMARY KEY (id),
    CONSTRAINT fk_visitas_solicitud FOREIGN KEY (solicitud_id)
        REFERENCES solicitudes (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    -- Una solicitud produce UNA visita. Que lo garantice el motor y no una
    -- comprobacion en Python: dos peticiones simultaneas pasarian las dos.
    CONSTRAINT uq_visitas_solicitud UNIQUE (solicitud_id),
    CONSTRAINT ck_visitas_estado CHECK (estado IN ('ABIERTA', 'CERRADA')),

    INDEX idx_visitas_paciente (paciente_id, fecha_visita)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
--  Lo que el especialista manda a hacer
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS examenes (
    -- EX-2026-XXXXXXXX
    id             VARCHAR(24)   NOT NULL,
    visita_id      VARCHAR(24)   NOT NULL,
    nombre         VARCHAR(160)  NOT NULL,
    indicado_en    DATETIME      NOT NULL,
    estado         VARCHAR(20)   NOT NULL DEFAULT 'SOLICITADO',
    resultado      TEXT,
    resultado_en   DATETIME      NULL,
    -- Quien cargo el resultado, del token de laboratorio.
    registrado_por VARCHAR(120),
    -- El id del cargo que ms-caja creo por este examen. Puede quedar NULO: si
    -- ms-caja no responde, el examen se guarda igual. No se pierde el dato
    -- clinico por un fallo de facturacion; el cobro se concilia despues.
    cargo_id       VARCHAR(16)   NULL,

    CONSTRAINT pk_examenes PRIMARY KEY (id),
    CONSTRAINT fk_examenes_visita FOREIGN KEY (visita_id)
        REFERENCES visitas (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT ck_examenes_estado
        CHECK (estado IN ('SOLICITADO', 'RESULTADO_LISTO')),

    INDEX idx_examenes_visita (visita_id),
    INDEX idx_examenes_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
--  Lo que el especialista receta
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS indicaciones (
    -- IN-2026-XXXXXXXX
    id               VARCHAR(24)   NOT NULL,
    visita_id        VARCHAR(24)   NOT NULL,
    principio_activo VARCHAR(64)   NOT NULL,
    nombre           VARCHAR(120),
    dosis_mg         DECIMAL(10,2) NOT NULL,
    cada_horas       DECIMAL(5,2)  NOT NULL,
    duracion_dias    SMALLINT      NOT NULL,
    como_tomarlo     TEXT,
    entregado        BOOLEAN       NOT NULL DEFAULT FALSE,
    entregado_en     DATETIME      NULL,
    entregado_por    VARCHAR(120),
    cargo_id         VARCHAR(16)   NULL,

    CONSTRAINT pk_indicaciones PRIMARY KEY (id),
    CONSTRAINT fk_indicaciones_visita FOREIGN KEY (visita_id)
        REFERENCES visitas (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT ck_indicaciones_dosis CHECK (dosis_mg > 0),
    CONSTRAINT ck_indicaciones_cada_horas CHECK (cada_horas BETWEEN 1 AND 72),
    CONSTRAINT ck_indicaciones_dias CHECK (duracion_dias BETWEEN 1 AND 90),

    INDEX idx_indicaciones_visita (visita_id),
    INDEX idx_indicaciones_entregado (entregado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
--  El aviso al familiar
-- ---------------------------------------------------------------------------
--  El enunciado pide que, al remitir a un interno, se le avise al familiar
--  responsable en que estado quedo la solicitud y a que especialidad se le
--  remitio.
--
--  Todo correo queda asentado aqui, se haya enviado de verdad o no. Si el
--  stack no tiene servidor de correo configurado (SMTP_HOST vacio), el
--  correo NO se pierde ni hace fallar la remision: se escribe completo en la
--  bitacora del contenedor y se guarda en esta tabla con estado REGISTRADO.
--  Asi el requisito se puede demostrar sin depender de un servidor externo.
CREATE TABLE IF NOT EXISTS correos_enviados (
    -- CO-2026-XXXXXXXX
    id            VARCHAR(24)   NOT NULL,
    solicitud_id  VARCHAR(24)   NOT NULL,
    destinatario  VARCHAR(160),
    asunto        VARCHAR(255)  NOT NULL,
    cuerpo        TEXT          NOT NULL,
    enviado_en    DATETIME      NOT NULL,
    estado        VARCHAR(20)   NOT NULL,

    CONSTRAINT pk_correos PRIMARY KEY (id),
    CONSTRAINT fk_correos_solicitud FOREIGN KEY (solicitud_id)
        REFERENCES solicitudes (id) ON UPDATE CASCADE ON DELETE CASCADE,
    -- ENVIADO          salio por SMTP
    -- REGISTRADO       no hay SMTP configurado: queda en bitacora y aqui
    -- FALLIDO          hay SMTP pero el envio dio error
    -- SIN_DESTINATARIO la ficha del interno no tiene correo del familiar
    CONSTRAINT ck_correos_estado
        CHECK (estado IN ('ENVIADO', 'REGISTRADO', 'FALLIDO', 'SIN_DESTINATARIO')),

    INDEX idx_correos_solicitud (solicitud_id),
    INDEX idx_correos_fecha (enviado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
