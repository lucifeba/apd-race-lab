// Estrategias de competición guardadas (race_plans), siempre del usuario de la sesión.

import { ok, readJson, HttpError } from "../http.js";
import { validatePlan } from "../validate.js";
import { ownedAthlete } from "./athletes.js";

const PLAN_MAX_BYTES = 256 * 1024;
const MAX_PLANS = 300;

function planOut(r, withForm) {
  const out = {
    id: r.id, athleteId: r.athlete_id, athleteName: r.athlete_name || "", name: r.name, raceDate: r.race_date,
    sport: r.sport, summary: r.summary || "", updatedAt: r.updated_at,
  };
  if (withForm) {
    try { out.form = JSON.parse(r.form_json); } catch { out.form = null; }
  }
  return out;
}

const SELECT = `SELECT p.*, a.name AS athlete_name FROM race_plans p LEFT JOIN athletes a ON a.id = p.athlete_id AND a.user_id = p.user_id`;

export async function listPlans({ env, user, url }) {
  const athleteId = Number(url.searchParams.get("athleteId")) || null;
  const stmt = athleteId
    ? env.DB.prepare(`${SELECT} WHERE p.user_id = ? AND p.athlete_id = ? ORDER BY p.updated_at DESC LIMIT 100`).bind(user.id, athleteId)
    : env.DB.prepare(`${SELECT} WHERE p.user_id = ? ORDER BY p.updated_at DESC LIMIT 100`).bind(user.id);
  const { results } = await stmt.all();
  return ok(results.map((r) => planOut(r, false)));
}

export async function getPlan({ env, user, params }) {
  const row = await env.DB.prepare(`${SELECT} WHERE p.id = ? AND p.user_id = ?`).bind(params.id, user.id).first();
  if (!row) throw new HttpError(404, "Estrategia no encontrada.");
  return ok(planOut(row, true));
}

// Guarda o sustituye: misma prueba y mismo deportista = misma estrategia.
export async function savePlan({ request, env, user }) {
  const p = validatePlan(await readJson(request, PLAN_MAX_BYTES));
  if (p.athleteId) await ownedAthlete(env, user.id, p.athleteId);
  const now = Date.now();
  const existing = await env.DB.prepare("SELECT id FROM race_plans WHERE user_id = ? AND name = ? AND athlete_id IS ?").bind(user.id, p.name, p.athleteId).first();
  let id;
  if (existing) {
    await env.DB.prepare("UPDATE race_plans SET race_date = ?, sport = ?, form_json = ?, summary = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(p.raceDate, p.sport, p.formJson, p.summary, now, existing.id, user.id).run();
    id = existing.id;
  } else {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM race_plans WHERE user_id = ?").bind(user.id).first();
    if (count.n >= MAX_PLANS) throw new HttpError(409, `Máximo ${MAX_PLANS} estrategias guardadas.`);
    const row = await env.DB.prepare(
      "INSERT INTO race_plans (user_id, athlete_id, name, race_date, sport, form_json, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id"
    ).bind(user.id, p.athleteId, p.name, p.raceDate, p.sport, p.formJson, p.summary, now, now).first();
    id = row.id;
  }
  return ok({ id, replaced: !!existing }, existing ? 200 : 201);
}

export async function deletePlan({ env, user, params }) {
  const res = await env.DB.prepare("DELETE FROM race_plans WHERE id = ? AND user_id = ?").bind(params.id, user.id).run();
  if (!res.meta || !res.meta.changes) throw new HttpError(404, "Estrategia no encontrada.");
  return ok({ deleted: params.id });
}
