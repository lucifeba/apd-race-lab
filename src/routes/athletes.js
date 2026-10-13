// Deportistas y su registro de entrenos. Toda consulta va acotada al usuario:
// un deportista solo se lee o modifica si athletes.user_id es el de la sesión.

import { ok, readJson, HttpError } from "../http.js";
import { validateAthlete, validateWorkout, validateRange, MAX_IMPORT_ROWS, ValidationError } from "../validate.js";

const MAX_ATHLETES = 200;
const WORKOUT_LIST_LIMIT = 5000;
const IMPORT_CHUNK = 500;
const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const SMALL_BODY = 16 * 1024;
const MAX_REPORTED_ERRORS = 20;

export function athleteOut(r) {
  return {
    id: r.id, name: r.name, sport: r.sport, ftp: r.ftp, runPaceSec: r.run_pace_sec, vdot: r.vdot,
    swimCssSec: r.swim_css_sec, lthr: r.lthr, weight: r.weight, notes: r.notes || "",
    workouts: r.n_workouts ?? undefined, lastDate: r.last_date ?? undefined, updatedAt: r.updated_at,
  };
}

export function workoutOut(r) {
  return {
    id: r.id, date: r.date, sport: r.sport, title: r.title || "", durationH: r.duration_h, plannedH: r.planned_h,
    distanceKm: r.distance_km, tss: r.tss, rpe: r.rpe, feeling: r.feeling, comments: r.comments || "",
    completed: !!r.completed, source: r.source,
  };
}

export async function ownedAthlete(env, userId, athleteId) {
  const row = await env.DB.prepare("SELECT * FROM athletes WHERE id = ? AND user_id = ?").bind(athleteId, userId).first();
  if (!row) throw new HttpError(404, "Deportista no encontrado.");
  return row;
}

export async function listAthletes({ env, user }) {
  const { results } = await env.DB.prepare(
    `SELECT a.*,
       (SELECT COUNT(*) FROM workouts w WHERE w.athlete_id = a.id) AS n_workouts,
       (SELECT MAX(w.date) FROM workouts w WHERE w.athlete_id = a.id AND w.completed = 1) AS last_date
     FROM athletes a WHERE a.user_id = ? ORDER BY a.name COLLATE NOCASE`
  ).bind(user.id).all();
  return ok(results.map(athleteOut));
}

export async function getAthlete({ env, user, params }) {
  return ok(athleteOut(await ownedAthlete(env, user.id, params.id)));
}

export async function createAthlete({ request, env, user }) {
  const a = validateAthlete(await readJson(request, SMALL_BODY));
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM athletes WHERE user_id = ?").bind(user.id).first();
  if (count.n >= MAX_ATHLETES) throw new HttpError(409, `Máximo ${MAX_ATHLETES} deportistas por cuenta.`);
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO athletes (user_id, name, sport, ftp, run_pace_sec, vdot, swim_css_sec, lthr, weight, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
  ).bind(user.id, a.name, a.sport, a.ftp, a.runPaceSec, a.vdot, a.swimCssSec, a.lthr, a.weight, a.notes, now, now).first();
  return ok(athleteOut(row), 201);
}

export async function updateAthlete({ request, env, user, params }) {
  await ownedAthlete(env, user.id, params.id);
  const a = validateAthlete(await readJson(request, SMALL_BODY));
  const row = await env.DB.prepare(
    `UPDATE athletes SET name = ?, sport = ?, ftp = ?, run_pace_sec = ?, vdot = ?, swim_css_sec = ?, lthr = ?, weight = ?, notes = ?, updated_at = ?
     WHERE id = ? AND user_id = ? RETURNING *`
  ).bind(a.name, a.sport, a.ftp, a.runPaceSec, a.vdot, a.swimCssSec, a.lthr, a.weight, a.notes, Date.now(), params.id, user.id).first();
  return ok(athleteOut(row));
}

export async function deleteAthlete({ env, user, params }) {
  await ownedAthlete(env, user.id, params.id);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM workouts WHERE athlete_id = ?").bind(params.id),
    env.DB.prepare("DELETE FROM feedbacks WHERE athlete_id = ? AND user_id = ?").bind(params.id, user.id),
    env.DB.prepare("UPDATE race_plans SET athlete_id = NULL WHERE athlete_id = ? AND user_id = ?").bind(params.id, user.id),
    env.DB.prepare("DELETE FROM athletes WHERE id = ? AND user_id = ?").bind(params.id, user.id),
  ]);
  return ok({ deleted: params.id });
}

export async function listWorkouts({ env, user, params, url }) {
  await ownedAthlete(env, user.id, params.id);
  const { from, to } = validateRange(url.searchParams);
  const { results } = await env.DB.prepare(
    `SELECT * FROM workouts WHERE athlete_id = ? AND date >= ? AND date <= ? ORDER BY date ASC, id ASC LIMIT ?`
  ).bind(params.id, from || "1990-01-01", to || "2100-12-31", WORKOUT_LIST_LIMIT).all();
  return ok(results.map(workoutOut));
}

