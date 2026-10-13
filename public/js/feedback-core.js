// Lógica pura del feedback personalizado (sin DOM ni red): hechos del periodo
// y del anterior de igual duración, lecturas objetivas (va a mejor / a
// vigilar), prompt para la IA, texto de respaldo y lectura de la respuesta.
// Portado del módulo de feedback del Session Builder, con los entrenos de la
// base de datos propia en lugar de TrainingPeaks.
"use strict";

(function (root) {
  const DAY = 86400000;
  const SPORT_LABEL = { swim: "natación", bike: "bici", run: "carrera", strength: "fuerza", other: "otros" };
  const toT = (iso) => Date.parse(iso + "T00:00:00Z");
  const isoOf = (t) => new Date(t).toISOString().slice(0, 10);
  const addDays = (iso, n) => isoOf(toT(iso) + n * DAY);
  const r1 = (v) => Math.round(v * 10) / 10;
  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
  const MIN_SESSIONS_CONSISTENT_WEEK = 3;

  // Periodos rápidos: "7", "28", "90" días hasta ayer, "month" (mes pasado) y "year" (desde el 1 de enero).
  function quickRange(kind, today) {
    const yesterday = addDays(today, -1);
    const [y, m] = today.split("-").map(Number);
    if (kind === "month") {
      const start = isoOf(Date.UTC(y, m - 2, 1));
      return { start, end: isoOf(Date.UTC(y, m - 1, 0)) };
    }
    if (kind === "year") {
      const start = `${y}-01-01`;
      return { start, end: yesterday < start ? start : yesterday };
    }
    const days = parseInt(kind, 10) || 28;
    return { start: addDays(today, -days), end: yesterday };
  }

  function previousPeriod(start, end) {
    const len = Math.round((toT(end) - toT(start)) / DAY) + 1;
    return { prevStart: addDays(start, -len), prevEnd: addDays(start, -1), len };
  }

  // Hechos del periodo [start, end]. `today` decide qué sesiones planificadas
  // ya cuentan como perdidas (las futuras no).
  function periodFacts(ws, start, end, today) {
    const hoy = today || isoOf(Date.now());
    const inP = (ws || []).filter((w) => w.date >= start && w.date <= end);
    const done = inP.filter((w) => w.completed);
    const planned = inP.filter((w) => (w.plannedH || 0) > 0);
    const plannedDone = planned.filter((w) => w.completed);
    const missed = planned.filter((w) => !w.completed && w.date < hoy);
    const days = Math.max(1, Math.round((toT(end) - toT(start)) / DAY) + 1);
    const bySport = {};
    for (const w of done) {
      const s = SPORT_LABEL[w.sport] ? w.sport : "other";
      const b = bySport[s] || { n: 0, h: 0, km: 0 };
      bySport[s] = { n: b.n + 1, h: b.h + (w.durationH || 0), km: b.km + (w.distanceKm || 0) };
    }
    const dates = [...new Set(done.map((w) => w.date))].sort();
    const bounds = [addDays(start, -1), ...dates, addDays(end, 1)];
    let gap = 0;
    for (let i = 1; i < bounds.length; i++) gap = Math.max(gap, Math.round((toT(bounds[i]) - toT(bounds[i - 1])) / DAY) - 1);
    const weeks = Math.max(1, Math.ceil(days / 7));
    const weekOf = (w) => Math.floor((toT(w.date) - toT(start)) / DAY / 7);
    const weekCounts = Array.from({ length: weeks }, (_, k) => done.filter((w) => weekOf(w) === k).length);
    const longest = done.slice().sort((a, b) => (b.durationH || 0) - (a.durationH || 0))[0] || null;
    const avg = (arr) => (arr.length ? r1(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
    return {
      start, end, days,
      sesiones: done.length, sesionesSemana: r1(done.length / (days / 7)),
      horas: r1(done.reduce((a, w) => a + (w.durationH || 0), 0)),
      carga: Math.round(done.reduce((a, w) => a + (w.tss || 0), 0)),
      planificadas: planned.length, cumplidas: plannedDone.length, perdidas: missed.length,
      adherencia: planned.length ? Math.round((plannedDone.length / planned.length) * 100) : null,
      semanasConstantes: weekCounts.filter((n) => n >= MIN_SESSIONS_CONSISTENT_WEEK).length, semanas: weeks,
      huecoMax: gap,
      porDeporte: Object.fromEntries(Object.entries(bySport).map(([k, v]) => [k, { sesiones: v.n, horas: r1(v.h), km: Math.round(v.km) }])),
      masLarga: longest ? { titulo: longest.title, fecha: longest.date, minutos: Math.round((longest.durationH || 0) * 60), km: longest.distanceKm } : null,
      sensacionMedia: avg(done.filter((w) => w.feeling != null).map((w) => w.feeling)),
      rpeMedio: avg(done.filter((w) => w.rpe != null).map((w) => w.rpe)),
      comentarios: done.filter((w) => w.comments).slice(-6).map((w) => `${w.date} (${w.title || "sesión"}): ${String(w.comments).replace(/\s+/g, " ").slice(0, 220)}`),
    };
  }

  // Lecturas objetivas: qué ha ido a mejor y qué vigilar.
  function readings(cur, prev, ctl0, ctl1) {
    const up = [], watch = [];
    if (prev.horas && cur.horas >= prev.horas * 1.08) up.push(`Más volumen: ${cur.horas} h frente a ${prev.horas} h (+${pct(cur.horas, prev.horas)} %).`);
    if (cur.adherencia != null && prev.adherencia != null && cur.adherencia >= prev.adherencia + 5) up.push(`Más cumplimiento del plan: ${cur.adherencia} % frente a ${prev.adherencia} %.`);
    if (cur.adherencia != null && cur.adherencia >= 85) up.push(`Cumplimiento alto: ${cur.cumplidas} de ${cur.planificadas} sesiones previstas.`);
    if (cur.semanas >= 2 && cur.semanasConstantes === cur.semanas) up.push(`Constancia: todas las semanas con ${MIN_SESSIONS_CONSISTENT_WEEK} sesiones o más.`);
    if (ctl0 != null && ctl1 != null && ctl1 >= ctl0 + 3) up.push(`La forma sube de ${Math.round(ctl0)} a ${Math.round(ctl1)}.`);
    if (cur.adherencia != null && cur.adherencia < 75) watch.push(`Cumplimiento del ${cur.adherencia} %: ${cur.perdidas} sesiones previstas sin hacer.`);
    if (cur.huecoMax >= 5) watch.push(`Un parón de ${cur.huecoMax} días seguidos sin entrenar.`);
    if (prev.horas && cur.horas < prev.horas * 0.8) watch.push(`Volumen a la baja: ${cur.horas} h frente a ${prev.horas} h.`);
    if (ctl0 != null && ctl1 != null && ctl1 < ctl0 - 5) watch.push(`La forma baja de ${Math.round(ctl0)} a ${Math.round(ctl1)}.`);
    if (cur.semanas >= 2 && cur.semanasConstantes < cur.semanas / 2) watch.push(`Constancia irregular: ${cur.semanasConstantes} de ${cur.semanas} semanas con ${MIN_SESSIONS_CONSISTENT_WEEK} sesiones o más.`);
    if (cur.sensacionMedia != null && cur.sensacionMedia >= 4) watch.push("Sensaciones marcadas como malas en buena parte de las sesiones.");
    return { up, watch };
  }

  // Último feedback guardado anterior a este periodo, con sus próximos pasos.
  function previousSteps(feedbacks, start, end) {
    const h = (feedbacks || []).filter((f) => f.end < end && !(f.start === start && f.end === end))
      .sort((a, b) => (b.end || "").localeCompare(a.end || ""))[0];
    return h && Array.isArray(h.pasos) && h.pasos.length ? { fecha: h.end, pasos: h.pasos } : null;
  }

  function buildPrompt(f, opts) {
    const o = opts || {};
    const name = (f.name || "").split(" ")[0] || "tu deportista";
    const size = o.length === "breve" ? "escrito 130-190 palabras; audio 110-160 palabras" : "escrito 260-400 palabras; audio 200-300 palabras";
    const tone = { cercano: "cercano y directo", motivador: "motivador, con energía pero sin frases vacías", tecnico: "algo más técnico, explicando el porqué de cada dato sin perder cercanía" }[o.tone] || "cercano y directo";
    const steps = f.prevSteps ? `\nPASOS DEL FEEDBACK ANTERIOR (${f.prevSteps.fecha}): ${JSON.stringify(f.prevSteps.pasos)}. Di claramente, uno por uno, si se cumplieron, a la vista de los datos.` : "";
    return `Redacta el FEEDBACK PERSONALIZADO del periodo ${f.cur.start} a ${f.cur.end} para ${name}. Antes de escribir, analiza los datos: qué ha mejorado de verdad frente al periodo anterior, qué hay que seguir mejorando y qué hacemos ahora.

DATOS DEL PERIODO (JSON, calculados de su registro de entrenos; no inventes cifras)
${JSON.stringify({ periodo: f.cur, periodoAnterior: f.prev, forma: f.forma, lecturas: f.lecturas, proximaCompeticion: f.next, pasosDelFeedbackAnterior: f.prevSteps })}
${steps}${o.focus ? `\nFOCO QUE PIDE EL ENTRENADOR: ${o.focus}` : ""}${f.ctx ? `\nCONTEXTO DEL DEPORTISTA\n${f.ctx}` : ""}

DEVUELVE SOLO UN JSON con estas claves:
- "escrito": mensaje para WhatsApp, empieza "Hola ${name}!". Cuatro bloques con su título en una línea propia entre asteriscos (*Lo que hemos mejorado*, *Lo que hay que seguir mejorando*, *Próximos pasos*, y un cierre de ánimo sin título). Próximos pasos: 2-4 acciones concretas y medibles para el siguiente periodo.${f.prevSteps ? " Incluye si se cumplieron los pasos del feedback anterior." : ""}
- "audio": el mismo mensaje para leerlo en voz alta como nota de voz: frases cortas, sin asteriscos, sin listas, sin siglas ni símbolos, máximo 4 cifras dichas como se dicen en voz alta ("cuatro horas y media").
- "mejorado": lista de 2-4 frases cortas.
- "mejorar": lista de 1-3 frases cortas.
- "pasos": lista de 2-4 acciones concretas.
Tono ${tone}. Extensión: ${size}. Castellano de España. Cita datos concretos suyos (2-4 en el escrito), traduce siglas (carga, forma, frescura) y nunca reproches: lo que faltó se recoloca.`;
  }

  // Texto de respaldo si la IA no responde: el módulo nunca se queda en blanco.
  function fallback(f) {
    const name = (f.name || "").split(" ")[0] || "";
    const up = f.lecturas.up.length ? f.lecturas.up.slice(0, 4) : [`Has sumado ${f.cur.sesiones} sesiones y ${f.cur.horas} horas en el periodo.`];
    const watch = f.lecturas.watch.length ? f.lecturas.watch.slice(0, 3) : ["Mantener la constancia de estas semanas."];
    const pasos = [
      f.cur.adherencia != null && f.cur.adherencia < 85 ? "Asegurar las sesiones clave de la semana aunque haya que acortar las demás." : "Mantener el mismo reparto de sesiones las próximas semanas.",
      f.cur.huecoMax >= 5 ? "No pasar más de 3 días seguidos sin moverte; si la semana se complica, 30 minutos suaves cuentan." : "Seguir sin huecos largos entre sesiones.",
      f.next ? `Enfocar las próximas semanas hacia ${f.next.name} (${f.next.date}).` : "Marcar una prueba o un test como objetivo de las próximas semanas.",
    ];
    const review = f.prevSteps ? `\n\n*Lo que nos marcamos la última vez*\n${f.prevSteps.pasos.map((p) => "· " + p).join("\n")}\nLo repasamos juntos con los datos de este periodo.` : "";
    const bullets = (arr) => arr.map((x) => "· " + x).join("\n");
    const escrito = `Hola${name ? " " + name : ""}!${review}\n\n*Lo que hemos mejorado*\n${bullets(up)}\n\n*Lo que hay que seguir mejorando*\n${bullets(watch)}\n\n*Próximos pasos*\n${bullets(pasos)}\n\nVas por muy buen camino: seguimos sumando y ajustamos sobre la marcha.`;
    const audio = `Hola${name ? " " + name : ""}. Te cuento cómo vemos este periodo. ${up.slice(0, 2).join(" ")} Lo que tenemos que seguir trabajando: ${watch.slice(0, 2).join(" ")} Para las próximas semanas: ${pasos.slice(0, 2).join(" ")} Vas muy bien, seguimos.`;
    return { escrito, audio, mejorado: up, mejorar: watch, pasos, fallback: true };
  }

  // Respuesta de la IA → {escrito, audio, mejorado[], mejorar[], pasos[]} o null.
  function parseAI(content, json) {
    let o = json && typeof json === "object" ? json : null;
    if (!o) {
      const txt = String(content || "").replace(/```(?:json)?/gi, "").trim();
      const a = txt.indexOf("{"), b = txt.lastIndexOf("}");
      if (a < 0 || b <= a) return null;
      try { o = JSON.parse(txt.slice(a, b + 1)); } catch { return null; }
    }
    if (!o || typeof o.escrito !== "string" || !o.escrito.trim()) return null;
    const list = (x) => (Array.isArray(x) ? x.map((v) => String(v ?? "").trim()).filter(Boolean).slice(0, 8) : []);
    return { escrito: o.escrito.trim(), audio: typeof o.audio === "string" ? o.audio.trim() : "", mejorado: list(o.mejorado), mejorar: list(o.mejorar), pasos: list(o.pasos) };
  }

  // Ensambla todos los hechos a partir de los entrenos y la serie de forma.
  function buildFacts(input) {
    const { workouts, series, start, end, today, name, feedbacks, nextRace, ctx } = input;
    const { prevStart, prevEnd } = previousPeriod(start, end);
    const cur = periodFacts(workouts, start, end, today), prev = periodFacts(workouts, prevStart, prevEnd, today);
    const p0 = root.RL_FITNESS ? root.RL_FITNESS.pointAt(series, start) : null;
    const p1 = root.RL_FITNESS ? root.RL_FITNESS.pointAt(series, end) : null;
    const ctl0 = p0 ? p0.ctl : null, ctl1 = p1 ? p1.ctl : null;
    return {
      name, cur, prev, lecturas: readings(cur, prev, ctl0, ctl1), next: nextRace || null,
      forma: { inicio: ctl0 != null ? Math.round(ctl0) : null, fin: ctl1 != null ? Math.round(ctl1) : null, frescuraAlFinal: p1 ? Math.round(p1.tsb) : null },
      prevSteps: previousSteps(feedbacks, start, end), ctx: ctx || "",
    };
  }

  const API = { SPORT_LABEL, quickRange, previousPeriod, periodFacts, readings, previousSteps, buildPrompt, fallback, parseAI, buildFacts, addDays };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.RL_FEEDBACK_CORE = API;
})(typeof window !== "undefined" ? window : globalThis);
