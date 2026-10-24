-- ===========================================================================
--  Asilo de Ancianos "Cabeza de Algodon" · INSTANCIA DE LA BASE DE DATOS
-- ---------------------------------------------------------------------------
--  Que es: el volcado de las cinco bases del sistema (asilo_vigia,
--  asilo_pastillero, asilo_caja, asilo_consultas y asilo_acceso) tal como
--  quedan recien levantado el stack, con el escenario de demostracion
--  sembrado y sin ningun registro de prueba. Es la instancia que pide la fase
--  de implementacion.
--
--  De donde sale: del commit del Bloque 17B (indicaciones.folio_validacion,
--  y las cuentas sembradas por ms-gateway), en modo demostracion
--  (MODO_DEMOSTRACION=1), con
--      docker compose down -v && docker compose up -d
--  y, con todo sano y antes de correr ninguna prueba,
--      mysqldump --databases <las cinco> --default-character-set=utf8mb4
--                --single-transaction --skip-dump-date
--  como root dentro del contenedor bd-asilo.
--
--  Que NO trae: los usuarios de MySQL ni sus claves (no se uso
--  --all-databases), ni procedimientos almacenados. Las cuentas del personal
--  que si trae son las siete de demostracion, con la clave en hash bcrypt.
--
--  NO se ejecuta al arrancar el stack: el arranque crea el esquema desde
--  sql/01 a sql/06. Esto es la entrega.
--
--  Como se restaura (reemplaza las tablas de esas cinco bases si ya existen):
--      mysql -u root -p --default-character-set=utf8mb4 < asilo-instancia.sql
--  o en MySQL Workbench: Server > Data Import > Import from Self-Contained
--  File, eligiendo este archivo.
--
--  Si cambia el esquema o la siembra, se regenera igual.
-- ===========================================================================
-- MySQL dump 10.13  Distrib 8.4.11, for Linux (x86_64)
--
-- Host: localhost    Database: asilo_vigia
-- ------------------------------------------------------
-- Server version	8.4.11

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Current Database: `asilo_vigia`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `asilo_vigia` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `asilo_vigia`;

--
-- Table structure for table `validaciones`
--