export async function createWorkout({ request, env, user, params }) {
  await ownedAthlete(env, user.id, params.id);
  const w = validateWorkout(await readJson(request, SMALL_BODY));
  const row = await env.DB.prepare(
    `INSERT INTO workouts (athlete_id, date, sport, title, duration_h, planned_h, distance_km, tss, rpe, feeling, comments, completed, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?) RETURNING *`
  ).bind(params.id, w.date, w.sport, w.title, w.durationH, w.plannedH, w.distanceKm, w.tss, w.rpe, w.feeling, w.comments, w.completed ? 1 : 0, Date.now()).first();
  return ok(workoutOut(row), 201);
}

// Separa filas válidas, inválidas y duplicadas dentro del propio lote.
export function prepareImportRows(rows) {
  const valid = [], errors = [];
  const seen = new Set();
  let duplicates = 0;
  rows.forEach((raw, i) => {
    try {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ValidationError("Fila vacía o mal formada.");
      const w = validateWorkout(raw);
      const key = [w.date, w.sport, w.title || "", w.durationH ?? -1].join("|");
      if (seen.has(key)) { duplicates++; return; }
      seen.add(key);
      valid.push(w);
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      if (errors.length < MAX_REPORTED_ERRORS) errors.push({ index: i, error: e.message });
      else errors.push(null);
    }
  });
  return { valid, invalid: errors.length, errors: errors.filter(Boolean), duplicates };
}

const IMPORT_SQL = `INSERT INTO workouts (athlete_id, date, sport, title, duration_h, planned_h, distance_km, tss, rpe, feeling, comments, completed, source, created_at)
  SELECT ?1, json_extract(j.value, '$.date'), json_extract(j.value, '$.sport'), json_extract(j.value, '$.title'),
    json_extract(j.value, '$.durationH'), json_extract(j.value, '$.plannedH'), json_extract(j.value, '$.distanceKm'),
    json_extract(j.value, '$.tss'), json_extract(j.value, '$.rpe'), json_extract(j.value, '$.feeling'),
    json_extract(j.value, '$.comments'), json_extract(j.value, '$.completed'), 'csv', ?3
  FROM json_each(?2) AS j
  WHERE NOT EXISTS (
    SELECT 1 FROM workouts w WHERE w.athlete_id = ?1 AND w.date = json_extract(j.value, '$.date')
      AND w.sport = json_extract(j.value, '$.sport') AND IFNULL(w.title, '') = IFNULL(json_extract(j.value, '$.title'), '')
      AND IFNULL(w.duration_h, -1) = IFNULL(json_extract(j.value, '$.durationH'), -1))`;

// Importación masiva (CSV ya interpretado en el navegador). Cada fila se
// valida aquí otra vez; se insertan en bloques de 500 con un único parámetro
// JSON por bloque y se omiten las que ya existen.
export async function importWorkouts({ request, env, user, params }) {
  await ownedAthlete(env, user.id, params.id);
  const body = await readJson(request, IMPORT_MAX_BYTES);
  if (!Array.isArray(body.rows) || !body.rows.length) throw new ValidationError("No hay filas para importar.");
  if (body.rows.length > MAX_IMPORT_ROWS) throw new ValidationError(`Máximo ${MAX_IMPORT_ROWS} filas por importación.`);
  const { valid, invalid, errors, duplicates } = prepareImportRows(body.rows);
  let imported = 0;
  if (valid.length) {
    const now = Date.now();
    const stmts = [];
    for (let i = 0; i < valid.length; i += IMPORT_CHUNK) {
      const chunk = valid.slice(i, i + IMPORT_CHUNK).map((w) => ({ ...w, completed: w.completed ? 1 : 0 }));
      stmts.push(env.DB.prepare(IMPORT_SQL).bind(params.id, JSON.stringify(chunk), now));
    }
    const res = await env.DB.batch(stmts);
    imported = res.reduce((s, r) => s + ((r.meta && r.meta.changes) || 0), 0);
  }
  const existing = valid.length - imported;
  return ok({ received: body.rows.length, imported, skipped: invalid + duplicates + existing, invalid, duplicates: duplicates + existing, errors });
}

export async function deleteWorkout({ env, user, params }) {
  const res = await env.DB.prepare(
    "DELETE FROM workouts WHERE id = ? AND athlete_id IN (SELECT id FROM athletes WHERE user_id = ?)"
  ).bind(params.id, user.id).run();
  if (!res.meta || !res.meta.changes) throw new HttpError(404, "Entreno no encontrado.");
  return ok({ deleted: params.id });
}
