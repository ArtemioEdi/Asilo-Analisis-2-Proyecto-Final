-- ===========================================================================
--  Asilo de Ancianos "Cabeza de Algodon" · INSTANCIA DE LA BASE DE DATOS
-- ---------------------------------------------------------------------------
--  Que es: el volcado de las cinco bases del sistema (asilo_vigia,
--  asilo_pastillero, asilo_caja, asilo_consultas y asilo_acceso) tal como
--  quedan recien levantado el stack, con el escenario de demostracion
--  sembrado y sin ningun registro de prueba. Es la instancia que pide la fase
--  de implementacion.
--
--  De donde sale: del commit 03b6547, con
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
INSERT INTO `internos` VALUES ('ASL-007','Tránsito Xicará Tzoc','1874523690902','1947-02-02','FEMENINO','2024-02-02','Depresión mayor con intento previo; requiere vigilancia y control de medicación.','Pabellón B','1','[\"Depresión mayor\", \"Hipertensión arterial\"]','[\"sulfas\"]','[{\"via\": \"oral\", \"dosisMg\": 10, \"farmaco\": \"Enalapril\", \"cadaHoras\": 12, \"principioActivo\": \"enalapril\"}, {\"via\": \"oral\", \"dosisMg\": 50, \"farmaco\": \"Sertralina\", \"cadaHoras\": 24, \"principioActivo\": \"sertralina\"}]','Siembra de demostracion','2026-10-21 19:21:22','Julio Xicará, sobrino','julio.xicara@ejemplo.gt','ACTIVO',NULL,NULL),('ASL-014','Rosalía Menchú Coy','2587412360101','1942-05-11','FEMENINO','2023-05-11','Deterioro cognitivo progresivo; la familia no puede darle atención permanente en casa.','Pabellón A','3','[\"Demencia mixta\", \"Insomnio crónico\"]','[\"penicilina\"]','[{\"via\": \"oral\", \"dosisMg\": 10, \"farmaco\": \"Donepecilo\", \"cadaHoras\": 24, \"principioActivo\": \"donepecilo\"}]','Siembra de demostracion','2026-10-21 19:21:22','María Coy, hija','maria.coy@ejemplo.gt','ACTIVO',NULL,NULL),('ASL-022','Bernardo Puac Ixcoy','1023698740503','1938-09-19','MASCULINO','2022-09-19','Viudo sin red familiar de apoyo; deterioro cognitivo leve y riesgo de caídas.','Pabellón C','2','[\"Deterioro cognitivo leve\", \"Fibrilación auricular\"]','[]','[{\"via\": \"oral\", \"dosisMg\": 5, \"farmaco\": \"Warfarina\", \"cadaHoras\": 24, \"principioActivo\": \"warfarina\"}]','Siembra de demostracion','2026-10-21 19:21:22','Elena Ixcoy, nieta','elena.ixcoy@ejemplo.gt','ACTIVO',NULL,NULL);
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
INSERT INTO `planes` VALUES ('PL-09453532','ASL-014','Rosalia Menchu Coy','donepecilo','Donepecilo',10.00,'oral',24.00,30,'Deterioro cognitivo, dosis nocturna',NULL,'Dr. Angel Maltez','2026-10-21 21:00:00','ACTIVO','2026-10-21 19:21:22'),('PL-1610ECDD','ASL-014','Rosalia Menchu Coy','paracetamol','Paracetamol',500.00,'oral',8.00,5,'Dolor osteoarticular',NULL,'Dr. Angel Maltez','2026-10-21 06:00:00','ACTIVO','2026-10-21 19:21:22'),('PL-2A167004','ASL-007','Transito Xicara Tzoc','enalapril','Enalapril',10.00,'oral',12.00,30,'Hipertension arterial',NULL,'Dr. Angel Maltez','2026-10-21 07:00:00','ACTIVO','2026-10-21 19:21:22'),('PL-A33A8395','ASL-022','Bernardo Puac Ixcoy','atorvastatina','Atorvastatina',20.00,'oral',24.00,30,'Dislipidemia',NULL,'Dr. Angel Maltez','2026-10-21 20:00:00','ACTIVO','2026-10-21 19:21:22'),('PL-CC4331FC','ASL-014','Rosalia Menchu Coy','omeprazol','Omeprazol',20.00,'oral',24.00,30,'Proteccion gastrica en ayunas',NULL,'Dr. Angel Maltez','2026-10-21 07:00:00','ACTIVO','2026-10-21 19:21:22'),('PL-D3BBA168','ASL-007','Transito Xicara Tzoc','sertralina','Sertralina',50.00,'oral',24.00,30,'Depresion mayor',NULL,'Dr. Angel Maltez','2026-10-21 08:00:00','ACTIVO','2026-10-21 19:21:22'),('PL-DD0D6DFC','ASL-022','Bernardo Puac Ixcoy','metformina','Metformina',850.00,'oral',12.00,30,'Diabetes tipo 2',NULL,'Dr. Angel Maltez','2026-10-21 07:00:00','ACTIVO','2026-10-21 19:21:22'),('PL-F5FA2459','ASL-022','Bernardo Puac Ixcoy','warfarina','Warfarina',5.00,'oral',24.00,30,'Fibrilacion auricular, control de INR mensual',NULL,'Dr. Angel Maltez','2026-10-21 18:00:00','ACTIVO','2026-10-21 19:21:22');
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
INSERT INTO `tomas` VALUES ('TM-01EA7F49F0','PL-F5FA2459','ASL-022','2026-10-23 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-0232B2FE80','PL-A33A8395','ASL-022','2026-11-08 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-05648033D7','PL-2A167004','ASL-007','2026-11-01 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-05D0261ACF','PL-D3BBA168','ASL-007','2026-11-14 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-06FE960DB5','PL-A33A8395','ASL-022','2026-11-03 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-07098EC389','PL-F5FA2459','ASL-022','2026-11-01 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-07F07A3FE0','PL-D3BBA168','ASL-007','2026-11-16 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-08220CA05B','PL-09453532','ASL-014','2026-11-01 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-0844DF5703','PL-2A167004','ASL-007','2026-10-27 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-0896DDCA49','PL-2A167004','ASL-007','2026-11-12 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-094FEF60CC','PL-D3BBA168','ASL-007','2026-10-23 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-0A5F4BE98B','PL-DD0D6DFC','ASL-022','2026-11-05 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-0DD021FB73','PL-2A167004','ASL-007','2026-10-27 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-0E2266DCFF','PL-DD0D6DFC','ASL-022','2026-11-11 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-0F13A61870','PL-2A167004','ASL-007','2026-10-25 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-107527CC65','PL-DD0D6DFC','ASL-022','2026-11-15 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-10880C19D8','PL-09453532','ASL-014','2026-10-28 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-1176DF186B','PL-A33A8395','ASL-022','2026-11-14 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-11C93092B4','PL-2A167004','ASL-007','2026-11-08 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-14EC1EC2A2','PL-DD0D6DFC','ASL-022','2026-11-03 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-1785587934','PL-2A167004','ASL-007','2026-11-07 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-193C0662A0','PL-2A167004','ASL-007','2026-11-02 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-1B3C279279','PL-A33A8395','ASL-022','2026-10-28 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-1B8D1A4AA4','PL-DD0D6DFC','ASL-022','2026-10-30 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-1C22F1CA45','PL-F5FA2459','ASL-022','2026-11-12 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-1E72F5E905','PL-A33A8395','ASL-022','2026-11-18 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-1EA27F1A14','PL-DD0D6DFC','ASL-022','2026-10-28 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-1EEC11A650','PL-2A167004','ASL-007','2026-10-26 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-239BF098EE','PL-2A167004','ASL-007','2026-11-05 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-23AB63D08F','PL-2A167004','ASL-007','2026-10-22 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-246391D2A9','PL-A33A8395','ASL-022','2026-11-19 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-254E84BA68','PL-D3BBA168','ASL-007','2026-11-09 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-256EEEBAB0','PL-F5FA2459','ASL-022','2026-10-21 18:00:00','vespertino','ADMINISTRADA','Enf. Lucia Cabrera','Toma sin incidencias','2026-10-21 18:00:00'),('TM-28DF08956E','PL-1610ECDD','ASL-014','2026-10-23 14:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-29B4F09F65','PL-F5FA2459','ASL-022','2026-11-11 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-29D66CAE0B','PL-F5FA2459','ASL-022','2026-11-05 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-29EFB258A3','PL-CC4331FC','ASL-014','2026-11-19 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-2AEBB81B17','PL-2A167004','ASL-007','2026-11-15 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-2AF60D45B5','PL-A33A8395','ASL-022','2026-11-02 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-2DAF0B27DD','PL-CC4331FC','ASL-014','2026-11-12 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-2E2FF99869','PL-2A167004','ASL-007','2026-11-03 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-2E611BEC01','PL-DD0D6DFC','ASL-022','2026-11-09 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-2E726C3FCF','PL-DD0D6DFC','ASL-022','2026-11-14 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-3016904098','PL-DD0D6DFC','ASL-022','2026-11-09 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-30701A9D1E','PL-D3BBA168','ASL-007','2026-11-02 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-3123C0AEA8','PL-D3BBA168','ASL-007','2026-10-21 08:00:00','matutino','ADMINISTRADA','Enf. Lucia Cabrera','Toma sin incidencias','2026-10-21 08:00:00'),('TM-319436C18A','PL-A33A8395','ASL-022','2026-10-26 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-31CD62C0F2','PL-DD0D6DFC','ASL-022','2026-10-26 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-32E2B88E25','PL-DD0D6DFC','ASL-022','2026-11-13 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-33948A010E','PL-2A167004','ASL-007','2026-11-16 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-34D01D3975','PL-CC4331FC','ASL-014','2026-11-16 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-360A26A048','PL-DD0D6DFC','ASL-022','2026-11-05 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-36D654D60F','PL-2A167004','ASL-007','2026-11-01 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-377BC46384','PL-2A167004','ASL-007','2026-11-13 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-3902C2E88D','PL-F5FA2459','ASL-022','2026-10-28 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-3A5A6392E1','PL-09453532','ASL-014','2026-10-24 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-3B591480B1','PL-2A167004','ASL-007','2026-10-28 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-3C5A60983A','PL-1610ECDD','ASL-014','2026-10-21 06:00:00','matutino','ADMINISTRADA','Enf. Lucia Cabrera','Toma sin incidencias','2026-10-21 06:00:00'),('TM-3CB792C261','PL-2A167004','ASL-007','2026-11-02 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-3D015AE49F','PL-09453532','ASL-014','2026-11-03 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-3D277EB433','PL-CC4331FC','ASL-014','2026-11-09 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-3F8E34FA35','PL-2A167004','ASL-007','2026-11-15 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-40A65B5AE8','PL-CC4331FC','ASL-014','2026-10-27 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-40AA464E46','PL-2A167004','ASL-007','2026-10-21 07:00:00','matutino','ADMINISTRADA','Enf. Lucia Cabrera','Toma sin incidencias','2026-10-21 07:00:00'),('TM-422969A322','PL-D3BBA168','ASL-007','2026-10-31 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-4250F09386','PL-DD0D6DFC','ASL-022','2026-10-27 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-4301DD4070','PL-D3BBA168','ASL-007','2026-10-27 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-43717F26FE','PL-A33A8395','ASL-022','2026-10-24 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-43AFA5EB71','PL-09453532','ASL-014','2026-10-29 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-43DADDCEE6','PL-F5FA2459','ASL-022','2026-11-04 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-444D3ACCB7','PL-D3BBA168','ASL-007','2026-11-18 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-45E8AFEFCF','PL-DD0D6DFC','ASL-022','2026-11-11 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-4649DB2BEC','PL-D3BBA168','ASL-007','2026-10-22 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-47F5F3B262','PL-1610ECDD','ASL-014','2026-10-21 14:00:00','vespertino','ADMINISTRADA','Enf. Lucia Cabrera','Toma sin incidencias','2026-10-21 14:00:00'),('TM-4892ED8252','PL-DD0D6DFC','ASL-022','2026-11-06 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-4926361945','PL-DD0D6DFC','ASL-022','2026-10-21 07:00:00','matutino','ADMINISTRADA','Enf. Lucia Cabrera','Toma sin incidencias','2026-10-21 07:00:00'),('TM-49BF527734','PL-DD0D6DFC','ASL-022','2026-10-24 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-49E068B113','PL-1610ECDD','ASL-014','2026-10-24 22:00:00','nocturno','PENDIENTE',NULL,NULL,NULL),('TM-4B33A467E0','PL-F5FA2459','ASL-022','2026-11-17 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-4E5A5CF962','PL-DD0D6DFC','ASL-022','2026-11-19 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-4EF9A9B02D','PL-2A167004','ASL-007','2026-10-31 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-50560DB4EE','PL-DD0D6DFC','ASL-022','2026-11-04 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-5768060379','PL-2A167004','ASL-007','2026-11-17 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-578CD3C1E3','PL-F5FA2459','ASL-022','2026-10-22 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-5859E1C170','PL-DD0D6DFC','ASL-022','2026-11-03 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-589B918F4E','PL-09453532','ASL-014','2026-11-13 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-592921B614','PL-F5FA2459','ASL-022','2026-11-13 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-5941893CC1','PL-D3BBA168','ASL-007','2026-11-11 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-5A998E8811','PL-CC4331FC','ASL-014','2026-11-17 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-5B58773014','PL-2A167004','ASL-007','2026-11-09 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-5BFC8D61C1','PL-2A167004','ASL-007','2026-11-16 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-5C7E8E2DE7','PL-1610ECDD','ASL-014','2026-10-24 06:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-5D4D12CD7B','PL-2A167004','ASL-007','2026-11-10 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-5D99E59556','PL-DD0D6DFC','ASL-022','2026-10-27 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-5E37D40C3D','PL-09453532','ASL-014','2026-10-23 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-5E39A25A74','PL-DD0D6DFC','ASL-022','2026-11-19 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-609530837D','PL-2A167004','ASL-007','2026-10-23 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-60A86E3043','PL-F5FA2459','ASL-022','2026-10-24 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-614AC64293','PL-2A167004','ASL-007','2026-10-30 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-61E7EAB3A6','PL-CC4331FC','ASL-014','2026-11-15 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-628173DA6A','PL-D3BBA168','ASL-007','2026-11-07 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-64C9D7B82C','PL-CC4331FC','ASL-014','2026-11-03 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-6635770689','PL-09453532','ASL-014','2026-11-14 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-664D767B4D','PL-D3BBA168','ASL-007','2026-10-29 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-67F3B15F27','PL-1610ECDD','ASL-014','2026-10-23 22:00:00','nocturno','PENDIENTE',NULL,NULL,NULL),('TM-67F5CDF2A7','PL-DD0D6DFC','ASL-022','2026-11-04 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-69989D0B51','PL-09453532','ASL-014','2026-10-22 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-69B67647E5','PL-A33A8395','ASL-022','2026-11-01 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-69D938B561','PL-A33A8395','ASL-022','2026-11-04 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-6A5B5A9F62','PL-2A167004','ASL-007','2026-10-23 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-6B39B696B5','PL-D3BBA168','ASL-007','2026-11-10 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-6E585FC27F','PL-CC4331FC','ASL-014','2026-11-08 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-701D50DFE5','PL-CC4331FC','ASL-014','2026-11-10 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-71C74C10C4','PL-2A167004','ASL-007','2026-11-11 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-75BC016073','PL-DD0D6DFC','ASL-022','2026-11-16 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-7735940447','PL-CC4331FC','ASL-014','2026-11-05 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-774B0309C9','PL-A33A8395','ASL-022','2026-11-11 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-78BDB0F3B8','PL-09453532','ASL-014','2026-11-05 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-797EBA7CD1','PL-F5FA2459','ASL-022','2026-10-30 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-79C6A92F81','PL-2A167004','ASL-007','2026-10-28 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-79E1A8A5A6','PL-A33A8395','ASL-022','2026-11-12 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-79FABAE6BF','PL-09453532','ASL-014','2026-11-12 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-7A6B9A10ED','PL-DD0D6DFC','ASL-022','2026-11-01 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-7A9C65800B','PL-2A167004','ASL-007','2026-10-25 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-7AAA2391EA','PL-D3BBA168','ASL-007','2026-10-28 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-7AD5A83E71','PL-09453532','ASL-014','2026-10-25 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-7AFB2FCFBA','PL-A33A8395','ASL-022','2026-10-25 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-7B985A351A','PL-2A167004','ASL-007','2026-11-06 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-7C2F777688','PL-09453532','ASL-014','2026-10-27 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-7C9C11B2FC','PL-D3BBA168','ASL-007','2026-11-19 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-7DDEA0AD09','PL-09453532','ASL-014','2026-10-26 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-7F70D13E2D','PL-DD0D6DFC','ASL-022','2026-10-31 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-7F725983E6','PL-CC4331FC','ASL-014','2026-11-02 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-82FDE021FB','PL-CC4331FC','ASL-014','2026-10-23 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-8340E4D8AA','PL-2A167004','ASL-007','2026-11-19 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-8364F41089','PL-D3BBA168','ASL-007','2026-11-03 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-8385F01D42','PL-DD0D6DFC','ASL-022','2026-10-21 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-8399029B26','PL-A33A8395','ASL-022','2026-10-23 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-851EB0FA49','PL-CC4331FC','ASL-014','2026-10-22 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-85349B2EBE','PL-DD0D6DFC','ASL-022','2026-11-15 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-86B1A76DE5','PL-CC4331FC','ASL-014','2026-11-07 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-872031032A','PL-DD0D6DFC','ASL-022','2026-10-31 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-872381F326','PL-D3BBA168','ASL-007','2026-11-06 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-872807B1B6','PL-2A167004','ASL-007','2026-10-24 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-8777A219B9','PL-09453532','ASL-014','2026-11-10 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-87CDF5443C','PL-D3BBA168','ASL-007','2026-11-04 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-87FA5AC26E','PL-2A167004','ASL-007','2026-11-04 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-88C66E1F1B','PL-09453532','ASL-014','2026-11-02 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-8AFAE2F69F','PL-CC4331FC','ASL-014','2026-10-21 07:00:00','matutino','ADMINISTRADA','Enf. Lucia Cabrera','Toma sin incidencias','2026-10-21 07:00:00'),('TM-8D02F975F3','PL-09453532','ASL-014','2026-11-17 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-90F643E661','PL-09453532','ASL-014','2026-11-19 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-93E86EC908','PL-1610ECDD','ASL-014','2026-10-25 06:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-94F8AFD037','PL-A33A8395','ASL-022','2026-11-13 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-9599B7EB2F','PL-A33A8395','ASL-022','2026-11-10 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-968AE0F191','PL-DD0D6DFC','ASL-022','2026-11-18 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-981E89FE7E','PL-09453532','ASL-014','2026-11-04 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-985A667881','PL-09453532','ASL-014','2026-11-06 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-991112FF91','PL-A33A8395','ASL-022','2026-11-09 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-991A3385BC','PL-DD0D6DFC','ASL-022','2026-10-26 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-993F73ECE8','PL-DD0D6DFC','ASL-022','2026-10-22 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-99E8B9E4A8','PL-1610ECDD','ASL-014','2026-10-25 22:00:00','nocturno','PENDIENTE',NULL,NULL,NULL),('TM-9A5EB01F1E','PL-F5FA2459','ASL-022','2026-11-03 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-9ACADA25E5','PL-1610ECDD','ASL-014','2026-10-24 14:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-9D085E4E01','PL-D3BBA168','ASL-007','2026-10-24 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-9F6358DD81','PL-DD0D6DFC','ASL-022','2026-10-29 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-9FC1C3D32D','PL-DD0D6DFC','ASL-022','2026-11-08 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-9FF2FDFC50','PL-2A167004','ASL-007','2026-11-17 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-A0C0B73E0C','PL-CC4331FC','ASL-014','2026-11-01 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-A0CA7EC6AD','PL-F5FA2459','ASL-022','2026-11-02 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-A208C591A8','PL-A33A8395','ASL-022','2026-11-16 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-A230C1FE84','PL-F5FA2459','ASL-022','2026-10-27 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-A3BD773046','PL-DD0D6DFC','ASL-022','2026-10-23 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-A53E1C05FB','PL-A33A8395','ASL-022','2026-11-17 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-A7E4DA1F5B','PL-A33A8395','ASL-022','2026-11-07 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-A8582821BF','PL-D3BBA168','ASL-007','2026-11-13 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-A8BE3A16EE','PL-09453532','ASL-014','2026-11-18 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-A926E56EF4','PL-DD0D6DFC','ASL-022','2026-11-08 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-AA073EF211','PL-2A167004','ASL-007','2026-11-18 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-ADAE12E955','PL-CC4331FC','ASL-014','2026-11-14 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-AF099799D8','PL-A33A8395','ASL-022','2026-11-15 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-AF9BF0AF52','PL-2A167004','ASL-007','2026-10-30 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B13863C159','PL-DD0D6DFC','ASL-022','2026-11-17 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B1AB6AD4FC','PL-2A167004','ASL-007','2026-11-10 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-B33CDCCA00','PL-F5FA2459','ASL-022','2026-11-18 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B34F81EBE4','PL-09453532','ASL-014','2026-11-15 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B461FA3DC9','PL-2A167004','ASL-007','2026-11-09 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B54CBC5BEB','PL-2A167004','ASL-007','2026-10-22 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B54DA4CB08','PL-09453532','ASL-014','2026-10-21 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B5EF4D4BDB','PL-F5FA2459','ASL-022','2026-11-10 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B6CA2EA20B','PL-DD0D6DFC','ASL-022','2026-11-18 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-B72A4FB5E7','PL-CC4331FC','ASL-014','2026-10-28 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-B743AB132E','PL-F5FA2459','ASL-022','2026-11-19 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B75F04334D','PL-F5FA2459','ASL-022','2026-11-07 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B7C54C3FF2','PL-CC4331FC','ASL-014','2026-10-31 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-B81E832F35','PL-A33A8395','ASL-022','2026-10-21 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-B832A85757','PL-2A167004','ASL-007','2026-10-21 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-BBA16B3254','PL-DD0D6DFC','ASL-022','2026-11-02 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-BDFF046547','PL-A33A8395','ASL-022','2026-10-31 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-BE5DB959BD','PL-DD0D6DFC','ASL-022','2026-11-07 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-BE7E9BED10','PL-A33A8395','ASL-022','2026-10-22 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-C1A4754032','PL-1610ECDD','ASL-014','2026-10-22 06:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-C2600AB73C','PL-D3BBA168','ASL-007','2026-10-26 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-C33A4BB925','PL-09453532','ASL-014','2026-10-30 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-C3E561658B','PL-DD0D6DFC','ASL-022','2026-10-29 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-C46DE4B396','PL-D3BBA168','ASL-007','2026-10-25 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-C5E74DB73A','PL-2A167004','ASL-007','2026-11-06 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-C5F42FB377','PL-1610ECDD','ASL-014','2026-10-22 22:00:00','nocturno','PENDIENTE',NULL,NULL,NULL),('TM-C611995725','PL-A33A8395','ASL-022','2026-11-06 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-C69F44F34E','PL-DD0D6DFC','ASL-022','2026-10-28 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-C72791AF90','PL-F5FA2459','ASL-022','2026-10-26 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-C8A57E4C30','PL-A33A8395','ASL-022','2026-10-27 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-C9BD1A41D0','PL-2A167004','ASL-007','2026-11-14 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-CA531EEC2B','PL-09453532','ASL-014','2026-11-09 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-CA53E6B35F','PL-2A167004','ASL-007','2026-11-18 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-CAA140136E','PL-2A167004','ASL-007','2026-10-24 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-CB2FD4D6DE','PL-DD0D6DFC','ASL-022','2026-11-17 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-CBAF0AA83A','PL-1610ECDD','ASL-014','2026-10-23 06:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-CD4DF4526D','PL-DD0D6DFC','ASL-022','2026-11-10 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-CE961CEC59','PL-09453532','ASL-014','2026-11-08 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-CEA39822EA','PL-DD0D6DFC','ASL-022','2026-11-02 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-CEE4CE37E9','PL-1610ECDD','ASL-014','2026-10-22 14:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-CF37569425','PL-2A167004','ASL-007','2026-11-05 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-D0B41B5820','PL-DD0D6DFC','ASL-022','2026-10-30 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-D110BBE40F','PL-2A167004','ASL-007','2026-11-19 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-D32C64FC42','PL-F5FA2459','ASL-022','2026-11-09 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-D35E7967EF','PL-DD0D6DFC','ASL-022','2026-11-14 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-D41B770AE1','PL-A33A8395','ASL-022','2026-10-30 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-D585DD7A6D','PL-DD0D6DFC','ASL-022','2026-11-10 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-D813307DD6','PL-CC4331FC','ASL-014','2026-10-29 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-D89C9B3691','PL-DD0D6DFC','ASL-022','2026-10-22 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-DA896DA28D','PL-CC4331FC','ASL-014','2026-10-26 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-DBA30783D6','PL-DD0D6DFC','ASL-022','2026-11-12 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-DBB83C49A4','PL-D3BBA168','ASL-007','2026-10-30 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-DD4B54AC77','PL-CC4331FC','ASL-014','2026-11-13 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-DE51BCD3A0','PL-D3BBA168','ASL-007','2026-11-15 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-DE6FB656E1','PL-A33A8395','ASL-022','2026-10-29 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-DED5869656','PL-A33A8395','ASL-022','2026-11-05 20:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-DF26D63FF2','PL-DD0D6DFC','ASL-022','2026-11-06 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-DF756B6C75','PL-F5FA2459','ASL-022','2026-11-15 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-DFD310FB74','PL-09453532','ASL-014','2026-10-31 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-E011F856C9','PL-2A167004','ASL-007','2026-11-04 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-E1551C2E14','PL-CC4331FC','ASL-014','2026-11-04 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-E16B163247','PL-D3BBA168','ASL-007','2026-11-17 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-E1875AE415','PL-CC4331FC','ASL-014','2026-10-25 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-E2E2BA981E','PL-2A167004','ASL-007','2026-11-12 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-E302566CA9','PL-F5FA2459','ASL-022','2026-11-08 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-E39E015E79','PL-D3BBA168','ASL-007','2026-11-05 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-E3DC05A9F6','PL-2A167004','ASL-007','2026-10-29 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-E3E656949A','PL-2A167004','ASL-007','2026-10-31 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-E46BA7CA71','PL-2A167004','ASL-007','2026-11-03 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-E485C87B6B','PL-DD0D6DFC','ASL-022','2026-11-12 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-E55491F760','PL-D3BBA168','ASL-007','2026-11-12 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-E556619CC0','PL-F5FA2459','ASL-022','2026-10-29 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-E563F7B2FA','PL-F5FA2459','ASL-022','2026-11-16 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-E5703F5527','PL-D3BBA168','ASL-007','2026-11-08 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-E7095F6497','PL-2A167004','ASL-007','2026-11-11 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-E7B84C926A','PL-F5FA2459','ASL-022','2026-10-25 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-E877764DB9','PL-2A167004','ASL-007','2026-11-07 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-E9CBE48DD6','PL-DD0D6DFC','ASL-022','2026-10-24 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-EACFFC5B9A','PL-CC4331FC','ASL-014','2026-10-30 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-EAE58881F7','PL-DD0D6DFC','ASL-022','2026-10-23 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-EC845D742C','PL-F5FA2459','ASL-022','2026-11-06 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-ED5C7C991A','PL-09453532','ASL-014','2026-11-11 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-ED729B6F22','PL-2A167004','ASL-007','2026-11-08 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-ED99B7B3D0','PL-DD0D6DFC','ASL-022','2026-10-25 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-EE77BDF36B','PL-CC4331FC','ASL-014','2026-11-11 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-EEA8567CD2','PL-2A167004','ASL-007','2026-11-14 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-F04EDC89A5','PL-DD0D6DFC','ASL-022','2026-10-25 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-F0A15F0246','PL-2A167004','ASL-007','2026-10-26 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-F18A89925D','PL-F5FA2459','ASL-022','2026-11-14 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-F5253D6264','PL-CC4331FC','ASL-014','2026-11-18 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-F566ADEAAA','PL-09453532','ASL-014','2026-11-07 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-F5C8698DD1','PL-09453532','ASL-014','2026-11-16 21:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-F611DB45B3','PL-1610ECDD','ASL-014','2026-10-21 22:00:00','nocturno','PENDIENTE',NULL,NULL,NULL),('TM-F6E8CE1A0E','PL-CC4331FC','ASL-014','2026-11-06 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-F7D36130D4','PL-CC4331FC','ASL-014','2026-10-24 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-F9C10A7209','PL-DD0D6DFC','ASL-022','2026-11-07 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-FAD4D2FBE8','PL-D3BBA168','ASL-007','2026-11-01 08:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-FAD734D95D','PL-2A167004','ASL-007','2026-10-29 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-FB6CB11668','PL-2A167004','ASL-007','2026-11-13 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-FBAD8A1F71','PL-DD0D6DFC','ASL-022','2026-11-01 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL),('TM-FCC5AA17D8','PL-1610ECDD','ASL-014','2026-10-25 14:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-FE768DDE3C','PL-F5FA2459','ASL-022','2026-10-31 18:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-FEFEA8CC73','PL-DD0D6DFC','ASL-022','2026-11-13 19:00:00','vespertino','PENDIENTE',NULL,NULL,NULL),('TM-FF6A38ABC4','PL-DD0D6DFC','ASL-022','2026-11-16 07:00:00','matutino','PENDIENTE',NULL,NULL,NULL);
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
INSERT INTO `cargos` VALUES ('CG-313A0384','ASL-014','Rosalia Menchu Coy','CONSULTA','Valoracion por psiquiatria geriatrica','consulta-especialista',350.00,55.00,157.50,157.50,'PAGADO','Marta Solis, administracion','2026-10-09 19:21:16',NULL,NULL),('CG-39E4C52B','ASL-007','Transito Xicara Tzoc','CONSULTA','Control de presion arterial','consulta-general',150.00,60.00,60.00,60.00,'PAGADO','Marta Solis, administracion','2026-10-16 19:21:16',NULL,NULL),('CG-48ADD10F','ASL-022','Bernardo Puac Ixcoy','FARMACIA','Atorvastatina, caja mensual','farmacia-especializado',220.00,40.00,132.00,0.00,'PENDIENTE','Marta Solis, administracion','2026-10-18 19:21:16',NULL,NULL),('CG-509096A3','ASL-022','Bernardo Puac Ixcoy','LABORATORIO','Control de INR por warfarina','laboratorio-basico',280.00,50.00,140.00,0.00,'PENDIENTE','Marta Solis, administracion','2026-10-18 19:21:16',NULL,NULL),('CG-5C020E5F','ASL-014','Rosalia Menchu Coy','CUOTA','Cuota mensual de estadia 2026-10','cuota-mensual',450.00,0.00,450.00,450.00,'PAGADO','Marta Solis, administracion','2026-10-01 19:21:16',NULL,'2026-10'),('CG-60D2A335','ASL-014','Rosalia Menchu Coy','LABORATORIO','Perfil metabolico de control','laboratorio-basico',280.00,50.00,140.00,0.00,'PENDIENTE','Marta Solis, administracion','2026-10-09 19:21:16',NULL,NULL),('CG-D4FB3425','ASL-022','Bernardo Puac Ixcoy','CUOTA','Cuota mensual de estadia 2026-10','cuota-mensual',450.00,0.00,450.00,450.00,'PAGADO','Marta Solis, administracion','2026-10-01 19:21:16',NULL,'2026-10'),('CG-DEMO0001','ASL-022','Bernardo Puac Ixcoy','LABORATORIO','Tiempo de protrombina e INR (visita VM-2026-DEMO0022)','laboratorio-basico',280.00,50.00,140.00,0.00,'PENDIENTE','Dr. Rolando Sicajau','2026-10-12 19:21:16','VM-2026-DEMO0022',NULL),('CG-DEMO0002','ASL-022','Bernardo Puac Ixcoy','LABORATORIO','Electrocardiograma de 12 derivaciones (visita VM-2026-DEMO0022)','laboratorio-imagen',420.00,45.00,231.00,0.00,'PENDIENTE','Dr. Rolando Sicajau','2026-10-12 19:21:16','VM-2026-DEMO0022',NULL),('CG-DEMO0003','ASL-022','Bernardo Puac Ixcoy','FARMACIA','Warfarina 5.00 mg (indicacion IN-2026-DEMO0001)','farmacia-generico',60.00,65.00,21.00,0.00,'PENDIENTE','Farmacia de la Fundación','2026-10-12 19:21:16','VM-2026-DEMO0022',NULL),('CG-FCFE79CA','ASL-007','Transito Xicara Tzoc','CUOTA','Cuota mensual de estadia 2026-10','cuota-mensual',450.00,0.00,450.00,0.00,'PENDIENTE','Marta Solis, administracion','2026-10-01 19:21:16',NULL,'2026-10');
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
INSERT INTO `donaciones` VALUES ('DN-0FFFC3D6','HelpAge International','EMPRESA_INTERNACIONAL',7200.00,'equipamiento','Marta Solis, administracion','2026-09-20 19:21:16'),('DN-7D331876','Municipalidad de Mazatenango','GOBIERNO',3500.00,'insumos medicos','Marta Solis, administracion','2026-10-03 19:21:16'),('DN-80C0C108','Fundacion Amigos del Adulto Mayor','EMPRESA_NACIONAL',5000.00,'fondo general','Marta Solis, administracion','2026-09-26 19:21:16'),('DN-ABAE7F59','Familia Coy Menchu','PARTICULAR',400.00,'fondo general','Marta Solis, administracion','2026-10-15 19:21:16');
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
INSERT INTO `gastos` VALUES ('GT-4221427D','Agua potable del mes','SERVICIOS',210.00,'Marta Solis, administracion','2026-10-06 19:21:16'),('GT-7F18D60C','Energia electrica del mes','SERVICIOS',890.00,'Marta Solis, administracion','2026-10-06 19:21:16'),('GT-83609726','Insumos de curacion y limpieza','INSUMOS',640.00,'Marta Solis, administracion','2026-10-12 19:21:16');
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
INSERT INTO `pagos` VALUES ('PG-088DD709','CG-D4FB3425','ASL-022',450.00,'efectivo','Marta Solis, administracion','2026-10-01 19:21:16'),('PG-0B91C3FE','CG-5C020E5F','ASL-014',450.00,'efectivo','Marta Solis, administracion','2026-10-01 19:21:16'),('PG-17BEB1D0','CG-39E4C52B','ASL-007',60.00,'efectivo','Marta Solis, administracion','2026-10-16 19:21:16'),('PG-578F429E','CG-313A0384','ASL-014',157.50,'efectivo','Marta Solis, administracion','2026-10-09 19:21:16');
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
INSERT INTO `pagos_fundacion` VALUES ('PF-A50666FE',800.00,'Abono de consultas y laboratorios de julio','Marta Solis, administracion','2026-10-11 19:21:16');
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
INSERT INTO `correos_enviados` VALUES ('CO-2026-DEMO0007','SOL-2026-DEMO0007','julio.xicara@ejemplo.gt','Asilo Cabeza de Algodon · Tránsito Xicará Tzoc fue remitido a Cardiologia','Estimado/a Julio Xicará, sobrino:\n\nLe escribimos del Asilo de Ancianos \"Cabeza de Algodon\" para informarle\nque su familiar Tránsito Xicará Tzoc (ASL-007) fue remitido a una consulta con especialista.\n\n  Numero de solicitud : SOL-2026-DEMO0007\n  Especialidad        : Cardiologia\n  Motivo              : Cifras de presion arterial elevadas en los ultimos tres controles, pese al tratamiento con enalapril.\n  Remitido por        : Dr. Angel Maltez\n  Fecha de la remision: 19/10/2026 a las 19:00\n  Estado actual       : PENDIENTE de que la fundacion le asigne medico y hora\n\nLo acompaña: Enf. Lucia Tzoc.\n\nCuando la fundacion le asigne medico, fecha y hora, se le informara el\ndetalle de la cita. Si necesita acompañar a su familiar ese dia, puede\ncomunicarse con la administracion del asilo.\n\nAtentamente,\nAsilo de Ancianos \"Cabeza de Algodon\"\nMazatenango, Suchitepequez\n','2026-10-19 19:00:00','REGISTRADO'),('CO-2026-DEMO0014','SOL-2026-DEMO0014','maria.coy@ejemplo.gt','Asilo Cabeza de Algodon · Rosalía Menchú Coy fue remitido a Psiquiatria','Estimado/a María Coy, hija:\n\nLe escribimos del Asilo de Ancianos \"Cabeza de Algodon\" para informarle\nque su familiar Rosalía Menchú Coy (ASL-014) fue remitido a una consulta con especialista.\n\n  Numero de solicitud : SOL-2026-DEMO0014\n  Especialidad        : Psiquiatria\n  Motivo              : Agitacion nocturna que no cede con el ajuste de la rutina de sueño.\n  Remitido por        : Dr. Angel Maltez\n  Fecha de la remision: 17/10/2026 a las 19:00\n  Estado actual       : PENDIENTE de que la fundacion le asigne medico y hora\n\nLo acompaña: Enf. Lucia Tzoc.\n\nCuando la fundacion le asigne medico, fecha y hora, se le informara el\ndetalle de la cita. Si necesita acompañar a su familiar ese dia, puede\ncomunicarse con la administracion del asilo.\n\nAtentamente,\nAsilo de Ancianos \"Cabeza de Algodon\"\nMazatenango, Suchitepequez\n','2026-10-17 19:00:00','REGISTRADO'),('CO-2026-DEMO0022','SOL-2026-DEMO0022','elena.ixcoy@ejemplo.gt','Asilo Cabeza de Algodon · Bernardo Puac Ixcoy fue remitido a Cardiologia','Estimado/a Elena Ixcoy, nieta:\n\nLe escribimos del Asilo de Ancianos \"Cabeza de Algodon\" para informarle\nque su familiar Bernardo Puac Ixcoy (ASL-022) fue remitido a una consulta con especialista.\n\n  Numero de solicitud : SOL-2026-DEMO0022\n  Especialidad        : Cardiologia\n  Motivo              : Control de anticoagulacion por fibrilacion auricular.\n  Remitido por        : Dr. Angel Maltez\n  Fecha de la remision: 09/10/2026 a las 19:00\n  Estado actual       : PENDIENTE de que la fundacion le asigne medico y hora\n\nLo acompaña: Enf. Lucia Tzoc.\n\nCuando la fundacion le asigne medico, fecha y hora, se le informara el\ndetalle de la cita. Si necesita acompañar a su familiar ese dia, puede\ncomunicarse con la administracion del asilo.\n\nAtentamente,\nAsilo de Ancianos \"Cabeza de Algodon\"\nMazatenango, Suchitepequez\n','2026-10-09 19:00:00','REGISTRADO');
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
INSERT INTO `examenes` VALUES ('EX-2026-DEMO0001','VM-2026-DEMO0022','Tiempo de protrombina e INR','2026-10-12 08:45:00','RESULTADO_LISTO','INR 2.4, dentro del rango terapeutico de 2.0 a 3.0. Sin ajuste de dosis.','2026-10-12 14:00:00','Lab. Clínico Central','CG-DEMO0001'),('EX-2026-DEMO0002','VM-2026-DEMO0022','Electrocardiograma de 12 derivaciones','2026-10-12 08:45:00','RESULTADO_LISTO','Fibrilacion auricular con respuesta ventricular controlada, 78 por minuto.','2026-10-12 14:00:00','Lab. Clínico Central','CG-DEMO0002');
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
INSERT INTO `indicaciones` VALUES ('IN-2026-DEMO0001','VM-2026-DEMO0022','warfarina','Warfarina',5.00,24.00,30,'Por la noche, siempre a la misma hora. No cambiar la dosis sin control de INR.',1,'2026-10-12 15:00:00','Farmacia de la Fundación','CG-DEMO0003');
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
INSERT INTO `solicitudes` VALUES ('SOL-2026-DEMO0007','ASL-007','Tránsito Xicará Tzoc','Cifras de presion arterial elevadas en los ultimos tres controles, pese al tratamiento con enalapril.','Cardiologia','Enf. Lucia Tzoc','Dr. Angel Maltez','2026-10-19 19:00:00','PENDIENTE',NULL,NULL,NULL,NULL),('SOL-2026-DEMO0014','ASL-014','Rosalía Menchú Coy','Agitacion nocturna que no cede con el ajuste de la rutina de sueño.','Psiquiatria','Enf. Lucia Tzoc','Dr. Angel Maltez','2026-10-17 19:00:00','AGENDADA','Dra. Silvia Racancoj','Psiquiatria','2026-10-22 09:00:00','Fundación Manos Unidas'),('SOL-2026-DEMO0022','ASL-022','Bernardo Puac Ixcoy','Control de anticoagulacion por fibrilacion auricular.','Cardiologia','Enf. Lucia Tzoc','Dr. Angel Maltez','2026-10-09 19:00:00','ATENDIDA','Dr. Rolando Sicajau','Cardiologia','2026-10-12 08:00:00','Fundación Manos Unidas');
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
INSERT INTO `visitas` VALUES ('VM-2026-DEMO0022','SOL-2026-DEMO0022','ASL-022','2026-10-12 08:30:00','Control de anticoagulacion por fibrilacion auricular.','Dr. Rolando Sicajau','Cardiologia','Fibrilacion auricular permanente, con anticoagulacion en rango terapeutico y frecuencia ventricular controlada.','Se mantiene la warfarina a la dosis actual y se surte la receta del mes. Control de INR en cuatro semanas y vigilancia de signos de sangrado.','CERRADA','2026-10-12 19:00:00',NULL);
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
INSERT INTO `bitacora_usuarios` VALUES (1,'admin','ALTA','sistema','2026-10-21 19:21:10','Siembra inicial con rol ADMINISTRADOR.'),(2,'administracion','ALTA','sistema','2026-10-21 19:21:10','Siembra inicial con rol ADMINISTRACION.'),(3,'enfermeria','ALTA','sistema','2026-10-21 19:21:10','Siembra inicial con rol ENFERMERIA.'),(4,'farmacia','ALTA','sistema','2026-10-21 19:21:10','Siembra inicial con rol FARMACIA.'),(5,'fundacion','ALTA','sistema','2026-10-21 19:21:10','Siembra inicial con rol FUNDACION.'),(6,'laboratorio','ALTA','sistema','2026-10-21 19:21:10','Siembra inicial con rol LABORATORIO.'),(7,'medico','ALTA','sistema','2026-10-21 19:21:10','Siembra inicial con rol MEDICO.');
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
INSERT INTO `usuarios` VALUES ('admin','Ing. Dolores Ramirez','ADMINISTRADOR','$2b$10$tjuRELdJTHZhUewPhkCdi.RuYGgVrPYNZVYHL0CEfb9CZ.LfqvKrG',0,NULL,1,1,'2026-10-21 19:21:10','sistema',NULL,NULL,NULL,NULL,NULL,NULL),('administracion','Marta Solis','ADMINISTRACION','$2a$10$TfAfArMu0mKMjiD/R52IHu5jp9a9PDer3s3g5kMK6OrtOr.VTmNgq',0,NULL,1,1,'2026-10-21 19:21:10','sistema',NULL,NULL,NULL,NULL,NULL,NULL),('enfermeria','Enf. Lucia Cabrera','ENFERMERIA','$2a$10$4dBU8uVC5Yk62HMMMBqWi.dQfmAc0v8bSvp37CQzYMu8SohDYJcbW',0,NULL,1,1,'2026-10-21 19:21:10','sistema',NULL,NULL,NULL,NULL,NULL,NULL),('farmacia','Farmacia de la Fundación','FARMACIA','$2a$10$3IGpX6ftQX5n8bgoEhzMXexVVmhowWnmQMCNG5B8NT4uWxNvmvggi',0,NULL,1,1,'2026-10-21 19:21:10','sistema',NULL,NULL,NULL,NULL,NULL,NULL),('fundacion','Fundación Manos Unidas','FUNDACION','$2a$10$/BDMqaJ2vi67RtCQbThF.uJXX8i6tVW7nGEN7DyjyKPXUevmiiJS.',0,NULL,1,1,'2026-10-21 19:21:10','sistema',NULL,NULL,NULL,NULL,NULL,NULL),('laboratorio','Lab. Clínico Central','LABORATORIO','$2a$10$syASm78x1JMgELgNm.tkI.j8/NJNWObuawvAY1/NcAgwLrk7DSvYu',0,NULL,1,1,'2026-10-21 19:21:10','sistema',NULL,NULL,NULL,NULL,NULL,NULL),('medico','Dr. Angel Maltez','MEDICO','$2a$10$3NiJ6wDavB8ZFIq5IQ6sDOh/CTWKtySBpm37iT6hgQOQqXPt8zvC2',0,NULL,1,1,'2026-10-21 19:21:10','sistema',NULL,NULL,NULL,NULL,NULL,NULL);
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
