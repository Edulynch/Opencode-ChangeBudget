# ChangeBudget — Constitución, Alcance y Roadmap de Specs

**Estado:** Draft inicial para ejecución con Spec-Kit  
**Orientación:** Herramienta personal, local-first, OpenCode-first  
**Objetivo principal:** Evitar que agentes de programación amplíen innecesariamente el alcance de tareas pequeñas o medianas.  
**Modelo de desarrollo inicial:** GPT-5.3-Codex-Spark como ejecutor principal  
**Licencia/publicación:** Proyecto privado inicialmente. La posibilidad de open source se evaluará en el futuro y no condiciona el diseño del MVP.

---

# 1. Constitución del proyecto

Esta constitución define las reglas que prevalecen sobre cualquier spec, plan, task, refactor o sugerencia futura. Si una propuesta contradice estos principios, debe rechazarse o requerir una modificación explícita de la constitución.

## Principio I — Local-first y sin infraestructura innecesaria

ChangeBudget debe ejecutarse localmente sobre repositorios Git.

- No requiere backend, base de datos remota, autenticación, cuentas, Firebase, Docker ni servicios cloud para su funcionamiento normal.
- El estado persistente del proyecto debe almacenarse en archivos locales pequeños y versionables cuando corresponda.
- No se introduce infraestructura “por si acaso”.

**Razón:** La herramienta existe para reducir complejidad, no para crear otra plataforma que administrar.

## Principio II — El core es determinista

Las decisiones de cumplimiento del contrato deben derivarse de reglas verificables: Git diff, rutas, límites, archivos protegidos, cambios de dependencias y otras políticas explícitas.

- Un LLM no decide si un cambio está dentro o fuera de presupuesto.
- Una futura función asistida por IA puede sugerir un presupuesto, pero no reemplazar la validación determinista.
- Ante ambigüedad, la herramienta informa y solicita decisión humana; no inventa intención.

## Principio III — Control de scope antes que automatización

La función principal de ChangeBudget es controlar el alcance de un cambio.

Debe priorizar:

1. qué puede modificarse;
2. cuánto puede modificarse;
3. qué requiere autorización;
4. qué está prohibido;
5. qué ocurrió realmente.

Funciones como dashboards, administración de equipos, nube, analytics, marketplace o colaboración multiusuario quedan fuera mientras no sean indispensables para esta misión.

## Principio IV — Git es la fuente de verdad del cambio

ChangeBudget debe basar sus comprobaciones en el estado real del repositorio.

- El commit/base seleccionado define el punto de comparación.
- El diff real tiene prioridad sobre lo que el agente afirma haber modificado.
- La herramienta nunca considera exitoso un cambio solo porque el agente lo declara exitoso.

## Principio V — Nunca destruir trabajo silenciosamente

ChangeBudget puede bloquear, advertir y recomendar revertir, pero no debe eliminar o revertir automáticamente trabajo del usuario sin una acción explícita.

- Ningún `check` puede modificar el working tree.
- Ninguna violación implica auto-revert por defecto.
- Las acciones destructivas futuras deben ser explícitas y claramente diferenciadas.

## Principio VI — OpenCode-first, core agnóstico

La primera integración de agente será OpenCode porque es el flujo principal de uso.

Sin embargo:

- el motor de reglas no puede depender internamente de OpenCode;
- el CLI debe funcionar de forma independiente;
- integrar otros agentes en el futuro no debe obligar a reescribir el core.

Esto no implica construir soporte multiagente en el MVP.

## Principio VII — Complejidad proporcional al riesgo

Las tareas pequeñas deben tener un camino pequeño.

- Una modificación localizada no debe requerir ceremonias equivalentes a una feature arquitectónica.
- Los tests deben ser proporcionales al riesgo del cambio.
- La suite completa se reserva para milestones, cambios transversales o cuando la spec lo exija.
- Una task de bajo riesgo debe poder completarse mediante implementación + validación dirigida.

## Principio VIII — Dependencias mínimas

Cada dependencia nueva necesita una razón concreta.

Preferencias:

