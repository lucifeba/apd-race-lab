// Pruebas del Worker: validación en la frontera, contraseñas, rutas, lotes de
// importación y extracción de JSON de la IA.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import * as V from "../src/validate.js";
import { pbkdf2Hex, verifyPassword, hashPassword, timingSafeEqualHex, sha256Hex, PBKDF2_ITERATIONS } from "../src/auth.js";
import { extractJson } from "../src/ai-json.js";
import { responseText } from "../src/routes/ai.js";
import { prepareImportRows } from "../src/routes/athletes.js";
import { matchRoute } from "../src/worker.js";
import { readJson, HttpError } from "../src/http.js";

const throwsV = (fn, re) => assert.throws(fn, (e) => e instanceof V.ValidationError && (!re || re.test(e.message)));

test("fechas ISO reales", () => {
  assert.ok(V.isIsoDate("2026-02-28"));
  assert.ok(V.isIsoDate("2028-02-29"));
  assert.ok(!V.isIsoDate("2026-02-29"));
  assert.ok(!V.isIsoDate("2026-2-1"));
  assert.ok(!V.isIsoDate("1980-01-01"));
  assert.ok(!V.isIsoDate(20260101));
});

test("text, number, oneOf y paceSec", () => {
  assert.equal(V.text("  hola ", "x"), "hola");
  assert.equal(V.text("", "x"), null);
  throwsV(() => V.text("", "el nombre", { required: true }), /Falta el nombre/);
  throwsV(() => V.text("a".repeat(11), "x", { max: 10 }), /máximo 10/);
  throwsV(() => V.text(5, "x"), /texto/);
  assert.equal(V.number("1,5", "x"), 1.5);
  assert.equal(V.number(null, "x"), null);
  throwsV(() => V.number("abc", "x"), /número/);
  throwsV(() => V.number(2.5, "x", { int: true }), /entero/);
  throwsV(() => V.number(700, "El FTP", { min: 50, max: 600 }), /entre 50 y 600/);
  assert.equal(V.oneOf("run", "x", ["run"]), "run");
  throwsV(() => V.oneOf("ski", "x", ["run"]), /no es válido/);
  assert.equal(V.paceSec("4:05", "x", { min: 150, max: 600 }), 245);
  assert.equal(V.paceSec(245, "x", { min: 150, max: 600 }), 245);
  throwsV(() => V.paceSec("4.05", "El ritmo", { min: 150, max: 600 }), /min:seg/);
  throwsV(() => V.paceSec("1:00", "x", { min: 150, max: 600 }), /entre/);
});

test("validateAthlete limpia y acota", () => {
  const a = V.validateAthlete({ name: " Lucía ", sport: "run", runPace: "4:05", vdot: "52.5", ftp: "", weight: 55.5 });
  assert.deepEqual(a, { name: "Lucía", sport: "run", ftp: null, runPaceSec: 245, vdot: 52.5, swimCssSec: null, lthr: null, weight: 55.5, notes: null });
  throwsV(() => V.validateAthlete({ sport: "run" }), /nombre/);
  throwsV(() => V.validateAthlete({ name: "X", sport: "swim" }), /deporte/);
});

test("validateWorkout: hecho, planificado y vacío", () => {
  const done = V.validateWorkout({ date: "2026-10-01", sport: "run", durationH: 1, tss: 60 });
  assert.equal(done.completed, true);
  const planned = V.validateWorkout({ date: "2026-10-20", sport: "bike", plannedH: 2 });
  assert.equal(planned.completed, false);
  assert.equal(V.validateWorkout({ date: "2026-10-01", sport: "run", durationH: 1, completed: false }).completed, false);
  throwsV(() => V.validateWorkout({ date: "2026-10-01", sport: "run" }), /duración/);
  throwsV(() => V.validateWorkout({ date: "01/10/2026", sport: "run", durationH: 1 }), /AAAA-MM-DD/);
  throwsV(() => V.validateWorkout({ date: "2026-10-01", sport: "run", durationH: 1, rpe: 11 }), /RPE/);
});

