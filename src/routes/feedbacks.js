// Feedbacks guardados por deportista. El siguiente feedback lee los `pasos`
// del último para comprobar si se cumplieron.

import { ok, readJson, HttpError } from "../http.js";
import { validateFeedback } from "../validate.js";
import { ownedAthlete } from "./athletes.js";

const FEEDBACK_MAX_BYTES = 64 * 1024;
const MAX_PER_ATHLETE = 100;

const parseList = (s) => {
  try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
};

function feedbackOut(r) {
  return {
    id: r.id, athleteId: r.athlete_id, start: r.start_date, end: r.end_date, escrito: r.escrito, audio: r.audio || "",
    mejorado: parseList(r.mejorado_json), mejorar: parseList(r.mejorar_json), pasos: parseList(r.pasos_json), createdAt: r.created_at,
  };
}

export async function listFeedbacks({ env, user, params }) {
  await ownedAthlete(env, user.id, params.id);
  const { results } = await env.DB.prepare(
    "SELECT * FROM feedbacks WHERE athlete_id = ? AND user_id = ? ORDER BY end_date DESC, id DESC LIMIT 24"
  ).bind(params.id, user.id).all();
  return ok(results.map(feedbackOut));
}

export async function saveFeedback({ request, env, user, params }) {
  await ownedAthlete(env, user.id, params.id);
  const f = validateFeedback(await readJson(request, FEEDBACK_MAX_BYTES));
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedbacks WHERE athlete_id = ? AND user_id = ?").bind(params.id, user.id).first();
  if (count.n >= MAX_PER_ATHLETE) throw new HttpError(409, `Máximo ${MAX_PER_ATHLETE} feedbacks por deportista.`);
  const row = await env.DB.prepare(
    `INSERT INTO feedbacks (user_id, athlete_id, start_date, end_date, escrito, audio, mejorado_json, mejorar_json, pasos_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
  ).bind(user.id, params.id, f.start, f.end, f.escrito, f.audio, JSON.stringify(f.mejorado), JSON.stringify(f.mejorar), JSON.stringify(f.pasos), Date.now()).first();
  return ok(feedbackOut(row), 201);
}

export async function deleteFeedback({ env, user, params }) {
  const res = await env.DB.prepare("DELETE FROM feedbacks WHERE id = ? AND user_id = ?").bind(params.id, user.id).run();
  if (!res.meta || !res.meta.changes) throw new HttpError(404, "Feedback no encontrado.");
  return ok({ deleted: params.id });
}