- APIs estándar de Node.js/Bun cuando sean suficientes;
- Git CLI como mecanismo de inspección del repositorio;
- librerías pequeñas solo cuando eviten una cantidad relevante de código frágil.

No se adoptará un framework grande para resolver una necesidad pequeña.

## Principio IX — Privacidad y cero telemetría por defecto

ChangeBudget no debe enviar código, diffs, rutas, nombres de proyectos ni estadísticas a terceros.

- Sin telemetry por defecto.
- Sin analytics silenciosos.
- Sin llamadas de red necesarias para validar un contrato.

## Principio X — Dogfooding obligatorio

Una vez que el MVP pueda vigilar su propio repositorio, ChangeBudget debe utilizarse para desarrollar ChangeBudget.

Las specs posteriores deben intentar ejecutarse bajo contratos reales de ChangeBudget. Los problemas encontrados durante este uso son evidencia prioritaria para mejorar el producto.

## Principio XI — No construir para un hipotético producto comercial

El proyecto se optimiza para uso personal.

- No introducir multi-tenancy, billing, cuentas, onboarding comercial ni compatibilidad masiva.
- Las decisiones deben maximizar utilidad personal y mantenibilidad.
- Una futura publicación open source será una consecuencia de la madurez del proyecto, no un requisito inicial.

## Principio XII — Spec-Kit debe reducir incertidumbre, no aumentar burocracia

Spec-Kit se utiliza para features/milestones que realmente requieren definición.

- No se crea una spec nueva para correcciones triviales.
- `clarify` se ejecuta solo cuando existen ambigüedades materiales.
- `analyze` debe usarse como gate previo a implementación o cuando haya señales concretas de inconsistencia, no como ciclo infinito.
- Las tasks deben ser pequeñas, verificables y con scope explícito.
- No se amplía una spec durante implementación salvo bloqueo real y documentado.

### Regla de fast path

Cuando una tarea sea localizada, reversible y de bajo riesgo, el camino preferido es:

`contract → implement → targeted validation → check → close`

No:

`specify → clarify → plan → tasks → analyze → implement → analyze → más tests → refactor no solicitado`

## Gobierno de la constitución

- Cualquier spec puede ser rechazada por violar esta constitución.
- Modificar un principio requiere una decisión explícita y documentada.
- Las excepciones temporales deben indicar motivo, alcance y cuándo dejan de aplicar.
- Si una regla de una spec contradice la constitución, prevalece la constitución.

---

# 2. Alcance del proyecto

## 2.1 Objetivo

Construir una herramienta CLI local que permita definir un **Change Contract** para una tarea, observar el cambio real en Git y determinar de forma determinista si el agente respetó el alcance autorizado.

ChangeBudget debe responder principalmente:

- ¿Qué archivos tenía permitido tocar la tarea?
- ¿Qué archivos tocó realmente?
- ¿Cuánto cambió?
- ¿Tocó archivos sensibles?
- ¿Introdujo dependencias, migraciones o configuración fuera del contrato?
- ¿El cambio sigue dentro del presupuesto?
- ¿Puede continuar, requiere reparación o requiere revisión humana?

## 2.2 Alcance funcional aprobado

El roadmap puede implementar gradualmente:

- inicialización local por repositorio;
- contratos de cambio;
- presets de presupuesto;
- selección de una base Git;
- conteo de archivos y líneas modificadas;
- allow/deny de rutas;
- archivos sensibles/protegidos;
- detección de archivos nuevos, eliminados y renombrados;
- detección de cambios de dependencias;
- detección de migraciones/configuración sensible mediante reglas explícitas;
- estados PASS / WARN / FAIL o equivalentes definidos por spec;
- reportes legibles y exit codes para automatización;
- integración con OpenCode para guardrails durante ejecución;
- políticas personales por stack: Android, Flutter, Spring Boot y Node/TypeScript;
- integración posterior con tasks de Spec-Kit;
- modo de diagnóstico para recomendar un presupuesto sin modificar archivos;
- histórico local mínimo si demuestra valor real.

## 2.3 Fuera de alcance

No forman parte del proyecto, salvo cambio explícito de constitución/roadmap:

