// Pruebas del feedback personalizado (hechos, lecturas, respaldo y lectura de la IA).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { makeWorkouts, same } from "./helpers.mjs";

// feedback-core usa RL_FITNESS para la forma: se cargan los dos en el mismo contexto.
const ctx = { module: { exports: {} } };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../public/js/fitness.js", import.meta.url), "utf8"), ctx);
const FIT = ctx.module.exports;
ctx.RL_FITNESS = FIT;
ctx.module = { exports: {} };
vm.runInContext(readFileSync(new URL("../public/js/feedback-core.js", import.meta.url), "utf8"), ctx);
const C = ctx.module.exports;

const TODAY = "2026-10-13";
const ws = [
  { date: "2026-10-01", sport: "run", title: "Series", completed: true, durationH: 1, plannedH: 1, tss: 70, distanceKm: 12, rpe: 7, feeling: 2, comments: "Muy bien" },
  { date: "2026-10-02", sport: "bike", title: "Fondo", completed: true, durationH: 2, plannedH: 2, tss: 100, distanceKm: 60, rpe: 5, feeling: 2 },
  { date: "2026-10-03", sport: "run", title: "Rodaje", completed: false, plannedH: 1 },
  { date: "2026-10-05", sport: "strength", title: "Fuerza", completed: true, durationH: 0.5, tss: 15 },
  { date: "2026-10-20", sport: "run", title: "Futuro", completed: false, plannedH: 1 },
];

test("periodFacts: sesiones, horas, carga, adherencia y deportes", () => {
  const f = C.periodFacts(ws, "2026-10-01", "2026-10-07", TODAY);
  assert.equal(f.sesiones, 3);
  assert.equal(f.horas, 3.5);
  assert.equal(f.carga, 185);
  assert.equal(f.planificadas, 3);
  assert.equal(f.cumplidas, 2);
  assert.equal(f.perdidas, 1);
  assert.equal(f.adherencia, 67);
  same(f.porDeporte.run, { sesiones: 1, horas: 1, km: 12 });
  assert.equal(f.porDeporte.strength.sesiones, 1);
  assert.equal(f.masLarga.titulo, "Fondo");
  assert.equal(f.comentarios.length, 1);
  assert.equal(f.rpeMedio, 6);
});

test("periodFacts: el hueco máximo cuenta hasta el final del periodo", () => {
  const f = C.periodFacts(ws, "2026-10-01", "2026-10-12", TODAY);
  assert.equal(f.huecoMax, 7, "del 6 al 12 sin entrenar");
  const empty = C.periodFacts([], "2026-10-01", "2026-10-07", TODAY);
  assert.equal(empty.huecoMax, 7);
  assert.equal(empty.adherencia, null);
});

test("periodFacts: las sesiones previstas en el futuro no cuentan como perdidas", () => {
  const f = C.periodFacts(ws, "2026-10-14", "2026-10-27", TODAY);
  assert.equal(f.planificadas, 1);
  assert.equal(f.perdidas, 0);
});

test("periodFacts: semanas constantes con ceil(días/7) semanas", () => {
  const three = makeWorkouts("2026-09-01", 10, (d, i) => ([0, 2, 4, 7, 8, 9].includes(i) ? { sport: "run", completed: true, durationH: 1 } : null));
  const f = C.periodFacts(three, "2026-09-01", "2026-09-10", TODAY);
  assert.equal(f.semanas, 2);
  assert.equal(f.semanasConstantes, 2);
});

test("readings: detecta mejoras y alertas", () => {
  const prev = { horas: 10, adherencia: 70, semanas: 4, semanasConstantes: 2 };
  const cur = { horas: 12, adherencia: 90, cumplidas: 18, planificadas: 20, perdidas: 2, semanas: 4, semanasConstantes: 4, huecoMax: 2, sensacionMedia: 2 };
  const r = C.readings(cur, prev, 50, 56);
  assert.ok(r.up.some((x) => x.startsWith("Más volumen")));
  assert.ok(r.up.some((x) => x.startsWith("Más cumplimiento")));
  assert.ok(r.up.some((x) => x.startsWith("Constancia")));
  assert.ok(r.up.some((x) => x.includes("forma sube")));
  assert.equal(r.watch.length, 0);
  const bad = C.readings({ horas: 6, adherencia: 60, perdidas: 6, semanas: 4, semanasConstantes: 1, huecoMax: 6, sensacionMedia: 4.2 }, prev, 56, 48);
  assert.ok(bad.watch.length >= 5, bad.watch.join(" | "));
  assert.ok(bad.watch.some((x) => x.includes("parón de 6 días")));
});

test("quickRange y previousPeriod", () => {
  same(C.quickRange("7", TODAY), { start: "2026-10-06", end: "2026-10-12" });
  same(C.quickRange("month", TODAY), { start: "2026-09-01", end: "2026-09-30" });
  same(C.quickRange("year", TODAY), { start: "2026-01-01", end: "2026-10-12" });
  same(C.quickRange("month", "2026-01-15"), { start: "2025-12-01", end: "2025-12-31" });
  same(C.quickRange("year", "2026-01-01"), { start: "2026-01-01", end: "2026-01-01" });
  same(C.previousPeriod("2026-10-06", "2026-10-12"), { prevStart: "2026-09-29", prevEnd: "2026-10-05", len: 7 });
});

test("previousSteps: el último feedback anterior con pasos", () => {
  const fbs = [
    { start: "2026-09-01", end: "2026-09-28", pasos: ["Tirada larga cada domingo"] },
    { start: "2026-08-01", end: "2026-08-28", pasos: ["Antiguo"] },
    { start: "2026-09-29", end: "2026-10-12", pasos: ["Mismo periodo"] },
  ];
  same(C.previousSteps(fbs, "2026-09-29", "2026-10-12"), { fecha: "2026-09-28", pasos: ["Tirada larga cada domingo"] });
  assert.equal(C.previousSteps([], "2026-09-29", "2026-10-12"), null);
});

test("buildFacts + buildPrompt incluyen los pasos anteriores y la forma", () => {
  const long = makeWorkouts("2026-06-01", 133, (d, i) => (i % 2 ? null : { sport: "run", completed: true, durationH: 1, plannedH: 1, tss: 60 }));
  const series = FIT.fitnessSeries(long, { to: "2026-10-12" });
  const f = C.buildFacts({ workouts: long, series, start: "2026-09-15", end: "2026-10-12", today: TODAY, name: "Lucía Ferrer",
    feedbacks: [{ start: "2026-08-18", end: "2026-09-14", pasos: ["Dormir 8 horas"] }], nextRace: { name: "Media de ejemplo", date: "2026-11-15" } });
  assert.equal(f.cur.days, 28);
  assert.equal(f.prev.start, "2026-08-18");
  assert.ok(f.forma.inicio > 0 && f.forma.fin > 0);
  const prompt = C.buildPrompt(f, { tone: "cercano", length: "breve" });
  assert.match(prompt, /Hola Lucía!/);
  assert.match(prompt, /Dormir 8 horas/);
  assert.match(prompt, /si se cumplieron/);
  assert.match(prompt, /"escrito"/);
});

test("fallback: nunca se queda en blanco y respeta las secciones", () => {
  const f = { name: "Elena Soto", cur: { sesiones: 0, horas: 0, adherencia: null, huecoMax: 7 }, lecturas: { up: [], watch: [] }, next: null, prevSteps: { fecha: "2026-09-01", pasos: ["Nadar 3 veces"] } };
  const out = C.fallback(f);
  assert.equal(out.fallback, true);
  assert.match(out.escrito, /^Hola Elena!/);
  for (const s of ["*Lo que hemos mejorado*", "*Lo que hay que seguir mejorando*", "*Próximos pasos*", "Nadar 3 veces"]) assert.ok(out.escrito.includes(s), s);
  assert.ok(out.audio.length > 40);
  assert.equal(out.pasos.length, 3);
  assert.ok(out.pasos[1].includes("3 días"), "con un parón largo propone no pasar de 3 días");
});

test("parseAI: JSON con texto alrededor, listas que no son listas y respuestas vacías", () => {
  const ok = C.parseAI('Aquí va:\n```json\n{"escrito":"Hola Lucía!","audio":"Hola","mejorado":["a",2],"mejorar":"no es lista","pasos":["x"]}\n```');
  same(ok, { escrito: "Hola Lucía!", audio: "Hola", mejorado: ["a", "2"], mejorar: [], pasos: ["x"] });
  assert.equal(C.parseAI("sin json"), null);
  assert.equal(C.parseAI('{"escrito":"   "}'), null);
  assert.equal(C.parseAI("{roto"), null);
  assert.equal(C.parseAI("", { escrito: "Desde el servidor", pasos: ["p"] }).escrito, "Desde el servidor");
});
