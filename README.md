# APD Race Lab

Herramienta web para entrenadores de deportes de resistencia (carrera, ciclismo y triatlón). Proyecto creado el 13 de octubre de 2026 para el **Hackathon de Vibe Coding E7 de Big School**.

> Todos los datos de la cuenta de prueba (deportistas, entrenos, estrategias) son **ficticios** y se generan con un script determinista.

## Cuenta de prueba

| Email | Contraseña |
|---|---|
| `jurado@apdracelab.demo` | `RaceLab-E7-2026` |

La pantalla de acceso muestra estas credenciales y un botón para rellenarlas. No hay registro público: las cuentas se crean con el script de semilla.

## Qué hace

1. **Deportistas**
   - Alta, edición y borrado de deportistas: nombre, deporte principal (carrera, ciclismo o triatlón), FTP (W), ritmo umbral (min:seg/km), VDOT, CSS de natación (min:seg/100 m), LTHR, peso y notas.
   - Registro de entrenos: alta manual, borrado e importación CSV con el formato de exportación de TrainingPeaks (`Title`, `WorkoutType`, `WorkoutDay`, `TimeTotalInHours`, `DistanceInMeters`, `TSS`, `PlannedDuration`, `Rpe`, `Feeling`, `AthleteComments`). La importación detecta el separador (`,` o `;`), reconoce las columnas sin importar mayúsculas, tildes ni espacios, admite decimales con coma, deja corregir el mapeo de columnas a mano, enseña una vista previa con las filas válidas y omitidas, omite duplicados y acepta como máximo 3000 filas.
   - Forma (CTL, media exponencial de 42 días), fatiga (ATL, 7 días) y frescura (TSB = CTL - ATL del día anterior), calculadas en el navegador a partir de la carga diaria, con un gráfico SVG.
2. **Estrategia de competición**
   - Pacing y nutrición con tres escenarios (optimista, normal y menos favorable) para carrera, ciclismo o triatlón, a partir de un track GPX/TCX o de distancia y desnivel.
   - Usa los umbrales del deportista y su forma actual (CTL) calculada con su registro.
   - Preguntas: intensidad, temperatura, viento, tolerancia a los hidratos, sudoración, cafeína, experiencia y notas.
   - Resultado: tarjetas de escenarios, perfil de altimetría, tabla por tramos (ritmo o potencia objetivo, paso acumulado y tomas), claves, lista previa a la carrera y avisos.
   - Guarda las estrategias en el servidor, tarjeta imprimible en A4 con pulsera recortable, texto para WhatsApp y explicación del entrenador redactada por IA (opcional).
3. **Feedback personalizado**
   - Eliges deportista y periodo (última semana, 4 semanas, mes pasado, 3 meses, desde el 1 de enero o fechas libres) y se compara con el periodo anterior de igual duración.
   - Hechos: sesiones, horas, carga, cumplimiento del plan, hueco más largo sin entrenar, semanas constantes (`ceil(días/7)` semanas con 3 sesiones o más), reparto por deporte, forma al inicio y al final, y comentarios del deportista. Con ellos salen las lecturas «va a mejor» y «a vigilar».
   - La IA redacta un JSON `{escrito, audio, mejorado[], mejorar[], pasos[]}` con «Lo que hemos mejorado», «Lo que hay que seguir mejorando», «Próximos pasos» y un cierre de ánimo, en dos versiones editables: escrita (WhatsApp) y hablada (nota de voz).
   - Botones: Copiar, Abrir en WhatsApp, ▶ Escuchar / ■ Parar (síntesis de voz es-ES), Informe PDF y Guardar.
   - El siguiente feedback del mismo deportista recibe los `pasos` del anterior y dice si se cumplieron.
   - Si la IA falla o se agota la cuota, sale un texto de respaldo calculado con los datos: el módulo nunca se queda en blanco.

## Arquitectura