- backend;
- SaaS;
- aplicación móvil;
- dashboard web;
- cuentas de usuario;
- sincronización cloud;
- equipos/organizaciones;
- billing;
- marketplace;
- administración remota de agentes;
- ejecución remota de código;
- reemplazar Git;
- reemplazar Spec-Kit;
- construir otro IDE;
- construir un sandbox completo de sistema operativo;
- revisión semántica automática del código mediante LLM como fuente de verdad;
- auto-revert silencioso;
- soporte inicial para múltiples agentes además de OpenCode;
- métricas/telemetría enviadas a terceros.

## 2.4 Stack objetivo

**Inicial:**

- TypeScript
- Node.js como runtime de referencia
- Git CLI
- configuración local JSON/YAML, seleccionada durante SPEC-001
- test runner liviano del ecosistema elegido
- plugin OpenCode únicamente cuando se alcance SPEC-004

**Restricción:** Añadir una tecnología nueva requiere demostrar que resuelve una necesidad de la spec activa.

---

# 3. Modelo conceptual

## Change Contract

Un Change Contract representa la autorización vigente para una tarea.

Ejemplo conceptual:

```yaml
task: "Fix empty playlist crash"
base: "HEAD"

budget:
  max_files: 4
  max_changed_lines: 180

allow:
  - "lib/features/player/**"
  - "test/features/player/**"

deny:
  - "pubspec.yaml"
  - "android/**"
  - "ios/**"

rules:
  new_dependencies: false
  migrations: false
  public_api_changes: false
```

El formato final se define en la spec correspondiente; este ejemplo solo expresa el concepto.

## Estados conceptuales

- **PASS:** el cambio respeta el contrato.
- **WARN/REVIEW:** el cambio necesita decisión humana, pero no implica necesariamente un error.
- **FAIL/REPAIR:** existe al menos una violación concreta del contrato.

Los nombres definitivos y exit codes se fijarán en SPEC-003.

---

# 4. Roadmap general

| Orden | Spec | Resultado principal | Versión objetivo |
|---|---|---|---|
| 1 | SPEC-001 — Contract Lifecycle | Crear, iniciar, consultar y cerrar contratos locales | v0.1 |
| 2 | SPEC-002 — Git Budget Engine | Medir diff real y validar presupuesto/rutas | v0.1 |
| 3 | SPEC-003 — Policy Results & Reports | Resultados deterministas, reportes y exit codes | v0.1 |
| 4 | SPEC-004 — OpenCode Runtime Guard | Advertir/bloquear acciones durante la ejecución | v0.2 |
| 5 | SPEC-005 — Personal Stack Policies | Presets Android, Flutter, Spring y Node/TS | v0.3 |
| 6 | SPEC-006 — Spec-Kit Task Bridge | Contratos asociados a `Txxx` y fast path | v0.4 |
| 7 | SPEC-007 — Diagnose & Budget Advisor | Estimar scope recomendado sin modificar código | v0.5 |
| 8 | SPEC-008 — Dogfood & Hardening | Usarlo en proyectos reales y cerrar gaps de robustez | v1.0 |

### Dependencia principal

`SPEC-001 → SPEC-002 → SPEC-003 → SPEC-004 → SPEC-005 → SPEC-006 → SPEC-007 → SPEC-008`

No todas las dependencias son técnicamente estrictas, pero este orden reduce retrabajo y evita construir integración antes de estabilizar el core.

---

# 5. Specs detalladas

## SPEC-001 — Local Change Contract Lifecycle

### Propósito

Crear el ciclo de vida mínimo de un contrato local sin validar todavía todo el diff.

### Problema

Necesitamos una representación persistente y predecible de “qué está autorizado” antes de poder medir cumplimiento.

### Scope

Debe cubrir:

- `changebudget init`;
- `changebudget start`;
- `changebudget status`;
- `changebudget close`;
- almacenamiento local del contrato activo;
- identificación del repositorio;
- selección/registro de base Git;
- presets iniciales `tiny`, `normal` y `free`;
- protección contra dos contratos activos incompatibles en el mismo repo;
- lectura de configuración sin mutar el working tree.

### No incluye

- validación completa de Git diff;
- plugin OpenCode;
- detección por stack;
- integración Spec-Kit;
- IA;
- histórico avanzado.

### Criterios de salida

- Un repositorio puede inicializar ChangeBudget.
- Se puede abrir exactamente un contrato activo.
- `status` representa fielmente el contrato vigente.
- `close` finaliza el contrato sin modificar código del proyecto.
- Un contrato inválido produce error explícito y no deja estado parcial.
- Las operaciones básicas tienen tests automatizados.

### Riesgo

**Bajo/medio.** La decisión más importante es el formato y ubicación del estado local.

---

## SPEC-002 — Deterministic Git Budget Engine

### Propósito

Comparar el repositorio real contra el contrato activo.

### Scope

- calcular cambios desde la base seleccionada;
- contar archivos productivos/test cuando la configuración pueda diferenciarlos;
- contar líneas agregadas/eliminadas o una métrica equivalente claramente documentada;
- detectar archivos nuevos;
- detectar eliminaciones;
- detectar renombrados cuando Git pueda identificarlos;
- validar allow patterns;
- validar deny patterns;
- validar `max_files`;
- validar `max_changed_lines`;
- no modificar el working tree;
- comportamiento consistente con cambios staged y unstaged según definición de spec.

### Decisiones que la spec debe cerrar

- semántica exacta de la base Git;
- tratamiento de staged/unstaged/untracked;
- estrategia para renames;
- definición exacta de “changed lines”;
- symlinks y submodules;
- comportamiento cuando Git no está disponible o el directorio no es repo.

### Criterios de salida

Debe existir una batería de repositorios Git temporales que demuestre:

- PASS dentro de presupuesto;
- FAIL por exceso de archivos;
- FAIL por exceso de líneas;
- FAIL por ruta prohibida;
- FAIL por archivo fuera de allow;
- manejo correcto de nuevos/eliminados/renombrados;
- cero modificaciones al working tree causadas por `check`.

### Riesgo

**Medio.** Git tiene suficientes edge cases para justificar tests fuertes, pero sin añadir abstracciones innecesarias.

---

## SPEC-003 — Policy Results, Reports & Exit Codes

### Propósito

Convertir la validación en una interfaz confiable para humanos y automatización.

### Scope

- comando `changebudget check`;
- modelo interno de violations;
- severidad/status final;
- salida humana concisa;
- salida machine-readable opcional;
- exit codes documentados;
- `status` con consumo actual del presupuesto;
- razones explícitas para cada violación;
- recomendación no destructiva: continuar, revisar o reparar.

### Ejemplo de experiencia objetivo

```text
CHANGE CONTRACT: FAILED

Task: Fix empty playlist crash
Files: 6 / 4
Changed lines: 241 / 180

Violations:
- pubspec.yaml is protected
- lib/core/router.dart is outside allowed paths
- file budget exceeded by 2

Decision: REPAIR
```

### No incluye

- revert automático;
- interpretación semántica por LLM;
- UI web.

### Criterios de salida

- Un humano puede saber qué regla falló sin abrir logs internos.
- Scripts/CI pueden distinguir éxito, warning/review y failure por exit code.
- El resultado es estable para el mismo repo + base + contrato.

### Gate v0.1

SPEC-001, SPEC-002 y SPEC-003 juntas conforman **v0.1 usable**.

Antes de iniciar SPEC-004, v0.1 debe probarse manualmente en al menos:

1. un proyecto Flutter;
2. un proyecto Android nativo;
3. un proyecto Java/Spring Boot o TypeScript.

No se busca compatibilidad especial todavía; se busca comprobar que el core general funciona.

---

## SPEC-004 — OpenCode Runtime Guard

### Propósito

Pasar de detectar scope creep al final a interceptarlo durante una sesión de OpenCode cuando sea técnicamente viable.

### Scope

- plugin mínimo para OpenCode;
- cargar contrato activo;
- detectar operaciones de escritura relevantes expuestas por la API/plugin system;
- permitir acciones dentro del contrato;
- advertir o denegar rutas prohibidas;
- proteger archivos sensibles según contrato;
- mostrar información suficiente para que el usuario decida cuando la política sea `ask`;
- registrar el intento sin enviar datos fuera del equipo;
- degradación segura: si la integración falla, el core CLI sigue funcionando.

