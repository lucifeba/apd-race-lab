#!/usr/bin/env node
// Genera el SQL de la cuenta de demostración por stdout (npm run seed > seed.sql).
// TODO es ficticio: la cuenta del jurado, los tres deportistas y sus ~200 días
// de entrenos sintéticos (estructura semanal, bloques 3+1, planificado frente
// a realizado, sesiones perdidas, progresión y algún comentario). El generador
// es determinista (PRNG con semilla); solo la sal de la contraseña es aleatoria.
// SEED_END=AAAA-MM-DD cambia el último día con entrenos hechos.

import { pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const DEMO = { id: 1, email: "jurado@apdracelab.demo", name: "Jurado Hackathon", password: "RaceLab-E7-2026" };
const PBKDF2_ITERATIONS = 100000;
const HISTORY_DAYS = 200;
const PLAN_AHEAD_DAYS = 14;
const END = process.env.SEED_END || "2026-10-12";
const CREATED_AT = Date.parse("2026-10-13T08:00:00Z");
const DAY = 86400000;

if (!/^\d{4}-\d{2}-\d{2}$/.test(END) || Number.isNaN(Date.parse(END))) {
  process.stderr.write("SEED_END debe tener el formato AAAA-MM-DD\n");
  process.exit(1);
}

// ---------- utilidades ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261013);
const between = (a, b) => a + (b - a) * rnd();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const q = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

function loadBrowserModule(rel) {
  const sandbox = { module: { exports: {} }, globalThis: {} };
  vm.runInNewContext(readFileSync(new URL(rel, import.meta.url), "utf8"), sandbox);
  return sandbox.module.exports;
}
const ENGINE = loadBrowserModule("../public/js/race-engine.js");
const FITNESS = loadBrowserModule("../public/js/fitness.js");

// ---------- deportistas ficticios ----------
// Plantilla semanal por día (0 = domingo): [deporte, título, horas, IF].
const ATHLETES = [
  {
    id: 1, name: "Lucía Ferrer (ficticia)", sport: "run", ftp: null, runPaceSec: 245, vdot: 52.5, swimCssSec: null, lthr: 176, weight: 55.5,
    notes: "Deportista ficticia de demostración. Corredora de asfalto; objetivo media maratón en noviembre. Tiende a salir rápida en las series.",
    miss: 0.06,
    week: {
      1: [], 2: [["run", "Series 6x1000 m", 1.0, 0.88]], 3: [["run", "Rodaje suave", 0.8, 0.68]],
      4: [["run", "Tempo 3x10 min", 1.0, 0.84]], 5: [["strength", "Fuerza y core", 0.6, 0.55]],
      6: [["run", "Rodaje con progresivos", 0.75, 0.72]], 0: [["run", "Tirada larga", 1.35, 0.74]],
    },
  },
  {
    id: 2, name: "Marcos Ibáñez (ficticio)", sport: "bike", ftp: 285, runPaceSec: null, vdot: null, swimCssSec: null, lthr: 168, weight: 72,
    notes: "Deportista ficticio de demostración. Ciclista de gran fondo; rueda bien en grupo pero le cuesta comer en carrera.",
    miss: 0.07,
    week: {
      1: [], 2: [["bike", "Rodillo VO2 5x4 min", 1.25, 0.86]], 3: [["bike", "Fondo en zona 2", 2.0, 0.68]],
      4: [["bike", "Sweet spot 3x15 min", 1.5, 0.83]], 5: [["bike", "Recuperación activa", 1.0, 0.55]],
      6: [["bike", "Salida larga", 3.5, 0.72]], 0: [["bike", "Grupeta con cambios de ritmo", 2.5, 0.76]],
    },
  },
  {
    id: 3, name: "Elena Soto (ficticia)", sport: "tri", ftp: 215, runPaceSec: 280, vdot: 45.5, swimCssSec: 105, lthr: 171, weight: 60.5,
    notes: "Deportista ficticia de demostración. Triatleta de distancia olímpica; la natación es su punto fuerte y la bici está en progresión.",
    miss: 0.08,
    week: {
      1: [["swim", "Técnica y series 10x100 m", 1.0, 0.75]],
      2: [["bike", "Rodillo umbral 3x12 min", 1.25, 0.84], ["run", "Transición 20 min", 0.33, 0.78]],
      3: [["run", "Series 5x1000 m", 1.0, 0.86], ["swim", "Aeróbico 2500 m", 0.9, 0.7]],
      4: [["bike", "Fondo en zona 2", 1.5, 0.68]],
      5: [["swim", "Ritmo de competición", 0.9, 0.78], ["strength", "Fuerza y core", 0.5, 0.55]],
      6: [["bike", "Salida larga", 2.75, 0.72], ["run", "Carrera a pie tras la bici", 0.33, 0.8]],
      0: [["run", "Tirada larga", 1.25, 0.73]],
    },
  },
];

const COMMENTS = [
  "Muy buenas sensaciones, los últimos kilómetros más rápido sin forzar.",
  "Piernas cargadas del trabajo, pero completo.",
  "Calor fuerte; bajé un poco el ritmo para no pasarme.",
  "Me costó arrancar, a partir del minuto 20 fino.",
  "Dormí poco y lo noté en las series.",
  "Sesión perfecta, controlando el pulso todo el rato.",
  "Molestia leve en el gemelo al final, nada importante.",
  "Viento de cara en la vuelta, se hizo largo.",
];

// Pausas ficticias: días (desde el inicio) en los que se pierden las sesiones previstas.
const BREAKS = { 2: { from: 120, to: 127, back: "Vuelvo de vacaciones: piernas pesadas pero con ganas." }, 3: { from: 182, to: 187, back: "Ya recuperada del resfriado, todavía sin chispa." } };
const TEST_DAY = { 1: { day: 171, title: "10K popular (test)", h: 0.67, IF: 1.0, comment: "Carrera de 10K como test: ritmo muy constante y final fuerte." } };

function distanceKm(sport, ath, h, IF) {
  if (sport === "run") return r1((h * 3600) / (ath.runPaceSec / (0.45 + 0.55 * IF)) );
  if (sport === "bike") return r1(h * (22 + 14 * IF));
  if (sport === "swim") return r2(h * 2.6 * (0.85 + 0.2 * IF));
  return null;
}

function session(ath, date, sport, title, plannedH, IF, done) {
  if (!done) return { athlete_id: ath.id, date, sport, title, duration_h: null, planned_h: r2(plannedH), distance_km: null, tss: null, rpe: null, feeling: null, comments: null, completed: 0 };
  const h = r2(plannedH * between(0.88, 1.08));
  const intensity = IF * between(0.97, 1.03);
  const roll = rnd();
  return {
    athlete_id: ath.id, date, sport, title, duration_h: h, planned_h: r2(plannedH), distance_km: distanceKm(sport, ath, h, intensity),
    tss: Math.round(h * intensity * intensity * 100), rpe: Math.max(1, Math.min(10, Math.round(intensity * 10 - 1 + between(-1, 1)))),
    feeling: roll < 0.25 ? 1 : roll < 0.8 ? 2 : roll < 0.95 ? 3 : 4, comments: rnd() < 0.05 ? pick(COMMENTS) : null, completed: 1,
  };
}

function workoutsFor(ath) {
  const out = [];
  const endT = Date.parse(END + "T00:00:00Z");
  const startT = endT - (HISTORY_DAYS - 1) * DAY;
  const totalWeeks = Math.ceil(HISTORY_DAYS / 7);
  let pendingBack = null;
  for (let i = 0; i < HISTORY_DAYS + PLAN_AHEAD_DAYS; i++) {
    const t = startT + i * DAY, date = iso(t), dow = new Date(t).getUTCDay();
    const week = Math.floor(i / 7), meso = week % 4;
    const factor = (meso === 3 ? 0.7 : 1 + 0.05 * meso) * (1 + 0.25 * Math.min(1, week / totalWeeks));
    const future = t > endT;
    const br = BREAKS[ath.id];
    const onBreak = br && i >= br.from && i <= br.to;
    const test = TEST_DAY[ath.id];
    if (test && i === test.day) {
      out.push({ ...session(ath, date, "run", test.title, test.h, test.IF, true), comments: test.comment });
      continue;
    }
    for (const [sport, title, h, IF] of ath.week[dow] || []) {
      const long = /larga|Tirada/.test(title);
      const planned = h * (long ? factor : 1 + (factor - 1) * 0.5);
      const done = !future && !onBreak && rnd() > ath.miss;
      const w = session(ath, date, sport, title, planned, IF, done);
      if (done && pendingBack) { w.comments = pendingBack; pendingBack = null; }
      out.push(w);
    }
    if (br && i === br.to) pendingBack = br.back;
    // Alguna sesión libre sin planificar en días de descanso.
    if (!future && !onBreak && !(ath.week[dow] || []).length && rnd() < 0.12) {
      const s = ath.sport === "bike" ? "bike" : "run";
      out.push({ ...session(ath, date, s, "Sesión libre", 0.75, 0.65, true), planned_h: null });
    }
  }
  return out;
}

// ---------- estrategias de ejemplo (calculadas con el mismo motor) ----------
function planFor(ath, ctl, def) {
  const course = ENGINE.buildCourse({ distKm: def.dist, gain: def.gain });
  const athlete = { ftp: ath.ftp, runPaceSec: ath.runPaceSec, vdot: ath.vdot, swimCssSec: ath.swimCssSec, lthr: ath.lthr, weight: ath.weight, ctl };
  const input = def.sport === "tri"
    ? { sport: "tri", athlete, cond: def.cond, nutrition: def.nut, courses: { bike: course, run: ENGINE.buildCourse({ distKm: def.distRun, gain: def.gainRun }) } }
    : { sport: def.sport, athlete, cond: def.cond, nutrition: def.nut, course };
  const res = ENGINE.plan(input);
  if (res.error) throw new Error(`Estrategia de ejemplo inválida: ${res.error}`);
  const pace = (s) => (s ? ENGINE.fmtPace(s) : "");
  const form = {
    "rc-athlete": String(ath.id), "rc-name": def.name, "rc-date": def.date, "rc-ftp": ath.ftp ?? "", "rc-runpace": pace(ath.runPaceSec),
    "rc-vdot": ath.vdot ?? "", "rc-css": pace(ath.swimCssSec), "rc-lthr": ath.lthr ?? "", "rc-weight": ath.weight ?? "", "rc-ctl": ctl,
    "rc-tri-dist": def.cond.triDistance || "olimpico", "rc-wetsuit": def.cond.wetsuit ? "1" : "0", "rc-dist": def.dist, "rc-gain": def.gain,
    "rc-dist-run": def.distRun ?? "", "rc-gain-run": def.gainRun ?? "", "rc-surface": def.cond.surface || "asfalto", "rc-bike": def.cond.bike || "carretera",
    "rc-draft": def.cond.draft ? "1" : "0", "rc-intent": def.cond.intent, "rc-temp": def.cond.tempC, "rc-wind": String(def.cond.wind || 0),
    "rc-gut": def.nut.gut, "rc-sweat": def.nut.sweat, "rc-caffeine": def.nut.caffeine ? "1" : "0", "rc-exp": def.exp, "rc-notes": def.notes,
    sport: def.sport, tracks: { main: null, run: null },
  };
  return { name: def.name, date: def.date, sport: def.sport, form, summary: res.scenarios.map((s) => `${s.label} ${ENGINE.fmtTime(s.totalSec)}`).join(" · ") };
}

const PLAN_DEFS = {
  1: { name: "Media maratón de Ejemplo (ficticia)", date: "2026-11-15", sport: "run", dist: 21.1, gain: 110, exp: "si", notes: "Avituallamientos cada 5 km; quiere bajar de 1:30.",
    cond: { intent: "exigente", tempC: 14, wind: 0, surface: "asfalto" }, nut: { gut: "media", sweat: "normal", caffeine: true } },
  2: { name: "Gran fondo de Ejemplo (ficticio)", date: "2026-10-25", sport: "bike", dist: 140, gain: 2200, exp: "si", notes: "Dos puertos largos; avituallamientos en los km 60 y 105.",
    cond: { intent: "controlado", tempC: 17, wind: 1, bike: "carretera", draft: true }, nut: { gut: "baja", sweat: "mucha", caffeine: true } },
  3: { name: "Triatlón olímpico de Ejemplo (ficticio)", date: "2026-11-08", sport: "tri", dist: 40, gain: 380, distRun: 10, gainRun: 60, exp: "no", notes: "Primer olímpico; agua prevista a 19 grados.",
    cond: { intent: "exigente", tempC: 19, wind: 0, triDistance: "olimpico", wetsuit: true, bike: "cabra", surface: "asfalto" }, nut: { gut: "media", sweat: "normal", caffeine: false } },
};

// ---------- SQL ----------
const salt = randomBytes(16).toString("hex");
const hash = pbkdf2Sync(DEMO.password, Buffer.from(salt, "hex"), PBKDF2_ITERATIONS, 32, "sha256").toString("hex");
const L = [];
L.push("-- APD Race Lab: datos de demostración 100 % ficticios. Generado por scripts/seed.mjs.");
L.push(`-- Cuenta de prueba: ${DEMO.email} (contraseña en el README). Últimos entrenos hechos: ${END}.`);
L.push(`DELETE FROM feedbacks WHERE user_id = ${DEMO.id};`);
L.push(`DELETE FROM race_plans WHERE user_id = ${DEMO.id};`);
L.push(`DELETE FROM workouts WHERE athlete_id IN (SELECT id FROM athletes WHERE user_id = ${DEMO.id});`);
L.push(`DELETE FROM athletes WHERE user_id = ${DEMO.id};`);
L.push(`DELETE FROM sessions WHERE user_id = ${DEMO.id};`);
L.push(`DELETE FROM ai_usage WHERE user_id = ${DEMO.id};`);
L.push(`DELETE FROM login_attempts WHERE email = ${q(DEMO.email)};`);
L.push(`DELETE FROM users WHERE id = ${DEMO.id} OR email = ${q(DEMO.email)};`);
L.push(`INSERT INTO users (id, email, name, pass_salt, pass_hash, created_at) VALUES (${DEMO.id}, ${q(DEMO.email)}, ${q(DEMO.name)}, ${q(salt)}, ${q(hash)}, ${CREATED_AT});`);

let total = 0;
for (const a of ATHLETES) {
  L.push(`INSERT INTO athletes (id, user_id, name, sport, ftp, run_pace_sec, vdot, swim_css_sec, lthr, weight, notes, created_at, updated_at) VALUES (${[a.id, DEMO.id, q(a.name), q(a.sport), q(a.ftp), q(a.runPaceSec), q(a.vdot), q(a.swimCssSec), q(a.lthr), q(a.weight), q(a.notes), CREATED_AT, CREATED_AT].join(", ")});`);
  const ws = workoutsFor(a);
  total += ws.length;
  for (const w of ws) {
    L.push(`INSERT INTO workouts (athlete_id, date, sport, title, duration_h, planned_h, distance_km, tss, rpe, feeling, comments, completed, source, created_at) VALUES (${[w.athlete_id, q(w.date), q(w.sport), q(w.title), q(w.duration_h), q(w.planned_h), q(w.distance_km), q(w.tss), q(w.rpe), q(w.feeling), q(w.comments), w.completed, "'seed'", CREATED_AT].join(", ")});`);
  }
  const series = FITNESS.fitnessSeries(ws.map((w) => ({ date: w.date, tss: w.tss, durationH: w.duration_h, completed: !!w.completed })), { to: END });
  const ctl = Math.round(series.length ? series[series.length - 1].ctl : 0);
  const p = planFor(a, ctl, PLAN_DEFS[a.id]);
  L.push(`INSERT INTO race_plans (user_id, athlete_id, name, race_date, sport, form_json, summary, created_at, updated_at) VALUES (${[DEMO.id, a.id, q(p.name), q(p.date), q(p.sport), q(JSON.stringify(p.form)), q(p.summary), CREATED_AT, CREATED_AT].join(", ")});`);
}
L.push(`-- ${ATHLETES.length} deportistas ficticios, ${total} entrenos sintéticos, ${ATHLETES.length} estrategias de ejemplo.`);
process.stdout.write(L.join("\n") + "\n");