```
Navegador (HTML + CSS + JS sin frameworks ni compilación)
  public/index.html
  public/js/util.js          escape HTML, fechas, ritmos, avisos
  public/js/api.js           cliente /api (Bearer en localStorage) + caché de deportistas
  public/js/fitness.js       CTL / ATL / TSB y gráfico SVG            (puro, probado en Node)
  public/js/csv.js           importación CSV tolerante                (puro, probado en Node)
  public/js/race-engine.js   motor de pacing y nutrición (copiado tal cual del Session Builder, probado en Node)
  public/js/feedback-core.js hechos, lecturas, prompt, respaldo, parseo (puro, probado en Node)
  public/js/athletes.js · import.js · race.js · race-view.js · feedback.js · print.js · app.js  (interfaz)
        │  fetch JSON {ok, data?, error?}
        ▼
Cloudflare Worker  src/worker.js  (run_worker_first para /api/*; el resto lo sirve ASSETS)
  src/auth.js        PBKDF2-SHA256 100 000 iteraciones, sesiones de 30 días, límite de intentos
  src/validate.js    validación de entradas (tipos, rangos, longitudes, fechas AAAA-MM-DD)
  src/routes/athletes.js · plans.js · feedbacks.js · ai.js
  src/ai-json.js     extracción robusta del JSON que devuelve el modelo
        │                         │
        ▼                         ▼
  D1 (binding DB)            Workers AI (binding AI)
  apd-race-lab-db            @cf/meta/llama-3.3-70b-instruct-fp8-fast
```

Seguridad:
- Cada consulta va acotada al usuario de la sesión y se comprueba la propiedad del deportista, el entreno, la estrategia o el feedback en cada ruta.
- Solo consultas parametrizadas; cuerpos JSON con tope de tamaño (16 KB a 2 MB según la ruta) y `content-type` obligatorio.
- El token de sesión son 32 bytes aleatorios en hex. En D1 se guarda solo su SHA-256.
- Máximo 5 intentos fallidos de acceso cada 15 minutos por email.
- 40 llamadas a la IA por usuario y día.
- CSP estricta en `public/_headers` y escape de todo texto interpolado en HTML con `esc()`.

## Modelo de datos (`schema.sql`)

| Tabla | Contenido |
|---|---|
| `users` | email, nombre, sal y hash PBKDF2 |
| `sessions` | hash SHA-256 del token, usuario, caducidad (30 días) |
| `login_attempts` | intentos fallidos por email y momento (ventana de 15 min) |
| `ai_usage` | llamadas a la IA por usuario y día (cuota 40) |
| `athletes` | deportistas del usuario con sus umbrales y notas |
| `workouts` | entrenos: fecha, deporte, título, duración hecha y planificada, distancia, TSS, RPE, sensación, comentarios, hecho; índice `(athlete_id, date)` |
| `race_plans` | estrategias guardadas: formulario y recorrido ya convertido en tramos (JSON), resumen |
| `feedbacks` | feedbacks guardados: periodo, textos y listas `mejorado`, `mejorar`, `pasos` |

## Cómo ejecutarlo en local

Requisitos: Node 20 o superior y Wrangler 4 (`npx wrangler`).

```bash
cd apd-race-lab
npm test                                   # pruebas de Node (motor, forma, feedback, CSV y Worker)
npm run seed                               # regenera seed.sql (opcional; ya viene generado)
npx wrangler d1 execute apd-race-lab-db --local --file schema.sql
npx wrangler d1 execute apd-race-lab-db --local --file seed.sql
npx wrangler dev                           # http://localhost:8787
```

- En local, D1 funciona con el `database_id` de marcador (`REPLACE_WITH_D1_ID`).
- Workers AI siempre usa la cuenta remota, también en `wrangler dev`, y necesita `npx wrangler login`. Sin IA, el feedback usa su texto de respaldo y la estrategia funciona igual.
- `SEED_END=AAAA-MM-DD npm run seed` mueve el último día con entrenos hechos (por defecto el 12/10/2026) para que los periodos rápidos tengan datos si se revisa más tarde.

## Despliegue en Cloudflare

```bash
npx wrangler d1 create apd-race-lab-db                     # copia el database_id que devuelve
# pega el id en wrangler.jsonc, en lugar de REPLACE_WITH_D1_ID
npx wrangler d1 execute apd-race-lab-db --remote --file schema.sql
npx wrangler d1 execute apd-race-lab-db --remote --file seed.sql
npx wrangler deploy
```

## Modelos y supuestos

- **Carrera**
  - Tiempo en llano por VDOT de Daniels-Gilbert o, si no hay VDOT, por ritmo umbral con la fórmula de Riegel (exponente 1,06).
  - Ajuste por pendiente estilo GAP: +3,3 % de coste por cada 1 % de subida y descenso con un mínimo hacia el -8 %.
  - Penalizaciones por calor (por encima de 12 °C, según la duración), viento, terreno (trail y trail técnico) y falta de fondo (CTL baja para la duración prevista).
  - Primer tramo unos segundos más lento.