### Principio de seguridad

El plugin no debe pretender ofrecer aislamiento de sistema operativo. Es un guardrail de workflow, no un sandbox de seguridad.

### Criterios de salida

- Un intento de modificar una ruta `deny` puede detenerse antes de la escritura cuando la API de OpenCode lo permita.
- Un cambio permitido no exige interacción innecesaria.
- Desactivar/eliminar el plugin no rompe el CLI.
- Los fallos del plugin no corrompen el contrato.

### Gate v0.2

Usar ChangeBudget + plugin durante varias tareas reales con Spark y registrar:

- bloqueos correctos;
- falsos positivos;
- casos no interceptables;
- fricción introducida.

---

## SPEC-005 — Personal Stack Policies

### Propósito

Incorporar conocimiento explícito de tus stacks sin convertir el core en un analizador semántico gigante.

### Presets iniciales

#### Android / Kotlin

Posibles categorías sensibles:

- `AndroidManifest.xml`;
- `build.gradle.kts` / Gradle config;
- Room migrations;
- ProGuard/R8;
- signing/release config;
- permisos;
- CI/release files.

#### Flutter

- `pubspec.yaml` / lockfile;
- `android/**`;
- `ios/**`;
- configuración Firebase;
- manifests/plists;
- release/signing.

#### Spring Boot

- `pom.xml` / Gradle dependencies;
- `application*.yml` / properties;
- DB migrations;
- security configuration;
- Docker/deployment descriptors;
- CI/release files.

#### Node / TypeScript

- `package.json` / lockfiles;
- tsconfig;
- environment/config files;
- migrations;
- CI/release config.

### Restricción

Los presets son reglas declarativas. No se crea un parser completo de Kotlin, Dart, Java o TypeScript en esta spec.

### Criterios de salida

- El usuario puede seleccionar un preset explícitamente.
- El preset puede extenderse por repo.
- Ningún preset cambia código.
- Las reglas son visibles y auditables.
- Un proyecto puede desactivar reglas individuales.

### Gate v0.3

Aplicar los presets a repositorios reales y ajustar falsos positivos antes de continuar.

---

## SPEC-006 — Spec-Kit Task Bridge

### Propósito

Conectar ChangeBudget con el flujo de Spec-Kit sin reemplazar Spec-Kit.

### Scope

- identificar el feature/spec activo cuando exista una estructura Spec-Kit reconocible;
- leer `tasks.md` de forma segura;
- iniciar contrato asociado a una task `Txxx`;
- registrar el texto de la task como contexto humano;
- permitir políticas/defaults por tipo de task;
- facilitar un fast path para tasks pequeñas;
- incluir el ID de task en reportes/cierre.

### Ejemplo conceptual

```text
changebudget start T031 --tiny
```

Salida esperada:

```text
Task: T031
Source: specs/004-navigation/tasks.md
Budget: tiny
Contract: active
```

### No incluye

- modificar automáticamente `tasks.md` sin autorización;
- decidir que una task está completada basándose solo en presupuesto;
- reemplazar `/speckit.implement`;
- ejecutar Spec-Kit por sí mismo.

### Criterios de salida

- Puede asociarse un contrato a una task real.
- Una task inexistente falla de forma clara.
- El bridge no rompe proyectos sin Spec-Kit.
- El fast path sigue obedeciendo la constitución y el contrato.

### Gate v0.4

Reproducir al menos un caso donde una task pequeña históricamente habría expandido su scope y verificar que ChangeBudget mantenga el cambio dentro de límites razonables.

---

## SPEC-007 — Diagnose & Budget Advisor

### Propósito

Ayudar a elegir un presupuesto antes de implementar.

### Comando objetivo

```text
changebudget diagnose
```

### Primera versión: determinista

Debe utilizar señales observables, por ejemplo:

