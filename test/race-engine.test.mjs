// Pruebas del motor de estrategia de competición: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(new URL("../public/js/race-engine.js", import.meta.url), "utf8");
const sandbox = { module: { exports: {} }, globalThis: {} };
vm.runInNewContext(code, sandbox);
const E = sandbox.module.exports;

const between = (v, lo, hi, msg) => assert.ok(v >= lo && v <= hi, `${msg}: ${v} fuera de [${lo}, ${hi}]`);
const runAthlete = { vdot: 50, weight: 68, lthr: 172 };
const bikeAthlete = { ftp: 250, weight: 70 };

test("VDOT de Daniels: 5K en 20:00 da ~49.8 y la inversa cuadra", () => {
  between(E.vdotFrom(5000, 1200), 49.4, 50.2, "VDOT 5K 20:00");
  between(E.timeForVdot(10000, 50), 2460, 2500, "10K con VDOT 50 (tabla 41:21)");
});

test("carrera llana: 10K y maratón con VDOT 50 en condiciones neutras", () => {
  const cond = { intent: "exigente", tempC: 12, surface: "asfalto" };
  const c10 = E.buildCourse({ distKm: 10, gain: 0 });
  const p10 = E.plan({ sport: "run", course: c10, athlete: runAthlete, cond });
  between(p10.scenarios[1].totalSec, 2440, 2520, "10K normal");
  const cM = E.buildCourse({ distKm: 42.195, gain: 0 });
  const pM = E.plan({ sport: "run", course: cM, athlete: runAthlete, cond });
  between(pM.scenarios[1].totalSec, 3 * 3600 + 8 * 60, 3 * 3600 + 16 * 60, "maratón normal");
});

test("los tres escenarios se ordenan: optimista < normal < menos favorable", () => {
  const course = E.buildCourse({ distKm: 21.1, gain: 150 });
  const p = E.plan({ sport: "run", course, athlete: runAthlete, cond: { intent: "exigente", tempC: 16 } });
  const [o, n, d] = p.scenarios.map((s) => s.totalSec);
  assert.ok(o < n && n < d, `orden ${o} ${n} ${d}`);
  assert.equal(p.scenarios.map((s) => s.id).join(","), "optimista,normal,desfavorable");
});

test("el desnivel y el trail técnico hacen la carrera más lenta", () => {
  const cond = { intent: "exigente", tempC: 12 };
  const flat = E.plan({ sport: "run", course: E.buildCourse({ distKm: 21.1, gain: 0 }), athlete: runAthlete, cond });
  const hilly = E.plan({ sport: "run", course: E.buildCourse({ distKm: 21.1, gain: 800 }), athlete: runAthlete, cond });
  const tech = E.plan({ sport: "run", course: E.buildCourse({ distKm: 21.1, gain: 800 }), athlete: runAthlete, cond: { ...cond, surface: "tecnico" } });
  assert.ok(hilly.scenarios[1].totalSec > flat.scenarios[1].totalSec * 1.08);
  assert.ok(tech.scenarios[1].totalSec > hilly.scenarios[1].totalSec * 1.08);
});

test("física de bici: 250 W en llano y en un 8 %", () => {
  const o = { mass: 80, crr: 0.004, cda: 0.32, vmax: 70, headwind: 0 };
  between(E.bikeSpeed(250, 0, o) * 3.6, 35, 39, "llano km/h");
  between(E.bikeSpeed(250, 8, o) * 3.6, 11.5, 14.5, "8 % km/h");
  between(E.bikeSpeed(0, -6, o) * 3.6, 45, 70, "bajada sin pedalear");
});

test("bici: 40 km llanos con FTP 250 en algo más de una hora y NP coherente", () => {
  const p = E.plan({ sport: "bike", course: E.buildCourse({ distKm: 40, gain: 0 }), athlete: bikeAthlete, cond: { intent: "exigente", tempC: 18, bike: "carretera" } });
  const b = p.scenarios[1].parts[0];
  between(b.totalSec / 60, 58, 72, "minutos");
  between(b.np, 225, 250, "NP");
});