- **Ciclismo**
  - Intensidad sostenible (IF) según la duración, interpolada en escala logarítmica: de 1,03 en 30 min a 0,52 en 24 h, ajustada por la intensidad elegida, el calor y la forma.
  - La potencia se reparte por pendiente manteniendo la potencia normalizada objetivo.
  - Velocidad por la ecuación de potencia: rodadura, gravedad y aerodinámica con CdA y Crr según la bicicleta, densidad del aire por altitud y rendimiento de transmisión de 0,975.
- **Triatlón**
  - Natación sobre el CSS con un factor por distancia, neopreno y temperatura.
  - Bici con el IF de la distancia (de 0,90 en sprint a 0,70 en Ironman).
  - Carrera a pie a un porcentaje del umbral que refleja la fatiga de la bici, más las transiciones.
- **Escenarios**: optimista (+2,5 % de rendimiento, +3 % de potencia, 3 °C menos), normal, y menos favorable (-4 % y -5 %, 5 °C más y más viento).
- **Nutrición**
  - Hidratos de 30 a 90 g/h según la duración, con tope según la tolerancia entrenada (60, 80 o 110 g/h); en carrera a pie, algo menos.
  - Líquido de 400 a 750 ml/h según la sudoración, más 20 ml/h por cada grado por encima de 18 °C, con tope de 800 ml/h corriendo y 1 l/h en bici.
  - Sodio de 350 a 1000 mg por litro.
  - Cafeína de 3 mg/kg: 2 mg/kg antes y el resto en la segunda mitad si la prueba pasa de 2 h.
  - Tomas cada 20 o 30 minutos.
  - Carga de hidratos de 8 a 10 g/kg y desayuno de 1,5 a 2,5 g/kg.
- **Forma**: CTL y ATL son medias exponenciales de la carga diaria (constantes de 42 y 7 días, al estilo de TrainingPeaks). La TSB del día es CTL - ATL de la víspera. Un entreno hecho sin TSS cuenta 50 por hora.
- **Sensación**: escala de 1 (muy bien) a 5 (muy mal), igual que el módulo de origen. Una media de 4 o más se marca «a vigilar».

## Pruebas

`npm test` ejecuta 47 pruebas con `node:test`, sin dependencias:

| Archivo | Qué cubre |
|---|---|
| `race-engine.test.mjs` | Pruebas originales del motor: VDOT, carrera llana, escenarios, desnivel, física de bici, IF, nutrición, triatlón, GPX/TCX, tramos |
| `fitness.test.mjs` | CTL/ATL/TSB, carga estimada, puntos en fecha, gráfico |
| `feedback.test.mjs` | Hechos del periodo, hueco máximo, semanas constantes, lecturas, periodos rápidos, pasos anteriores, prompt, respaldo, `parseAI` |
| `csv.test.mjs` | Separador, comillas, mapeo de cabeceras, números y fechas, deportes, filas omitidas, mapeo manual, tope de 3000 filas |
| `worker.test.mjs` | Validadores, PBKDF2 del Worker frente a `node:crypto` (el de la semilla), rutas 404/405, lotes de importación, `readJson`, extracción de JSON |

Nota: el script de pruebas es `node --test test/*.test.mjs`, porque Node 24 no acepta un directorio (`node --test test/`).

## Limitaciones

- Los modelos de pacing y nutrición son estimaciones generales. No sustituyen al criterio del entrenador ni a un test de laboratorio.
- La importación CSV no lee la potencia, el pulso ni los archivos FIT. La carga sin TSS se estima por duración.
- El límite de intentos de acceso va por email, no por IP. No hay recuperación de contraseña ni registro público.
- El token se guarda en `localStorage`: es cómodo para la demo, pero queda expuesto si alguna vez hubiera un XSS (mitigado con CSP y escape de HTML).
- La impresión depende de que el navegador permita la ventana emergente.
- La síntesis de voz depende de las voces es-ES que tenga el sistema.
- La interfaz es solo en castellano y con tema oscuro.
- `race-engine.js` (543 líneas) se ha copiado sin cambios desde el Session Builder junto con sus pruebas.