- paths mencionados;
- stack/preset;
- tamaño del área afectada;
- tipo de archivos;
- si existen migraciones/dependencias/configuración en el scope declarado;
- información de una task Spec-Kit cuando esté disponible.

Puede recomendar:

- `tiny`;
- `normal`;
- `free`;
- revisión manual previa.

### Extensión opcional futura

Un LLM podría sugerir el scope esperado, pero la salida debe marcarse como recomendación y nunca convertirse en autorización automática.

### Criterios de salida

- `diagnose` no modifica archivos.
- Explica por qué recomienda un preset.
- Ante incertidumbre alta recomienda revisión, no inventa precisión.
- La validación posterior sigue siendo completamente determinista.

### Gate v0.5

Usar el advisor en tareas reales y medir si sus recomendaciones reducen ajustes manuales de contrato sin aumentar falsos bloqueos.

---

## SPEC-008 — Dogfood, Reliability & Personal v1.0

### Propósito

Convertir el prototipo funcional en una herramienta confiable para uso cotidiano.

### Scope

La spec debe construirse a partir de evidencia obtenida durante v0.1–v0.5, no de features imaginadas.

Áreas candidatas:

- atomicidad del estado local;
- recuperación de contrato interrumpido;
- mensajes y errores;
- comportamiento cross-platform relevante para tus equipos;
- rendimiento en repositorios grandes;
- compatibilidad de versiones Git;
- seguridad de paths;
- documentación personal;
- instalación/update sencilla;
- histórico mínimo únicamente si ya demostró utilidad.

### Criterios de salida v1.0

- Se usa normalmente en tus proyectos sin requerir intervención constante.
- No pierde/corrompe contratos ante errores normales.
- No modifica el working tree durante validaciones.
- Sus errores son accionables.
- Los presets usados por tus stacks son estables.
- La integración con OpenCode no es requisito para que el core funcione.
- ChangeBudget se utiliza para desarrollar ChangeBudget.

---

# 6. Milestones y Definition of Done

## v0.1 — Core usable

Incluye SPEC-001 a SPEC-003.

**Definition of Done:** puedo abrir un contrato en cualquier repo Git, hacer cambios, ejecutar `check` y obtener un resultado determinista y útil.

## v0.2 — Guardrail en ejecución

Incluye SPEC-004.

**Definition of Done:** durante una sesión real de OpenCode, ChangeBudget puede reducir al menos parte del scope creep antes de que ocurra.

## v0.3 — Adaptado a mis proyectos

Incluye SPEC-005.

**Definition of Done:** mis principales stacks tienen reglas útiles sin generar ruido excesivo.

## v0.4 — Spec-Kit-aware

Incluye SPEC-006.

**Definition of Done:** una task `Txxx` puede convertirse en un contrato pequeño y trazable sin repetir manualmente su contexto.

## v0.5 — Fast path asistido

Incluye SPEC-007.

**Definition of Done:** la herramienta ayuda a elegir el presupuesto adecuado antes de implementar, sin ceder la decisión de cumplimiento a IA.

## v1.0 — Herramienta personal estable

Incluye SPEC-008.

**Definition of Done:** ChangeBudget forma parte habitual del workflow y disminuye retrabajo/fricción de agentes en proyectos reales.

---

# 7. Estrategia Spec-Kit

## Secuencia para cada spec relevante

Camino estándar:

```text
/speckit.specify
      ↓
/speckit.clarify   ← solo si hay ambigüedades materiales
      ↓
/speckit.plan
      ↓
/speckit.tasks
      ↓
/speckit.analyze   ← un gate previo a implementación
      ↓
/speckit.implement
```

## Reglas operativas

1. No ejecutar `clarify` solo por ceremonia.
2. No repetir `analyze` indefinidamente si no existen findings nuevos de severidad material.
3. Las tasks deben poder cerrarse individualmente.
4. Una task no puede introducir una feature que pertenezca a una spec posterior.
5. Tests relacionados primero; regresión amplia en gates/milestones o cuando el riesgo lo justifique.
6. Si una task descubre una necesidad fuera de scope, documentarla como candidate/follow-up; no implementarla automáticamente.
7. Después de SPEC-003, las siguientes specs deben dogfood ChangeBudget siempre que sea posible.