test("validatePlan, validateFeedback, validateLogin y validateAiRequest", () => {
  const p = V.validatePlan({ name: "Media", sport: "run", form: { a: 1 }, athleteId: "3", raceDate: "2026-11-15" });
  assert.equal(p.athleteId, 3);
  assert.equal(p.formJson, '{"a":1}');
  throwsV(() => V.validatePlan({ name: "Media", sport: "run" }), /formulario/);
  throwsV(() => V.validatePlan({ name: "Media", sport: "run", form: { big: "x".repeat(200001) } }), /grande/);
  const f = V.validateFeedback({ start: "2026-09-01", end: "2026-09-28", escrito: "Hola", pasos: ["a", 2, ""] });
  assert.deepEqual(f.pasos, ["a", "2"]);
  throwsV(() => V.validateFeedback({ start: "2026-09-28", end: "2026-09-01", escrito: "Hola" }), /invertido/);
  throwsV(() => V.validateFeedback({ start: "2026-09-01", end: "2026-09-28", escrito: "Hola", pasos: Array(9).fill("x") }), /máximo 8/);
  assert.equal(V.validateLogin({ email: " Jurado@APDRaceLab.demo ", password: "x" }).email, "jurado@apdracelab.demo");
  throwsV(() => V.validateLogin({ email: "no-es-email", password: "x" }), /email/);
  assert.equal(V.validateAiRequest({ prompt: "hola" }).format, "text");
  throwsV(() => V.validateAiRequest({ prompt: "hola", format: "xml" }), /formato/);
});

test("PBKDF2 del Worker coincide con el de node:crypto (seed) y verifica", async () => {
  const salt = randomBytes(16).toString("hex");
  const node = pbkdf2Sync("RaceLab-E7-2026", Buffer.from(salt, "hex"), PBKDF2_ITERATIONS, 32, "sha256").toString("hex");
  assert.equal(await pbkdf2Hex("RaceLab-E7-2026", salt), node);
  assert.ok(await verifyPassword("RaceLab-E7-2026", salt, node));
  assert.ok(!(await verifyPassword("otra", salt, node)));
  const h = await hashPassword("abc");
  assert.equal(h.salt.length, 32);
  assert.equal(h.hash.length, 64);
  assert.ok(timingSafeEqualHex("abcd", "abcd"));
  assert.ok(!timingSafeEqualHex("abcd", "abce"));
  assert.ok(!timingSafeEqualHex("abcd", "abcdef"));
  assert.equal((await sha256Hex("x")).length, 64);
});

test("rutas: método, ids y 404/405", () => {
  assert.equal(matchRoute("GET", "/api/athletes").handler.name, "listAthletes");
  const r = matchRoute("DELETE", "/api/workouts/42");
  assert.equal(r.params.id, 42);
  assert.equal(r.needsAuth, true);
  assert.equal(matchRoute("POST", "/api/login").needsAuth, false);
  assert.equal(matchRoute("PATCH", "/api/athletes").status, 405);
  assert.equal(matchRoute("GET", "/api/nada").status, 404);
  assert.equal(matchRoute("GET", "/api/athletes/0").status, 404);
  assert.equal(matchRoute("GET", "/api/athletes/99999999999").status, 404);
});

test("prepareImportRows: válidas, inválidas y duplicadas del propio lote", () => {
  const row = { date: "2026-09-01", sport: "run", title: "Series", durationH: 1 };
  const r = prepareImportRows([row, { ...row }, { date: "mal", sport: "run", durationH: 1 }, null, { ...row, title: "Otra" }]);
  assert.equal(r.valid.length, 2);
  assert.equal(r.duplicates, 1);
  assert.equal(r.invalid, 2);
  assert.equal(r.errors[0].index, 2);
});

test("readJson: tipo, tamaño y objeto", async () => {
  const req = (body, type = "application/json") => new Request("https://x.test/api", { method: "POST", headers: { "content-type": type }, body });
  assert.deepEqual(await readJson(req('{"a":1}'), 100), { a: 1 });
  await assert.rejects(readJson(req('{"a":1}', "text/plain"), 100), (e) => e instanceof HttpError && e.status === 415);
  await assert.rejects(readJson(req(JSON.stringify({ a: "x".repeat(200) })), 100), (e) => e.status === 413);
  await assert.rejects(readJson(req("[1,2]"), 100), (e) => e.status === 400);
  await assert.rejects(readJson(req("{no"), 100), (e) => e.status === 400);
});

test("extractJson: bloques de código, saltos de línea crudos y comas finales", () => {
  assert.deepEqual(extractJson('Claro:\n```json\n{"escrito": "Hola\nLucía", "pasos": ["a",],}\n```\nFin'), { escrito: "Hola\nLucía", pasos: ["a"] });
  assert.deepEqual(extractJson('{"a": "llave } dentro", "b": {"c": 1}} y más {"d":2}'), { a: "llave } dentro", b: { c: 1 } });
  assert.deepEqual(extractJson({ ya: "objeto" }), { ya: "objeto" });
  assert.equal(extractJson("sin json"), null);
  assert.equal(extractJson('{"incompleto": '), null);
  assert.equal(responseText({ response: "hola" }), "hola");
  assert.equal(responseText({ response: { a: 1 } }), '{"a":1}');
  assert.equal(responseText(null), "");
});
