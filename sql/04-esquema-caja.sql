-- ===========================================================================
--  04 · Esquema de asilo_caja  (ms-caja · entradas, salidas y caja)
-- ---------------------------------------------------------------------------
--  Cinco tablas: lo que se le cobra a la familia de cada interno, lo que la
--  familia paga, lo que entra por donaciones, lo que sale por gastos, y lo
--  que el asilo le paga a la fundacion.
--
--  TODO el dinero va en DECIMAL(10,2). Antes eran REAL, y sumar centavos en
--  coma flotante produce diferencias que en un libro de caja no se pueden
--  explicar: un total de Q 449.99 donde deberia decir Q 450.00.
--
--  El tarifario NO esta aqui: igual que el vademecum de ms-vigia, es la base
--  de conocimiento del servicio y vive junto al codigo que la aplica.
-- ===========================================================================

USE asilo_caja;

CREATE TABLE IF NOT EXISTS cargos (
    id               VARCHAR(16)    NOT NULL,
    paciente_id      VARCHAR(16)    NOT NULL,
    paciente_nombre  VARCHAR(120),
    categoria        VARCHAR(16)    NOT NULL,
    concepto         VARCHAR(160)   NOT NULL,
    -- Clave del tarifario con el que se calculo, si se uso uno.
    referencia       VARCHAR(48),
    monto_bruto      DECIMAL(10,2)  NOT NULL,
    descuento_pct    DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
    monto_neto       DECIMAL(10,2)  NOT NULL,
    monto_pagado     DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    estado           VARCHAR(16)    NOT NULL DEFAULT 'PENDIENTE',
    registrado_por   VARCHAR(120),
    creado_en        DATETIME       NOT NULL,
    -- La visita medica que origino el cargo, cuando lo origino una. Es lo que
    -- permite responder "cuanto costo esta consulta" sumando el laboratorio y
    -- la farmacia que salieron de ella.
    --
    -- Se guarda como texto suelto y NO como clave foranea a proposito: las
    -- visitas viven en asilo_consultas, que es la base de OTRO microservicio.
    -- usr_caja no tiene permiso para leerla, y asi debe seguir siendo. Un
    -- microservicio no pone claves foraneas contra la base de otro; guarda la
    -- referencia y confia en quien se la manda.
    --
    -- Queda NULA en los cargos que no nacen de una visita: la cuota mensual
    -- de estadia, las donaciones en especie, cualquier cargo suelto que
    -- administracion registre a mano.
    visita_id        VARCHAR(24)    NULL,

    -- Mes que cubre la cuota de estadia, como AAAA-MM. NULO en todo lo demas.
    -- Existe para que la generacion mensual sea idempotente sin depender de
    -- que la aplicacion mire antes: con el UNIQUE de abajo, dos ejecuciones
    -- sobre el mismo mes —o dos simultaneas— no pueden duplicar la cuota.
    -- En MySQL los NULOS no chocan entre si en un indice unico, asi que los
    -- cargos que no son cuota quedan fuera de la restriccion.
    periodo_cuota    CHAR(7)        NULL,

    CONSTRAINT pk_cargos PRIMARY KEY (id),
    CONSTRAINT ck_cargos_categoria
        CHECK (categoria IN ('CONSULTA', 'LABORATORIO', 'FARMACIA', 'CUOTA', 'OTRO')),
    CONSTRAINT ck_cargos_estado
        CHECK (estado IN ('PENDIENTE', 'ABONADO', 'PAGADO')),
    CONSTRAINT ck_cargos_descuento CHECK (descuento_pct BETWEEN 0 AND 100),
    CONSTRAINT ck_cargos_montos
        CHECK (monto_bruto >= 0 AND monto_neto >= 0 AND monto_pagado >= 0),

    -- Una cuota por interno y por mes. Lo garantiza el motor y no una
    -- consulta previa: entre el SELECT y el INSERT cabe otra ejecucion.
    CONSTRAINT uq_cargos_cuota_mes UNIQUE (paciente_id, periodo_cuota),

    INDEX idx_cargos_paciente (paciente_id, creado_en),
    INDEX idx_cargos_categoria (categoria),
    INDEX idx_cargos_visita (visita_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS pagos (
    id              VARCHAR(16)    NOT NULL,
    cargo_id        VARCHAR(16)    NOT NULL,
    paciente_id     VARCHAR(16)    NOT NULL,
    monto           DECIMAL(10,2)  NOT NULL,
    metodo          VARCHAR(24)    NOT NULL,
    registrado_por  VARCHAR(120),
    creado_en       DATETIME       NOT NULL,

    CONSTRAINT pk_pagos PRIMARY KEY (id),
    CONSTRAINT fk_pagos_cargo FOREIGN KEY (cargo_id)
        REFERENCES cargos (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT ck_pagos_monto CHECK (monto > 0),

    INDEX idx_pagos_paciente (paciente_id, creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS donaciones (
    id              VARCHAR(16)    NOT NULL,
    donante         VARCHAR(160)   NOT NULL,
    -- 24 y no 16: EMPRESA_INTERNACIONAL mide 21 caracteres.
    tipo            VARCHAR(24)    NOT NULL,
    monto           DECIMAL(10,2)  NOT NULL,
    destino         VARCHAR(120),
    registrado_por  VARCHAR(120),
    creado_en       DATETIME       NOT NULL,

    CONSTRAINT pk_donaciones PRIMARY KEY (id),
    CONSTRAINT ck_donaciones_tipo
        CHECK (tipo IN ('EMPRESA_INTERNACIONAL', 'EMPRESA_NACIONAL',
                        'GOBIERNO', 'PARTICULAR')),
    CONSTRAINT ck_donaciones_monto CHECK (monto > 0),

    INDEX idx_donaciones_fecha (creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS gastos (
    id              VARCHAR(16)    NOT NULL,
    concepto        VARCHAR(160)   NOT NULL,
    categoria       VARCHAR(16)    NOT NULL,
    monto           DECIMAL(10,2)  NOT NULL,
    registrado_por  VARCHAR(120),
    creado_en       DATETIME       NOT NULL,

    CONSTRAINT pk_gastos PRIMARY KEY (id),
    CONSTRAINT ck_gastos_categoria
        CHECK (categoria IN ('SERVICIOS', 'PERSONAL', 'INSUMOS', 'MANTENIMIENTO', 'OTRO')),
    CONSTRAINT ck_gastos_monto CHECK (monto > 0),

    INDEX idx_gastos_fecha (creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS pagos_fundacion (
    id              VARCHAR(16)    NOT NULL,
    monto           DECIMAL(10,2)  NOT NULL,
    referencia      VARCHAR(160),
    registrado_por  VARCHAR(120),
    creado_en       DATETIME       NOT NULL,

    CONSTRAINT pk_pagos_fundacion PRIMARY KEY (id),
    CONSTRAINT ck_pagos_fundacion_monto CHECK (monto > 0),

    INDEX idx_pagos_fundacion_fecha (creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
