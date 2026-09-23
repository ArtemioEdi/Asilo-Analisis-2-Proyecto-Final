-- ===========================================================================
--  03 · Esquema de asilo_pastillero  (ms-pastillero)
-- ---------------------------------------------------------------------------
--  Tres tablas:
--    internos  el padron del asilo, con la ficha clinica de cada uno
--    planes    la indicacion medica ya validada
--    tomas     esa indicacion expandida en horas concretas
--
--  El padron vive aqui y no en el navegador: la edad, las alergias y las
--  psicopatologias son los tres datos con los que ms-vigia decide si bloquea
--  un medicamento, y un dato del que depende la seguridad del paciente no
--  puede venir del cliente.
-- ===========================================================================

USE asilo_pastillero;

CREATE TABLE IF NOT EXISTS internos (
    id               VARCHAR(16)   NOT NULL,
    nombre           VARCHAR(120)  NOT NULL,
    -- Documento de identidad. Es lo unico que impide dar de alta dos veces a
    -- la misma persona, asi que la unicidad la garantiza el motor y no una
    -- comprobacion en Python: dos altas simultaneas pasarian las dos.
    documento        VARCHAR(32)   NOT NULL,
    -- La edad NO se guarda: se calcula de la fecha de nacimiento cada vez que
    -- se lee la ficha. Guardarla obligaria a corregirla en cada cumpleanos, y
    -- una edad vieja no es un detalle cosmetico aqui: ms-vigia aplica
    -- criterios geriatricos a partir de ella para decidir si un medicamento
    -- es seguro.
    fecha_nacimiento DATE          NOT NULL,
    sexo             VARCHAR(12)   NOT NULL,
    -- Fecha real, no texto: se guarda como DATE y la aplicacion la presenta
    -- en formato dd/mm/aaaa.
    ingreso          DATE,
    motivo_ingreso   TEXT,
    pabellon         VARCHAR(60),
    cama             VARCHAR(60),
    -- Listas cortas; JSON nativo de MySQL en vez de texto con formato propio.
    psicopatologias  JSON          NOT NULL,
    alergias         JSON          NOT NULL,
    -- Lo que el interno toma de forma cronica, fuera de los planes de tomas.
    -- ms-vigia lo necesita para detectar duplicidad terapeutica.
    medicacion_permanente JSON     NOT NULL,
    responsable      VARCHAR(120),
    -- Correo del familiar responsable. Es a donde ms-consultas avisa cuando
    -- se remite al interno a una especialidad. Dato de contacto, no clinico:
    -- por eso viaja tambien en la ficha que recibe administracion.
    correo_responsable VARCHAR(160),
    -- Un interno nunca se borra. Egresa, y su historial queda intacto: las
    -- tomas y los planes que firmo enfermeria son documentos legales.
    estado           VARCHAR(12)   NOT NULL DEFAULT 'ACTIVO',
    egreso_fecha     DATE          NULL,
    egreso_motivo    TEXT          NULL,

    CONSTRAINT pk_internos PRIMARY KEY (id),
    CONSTRAINT uq_internos_documento UNIQUE (documento),
    CONSTRAINT ck_internos_sexo
        CHECK (sexo IN ('FEMENINO', 'MASCULINO', 'OTRO')),
    CONSTRAINT ck_internos_estado
        CHECK (estado IN ('ACTIVO', 'EGRESADO')),
    -- Un egresado tiene fecha de egreso y un activo no. Que la coherencia la
    -- imponga el motor evita que un error de la aplicacion deje internos a
    -- medio egresar.
    CONSTRAINT ck_internos_egreso CHECK (
        (estado = 'ACTIVO'   AND egreso_fecha IS NULL) OR
        (estado = 'EGRESADO' AND egreso_fecha IS NOT NULL)),

    INDEX idx_internos_estado (estado, nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS planes (
    id                VARCHAR(16)   NOT NULL,
    paciente_id       VARCHAR(16)   NOT NULL,
    -- Se conserva el nombre con el que se creo el plan: es un documento
    -- clinico y tiene que poder leerse tal como se firmo.
    paciente_nombre   VARCHAR(120),
    principio_activo  VARCHAR(64)   NOT NULL,
    farmaco           VARCHAR(120)  NOT NULL,
    dosis_mg          DECIMAL(10,2) NOT NULL,
    via               VARCHAR(24)   NOT NULL,
    cada_horas        DECIMAL(5,2)  NOT NULL,
    dias              SMALLINT      NOT NULL,
    indicacion        VARCHAR(255),
    -- Folio del dictamen de ms-vigia que autorizo este plan. No es clave
    -- foranea: vive en otra base, de otro servicio, y cada microservicio es
    -- dueño de la suya.
    folio_validacion  VARCHAR(24),
    prescrito_por     VARCHAR(120),
    inicio            DATETIME      NOT NULL,
    estado            VARCHAR(16)   NOT NULL DEFAULT 'ACTIVO',
    creado_en         DATETIME      NOT NULL,

    CONSTRAINT pk_planes PRIMARY KEY (id),
    CONSTRAINT fk_planes_interno FOREIGN KEY (paciente_id)
        REFERENCES internos (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    -- FINALIZADO lo pone el egreso del interno; SUSPENDIDO es la revocacion
    -- clinica que solo firma el medico. Son cosas distintas y por eso no
    -- comparten estado.
    CONSTRAINT ck_planes_estado
        CHECK (estado IN ('ACTIVO', 'SUSPENDIDO', 'FINALIZADO')),
    CONSTRAINT ck_planes_dosis CHECK (dosis_mg > 0),
    CONSTRAINT ck_planes_cada_horas CHECK (cada_horas BETWEEN 1 AND 72),
    CONSTRAINT ck_planes_dias CHECK (dias BETWEEN 1 AND 90),

    INDEX idx_planes_paciente (paciente_id, estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS tomas (
    id               VARCHAR(16)   NOT NULL,
    plan_id          VARCHAR(16)   NOT NULL,
    paciente_id      VARCHAR(16)   NOT NULL,
    programado_para  DATETIME      NOT NULL,
    turno            VARCHAR(12)   NOT NULL,
    -- VENCIDA no se guarda: es un estado calculado. Una toma pendiente cuya
    -- hora ya paso con holgura se considera vencida al leerla, y basta que
    -- alguien la registre para que deje de serlo. Guardarla obligaria a un
    -- proceso que recorriera la tabla cambiando filas solas.
    estado           VARCHAR(16)   NOT NULL DEFAULT 'PENDIENTE',
    enfermero        VARCHAR(120),
    observacion      VARCHAR(255),
    registrado_en    DATETIME      NULL,

    CONSTRAINT pk_tomas PRIMARY KEY (id),
    CONSTRAINT fk_tomas_plan FOREIGN KEY (plan_id)
        REFERENCES planes (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT ck_tomas_estado
        CHECK (estado IN ('PENDIENTE', 'ADMINISTRADA', 'OMITIDA')),
    CONSTRAINT ck_tomas_turno
        CHECK (turno IN ('matutino', 'vespertino', 'nocturno')),

    -- La hoja de trabajo del turno se pide por interno y dia.
    INDEX idx_tomas_paciente (paciente_id, programado_para),
    INDEX idx_tomas_plan (plan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