---

# 8. Estrategia de ejecución con Spark

Spark se utilizará principalmente para:

- implementar una task pequeña;
- crear tests dirigidos;
- corregir lint/compile issues localizados;
- realizar refactors mecánicos explícitamente autorizados;
- implementar parsers/reglas pequeñas;
- completar documentación técnica asociada a una task.

Para evitar scope creep, cada task debe contener como mínimo:

- objetivo;
- archivos/área esperada cuando sea conocida;
- exclusiones;
- criterio de aceptación;
- validación mínima requerida.

Cuando ChangeBudget v0.1 esté disponible, Spark debe trabajar bajo un contrato siempre que la tarea lo permita.

---

# 9. Orden recomendado de arranque

## Paso 0 — Inicialización del repositorio

Crear el repositorio y preparar Spec-Kit.

## Paso 1 — Constitution

Convertir la sección **1. Constitución del proyecto** de este documento en `.specify/memory/constitution.md`, adaptando únicamente formato/metadatos requeridos por Spec-Kit.

No volver a inventar principios durante `/speckit.constitution`: este documento es la fuente aprobada.

## Paso 2 — SPEC-001

Crear el primer feature/spec:

**Local Change Contract Lifecycle**

Debe ser deliberadamente pequeño. No incluir Git Budget Engine “porque ya estamos ahí”.

## Paso 3 — SPEC-002 y SPEC-003

Construir validación y reporting hasta obtener v0.1.

## Paso 4 — Primera prueba real

Antes del plugin OpenCode, usar v0.1 manualmente en tareas reales y registrar fricción.

## Paso 5 — Continuar roadmap según evidencia

SPEC-004 en adelante solo debe absorber problemas observados o requisitos explícitos de este roadmap.

---

# 10. Métricas personales de éxito

No necesitamos analytics remotos. Basta un pequeño registro manual durante dogfooding.

Preguntas útiles:

- ¿Cuántas veces detectó archivos fuera de scope?
- ¿Cuántas veces bloqueó algo legítimo?
- ¿Cuántas tasks pequeñas evitaron una regresión completa innecesaria?
- ¿Cuánto cuesta configurar un contrato?
- ¿El contrato requiere menos tiempo que revisar un diff expandido?
- ¿Spark se mantiene más enfocado cuando existe el contrato?

Una feature nueva solo debería ganar prioridad si mejora claramente una de estas respuestas.

---

# 11. Backlog explícitamente diferido

Estas ideas pueden ser útiles algún día, pero **no pertenecen al roadmap activo**:

- UI/TUI rica;
- dashboard;
- integración GitHub/GitLab;
- PR comments;
- soporte Claude Code/Codex CLI/etc.;
- editor visual de políticas;
- compartir presets públicamente;
- marketplace;
- recomendaciones LLM avanzadas;
- análisis AST multi-lenguaje;
- servidor central;
- sincronización entre máquinas;
- modo organización/equipo;
- publicación npm pública;
- open source.

Se reconsideran solo después de v1.0 o si una necesidad personal concreta lo exige.

---

# 12. Regla final del proyecto

> **ChangeBudget no puede convertirse en otra herramienta enorme que necesite ChangeBudget para poder desarrollarse.**

Cuando haya dos soluciones válidas, se elige la que tenga:

1. menos infraestructura;
2. menos dependencias;
3. menos estados implícitos;
4. comportamiento más determinista;
5. menor costo de mantenimiento;
6. mayor utilidad inmediata en proyectos reales.

---

## Resumen ejecutivo

ChangeBudget comenzará como un CLI personal y local para contratos de cambio sobre Git. La primera meta no es integración con agentes ni inteligencia avanzada: es lograr un **core v0.1 determinista y confiable**.

Después se añadirá guardrail para OpenCode, políticas adaptadas a tus stacks, integración con Spec-Kit y un diagnóstico de presupuesto. El proyecto permanecerá privado durante esta etapa. Si con el uso cotidiano demuestra ser útil, pequeño y mantenible, una publicación open source podrá evaluarse más adelante sin rediseñar el objetivo actual.