test("bici con un puerto: más potencia subiendo que bajando e IF según la duración", () => {
  // track de 60 km: 10 llanos, 15 subiendo al 5 %, 15 bajando y 20 llanos
  const pts = [];
  for (let km = 0; km <= 60; km += 0.1) {
    const ele = km < 10 ? 500 : km < 25 ? 500 + (km - 10) * 50 : km < 40 ? 1250 - (km - 25) * 50 : 500;
    pts.push({ lat: 40 + km / 111.2, lon: -3.7, ele });
  }
  const p = E.plan({ sport: "bike", course: E.buildCourse({ points: pts }), athlete: bikeAthlete, cond: { intent: "exigente", tempC: 18 } });
  const b = p.scenarios[1].parts[0];
  const up = b.tramos.filter((t) => t.grade > 2), down = b.tramos.filter((t) => t.grade < -1);
  assert.ok(up.length && down.length);
  assert.ok(Math.min(...up.map((t) => t.power)) > Math.max(...down.map((t) => t.power)));
  between(b.IF, 0.80, 0.92, "IF para ~2 h");
});

test("nutrición: dosis por duración y tope por tolerancia entrenada", () => {
  assert.equal(E.nutrition("bike", 0.6, {}).carbsH, 0);
  assert.equal(E.nutrition("bike", 2, {}).carbsH, 60);
  assert.equal(E.nutrition("bike", 3, { gut: "media" }).carbsH, 80);
  assert.equal(E.nutrition("bike", 5, { gut: "baja" }).carbsH, 60);
  assert.ok(E.nutrition("bike", 3, { sweat: "mucha", tempC: 30 }).fluidH > E.nutrition("bike", 3, { sweat: "poca", tempC: 15 }).fluidH);
});

test("triatlón olímpico: tiempo total razonable y tres segmentos con transiciones", () => {
  const ath = { ftp: 250, weight: 70, runPace: "4:15", swimCss: "1:45" };
  const p = E.plan({
    sport: "tri", athlete: ath, cond: { intent: "exigente", triDistance: "olimpico", tempC: 20, wetsuit: true },
    courses: { bike: E.buildCourse({ distKm: 40, gain: 300 }), run: E.buildCourse({ distKm: 10, gain: 50 }) },
    nutrition: { gut: "media", sweat: "normal" },
  });
  const n = p.scenarios[1];
  assert.equal(n.parts.map((x) => x.sport).join(","), "swim,bike,run");
  between(n.totalSec / 60, 120, 165, "minutos totales");
  assert.ok(n.intake.length > 0, "hay tomas de nutrición");
});

test("errores claros si faltan los umbrales", () => {
  assert.match(E.plan({ sport: "bike", course: E.buildCourse({ distKm: 40 }), athlete: {}, cond: {} }).error, /FTP/);
  assert.match(E.plan({ sport: "run", course: E.buildCourse({ distKm: 10 }), athlete: {}, cond: {} }).error, /umbral|VDOT/);
});

test("GPX y TCX: lee puntos, distancia y desnivel; tramos acotados", () => {
  const pts = [];
  for (let i = 0; i <= 200; i++) pts.push(`<trkpt lat="${(40 + i * 0.0009).toFixed(6)}" lon="-3.700000"><ele>${(600 + 80 * Math.sin(i / 20)).toFixed(1)}</ele></trkpt>`);
  const gpx = `<?xml version="1.0"?><gpx><trk><name>Prueba test</name><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
  const t = E.parseTrack(gpx);
  assert.equal(t.name, "Prueba test");
  assert.equal(t.points.length, 201);
  const c = E.buildCourse({ points: t.points, maxSeg: 12 });
  between(c.distKm, 19.8, 20.2, "km del track");
  assert.ok(c.gain > 150 && c.gain < 700, `desnivel ${c.gain}`);
  assert.ok(c.segments.length <= 12);
  const tcx = "<TrainingCenterDatabase><Trackpoint><Position><LatitudeDegrees>40.0</LatitudeDegrees><LongitudeDegrees>-3.7</LongitudeDegrees></Position><AltitudeMeters>600</AltitudeMeters></Trackpoint><Trackpoint><Position><LatitudeDegrees>40.01</LatitudeDegrees><LongitudeDegrees>-3.7</LongitudeDegrees></Position><AltitudeMeters>620</AltitudeMeters></Trackpoint></TrainingCenterDatabase>";
  assert.equal(E.parseTrack(tcx).points.length, 2);
});

test("sin track, los tramos sintéticos se agrupan en parciales legibles", () => {
  const p = E.plan({ sport: "bike", course: E.buildCourse({ distKm: 90, gain: 900 }), athlete: bikeAthlete, cond: { intent: "exigente" } });
  const b = p.scenarios[1].parts[0];
  assert.ok(b.tramos.length <= 10, `${b.tramos.length} parciales`);
  assert.ok(b.tramos.every((t) => t.rolling > 0));
  between(b.tramos[b.tramos.length - 1].cumSec, b.totalSec - 1, b.totalSec + 1, "el último paso coincide con el total");
});