DROP TABLE IF EXISTS `validaciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `validaciones` (
  `folio` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `paciente_id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `principio_activo` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `veredicto` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `puntaje_riesgo` smallint NOT NULL,
  `solicitado_por` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dictamen` json NOT NULL,
  `creado_en` datetime NOT NULL,
  PRIMARY KEY (`folio`),
  UNIQUE KEY `uq_validaciones_folio` (`folio`),
  KEY `idx_validaciones_paciente` (`paciente_id`,`creado_en`),
  CONSTRAINT `ck_validaciones_puntaje` CHECK ((`puntaje_riesgo` between 0 and 100)),
  CONSTRAINT `ck_validaciones_veredicto` CHECK ((`veredicto` in (_latin1'APROBADO',_latin1'ADVERTENCIA',_latin1'BLOQUEADO')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `validaciones`
--

LOCK TABLES `validaciones` WRITE;
/*!40000 ALTER TABLE `validaciones` DISABLE KEYS */;
/*!40000 ALTER TABLE `validaciones` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Current Database: `asilo_pastillero`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `asilo_pastillero` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `asilo_pastillero`;

--
-- Table structure for table `internos`
--

DROP TABLE IF EXISTS `internos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `internos` (
  `id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `documento` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fecha_nacimiento` date NOT NULL,
  `sexo` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ingreso` date DEFAULT NULL,
  `motivo_ingreso` text COLLATE utf8mb4_unicode_ci,
  `pabellon` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cama` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `psicopatologias` json NOT NULL,
  `alergias` json NOT NULL,
  `medicacion_permanente` json NOT NULL,
  `clinica_actualizada_por` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `clinica_actualizada_en` datetime DEFAULT NULL,
  `responsable` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `correo_responsable` varchar(160) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `estado` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVO',
  `egreso_fecha` date DEFAULT NULL,
  `egreso_motivo` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_internos_documento` (`documento`),
  KEY `idx_internos_estado` (`estado`,`nombre`),
  CONSTRAINT `ck_internos_egreso` CHECK ((((`estado` = _latin1'ACTIVO') and (`egreso_fecha` is null)) or ((`estado` = _latin1'EGRESADO') and (`egreso_fecha` is not null)))),
  CONSTRAINT `ck_internos_estado` CHECK ((`estado` in (_latin1'ACTIVO',_latin1'EGRESADO'))),
  CONSTRAINT `ck_internos_sexo` CHECK ((`sexo` in (_latin1'FEMENINO',_latin1'MASCULINO',_latin1'OTRO')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `internos`
--

LOCK TABLES `internos` WRITE;
/*!40000 ALTER TABLE `internos` DISABLE KEYS */;
INSERT INTO `internos` VALUES ('ASL-007','Tránsito Xicará Tzoc','1874523690902','1947-02-02','FEMENINO','2024-02-02','Depresión mayor con intento previo; requiere vigilancia y control de medicación.','Pabellón B','1','[\"Depresión mayor\", \"Hipertensión arterial\"]','[\"sulfas\"]','[{\"via\": \"oral\", \"dosisMg\": 10, \"farmaco\": \"Enalapril\", \"cadaHoras\": 12, \"principioActivo\": \"enalapril\"}, {\"via\": \"oral\", \"dosisMg\": 50, \"farmaco\": \"Sertralina\", \"cadaHoras\": 24, \"principioActivo\": \"sertralina\"}]','Siembra de demostracion','2026-10-24 13:00:44','Julio Xicará, sobrino','julio.xicara@ejemplo.gt','ACTIVO',NULL,NULL),('ASL-014','Rosalía Menchú Coy','2587412360101','1942-05-11','FEMENINO','2023-05-11','Deterioro cognitivo progresivo; la familia no puede darle atención permanente en casa.','Pabellón A','3','[\"Demencia mixta\", \"Insomnio crónico\"]','[\"penicilina\"]','[{\"via\": \"oral\", \"dosisMg\": 10, \"farmaco\": \"Donepecilo\", \"cadaHoras\": 24, \"principioActivo\": \"donepecilo\"}]','Siembra de demostracion','2026-10-24 13:00:44','María Coy, hija','maria.coy@ejemplo.gt','ACTIVO',NULL,NULL),('ASL-022','Bernardo Puac Ixcoy','1023698740503','1938-09-19','MASCULINO','2022-09-19','Viudo sin red familiar de apoyo; deterioro cognitivo leve y riesgo de caídas.','Pabellón C','2','[\"Deterioro cognitivo leve\", \"Fibrilación auricular\"]','[]','[{\"via\": \"oral\", \"dosisMg\": 5, \"farmaco\": \"Warfarina\", \"cadaHoras\": 24, \"principioActivo\": \"warfarina\"}]','Siembra de demostracion','2026-10-24 13:00:44','Elena Ixcoy, nieta','elena.ixcoy@ejemplo.gt','ACTIVO',NULL,NULL);
/*!40000 ALTER TABLE `internos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `planes`
--

DROP TABLE IF EXISTS `planes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `planes` (
  `id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `paciente_id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `paciente_nombre` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `principio_activo` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `farmaco` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dosis_mg` decimal(10,2) NOT NULL,
  `via` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cada_horas` decimal(5,2) NOT NULL,
  `dias` smallint NOT NULL,
  `indicacion` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `folio_validacion` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `prescrito_por` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `inicio` datetime NOT NULL,
  `estado` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVO',
  `creado_en` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_planes_folio` (`folio_validacion`),
  KEY `idx_planes_paciente` (`paciente_id`,`estado`),
  CONSTRAINT `fk_planes_interno` FOREIGN KEY (`paciente_id`) REFERENCES `internos` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ck_planes_cada_horas` CHECK ((`cada_horas` between 1 and 72)),
  CONSTRAINT `ck_planes_dias` CHECK ((`dias` between 1 and 90)),
  CONSTRAINT `ck_planes_dosis` CHECK ((`dosis_mg` > 0)),
  CONSTRAINT `ck_planes_estado` CHECK ((`estado` in (_latin1'ACTIVO',_latin1'SUSPENDIDO',_latin1'FINALIZADO')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `planes`
--

LOCK TABLES `planes` WRITE;
/*!40000 ALTER TABLE `planes` DISABLE KEYS */;
INSERT INTO `planes` VALUES ('PL-18BAEC5E','ASL-014','Rosalia Menchu Coy','donepecilo','Donepecilo',10.00,'oral',24.00,30,'Deterioro cognitivo, dosis nocturna',NULL,'Dr. Angel Maltez','2026-10-24 21:00:00','ACTIVO','2026-10-24 13:00:44'),('PL-52C2A47D','ASL-022','Bernardo Puac Ixcoy','metformina','Metformina',850.00,'oral',12.00,30,'Diabetes tipo 2',NULL,'Dr. Angel Maltez','2026-10-24 07:00:00','ACTIVO','2026-10-24 13:00:44'),('PL-56C8D190','ASL-007','Transito Xicara Tzoc','enalapril','Enalapril',10.00,'oral',12.00,30,'Hipertension arterial',NULL,'Dr. Angel Maltez','2026-10-24 07:00:00','ACTIVO','2026-10-24 13:00:44'),('PL-58367E21','ASL-007','Transito Xicara Tzoc','sertralina','Sertralina',50.00,'oral',24.00,30,'Depresion mayor',NULL,'Dr. Angel Maltez','2026-10-24 08:00:00','ACTIVO','2026-10-24 13:00:44'),('PL-6F8E52B6','ASL-022','Bernardo Puac Ixcoy','warfarina','Warfarina',5.00,'oral',24.00,30,'Fibrilacion auricular, control de INR mensual',NULL,'Dr. Angel Maltez','2026-10-24 18:00:00','ACTIVO','2026-10-24 13:00:44'),('PL-74259383','ASL-014','Rosalia Menchu Coy','omeprazol','Omeprazol',20.00,'oral',24.00,30,'Proteccion gastrica en ayunas',NULL,'Dr. Angel Maltez','2026-10-24 07:00:00','ACTIVO','2026-10-24 13:00:44'),('PL-7CF43A28','ASL-022','Bernardo Puac Ixcoy','atorvastatina','Atorvastatina',20.00,'oral',24.00,30,'Dislipidemia',NULL,'Dr. Angel Maltez','2026-10-24 20:00:00','ACTIVO','2026-10-24 13:00:44'),('PL-B5E9F713','ASL-014','Rosalia Menchu Coy','paracetamol','Paracetamol',500.00,'oral',8.00,5,'Dolor osteoarticular',NULL,'Dr. Angel Maltez','2026-10-24 06:00:00','ACTIVO','2026-10-24 13:00:44');
/*!40000 ALTER TABLE `planes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tomas`
--

DROP TABLE IF EXISTS `tomas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tomas` (
  `id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan_id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `paciente_id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `programado_para` datetime NOT NULL,
  `turno` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL,
  `estado` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDIENTE',
  `enfermero` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `observacion` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `registrado_en` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tomas_paciente` (`paciente_id`,`programado_para`),
  KEY `idx_tomas_plan` (`plan_id`),
  CONSTRAINT `fk_tomas_plan` FOREIGN KEY (`plan_id`) REFERENCES `planes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ck_tomas_estado` CHECK ((`estado` in (_latin1'PENDIENTE',_latin1'ADMINISTRADA',_latin1'OMITIDA'))),
  CONSTRAINT `ck_tomas_turno` CHECK ((`turno` in (_latin1'matutino',_latin1'vespertino',_latin1'nocturno')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tomas`
--

LOCK TABLES `tomas` WRITE;
/*!40000 ALTER TABLE `tomas` DISABLE KEYS */;
INSERT INTO `tomas` VALUES ('TM-02516AC36D','PL-74259383','ASL-014','2026-10-27 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-025AF64E0C','PL-52C2A47D','ASL-022','2026-10-29 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-039A75E184','PL-56C8D190','ASL-007','2026-11-05 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-041A8345B7','PL-18BAEC5E','ASL-014','2026-11-22 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-066D6C04CE','PL-6F8E52B6','ASL-022','2026-11-06 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-0670E2C74A','PL-56C8D190','ASL-007','2026-11-15 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-0707001180','PL-6F8E52B6','ASL-022','2026-10-27 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-07AC4B3455','PL-58367E21','ASL-007','2026-11-16 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-08C6750611','PL-56C8D190','ASL-007','2026-11-02 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-0B4E5D1DF6','PL-56C8D190','ASL-007','2026-11-10 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-0B7259668E','PL-6F8E52B6','ASL-022','2026-11-08 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-0BA4FDDAAD','PL-52C2A47D','ASL-022','2026-11-06 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-0BEBFF6666','PL-6F8E52B6','ASL-022','2026-10-29 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-0BF4420A60','PL-52C2A47D','ASL-022','2026-11-03 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-0BFC44C6D2','PL-18BAEC5E','ASL-014','2026-11-15 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-0BFDFD909A','PL-58367E21','ASL-007','2026-11-08 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-0D0CA0C6DB','PL-52C2A47D','ASL-022','2026-11-02 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-0DB5BADAA4','PL-56C8D190','ASL-007','2026-10-29 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-0E7C89C4EF','PL-74259383','ASL-014','2026-11-03 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-0F47133658','PL-18BAEC5E','ASL-014','2026-11-11 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-0FC05716D6','PL-18BAEC5E','ASL-014','2026-11-09 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-0FFA857629','PL-52C2A47D','ASL-022','2026-11-11 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-105BAA8DE7','PL-58367E21','ASL-007','2026-11-11 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-10DE4171C5','PL-58367E21','ASL-007','2026-11-07 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-12DA7753F5','PL-7CF43A28','ASL-022','2026-10-27 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-133DC1611A','PL-58367E21','ASL-007','2026-11-05 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-1412100192','PL-52C2A47D','ASL-022','2026-11-05 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-145E103A1E','PL-56C8D190','ASL-007','2026-11-17 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-159BEA7FE9','PL-58367E21','ASL-007','2026-11-21 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-15E827478B','PL-52C2A47D','ASL-022','2026-11-11 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-15F130C00F','PL-56C8D190','ASL-007','2026-11-02 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-168F96698F','PL-18BAEC5E','ASL-014','2026-11-14 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-1699AA610B','PL-58367E21','ASL-007','2026-10-25 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-16C5BA1B9A','PL-56C8D190','ASL-007','2026-11-21 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-1773C129D1','PL-74259383','ASL-014','2026-11-07 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-17E2EC174B','PL-52C2A47D','ASL-022','2026-11-12 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-188B8DAB8D','PL-52C2A47D','ASL-022','2026-11-10 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-18C77A9A91','PL-58367E21','ASL-007','2026-11-14 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-1A02DD5EDB','PL-6F8E52B6','ASL-022','2026-11-15 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-1BB1052345','PL-52C2A47D','ASL-022','2026-10-31 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-1C8D39342A','PL-56C8D190','ASL-007','2026-11-14 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-1CF660C6F4','PL-74259383','ASL-014','2026-11-15 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-1CF7ED2391','PL-7CF43A28','ASL-022','2026-11-07 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-1D11A3B494','PL-56C8D190','ASL-007','2026-10-26 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-1DBD27DF48','PL-56C8D190','ASL-007','2026-11-04 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-1F43B58DF7','PL-B5E9F713','ASL-014','2026-10-28 06:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-2031D8E8B1','PL-52C2A47D','ASL-022','2026-11-12 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-22B9CE09D8','PL-58367E21','ASL-007','2026-10-30 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-23BF6231A9','PL-58367E21','ASL-007','2026-11-18 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-251998E239','PL-58367E21','ASL-007','2026-11-17 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-260963DB3A','PL-56C8D190','ASL-007','2026-11-20 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-290C5E7AEA','PL-18BAEC5E','ASL-014','2026-11-03 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-296F461BEC','PL-56C8D190','ASL-007','2026-11-03 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-2990BBBE8B','PL-74259383','ASL-014','2026-11-18 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-2A1261A9EA','PL-B5E9F713','ASL-014','2026-10-28 22:00:00','nocturno','PENDIENTE',NULL,NULL,NULL),('TM-2AD6A50F3B','PL-52C2A47D','ASL-022','2026-10-29 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-2B9330A68D','PL-18BAEC5E','ASL-014','2026-11-20 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-2BFBBCA08D','PL-52C2A47D','ASL-022','2026-10-25 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-2C3FCF147D','PL-74259383','ASL-014','2026-11-11 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-2CA3DF63F0','PL-52C2A47D','ASL-022','2026-11-02 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-2CD16B9466','PL-B5E9F713','ASL-014','2026-10-25 22:00:00','nocturno','PENDIENTE',NULL,NULL,NULL),('TM-2DCD0B3A26','PL-6F8E52B6','ASL-022','2026-11-11 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-2F6E189AD8','PL-56C8D190','ASL-007','2026-10-31 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-3041648534','PL-52C2A47D','ASL-022','2026-11-03 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-3142D415AE','PL-56C8D190','ASL-007','2026-10-24 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-31DA1D09B3','PL-52C2A47D','ASL-022','2026-10-26 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-32868284BA','PL-7CF43A28','ASL-022','2026-11-14 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-32F15D64A5','PL-58367E21','ASL-007','2026-10-29 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-360D7F3F1C','PL-56C8D190','ASL-007','2026-10-30 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-382302E3C4','PL-52C2A47D','ASL-022','2026-10-31 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-38B1ECF765','PL-56C8D190','ASL-007','2026-11-12 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-39AB680E08','PL-6F8E52B6','ASL-022','2026-11-02 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-39ED93AF42','PL-56C8D190','ASL-007','2026-11-11 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-3AF2A72110','PL-52C2A47D','ASL-022','2026-11-17 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-3B07494B81','PL-56C8D190','ASL-007','2026-11-05 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-3BAB840DD9','PL-52C2A47D','ASL-022','2026-11-13 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-3BAFC92CD2','PL-18BAEC5E','ASL-014','2026-10-30 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-3C41275010','PL-52C2A47D','ASL-022','2026-11-18 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-3C4717CA34','PL-6F8E52B6','ASL-022','2026-11-13 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-3D1008D1E3','PL-18BAEC5E','ASL-014','2026-11-18 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-3D264AFF6C','PL-6F8E52B6','ASL-022','2026-11-09 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-3F57C119ED','PL-52C2A47D','ASL-022','2026-11-15 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-400CDE4C7A','PL-56C8D190','ASL-007','2026-10-31 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-422360AE36','PL-B5E9F713','ASL-014','2026-10-26 14:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-422599C312','PL-52C2A47D','ASL-022','2026-11-13 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-429C9D3A6F','PL-74259383','ASL-014','2026-11-20 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-433ECF2B47','PL-7CF43A28','ASL-022','2026-11-05 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-43A6B45EC8','PL-56C8D190','ASL-007','2026-11-03 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-43C496CF59','PL-7CF43A28','ASL-022','2026-11-15 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-47528085AB','PL-56C8D190','ASL-007','2026-11-06 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-497AC25624','PL-74259383','ASL-014','2026-11-21 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-4A87ED31A6','PL-52C2A47D','ASL-022','2026-11-06 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-4B188972D8','PL-7CF43A28','ASL-022','2026-11-22 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-4C56E565FA','PL-6F8E52B6','ASL-022','2026-11-20 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-4F0AC05DB2','PL-18BAEC5E','ASL-014','2026-11-19 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-4F2427AA91','PL-6F8E52B6','ASL-022','2026-11-19 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-51379A24A7','PL-56C8D190','ASL-007','2026-11-11 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-51B25A1CDC','PL-58367E21','ASL-007','2026-11-20 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-52410D8781','PL-74259383','ASL-014','2026-10-30 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-552C90F88E','PL-18BAEC5E','ASL-014','2026-11-06 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-559D48BA1E','PL-7CF43A28','ASL-022','2026-11-17 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-566846BFE9','PL-74259383','ASL-014','2026-11-04 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-5734DAE13A','PL-52C2A47D','ASL-022','2026-11-20 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-58229EBB46','PL-56C8D190','ASL-007','2026-10-27 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-58988EAC24','PL-56C8D190','ASL-007','2026-10-26 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-5BDA3329BC','PL-52C2A47D','ASL-022','2026-11-09 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-5C0C798163','PL-52C2A47D','ASL-022','2026-10-30 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-5C1F8B1C3F','PL-56C8D190','ASL-007','2026-11-15 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-5C4D02140D','PL-18BAEC5E','ASL-014','2026-11-01 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-5DC365ACA3','PL-58367E21','ASL-007','2026-11-22 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-5E2035583B','PL-52C2A47D','ASL-022','2026-11-22 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-5ED8FDCFBC','PL-7CF43A28','ASL-022','2026-10-31 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-5EF69F58ED','PL-52C2A47D','ASL-022','2026-11-19 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-60B218DC8B','PL-56C8D190','ASL-007','2026-10-29 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-62EA9500DC','PL-6F8E52B6','ASL-022','2026-11-03 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-630107E28E','PL-52C2A47D','ASL-022','2026-11-21 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-632406F3A6','PL-18BAEC5E','ASL-014','2026-11-04 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-637DDFD3B4','PL-52C2A47D','ASL-022','2026-11-16 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-64C8AA3FA3','PL-7CF43A28','ASL-022','2026-11-08 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-64D0E60C51','PL-56C8D190','ASL-007','2026-11-08 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-64E4ED2FB8','PL-18BAEC5E','ASL-014','2026-11-05 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-658A5228FF','PL-56C8D190','ASL-007','2026-11-10 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-66C261BA89','PL-6F8E52B6','ASL-022','2026-11-14 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-69516F726D','PL-7CF43A28','ASL-022','2026-10-26 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-6BF314C0E4','PL-6F8E52B6','ASL-022','2026-11-17 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-6D063D82CF','PL-18BAEC5E','ASL-014','2026-11-12 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-6D9FBE9C2D','PL-74259383','ASL-014','2026-11-06 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-71A18D354A','PL-6F8E52B6','ASL-022','2026-10-31 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-71DE4CE732','PL-74259383','ASL-014','2026-11-16 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-7381B257EA','PL-56C8D190','ASL-007','2026-11-21 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-7393F76400','PL-52C2A47D','ASL-022','2026-11-14 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-7531455DA1','PL-56C8D190','ASL-007','2026-10-30 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-7578CAD415','PL-58367E21','ASL-007','2026-11-10 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-75B3CEC37F','PL-58367E21','ASL-007','2026-10-28 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-7855BE2445','PL-7CF43A28','ASL-022','2026-11-01 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-78AECE52FE','PL-7CF43A28','ASL-022','2026-11-21 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-7AB9701297','PL-6F8E52B6','ASL-022','2026-11-01 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-7AD9CC8689','PL-56C8D190','ASL-007','2026-11-08 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-7D79BA5B16','PL-56C8D190','ASL-007','2026-11-16 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-7EE2AEFDF5','PL-56C8D190','ASL-007','2026-11-22 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-80221B033F','PL-58367E21','ASL-007','2026-11-09 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-80226277D9','PL-74259383','ASL-014','2026-10-25 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-825F2F9B4D','PL-58367E21','ASL-007','2026-11-19 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-82C22B9016','PL-52C2A47D','ASL-022','2026-11-10 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-82F5CD0345','PL-7CF43A28','ASL-022','2026-11-09 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-864F9E1869','PL-56C8D190','ASL-007','2026-10-24 07:00:00','matutino','ADMINISTRADA','Enf. Lucia Cabrera','Toma sin incidencias','2026-10-24 07:00:00'),('TM-86C592714F','PL-52C2A47D','ASL-022','2026-11-07 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-874E5A59CF','PL-B5E9F713','ASL-014','2026-10-24 22:00:00','nocturno','PENDIENTE',NULL,NULL,NULL),('TM-883257CB7D','PL-7CF43A28','ASL-022','2026-11-13 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-88B4523B6E','PL-7CF43A28','ASL-022','2026-11-03 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-8A3F67521B','PL-58367E21','ASL-007','2026-11-12 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-8C2BFD23FA','PL-74259383','ASL-014','2026-10-24 07:00:00','matutino','ADMINISTRADA','Enf. Lucia Cabrera','Toma sin incidencias','2026-10-24 07:00:00'),('TM-8C7E147692','PL-7CF43A28','ASL-022','2026-10-25 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-8D385B50F5','PL-52C2A47D','ASL-022','2026-11-22 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-8D85E9D74D','PL-52C2A47D','ASL-022','2026-11-18 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-8E57966AB3','PL-18BAEC5E','ASL-014','2026-11-21 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-8E9BE57A32','PL-7CF43A28','ASL-022','2026-10-29 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-8ECE03F545','PL-B5E9F713','ASL-014','2026-10-25 06:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-8ED485D1CD','PL-74259383','ASL-014','2026-11-08 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-8F88D4C7C1','PL-B5E9F713','ASL-014','2026-10-26 06:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-8FD835BC84','PL-52C2A47D','ASL-022','2026-10-28 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-90626D8A19','PL-18BAEC5E','ASL-014','2026-10-27 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-91CE12F99E','PL-7CF43A28','ASL-022','2026-10-30 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-927331BEAB','PL-58367E21','ASL-007','2026-11-13 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-93C558BB4E','PL-7CF43A28','ASL-022','2026-11-02 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-95588E5865','PL-58367E21','ASL-007','2026-11-03 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-9577411AB5','PL-58367E21','ASL-007','2026-10-26 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-9660DFDFB5','PL-7CF43A28','ASL-022','2026-11-16 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-968F473BE9','PL-74259383','ASL-014','2026-11-19 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-9707A17DB1','PL-52C2A47D','ASL-022','2026-11-14 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-97403A275B','PL-52C2A47D','ASL-022','2026-10-25 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-987AC81D5D','PL-B5E9F713','ASL-014','2026-10-24 06:00:00','matutino','ADMINISTRADA','Enf. Lucia Cabrera','Toma sin incidencias','2026-10-24 06:00:00'),('TM-987DAF8D08','PL-7CF43A28','ASL-022','2026-11-06 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-99C6322F76','PL-18BAEC5E','ASL-014','2026-10-29 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-99EF74A9C7','PL-18BAEC5E','ASL-014','2026-10-31 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-9A5FF07F08','PL-18BAEC5E','ASL-014','2026-11-13 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-9A7C891A15','PL-7CF43A28','ASL-022','2026-11-18 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-9AA5B100E6','PL-58367E21','ASL-007','2026-10-31 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-9B6BE10A92','PL-B5E9F713','ASL-014','2026-10-27 14:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-9C77192C27','PL-58367E21','ASL-007','2026-10-24 08:00:00','matutino','ADMINISTRADA','Enf. Lucia Cabrera','Toma sin incidencias','2026-10-24 08:00:00'),('TM-9D971BA479','PL-74259383','ASL-014','2026-10-26 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-9DA866EE23','PL-B5E9F713','ASL-014','2026-10-25 14:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-9EDD982B87','PL-7CF43A28','ASL-022','2026-10-24 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-A05F2BC96F','PL-6F8E52B6','ASL-022','2026-10-24 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-A1A91B5F60','PL-74259383','ASL-014','2026-11-10 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-A214BA060E','PL-74259383','ASL-014','2026-11-22 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-A36FCE43DF','PL-58367E21','ASL-007','2026-10-27 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-A477F10F51','PL-18BAEC5E','ASL-014','2026-11-08 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-A59BD71668','PL-B5E9F713','ASL-014','2026-10-26 22:00:00','nocturno','PENDIENTE',NULL,NULL,NULL),('TM-A67001FBFA','PL-52C2A47D','ASL-022','2026-10-27 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-A704BFCA18','PL-74259383','ASL-014','2026-11-09 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-A733752CE6','PL-18BAEC5E','ASL-014','2026-11-07 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-A8CBC1801C','PL-52C2A47D','ASL-022','2026-11-19 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-A96ACDC768','PL-6F8E52B6','ASL-022','2026-11-18 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-A9FF77B60F','PL-18BAEC5E','ASL-014','2026-10-28 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-AAD14B3237','PL-56C8D190','ASL-007','2026-11-09 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-AB1D4544FF','PL-6F8E52B6','ASL-022','2026-10-26 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-AB2D6A8096','PL-6F8E52B6','ASL-022','2026-11-21 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-ABAD34E70C','PL-52C2A47D','ASL-022','2026-11-07 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-AC8F1CED52','PL-56C8D190','ASL-007','2026-11-07 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-ACA909A589','PL-56C8D190','ASL-007','2026-11-19 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-AEDC748746','PL-18BAEC5E','ASL-014','2026-11-17 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B079DC08FE','PL-56C8D190','ASL-007','2026-10-25 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-B18FF15F43','PL-74259383','ASL-014','2026-11-02 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-B2B3C86680','PL-52C2A47D','ASL-022','2026-10-24 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B31564CDAD','PL-18BAEC5E','ASL-014','2026-10-26 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B5A79387B8','PL-56C8D190','ASL-007','2026-11-14 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B692C667BE','PL-74259383','ASL-014','2026-11-17 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-B6EFAA30F9','PL-52C2A47D','ASL-022','2026-11-08 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B74934C2B5','PL-6F8E52B6','ASL-022','2026-10-25 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B7B4E33842','PL-56C8D190','ASL-007','2026-11-18 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-B826B385DE','PL-56C8D190','ASL-007','2026-10-28 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-B991056134','PL-56C8D190','ASL-007','2026-11-07 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-B9EAC9AFA3','PL-74259383','ASL-014','2026-11-01 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-BB296B3F87','PL-56C8D190','ASL-007','2026-11-06 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-BD8E3721B1','PL-7CF43A28','ASL-022','2026-11-10 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-BDC1F45978','PL-58367E21','ASL-007','2026-11-15 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-BDD11578C5','PL-6F8E52B6','ASL-022','2026-11-12 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-BE2B52172D','PL-6F8E52B6','ASL-022','2026-11-16 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-BF96396C0D','PL-56C8D190','ASL-007','2026-10-27 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-C1EA701C61','PL-56C8D190','ASL-007','2026-11-20 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-C2C1A3A8DA','PL-74259383','ASL-014','2026-11-12 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-C47AC0E5CE','PL-56C8D190','ASL-007','2026-11-09 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-C4B35CCC45','PL-52C2A47D','ASL-022','2026-10-24 07:00:00','matutino','ADMINISTRADA','Enf. Lucia Cabrera','Toma sin incidencias','2026-10-24 07:00:00'),('TM-C50550113C','PL-52C2A47D','ASL-022','2026-11-20 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-C5CDD35C2D','PL-56C8D190','ASL-007','2026-11-18 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-C5F22B594E','PL-6F8E52B6','ASL-022','2026-11-04 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-C631A57BEB','PL-52C2A47D','ASL-022','2026-11-08 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-C7A4D2FAAE','PL-52C2A47D','ASL-022','2026-11-04 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-C7C190B660','PL-52C2A47D','ASL-022','2026-11-01 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-C819E49590','PL-7CF43A28','ASL-022','2026-10-28 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-C864CE4C7D','PL-52C2A47D','ASL-022','2026-10-28 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-C868867E5A','PL-52C2A47D','ASL-022','2026-10-30 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-C8A92A6ECB','PL-58367E21','ASL-007','2026-11-06 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-C8BB3E4FA4','PL-52C2A47D','ASL-022','2026-11-09 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-CA82EC0E94','PL-52C2A47D','ASL-022','2026-11-15 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-CCA0E95FD7','PL-56C8D190','ASL-007','2026-11-01 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-CCDAF785AB','PL-B5E9F713','ASL-014','2026-10-27 22:00:00','nocturno','PENDIENTE',NULL,NULL,NULL),('TM-CE7B015250','PL-74259383','ASL-014','2026-10-31 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-CFC8F1B5BD','PL-18BAEC5E','ASL-014','2026-10-24 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-D0D7237EC3','PL-7CF43A28','ASL-022','2026-11-20 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-D1D38AA3A8','PL-74259383','ASL-014','2026-11-05 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-D391209E5D','PL-56C8D190','ASL-007','2026-11-16 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-D3BDC192CF','PL-7CF43A28','ASL-022','2026-11-12 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-D3FEC0F88E','PL-58367E21','ASL-007','2026-11-01 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-D4CFEEBCEA','PL-56C8D190','ASL-007','2026-10-25 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-D54B3C8D9E','PL-7CF43A28','ASL-022','2026-11-04 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-D9233B00C0','PL-74259383','ASL-014','2026-10-28 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-D933FF81FD','PL-6F8E52B6','ASL-022','2026-11-07 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-D964967E62','PL-B5E9F713','ASL-014','2026-10-27 06:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-DA0581000C','PL-6F8E52B6','ASL-022','2026-11-05 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-DA31338EA0','PL-6F8E52B6','ASL-022','2026-11-10 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-DA86703507','PL-56C8D190','ASL-007','2026-11-22 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-DB02FE85FC','PL-52C2A47D','ASL-022','2026-11-17 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-DEA234B6EB','PL-52C2A47D','ASL-022','2026-11-21 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-DF2290AEAA','PL-B5E9F713','ASL-014','2026-10-24 14:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-DF23FDB206','PL-52C2A47D','ASL-022','2026-11-04 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-DF52325220','PL-56C8D190','ASL-007','2026-11-04 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-E01C510206','PL-7CF43A28','ASL-022','2026-11-19 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-E147143FCA','PL-6F8E52B6','ASL-022','2026-10-30 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-E20FF7EE6A','PL-52C2A47D','ASL-022','2026-11-01 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-E3A2272CB1','PL-18BAEC5E','ASL-014','2026-11-10 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-E604E8150B','PL-7CF43A28','ASL-022','2026-11-11 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-E8A553AB12','PL-74259383','ASL-014','2026-10-29 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-EA92C52163','PL-18BAEC5E','ASL-014','2026-10-25 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-EAB9899F68','PL-56C8D190','ASL-007','2026-11-12 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-EC615DDBE6','PL-58367E21','ASL-007','2026-11-02 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-ED635D77F5','PL-B5E9F713','ASL-014','2026-10-28 14:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-EE0C0822F7','PL-56C8D190','ASL-007','2026-11-01 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-EF9444473E','PL-52C2A47D','ASL-022','2026-10-27 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-F15369EE6C','PL-74259383','ASL-014','2026-11-13 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-F24A39DD9E','PL-56C8D190','ASL-007','2026-11-19 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-F2F2F12470','PL-52C2A47D','ASL-022','2026-10-26 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-F4D9F6380F','PL-74259383','ASL-014','2026-11-14 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-F521B860F1','PL-56C8D190','ASL-007','2026-11-13 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-F83EF144F2','PL-52C2A47D','ASL-022','2026-11-16 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-F86DFEE5E9','PL-58367E21','ASL-007','2026-11-04 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-F9DBE0C9E8','PL-56C8D190','ASL-007','2026-10-28 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-FB81A0222D','PL-56C8D190','ASL-007','2026-11-17 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-FBAC46A679','PL-52C2A47D','ASL-022','2026-11-05 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-FBCB00ACFB','PL-6F8E52B6','ASL-022','2026-10-28 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-FBEE432A0F','PL-18BAEC5E','ASL-014','2026-11-02 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-FC96A5951A','PL-6F8E52B6','ASL-022','2026-11-22 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-FCBA32C815','PL-18BAEC5E','ASL-014','2026-11-16 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-FF19305853','PL-56C8D190','ASL-007','2026-11-13 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL);
/*!40000 ALTER TABLE `tomas` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Current Database: `asilo_caja`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `asilo_caja` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `asilo_caja`;

--
-- Table structure for table `cargos`
--

DROP TABLE IF EXISTS `cargos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cargos` (
  `id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `paciente_id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `paciente_nombre` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `categoria` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `concepto` varchar(160) COLLATE utf8mb4_unicode_ci NOT NULL,
  `referencia` varchar(48) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `monto_bruto` decimal(10,2) NOT NULL,
  `descuento_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
  `monto_neto` decimal(10,2) NOT NULL,
  `monto_pagado` decimal(10,2) NOT NULL DEFAULT '0.00',
  `estado` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDIENTE',
  `registrado_por` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `creado_en` datetime NOT NULL,
  `visita_id` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `periodo_cuota` char(7) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cargos_cuota_mes` (`paciente_id`,`periodo_cuota`),
  KEY `idx_cargos_paciente` (`paciente_id`,`creado_en`),
  KEY `idx_cargos_categoria` (`categoria`),
  KEY `idx_cargos_visita` (`visita_id`),
  CONSTRAINT `ck_cargos_categoria` CHECK ((`categoria` in (_latin1'CONSULTA',_latin1'LABORATORIO',_latin1'FARMACIA',_latin1'CUOTA',_latin1'OTRO'))),
  CONSTRAINT `ck_cargos_descuento` CHECK ((`descuento_pct` between 0 and 100)),
  CONSTRAINT `ck_cargos_estado` CHECK ((`estado` in (_latin1'PENDIENTE',_latin1'ABONADO',_latin1'PAGADO'))),
  CONSTRAINT `ck_cargos_montos` CHECK (((`monto_bruto` >= 0) and (`monto_neto` >= 0) and (`monto_pagado` >= 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cargos`
--

LOCK TABLES `cargos` WRITE;
/*!40000 ALTER TABLE `cargos` DISABLE KEYS */;
INSERT INTO `cargos` VALUES ('CG-20EA8A98','ASL-014','Rosalia Menchu Coy','CONSULTA','Valoracion por psiquiatria geriatrica','consulta-especialista',350.00,55.00,157.50,157.50,'PAGADO','Marta Solis, administracion','2026-10-12 13:00:39',NULL,NULL),('CG-308CC8F2','ASL-022','Bernardo Puac Ixcoy','LABORATORIO','Control de INR por warfarina','laboratorio-basico',280.00,50.00,140.00,0.00,'PENDIENTE','Marta Solis, administracion','2026-10-21 13:00:39',NULL,NULL),('CG-44FE6E47','ASL-007','Transito Xicara Tzoc','CONSULTA','Control de presion arterial','consulta-general',150.00,60.00,60.00,60.00,'PAGADO','Marta Solis, administracion','2026-10-19 13:00:39',NULL,NULL),('CG-4BA38E53','ASL-022','Bernardo Puac Ixcoy','CUOTA','Cuota mensual de estadia 2026-10','cuota-mensual',450.00,0.00,450.00,450.00,'PAGADO','Marta Solis, administracion','2026-10-04 13:00:39',NULL,'2026-10'),('CG-95EA79B0','ASL-014','Rosalia Menchu Coy','LABORATORIO','Perfil metabolico de control','laboratorio-basico',280.00,50.00,140.00,0.00,'PENDIENTE','Marta Solis, administracion','2026-10-12 13:00:39',NULL,NULL),('CG-9B2AD379','ASL-022','Bernardo Puac Ixcoy','FARMACIA','Atorvastatina, caja mensual','farmacia-especializado',220.00,40.00,132.00,0.00,'PENDIENTE','Marta Solis, administracion','2026-10-21 13:00:39',NULL,NULL),('CG-C8FE7967','ASL-014','Rosalia Menchu Coy','CUOTA','Cuota mensual de estadia 2026-10','cuota-mensual',450.00,0.00,450.00,450.00,'PAGADO','Marta Solis, administracion','2026-10-04 13:00:39',NULL,'2026-10'),('CG-DEMO0001','ASL-022','Bernardo Puac Ixcoy','LABORATORIO','Tiempo de protrombina e INR (visita VM-2026-DEMO0022)','laboratorio-basico',280.00,50.00,140.00,0.00,'PENDIENTE','Dr. Rolando Sicajau','2026-10-15 13:00:39','VM-2026-DEMO0022',NULL),('CG-DEMO0002','ASL-022','Bernardo Puac Ixcoy','LABORATORIO','Electrocardiograma de 12 derivaciones (visita VM-2026-DEMO0022)','laboratorio-imagen',420.00,45.00,231.00,0.00,'PENDIENTE','Dr. Rolando Sicajau','2026-10-15 13:00:39','VM-2026-DEMO0022',NULL),('CG-DEMO0003','ASL-022','Bernardo Puac Ixcoy','FARMACIA','Warfarina 5.00 mg (indicacion IN-2026-DEMO0001)','farmacia-generico',60.00,65.00,21.00,0.00,'PENDIENTE','Farmacia de la Fundación','2026-10-15 13:00:39','VM-2026-DEMO0022',NULL),('CG-ECE06C04','ASL-007','Transito Xicara Tzoc','CUOTA','Cuota mensual de estadia 2026-10','cuota-mensual',450.00,0.00,450.00,0.00,'PENDIENTE','Marta Solis, administracion','2026-10-04 13:00:39',NULL,'2026-10');
/*!40000 ALTER TABLE `cargos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `donaciones`
--

DROP TABLE IF EXISTS `donaciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `donaciones` (
  `id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `donante` varchar(160) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tipo` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `destino` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `registrado_por` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `creado_en` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_donaciones_fecha` (`creado_en`),
  CONSTRAINT `ck_donaciones_monto` CHECK ((`monto` > 0)),
  CONSTRAINT `ck_donaciones_tipo` CHECK ((`tipo` in (_latin1'EMPRESA_INTERNACIONAL',_latin1'EMPRESA_NACIONAL',_latin1'GOBIERNO',_latin1'PARTICULAR')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `donaciones`
--

LOCK TABLES `donaciones` WRITE;
/*!40000 ALTER TABLE `donaciones` DISABLE KEYS */;
INSERT INTO `donaciones` VALUES ('DN-22D075F9','Familia Coy Menchu','PARTICULAR',400.00,'fondo general','Marta Solis, administracion','2026-10-18 13:00:39'),('DN-439A9E17','HelpAge International','EMPRESA_INTERNACIONAL',7200.00,'equipamiento','Marta Solis, administracion','2026-09-23 13:00:39'),('DN-75F44C81','Municipalidad de Mazatenango','GOBIERNO',3500.00,'insumos medicos','Marta Solis, administracion','2026-10-06 13:00:39'),('DN-EC633DC8','Fundacion Amigos del Adulto Mayor','EMPRESA_NACIONAL',5000.00,'fondo general','Marta Solis, administracion','2026-09-29 13:00:39');
/*!40000 ALTER TABLE `donaciones` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `gastos`
--

DROP TABLE IF EXISTS `gastos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gastos` (
  `id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `concepto` varchar(160) COLLATE utf8mb4_unicode_ci NOT NULL,
  `categoria` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `registrado_por` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `creado_en` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_gastos_fecha` (`creado_en`),
  CONSTRAINT `ck_gastos_categoria` CHECK ((`categoria` in (_latin1'SERVICIOS',_latin1'PERSONAL',_latin1'INSUMOS',_latin1'MANTENIMIENTO',_latin1'OTRO'))),
  CONSTRAINT `ck_gastos_monto` CHECK ((`monto` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `gastos`
--

LOCK TABLES `gastos` WRITE;
/*!40000 ALTER TABLE `gastos` DISABLE KEYS */;
INSERT INTO `gastos` VALUES ('GT-DF480A32','Insumos de curacion y limpieza','INSUMOS',640.00,'Marta Solis, administracion','2026-10-15 13:00:39'),('GT-E0D4659F','Energia electrica del mes','SERVICIOS',890.00,'Marta Solis, administracion','2026-10-09 13:00:39'),('GT-E238D3A1','Agua potable del mes','SERVICIOS',210.00,'Marta Solis, administracion','2026-10-09 13:00:39');
/*!40000 ALTER TABLE `gastos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `pagos`
--

DROP TABLE IF EXISTS `pagos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pagos` (
  `id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cargo_id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `paciente_id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `metodo` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `registrado_por` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `creado_en` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_pagos_cargo` (`cargo_id`),
  KEY `idx_pagos_paciente` (`paciente_id`,`creado_en`),
  CONSTRAINT `fk_pagos_cargo` FOREIGN KEY (`cargo_id`) REFERENCES `cargos` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ck_pagos_monto` CHECK ((`monto` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `pagos`
--

LOCK TABLES `pagos` WRITE;
/*!40000 ALTER TABLE `pagos` DISABLE KEYS */;
INSERT INTO `pagos` VALUES ('PG-073C799F','CG-C8FE7967','ASL-014',450.00,'efectivo','Marta Solis, administracion','2026-10-04 13:00:39'),('PG-5275545B','CG-44FE6E47','ASL-007',60.00,'efectivo','Marta Solis, administracion','2026-10-19 13:00:39'),('PG-92A8B95F','CG-4BA38E53','ASL-022',450.00,'efectivo','Marta Solis, administracion','2026-10-04 13:00:39'),('PG-94F97D31','CG-20EA8A98','ASL-014',157.50,'efectivo','Marta Solis, administracion','2026-10-12 13:00:39');
/*!40000 ALTER TABLE `pagos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `pagos_fundacion`
--

DROP TABLE IF EXISTS `pagos_fundacion`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pagos_fundacion` (
  `id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `referencia` varchar(160) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `registrado_por` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `creado_en` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pagos_fundacion_fecha` (`creado_en`),
  CONSTRAINT `ck_pagos_fundacion_monto` CHECK ((`monto` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `pagos_fundacion`
--

LOCK TABLES `pagos_fundacion` WRITE;
/*!40000 ALTER TABLE `pagos_fundacion` DISABLE KEYS */;
INSERT INTO `pagos_fundacion` VALUES ('PF-705D6A1C',800.00,'Abono de consultas y laboratorios de julio','Marta Solis, administracion','2026-10-14 13:00:39');
/*!40000 ALTER TABLE `pagos_fundacion` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Current Database: `asilo_consultas`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `asilo_consultas` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `asilo_consultas`;

--
-- Table structure for table `correos_enviados`
--

DROP TABLE IF EXISTS `correos_enviados`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `correos_enviados` (
  `id` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `solicitud_id` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `destinatario` varchar(160) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `asunto` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cuerpo` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `enviado_en` datetime NOT NULL,
  `estado` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_correos_solicitud` (`solicitud_id`),
  KEY `idx_correos_fecha` (`enviado_en`),
  CONSTRAINT `fk_correos_solicitud` FOREIGN KEY (`solicitud_id`) REFERENCES `solicitudes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ck_correos_estado` CHECK ((`estado` in (_latin1'ENVIADO',_latin1'REGISTRADO',_latin1'FALLIDO',_latin1'SIN_DESTINATARIO')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `correos_enviados`
--

LOCK TABLES `correos_enviados` WRITE;
/*!40000 ALTER TABLE `correos_enviados` DISABLE KEYS */;
INSERT INTO `correos_enviados` VALUES ('CO-2026-DEMO0007','SOL-2026-DEMO0007','julio.xicara@ejemplo.gt','Asilo Cabeza de Algodon · Tránsito Xicará Tzoc fue remitido a Cardiologia','Estimado/a Julio Xicará, sobrino:\n\nLe escribimos del Asilo de Ancianos \"Cabeza de Algodon\" para informarle\nque su familiar Tránsito Xicará Tzoc (ASL-007) fue remitido a una consulta con especialista.\n\n  Numero de solicitud : SOL-2026-DEMO0007\n  Especialidad        : Cardiologia\n  Motivo              : Cifras de presion arterial elevadas en los ultimos tres controles, pese al tratamiento con enalapril.\n  Remitido por        : Dr. Angel Maltez\n  Fecha de la remision: 22/10/2026 a las 13:00\n  Estado actual       : PENDIENTE de que la fundacion le asigne medico y hora\n\nLo acompaña: Enf. Lucia Tzoc.\n\nCuando la fundacion le asigne medico, fecha y hora, se le informara el\ndetalle de la cita. Si necesita acompañar a su familiar ese dia, puede\ncomunicarse con la administracion del asilo.\n\nAtentamente,\nAsilo de Ancianos \"Cabeza de Algodon\"\nMazatenango, Suchitepequez\n','2026-10-22 13:00:00','REGISTRADO'),('CO-2026-DEMO0014','SOL-2026-DEMO0014','maria.coy@ejemplo.gt','Asilo Cabeza de Algodon · Rosalía Menchú Coy fue remitido a Psiquiatria','Estimado/a María Coy, hija:\n\nLe escribimos del Asilo de Ancianos \"Cabeza de Algodon\" para informarle\nque su familiar Rosalía Menchú Coy (ASL-014) fue remitido a una consulta con especialista.\n\n  Numero de solicitud : SOL-2026-DEMO0014\n  Especialidad        : Psiquiatria\n  Motivo              : Agitacion nocturna que no cede con el ajuste de la rutina de sueño.\n  Remitido por        : Dr. Angel Maltez\n  Fecha de la remision: 20/10/2026 a las 13:00\n  Estado actual       : PENDIENTE de que la fundacion le asigne medico y hora\n\nLo acompaña: Enf. Lucia Tzoc.\n\nCuando la fundacion le asigne medico, fecha y hora, se le informara el\ndetalle de la cita. Si necesita acompañar a su familiar ese dia, puede\ncomunicarse con la administracion del asilo.\n\nAtentamente,\nAsilo de Ancianos \"Cabeza de Algodon\"\nMazatenango, Suchitepequez\n','2026-10-20 13:00:00','REGISTRADO'),('CO-2026-DEMO0022','SOL-2026-DEMO0022','elena.ixcoy@ejemplo.gt','Asilo Cabeza de Algodon · Bernardo Puac Ixcoy fue remitido a Cardiologia','Estimado/a Elena Ixcoy, nieta:\n\nLe escribimos del Asilo de Ancianos \"Cabeza de Algodon\" para informarle\nque su familiar Bernardo Puac Ixcoy (ASL-022) fue remitido a una consulta con especialista.\n\n  Numero de solicitud : SOL-2026-DEMO0022\n  Especialidad        : Cardiologia\n  Motivo              : Control de anticoagulacion por fibrilacion auricular.\n  Remitido por        : Dr. Angel Maltez\n  Fecha de la remision: 12/10/2026 a las 13:00\n  Estado actual       : PENDIENTE de que la fundacion le asigne medico y hora\n\nLo acompaña: Enf. Lucia Tzoc.\n\nCuando la fundacion le asigne medico, fecha y hora, se le informara el\ndetalle de la cita. Si necesita acompañar a su familiar ese dia, puede\ncomunicarse con la administracion del asilo.\n\nAtentamente,\nAsilo de Ancianos \"Cabeza de Algodon\"\nMazatenango, Suchitepequez\n','2026-10-12 13:00:00','REGISTRADO');
/*!40000 ALTER TABLE `correos_enviados` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `examenes`
--

DROP TABLE IF EXISTS `examenes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `examenes` (
  `id` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `visita_id` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(160) COLLATE utf8mb4_unicode_ci NOT NULL,
  `indicado_en` datetime NOT NULL,
  `estado` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'SOLICITADO',
  `resultado` text COLLATE utf8mb4_unicode_ci,
  `resultado_en` datetime DEFAULT NULL,
  `registrado_por` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cargo_id` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_examenes_visita` (`visita_id`),
  KEY `idx_examenes_estado` (`estado`),
  CONSTRAINT `fk_examenes_visita` FOREIGN KEY (`visita_id`) REFERENCES `visitas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ck_examenes_estado` CHECK ((`estado` in (_latin1'SOLICITADO',_latin1'RESULTADO_LISTO')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `examenes`
--

LOCK TABLES `examenes` WRITE;
/*!40000 ALTER TABLE `examenes` DISABLE KEYS */;
INSERT INTO `examenes` VALUES ('EX-2026-DEMO0001','VM-2026-DEMO0022','Tiempo de protrombina e INR','2026-10-15 08:45:00','RESULTADO_LISTO','INR 2.4, dentro del rango terapeutico de 2.0 a 3.0. Sin ajuste de dosis.','2026-10-15 14:00:00','Lab. Clínico Central','CG-DEMO0001'),('EX-2026-DEMO0002','VM-2026-DEMO0022','Electrocardiograma de 12 derivaciones','2026-10-15 08:45:00','RESULTADO_LISTO','Fibrilacion auricular con respuesta ventricular controlada, 78 por minuto.','2026-10-15 14:00:00','Lab. Clínico Central','CG-DEMO0002');
/*!40000 ALTER TABLE `examenes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `indicaciones`
--

DROP TABLE IF EXISTS `indicaciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `indicaciones` (
  `id` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `visita_id` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `principio_activo` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dosis_mg` decimal(10,2) NOT NULL,
  `cada_horas` decimal(5,2) NOT NULL,
  `duracion_dias` smallint NOT NULL,
  `como_tomarlo` text COLLATE utf8mb4_unicode_ci,
  `entregado` tinyint(1) NOT NULL DEFAULT '0',
  `entregado_en` datetime DEFAULT NULL,
  `entregado_por` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cargo_id` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `folio_validacion` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_indicaciones_visita` (`visita_id`),
  KEY `idx_indicaciones_entregado` (`entregado`),
  CONSTRAINT `fk_indicaciones_visita` FOREIGN KEY (`visita_id`) REFERENCES `visitas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ck_indicaciones_cada_horas` CHECK ((`cada_horas` between 1 and 72)),
  CONSTRAINT `ck_indicaciones_dias` CHECK ((`duracion_dias` between 1 and 90)),
  CONSTRAINT `ck_indicaciones_dosis` CHECK ((`dosis_mg` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `indicaciones`
--

LOCK TABLES `indicaciones` WRITE;
/*!40000 ALTER TABLE `indicaciones` DISABLE KEYS */;
INSERT INTO `indicaciones` VALUES ('IN-2026-DEMO0001','VM-2026-DEMO0022','warfarina','Warfarina',5.00,24.00,30,'Por la noche, siempre a la misma hora. No cambiar la dosis sin control de INR.',1,'2026-10-15 15:00:00','Farmacia de la Fundación','CG-DEMO0003',NULL);
/*!40000 ALTER TABLE `indicaciones` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `solicitudes`
--

DROP TABLE IF EXISTS `solicitudes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `solicitudes` (
  `id` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `paciente_id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `paciente_nombre` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `motivo` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `especialidad_solicitada` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `enfermero_acompanante` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `solicitado_por` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `creada_en` datetime NOT NULL,
  `estado` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDIENTE',
  `medico_asignado` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `especialidad_asignada` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `agendada_para` datetime DEFAULT NULL,
  `agendada_por` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_solicitudes_paciente` (`paciente_id`,`creada_en`),
  KEY `idx_solicitudes_estado` (`estado`),
  CONSTRAINT `ck_solicitudes_estado` CHECK ((`estado` in (_latin1'PENDIENTE',_latin1'AGENDADA',_latin1'ATENDIDA',_latin1'CANCELADA')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `solicitudes`
--

LOCK TABLES `solicitudes` WRITE;
/*!40000 ALTER TABLE `solicitudes` DISABLE KEYS */;
INSERT INTO `solicitudes` VALUES ('SOL-2026-DEMO0007','ASL-007','Tránsito Xicará Tzoc','Cifras de presion arterial elevadas en los ultimos tres controles, pese al tratamiento con enalapril.','Cardiologia','Enf. Lucia Tzoc','Dr. Angel Maltez','2026-10-22 13:00:00','PENDIENTE',NULL,NULL,NULL,NULL),('SOL-2026-DEMO0014','ASL-014','Rosalía Menchú Coy','Agitacion nocturna que no cede con el ajuste de la rutina de sueño.','Psiquiatria','Enf. Lucia Tzoc','Dr. Angel Maltez','2026-10-20 13:00:00','AGENDADA','Dra. Silvia Racancoj','Psiquiatria','2026-10-25 09:00:00','Fundación Manos Unidas'),('SOL-2026-DEMO0022','ASL-022','Bernardo Puac Ixcoy','Control de anticoagulacion por fibrilacion auricular.','Cardiologia','Enf. Lucia Tzoc','Dr. Angel Maltez','2026-10-12 13:00:00','ATENDIDA','Dr. Rolando Sicajau','Cardiologia','2026-10-15 08:00:00','Fundación Manos Unidas');
/*!40000 ALTER TABLE `solicitudes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `visitas`
--

DROP TABLE IF EXISTS `visitas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `visitas` (
  `id` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `solicitud_id` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `paciente_id` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fecha_visita` datetime NOT NULL,
  `motivo` text COLLATE utf8mb4_unicode_ci,
  `medico_tratante` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `especialidad` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `diagnostico` text COLLATE utf8mb4_unicode_ci,
  `observaciones` text COLLATE utf8mb4_unicode_ci,
  `estado` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ABIERTA',
  `creada_en` datetime NOT NULL,
  `cargo_id` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_visitas_solicitud` (`solicitud_id`),
  KEY `idx_visitas_paciente` (`paciente_id`,`fecha_visita`),
  CONSTRAINT `fk_visitas_solicitud` FOREIGN KEY (`solicitud_id`) REFERENCES `solicitudes` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ck_visitas_estado` CHECK ((`estado` in (_latin1'ABIERTA',_latin1'CERRADA')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `visitas`
--

LOCK TABLES `visitas` WRITE;
/*!40000 ALTER TABLE `visitas` DISABLE KEYS */;
INSERT INTO `visitas` VALUES ('VM-2026-DEMO0022','SOL-2026-DEMO0022','ASL-022','2026-10-15 08:30:00','Control de anticoagulacion por fibrilacion auricular.','Dr. Rolando Sicajau','Cardiologia','Fibrilacion auricular permanente, con anticoagulacion en rango terapeutico y frecuencia ventricular controlada.','Se mantiene la warfarina a la dosis actual y se surte la receta del mes. Control de INR en cuatro semanas y vigilancia de signos de sangrado.','CERRADA','2026-10-15 13:00:00',NULL);
/*!40000 ALTER TABLE `visitas` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Current Database: `asilo_acceso`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `asilo_acceso` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `asilo_acceso`;

--
-- Table structure for table `bitacora_usuarios`
--

DROP TABLE IF EXISTS `bitacora_usuarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bitacora_usuarios` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `usuario` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `accion` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `hecho_por` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `en` datetime NOT NULL,
  `detalle` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_bitacora_usuarios_usuario` (`usuario`,`id`),
  CONSTRAINT `fk_bitacora_usuarios_usuario` FOREIGN KEY (`usuario`) REFERENCES `usuarios` (`usuario`),
  CONSTRAINT `ck_bitacora_usuarios_accion` CHECK ((`accion` in (_utf8mb4'ALTA',_utf8mb4'EDICION',_utf8mb4'RESTABLECIMIENTO',_utf8mb4'DESACTIVACION',_utf8mb4'REACTIVACION',_utf8mb4'CAMBIO_DE_CLAVE')))
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bitacora_usuarios`
--

LOCK TABLES `bitacora_usuarios` WRITE;
/*!40000 ALTER TABLE `bitacora_usuarios` DISABLE KEYS */;
INSERT INTO `bitacora_usuarios` VALUES (1,'admin','ALTA','sistema','2026-10-24 13:00:50','Siembra de demostracion con rol ADMINISTRADOR.'),(2,'administracion','ALTA','sistema','2026-10-24 13:00:50','Siembra de demostracion con rol ADMINISTRACION.'),(3,'enfermeria','ALTA','sistema','2026-10-24 13:00:50','Siembra de demostracion con rol ENFERMERIA.'),(4,'farmacia','ALTA','sistema','2026-10-24 13:00:50','Siembra de demostracion con rol FARMACIA.'),(5,'fundacion','ALTA','sistema','2026-10-24 13:00:50','Siembra de demostracion con rol FUNDACION.'),(6,'laboratorio','ALTA','sistema','2026-10-24 13:00:50','Siembra de demostracion con rol LABORATORIO.'),(7,'medico','ALTA','sistema','2026-10-24 13:00:50','Siembra de demostracion con rol MEDICO.');
/*!40000 ALTER TABLE `bitacora_usuarios` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `usuarios`
--

DROP TABLE IF EXISTS `usuarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuarios` (
  `usuario` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rol` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `clave_hash` char(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `debe_cambiar_clave` tinyint(1) NOT NULL DEFAULT '1',
  `clave_temporal_vence` datetime DEFAULT NULL,
  `version_sesion` int NOT NULL DEFAULT '1',
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `creado_en` datetime NOT NULL,
  `creado_por` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `actualizado_en` datetime DEFAULT NULL,
  `actualizado_por` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `desactivado_en` datetime DEFAULT NULL,
  `desactivado_por` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `motivo_desactivacion` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ultimo_ingreso` datetime DEFAULT NULL,
  PRIMARY KEY (`usuario`),
  KEY `idx_usuarios_rol` (`rol`,`activo`),
  CONSTRAINT `ck_usuarios_desactivacion` CHECK ((((`activo` = 1) and (`desactivado_en` is null) and (`desactivado_por` is null) and (`motivo_desactivacion` is null)) or ((`activo` = 0) and (`desactivado_en` is not null) and (`desactivado_por` is not null) and (`motivo_desactivacion` is not null)))),
  CONSTRAINT `ck_usuarios_rol` CHECK ((`rol` in (_utf8mb4'MEDICO',_utf8mb4'ENFERMERIA',_utf8mb4'ADMINISTRACION',_utf8mb4'FUNDACION',_utf8mb4'LABORATORIO',_utf8mb4'FARMACIA',_utf8mb4'ADMINISTRADOR'))),
  CONSTRAINT `ck_usuarios_temporal` CHECK (((`debe_cambiar_clave` = 1) or (`clave_temporal_vence` is null))),
  CONSTRAINT `ck_usuarios_usuario` CHECK (regexp_like(`usuario`,_utf8mb4'^[a-z][a-z0-9._-]{2,31}$',_utf8mb4'c')),
  CONSTRAINT `ck_usuarios_version` CHECK ((`version_sesion` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `usuarios`
--

LOCK TABLES `usuarios` WRITE;
/*!40000 ALTER TABLE `usuarios` DISABLE KEYS */;
INSERT INTO `usuarios` VALUES ('admin','Ing. Dolores Ramirez','ADMINISTRADOR','$2b$10$tjuRELdJTHZhUewPhkCdi.RuYGgVrPYNZVYHL0CEfb9CZ.LfqvKrG',0,NULL,1,1,'2026-10-24 13:00:50','sistema',NULL,NULL,NULL,NULL,NULL,NULL),('administracion','Marta Solis','ADMINISTRACION','$2a$10$TfAfArMu0mKMjiD/R52IHu5jp9a9PDer3s3g5kMK6OrtOr.VTmNgq',0,NULL,1,1,'2026-10-24 13:00:50','sistema',NULL,NULL,NULL,NULL,NULL,NULL),('enfermeria','Enf. Lucia Cabrera','ENFERMERIA','$2a$10$4dBU8uVC5Yk62HMMMBqWi.dQfmAc0v8bSvp37CQzYMu8SohDYJcbW',0,NULL,1,1,'2026-10-24 13:00:50','sistema',NULL,NULL,NULL,NULL,NULL,NULL),('farmacia','Farmacia de la Fundación','FARMACIA','$2a$10$3IGpX6ftQX5n8bgoEhzMXexVVmhowWnmQMCNG5B8NT4uWxNvmvggi',0,NULL,1,1,'2026-10-24 13:00:50','sistema',NULL,NULL,NULL,NULL,NULL,NULL),('fundacion','Fundación Manos Unidas','FUNDACION','$2a$10$/BDMqaJ2vi67RtCQbThF.uJXX8i6tVW7nGEN7DyjyKPXUevmiiJS.',0,NULL,1,1,'2026-10-24 13:00:50','sistema',NULL,NULL,NULL,NULL,NULL,NULL),('laboratorio','Lab. Clínico Central','LABORATORIO','$2a$10$syASm78x1JMgELgNm.tkI.j8/NJNWObuawvAY1/NcAgwLrk7DSvYu',0,NULL,1,1,'2026-10-24 13:00:50','sistema',NULL,NULL,NULL,NULL,NULL,NULL),('medico','Dr. Angel Maltez','MEDICO','$2a$10$3NiJ6wDavB8ZFIq5IQ6sDOh/CTWKtySBpm37iT6hgQOQqXPt8zvC2',0,NULL,1,1,'2026-10-24 13:00:50','sistema',NULL,NULL,NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `usuarios` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed
