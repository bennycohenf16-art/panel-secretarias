# MASTER MEMORY — Ecosistema Médico Automatizado

> Documento canónico. Actualizar en cada sprint. Nunca omitir reglas marcadas como CRÍTICO.

---

## 1. INFRAESTRUCTURA UNIFICADA

### Repositorios y URLs de producción

| Servicio | Carpeta local | Repositorio GitHub | URL Render |
|---|---|---|---|
| bot-factory | `~/Desktop/bot-factory/` | bennycohenf16-art/bot-factory | https://bot-factory-8amb.onrender.com |
| panel-secretarias | `~/Desktop/panel-secretarias/` | bennycohenf16-art/panel-secretarias | https://panel-secretarias.onrender.com |

Ambos comparten la misma instancia de **Postgres en Render Oregon**: base de datos `factory_prod`.

### Relación entre servicios

```
WhatsApp → Baileys → bot-factory (bot-engine.js)
                          │
                    HTTP interno (x-internal-key)
                          │
              panel-secretarias (Express + React)
                          │
                     factory_prod (Postgres compartida)
```

- `panel-secretarias` actúa como panel de control y como pasarela de billing.
- `bot-factory` expone tres endpoints internos que `panel-secretarias` consume vía HTTP con header `x-internal-key`.
- El panel React (client/) se sirve como build estático desde el mismo Express de panel-secretarias.

### Variables de entorno — bot-factory (Render)

```
DATABASE_URL         postgresql://...factory_prod (Oregon)
INTERNAL_API_KEY     clave secreta compartida con panel-secretarias
FACTORY_SECRET       6c62d5381fb88cd04ebd604ad5913d24520aa829
NODE_ENV             production
# Línea 1 de server.js:
process.env.TZ = 'America/Mexico_City'
```

### Variables de entorno — panel-secretarias (Render)

```
DATABASE_URL          postgresql://...factory_prod (mismo)
JWT_SECRET            secreto para tokens de sesión del panel
INTERNAL_API_KEY      mismo valor que bot-factory
BOT_FACTORY_URL       https://bot-factory-8amb.onrender.com
FACTORY_SECRET        mismo valor que bot-factory
STRIPE_SECRET_KEY     sk_live_... (llave Stripe — TRIM obligatorio al leer)
STRIPE_PRICE_ID       price_... (ID del plan mensual — TRIM obligatorio al leer)
STRIPE_WEBHOOK_SECRET whsec_...
PANEL_URL             https://panel-secretarias.onrender.com
# Línea 1 de server.js:
process.env.TZ = 'America/Mexico_City'
```

### Autenticación — tres capas

| Capa | Mecanismo | Alcance |
|---|---|---|
| React client ↔ Express panel | JWT `Authorization: Bearer` — middleware `auth` | Rutas `/api/*` del panel |
| panel-secretarias → bot-factory | Header `x-internal-key === INTERNAL_API_KEY` | Endpoints internos del bot |
| Admin UI bot-factory | Cookie `factory_auth` (HMAC SHA256 + FACTORY_SECRET) | Panel admin del bot |

### Endpoints internos de bot-factory (consumidos por panel-secretarias)

```
POST /api/messages/send-notification   { botSlug, phone, text }
POST /api/messages/send-offer          { botSlug, phone, text, fecha, hora, nombre, telefono }
GET  /api/bots/:slug/status            → { status, qr? }
```

`send-notification` y `send-offer` deben estar registrados **antes** de `express.static` en bot-factory/server.js (R2).  
`GET /api/bots/:slug/status` debe estar registrado **antes** de `app.use('/api/bots', requireAuth, ...)` (R3).

---

## 2. BASE DE DATOS — TABLAS RELEVANTES

### doctors (panel-secretarias)
```sql
id SERIAL PK, name, email UNIQUE, password_hash, bot_slug UNIQUE,
panel_token UNIQUE, role VARCHAR(50) DEFAULT 'doctor', created_at,
stripe_customer_id VARCHAR(255),
subscription_status VARCHAR(50) DEFAULT 'unpaid',
subscription_ends_at TIMESTAMP
```

### appointments (panel-secretarias)
```sql
id SERIAL PK, doctor_id → doctors(id), nombre, telefono,
fecha DATE, hora TIME, motivo TEXT, status DEFAULT 'pendiente',
source DEFAULT 'whatsapp', reminder_sent BOOLEAN DEFAULT FALSE, created_at
```

### waiting_list
```sql
id SERIAL PK, doctor_id → doctors(id), nombre, telefono,
bot_slug, fecha_preferida DATE, origen DEFAULT 'manual', created_at,
UNIQUE(doctor_id, telefono)
```
UPSERT siempre con `DO UPDATE SET fecha_preferida = EXCLUDED.fecha_preferida` — **nunca DO NOTHING**.

### blocked_slots
```sql
id SERIAL PK, doctor_id → doctors(id),
fecha DATE, hora TIME NULL,   ← NULL = bloqueo de día completo
motivo TEXT, created_at
```

### conv_state (bot-factory)
```sql
bot_slug TEXT, jid TEXT, step INT, data JSONB, updated_at,
UNIQUE(bot_slug, jid)
```
**Clave canónica:** `jid` es SIEMPRE `phone:XXXXXXXXXX` (exactamente 10 dígitos locales mexicanos).

### patients (bot-factory)
```sql
bot_slug TEXT, jid TEXT, nombre TEXT, telefono TEXT,
is_owner BOOLEAN DEFAULT false, updated_at,
UNIQUE INDEX patients_bot_slug_jid_nombre_idx ON patients(bot_slug, jid, lower(nombre))
```

### secretary_logs
```sql
id SERIAL PK, secretary_id INT, secretary_name,
appointment_id INT, action VARCHAR(50), created_at
```
Acciones: `'confirmar'`, `'cancelar'`, `'crear_manual'`.

---

## 3. FLUJOS Y REGLAS CRÍTICAS

### REGLA ABSOLUTA — Teléfonos México (10 dígitos locales)

```javascript
// En cualquier parte del sistema — extracción universal:
telefono.replace(/\D/g, '').slice(-10)

// En bot-engine.js — conversión desde JID:
function toLast10(digits) {
  if (digits.startsWith('521') && digits.length === 13) return digits.slice(3);
  if (digits.startsWith('52')  && digits.length === 12) return digits.slice(2);
  return digits.slice(-10);
}

// Clave canónica en conv_state:
`phone:${toLast10(digits)}`   // siempre 'phone:XXXXXXXXXX'
```

### REGLA ABSOLUTA — Fechas sin desfase ISO

Postgres serializa columnas `DATE` como ISO completo en JSON (`"2025-06-04T06:00:00.000Z"`). Para parsear sin off-by-one:

```javascript
const iso = String(raw).slice(0, 10);           // siempre "YYYY-MM-DD"
const [y, m, d] = iso.split('-').map(Number);
new Date(y, m - 1, d, 12)                       // mediodía local, sin timezone shift
```

**Nunca** usar `new Date(raw + 'T12:00:00')` si `raw` puede venir como ISO completo con timezone.

### Flujo multi-familiar del bot (CRÍTICO)

**Tabla `patients` permite múltiples filas por JID** (titular + familiares comparten número).

`getPatient(slug, jid)`:
- Busca con `is_owner = true`.
- Si no existe registro con `is_owner = true` → retorna `null` obligatoriamente (fuerza re-registro).

`savePatientMulti(slug, jid, nombre, telefono, isOwner)`:
- Si `isOwner === true`: pone `is_owner = false` en TODOS los registros del JID, luego UPSERT del titular con `is_owner = true`.
- Si `isOwner === false`: UPSERT aislado del familiar por nombre (sin tocar el flag del titular).

### Embudo de conversación (STEPS)

```javascript
STEPS = {
  IDLE:0, NOMBRE:1, TELEFONO:2, FECHA:3, HORA:4,
  MOTIVO:5, CANCELACION:6, LISTA_ESPERA:7, ESPERANDO_OFERTA:8, PARA_QUIEN:9
}
```

**Orden de prioridades en `handleMessage` — JAMÁS ROMPER:**
```
P1   → CANCELACION(6)       bloquea todo
P1b  → LISTA_ESPERA(7)      bloquea todo
P1c  → ESPERANDO_OFERTA(8)  bloquea todo
P1d  → PARA_QUIEN(9)        bloquea todo
P2   → quiereCancelar && IDLE
P3   → flujo agendamiento IDLE→NOMBRE→TELEFONO→PARA_QUIEN→FECHA→HORA→MOTIVO
```
Todo step nuevo siempre se añade como Prioridad 1x.

### Clave canónica jidToPhoneKey (CRÍTICO)

```javascript
async function jidToPhoneKey(slug, jid) {
  if (!jid) return null;
  if (jid.startsWith('phone:')) return jid;   // ← GUARDA CRÍTICA — sin esto el regex destruye la clave
  if (jid includes @s.whatsapp.net) → extrae dígitos → toLast10 → 'phone:XXXXXXXXXX'
  if (jid includes @lid) → busca en lidToPhone → fallback DB → null si no resuelve
}
```

### Send-offer — escritura directa en conv_state (CRÍTICO)

```javascript
// En bot-factory/server.js POST /api/messages/send-offer:
const fianzaKey = `phone:${numeroLimpio}`;
// DELETE + INSERT directo a conv_state — NO usar setConvState/clearConvState
// para evitar doble-resolución de JID y nulos silenciosos (R5)
```

### Webhook de facturación — orden en server.js (CRÍTICO)

```javascript
// DEBE ir ANTES de app.use(express.json()) — consume body crudo para validar firma Stripe
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), ...)
app.use(express.json())   // ← después
```

---

## 4. MÓDULOS FUNCIONALES COMPLETOS

| Módulo | Estado | Commits clave |
|---|---|---|
| Agendamiento WhatsApp multi-familiar | ✅ Producción | 8519844, 86bcf93 |
| Flujo PARA_QUIEN (propia/tercero) | ✅ Producción | sprint 2026-06-02 |
| Cancelación por WhatsApp | ✅ Producción | — |
| Lista de espera + oferta ⚡ | ✅ Producción | sprint 2026-06-01 |
| Bloqueos de agenda | ✅ Producción | sprint 2026-06-01 |
| Agenda visual Time-Grid | ✅ Producción | sprint 2026-06-02 |
| Recordatorios cron (09:00 CDMX) | ✅ Producción | — |
| Módulo de rendimiento (leaderboard) | ✅ Producción | 20745b3, e232bc1 |
| Pasarela Stripe + muro de pago | ✅ Producción | 0686ce6, 77e7182 |
| Validación de slot en oferta de espera | ✅ Producción | e17ac7b, aac35e3 |
| authOrInternal — bot confirma cita sin JWT | ✅ Producción | e17ac7b |
| Filtro horas pasadas en modal oferta | ✅ Producción | 9baab91 |
| Crash SÍ WhatsApp — savePatientMulti en ESPERANDO_OFERTA | ✅ Producción | 923da14 |
| Registro de rechazos de oferta (status='rechazada') | ✅ Producción | sprint 2026-06-09 |
| Historial de Ofertas Rechazadas en panel UI | ✅ Producción | sprint 2026-06-09 |

---

## 5. ESTADO DEL SPRINT ACTUAL (2026-06-09)

### Historial de sprints previos (resumen)

**Sprint 2026-06-08** — commits `0686ce6`, `77e7182`, `e17ac7b`, `aac35e3`, `9baab91`, `923da14`:
- Pasarela Stripe completa (checkout → webhook → activación). R10, R11 aplicadas.
- `authOrInternal` en `POST /api/appointments` — bot puede crear citas sin JWT.
- Filtro de horas pasadas en modal de oferta (`WaitingListPanel.jsx`).
- Fix crash ESPERANDO_OFERTA SÍ: `savePatient` → `savePatientMulti` (R13).

---

### Sprint 2026-06-09 — Registro de rechazos de oferta de lista de espera

**Problema:** cuando un paciente respondía NO a una oferta de espacio liberado, el sistema no dejaba rastro en la base de datos. La interacción se perdía silenciosamente.

**Solución coordinada en ambos repositorios:**

**panel-secretarias `server.js` — `POST /api/appointments`:**
- Se extrae `status: bodyStatus` del body.
- Cuando la petición llega sin JWT (`!req.user`) y trae `bodyStatus` explícito, se usa ese valor como `status` en el INSERT.
- Las peticiones del panel siguen recibiendo `'pendiente'` por defecto (guard `!req.user`).
- El INSERT ahora es explícito en la columna `status` (`$7`) y `source` pasa a `$8`.
- R12 intacta: `if (req.user)` en `secretary_logs` no cambia.

**bot-factory `bot-engine.js` — handler `ESPERANDO_OFERTA` (bloque NO):**
- Justo antes de `clearConvState`, si se conocen `fRech`, `hRech` y `doctorId`, se inserta con `execute()` directo:
  - `status = 'rechazada'`, `motivo = 'Oferta de lista de espera rechazada'`, `source = 'whatsapp'`.
- `try/catch` aísla el error de DB para que no rompa el mensaje de respuesta al paciente.
- Usa el mismo patrón `execute()` directo que el bloque SÍ (no hay fetch HTTP en este flujo — bot-factory tiene acceso directo a la DB compartida).
- R1 intacta: P1c (`ESPERANDO_OFERTA`) sigue bloqueando todo; el insert va en el único camino de salida NO.

---

### Sprint 2026-06-09 (parche) — doctor_id en conv_state + logging diagnóstico — commits `1380260` (bot-factory), `1c23531` (panel-secretarias)

**Problema:** en producción, los rechazos de oferta no se guardaban. Causa raíz: `doctor_id` nunca se almacenaba en `conv_state.data`; si el closure `doctorId` era null, la condición `if (fRech && hRech && doctorId)` fallaba silenciosamente sin log.

**Fixes aplicados:**

**panel-secretarias `server.js`:**
- `POST /api/waiting-list/offer`: ahora incluye `doctor_id: req.user.id` en el body enviado a `bot-factory/send-offer`.
- `POST /api/appointments`: agrega `console.log('[INCOMING APPOINTMENT]', req.body)` al inicio para diagnóstico en Render.

**bot-factory `server.js` — send-offer:**
- Extrae `doctor_id` del body (`doctorIdOffer`) y lo guarda en `conv_state.data` junto a `nombre`, `telefono` y `oferta`.

**bot-factory `bot-engine.js` — ESPERANDO_OFERTA bloque NO:**
- Introduce `effectiveDoctorId = doctorId || state.doctor_id || null` para usar el valor del estado como fallback.
- Agrega log diagnóstico completo antes del INSERT (valores de `fRech`, `hRech`, `doctorId`, `state.doctor_id`).
- Agrega `console.warn` cuando la condición falla, indicando qué valor es falso.
- El `catch` ahora loguea el payload completo para facilitar diagnóstico en Render.

---

### Sprint 2026-06-09 (parche 2) — try/catch SÍ branch + fresh doctor_id lookup + logging completo — commit `38b6355` (bot-factory)

**Problemas encontrados en revisión:**
1. Bloque SÍ de ESPERANDO_OFERTA ejecutaba `execute(INSERT)` sin try/catch — cualquier error de DB propagaba sin atrapar, `clearConvState` no corría, el paciente quedaba atascado en step 8 para siempre ("el flujo se rompe").
2. Si tanto `doctorId` (closure) como `state.doctor_id` eran null en el momento del rechazo, el INSERT se saltaba sin fallback.
3. Los logs no incluían `state.oferta` completo ni `e.stack`, imposible diagnosticar en Render.

**Fixes aplicados — bot-factory `bot-engine.js`:**
- Bloque SÍ: todo el INSERT + savePatientMulti dentro de try/catch; `clearConvState` siempre corre.
- Bloque SÍ: usa `effectiveDIdSi = doctorId || state.doctor_id` (igual que el bloque NO).
- Bloque NO: si `effectiveDoctorId` sigue null después de closure + state, hace `SELECT id FROM doctors WHERE bot_slug=$1` en caliente como último recurso.
- Logging de entrada al bloque incluye `JSON.stringify(state.oferta)` y `state.doctor_id`.
- catch blocks usan `e.stack || e.message` y loguean `oferta_raw`.

**bot-factory `server.js` — send-offer:**
- Log de `[OFERTA TRABADA]` ahora incluye `doctor_id`, `fecha`, `hora` para confirmar qué se almacenó.
- `catch` usa `e.stack || e.message`.

**No hay bugs abiertos al cierre de este parche.**

---

### Sprint 2026-06-09 (parche 5) — Blindaje SÍ branch + sanitización de hora

**Problema 1 — bot SÍ branch**: si `doctorId` closure y `state.doctor_id` eran ambos null, el bloque SÍ ejecutaba `SKIP insert` silenciosamente pero el paciente recibía "¡cita agendada!" (respuesta falsa). El bloque NO ya tenía el `fresh SELECT id FROM doctors WHERE bot_slug`, el SÍ no.

**Problema 2 — hora con sufijo**: aunque el frontend enviaba `hora.slice(0,5)` limpio, si por cualquier causa el valor en `state.oferta.hora` llegaba con sufijo (ej: "09:00 hrs"), el INSERT fallaba con error de tipo TIME en Postgres.

**Fixes — bot-factory `bot-engine.js` — ESPERANDO_OFERTA bloque SÍ:**
- `const effectiveDIdSi` → `let effectiveDIdSi`.
- Si `effectiveDIdSi` es null → `SELECT id FROM doctors WHERE bot_slug=$1` como último recurso (igual que el bloque NO).
- `hora` se sanitiza ANTES del INSERT: `String(horaRaw).replace(/[^0-9:]/g, '').slice(0, 5)`.
- Log explícito `[oferta-si]` con fuente del doctor_id (closure / state / fresh).
- `ocupados.includes(hora)` usa la `hora` ya sanitizada.

**Fix — WaitingListPanel.jsx — sendOffer:**
- `hora: offerHora.replace(/[^0-9:]/g, '').slice(0, 5)` — elimina cualquier carácter no numérico ni `:` antes de cortar a 5 chars.

---

### Sprint 2026-06-09 (parche 4) — Endpoint dedicado /api/appointments/rejected

**Problema:** la sección de rechazadas no aparecía aunque el commit d047e61 ya estaba desplegado.

**Causa raíz:** `GET /api/appointments` devuelve correctamente TODOS los status incluyendo 'rechazada', pero la llamada en el cliente podía fallar silenciosamente (catch → array vacío) sin ningún log de backend, sin forma de diagnosticar si el `doctor_id` del appointment coincide con el del usuario loggeado.

**Solución — panel-secretarias `server.js`:**
- Nuevo endpoint `GET /api/appointments/rejected` (registrado DESPUÉS de `/month` y ANTES de `/:id`).
- Query explícito: `WHERE doctor_id=$1 AND status='rechazada' ORDER BY created_at DESC`.
- Loguea `[REJECTED] doctor_id=X → N registros` en cada llamada para diagnóstico en Render.

**Solución — WaitingListPanel.jsx:**
- `loadRechazadas()` ahora llama `/api/appointments/rejected` directamente.
- No necesita filtrar en cliente — el backend ya devuelve solo rechazadas.

**Invariante:** ruta registrada ANTES de cualquier ruta paramétrica `/:id` para que Express no la confunda con un ID numérico (aunque no hay `GET /:id`, la posición es defensiva).

---

### Sprint 2026-06-09 (parche 3) — Historial de Ofertas Rechazadas en panel UI

**Problema:** las citas con `status='rechazada'` ya se guardaban en la DB (confirmado: ID 66), pero eran invisibles para las secretarias — no aparecían en ninguna sección del panel.

**Solución:**

**panel-secretarias `client/src/components/WaitingListPanel.jsx`:**
- Se agrega estado `rechazadas` + `loadingRech` y función `loadRechazadas()`.
- `loadRechazadas()` llama `GET /api/appointments` (sin filtro de fecha) y filtra `status === 'rechazada'` en el cliente.
- Ambas cargas (`load()` + `loadRechazadas()`) se disparan juntas en el `useEffect` inicial.
- Se añade una nueva sección "🚫 Historial de Ofertas Rechazadas" debajo de la lista de espera (justo antes del modal de oferta).
- Tabla con columnas: Paciente, Teléfono, Fecha ofrecida, Hora.
- Reutiliza `fmtFecha()` ya existente para parsear `fecha` sin desfase de zona horaria.
- `npm run build` ejecutado y exitoso (R8 aplicada).

---

## 6. PROTOCOLO ESTRICTO DE GIT Y DESPLIEGUE (PROHIBIDO COLAPSAR RENDER)

1. **CAMBIOS EN LOCAL:** Todas las modificaciones de código, refactorizaciones y compilaciones (`npm run build`) se hacen exclusivamente en local.
2. **COMMITS CONSOLIDADOS:** Queda terminantemente prohibido hacer micro-commits o empujar cambios línea por línea. Se agrupan los cambios por feature o fix completo.
3. **PROHIBICIÓN DE PUSH AUTOMÁTICO:** Claude TIENE PROHIBIDO ejecutar `git push` por iniciativa propia bajo ninguna circunstancia.
4. **CONTROL DE FLUJO:** Al terminar una tarea, Claude guardará los cambios en un commit local, se detendrá y le preguntará al usuario: "Código listo en local. ¿Confirmas el push definitivo?".

---

## 7. DEPLOY — HOOKS Y PROCEDIMIENTO OBLIGATORIO

### Deploy Hooks de Render (disparar con curl tras cada push)

```
bot-factory:
  curl -s -X POST "https://api.render.com/deploy/srv-d8e7evcm0tmc73ek52a0?key=DGwVLCg9mGo"

panel-secretarias:
  curl -s -X POST "https://api.render.com/deploy/srv-d8c8b0q8qa3s73fpb1ng?key=afKT9V9X1OI"
```

### Regla de despliegue (OBLIGATORIO tras cada push)

Después de cada `git push origin main` exitoso, ejecutar los curl de los hooks correspondientes. El auto-deploy de Render no es confiable. El hook es la única garantía de que el código llega a producción.

Secuencia estándar de cierre de sprint:
```bash
# 1. commit + push
git add <archivos> && git commit -m "..." && git push origin main

# 2. disparar deploy en Render (siempre, aunque diga "up to date")
curl -s -X POST "https://api.render.com/deploy/srv-d8e7evcm0tmc73ek52a0?key=DGwVLCg9mGo"   # bot-factory
curl -s -X POST "https://api.render.com/deploy/srv-d8c8b0q8qa3s73fpb1ng?key=afKT9V9X1OI"   # panel-secretarias (solo si se tocó)
```

Respuesta esperada: `{"deploy":{"id":"dep-..."}}` — confirma que Render empezó a compilar.

---

## 7. REGLAS INVARIANTES — PROHIBIDO ROMPER

| # | Regla |
|---|---|
| R1 | Orden de prioridades en `handleMessage`: P1→P1b→P1c→P1d→P2→P3. Nuevo step siempre es P1x. |
| R2 | `send-offer` y `send-notification` se registran ANTES de `express.static` en bot-factory/server.js. |
| R3 | `GET /api/bots/:slug/status` se registra ANTES de `app.use('/api/bots', requireAuth, ...)`. |
| R4 | `jidToPhoneKey` tiene la guarda `if(jid.startsWith('phone:')) return jid` como segunda línea. |
| R5 | `send-offer` usa DELETE+INSERT directo a `conv_state` con `fianzaKey` — NO pasar por `setConvState`. |
| R6 | Todas las migraciones en `initDB()` usan `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`. |
| R7 | UPSERT de `waiting_list` siempre `DO UPDATE SET fecha_preferida=...` — nunca `DO NOTHING`. |
| R8 | `bot-engine.js`: sin build. `panel-secretarias`: `npm run build` en `client/` si se tocó algo en `client/src/`. |
| R9 | Verificar en logs de Render: `[OFERTA TRABADA]` y `[MENSAJE]` deben mostrar la misma clave `phone:XXXXXXXXXX`. |
| R10 | `STRIPE_SECRET_KEY` y `STRIPE_PRICE_ID` siempre con `.trim()` al leerlos — espacios rompen Stripe silenciosamente. |
| R11 | El webhook de Stripe (`express.raw`) siempre ANTES de `app.use(express.json())` en server.js. |
| R12 | Guard `if (req.user)` en todos los `INSERT INTO secretary_logs` — el bot edita vía `INTERNAL_API_KEY` sin JWT. |
| R13 | En `ESPERANDO_OFERTA`, usar SIEMPRE `savePatientMulti` (NO `savePatient`) — el constraint `UNIQUE(bot_slug,jid)` fue eliminado en commit 8519844 y `savePatient` explota en Postgres. |
| R14 | Comparaciones de columna `TIME` en Postgres: usar `hora::text LIKE $n || '%'` con el prefijo `"HH:MM"` — evita crash por diferencia entre `"HH:MM"` y `"HH:MM:SS"`. |

---

## 7. ARCHIVOS CLAVE

```
bot-factory/
  bot-engine.js          lógica conversacional, jidToPhoneKey, resolución @lid, STEPS
  server.js              endpoints HTTP internos, arranque de bots, bridge LID

panel-secretarias/
  server.js              API REST, cron recordatorios, puente HTTP, billing Stripe,
                         calcAvailableSlots, blocked_slots, notificarCambioEstado
  client/src/
    pages/Dashboard.jsx              tabs Agenda|Rendimiento|Espera + Time-Grid + checkSubscription()
    components/CitaModal.jsx         dropdown dinámico de slots
    components/BlockedSlotsModal.jsx crear/listar/eliminar bloqueos
    components/BotStatusWidget.jsx   widget QR/estado con polling
    components/WaitingListPanel.jsx  lista de espera + oferta ⚡ + fmtFecha() anti-timezone
    components/PatientHistoryModal.jsx
```
