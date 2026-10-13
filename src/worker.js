// APD Race Lab: Worker de Cloudflare. /api/* pasa por el enrutador; el resto
// lo sirven los estáticos de public/ (binding ASSETS).

import { ok, fail, HttpError } from "./http.js";
import { ValidationError, positiveId } from "./validate.js";
import { authenticate, login, logout, me } from "./auth.js";
import {
  listAthletes, getAthlete, createAthlete, updateAthlete, deleteAthlete,
  listWorkouts, createWorkout, importWorkouts, deleteWorkout,
} from "./routes/athletes.js";
import { listPlans, getPlan, savePlan, deletePlan } from "./routes/plans.js";
import { listFeedbacks, saveFeedback, deleteFeedback } from "./routes/feedbacks.js";
import { aiHandler } from "./routes/ai.js";

const health = async () => ok({ status: "ok", app: "apd-race-lab" });

// [método, patrón, manejador, ¿requiere sesión?]
const ROUTES = [
  ["GET", /^\/api\/health$/, health, false],
  ["POST", /^\/api\/login$/, login, false],
  ["POST", /^\/api\/logout$/, logout, false],
  ["GET", /^\/api\/me$/, me, true],
  ["GET", /^\/api\/athletes$/, listAthletes, true],
  ["POST", /^\/api\/athletes$/, createAthlete, true],
  ["GET", /^\/api\/athletes\/(\d+)$/, getAthlete, true],
  ["PUT", /^\/api\/athletes\/(\d+)$/, updateAthlete, true],
  ["DELETE", /^\/api\/athletes\/(\d+)$/, deleteAthlete, true],
  ["GET", /^\/api\/athletes\/(\d+)\/workouts$/, listWorkouts, true],
  ["POST", /^\/api\/athletes\/(\d+)\/workouts$/, createWorkout, true],
  ["POST", /^\/api\/athletes\/(\d+)\/workouts\/import$/, importWorkouts, true],
  ["DELETE", /^\/api\/workouts\/(\d+)$/, deleteWorkout, true],
  ["GET", /^\/api\/athletes\/(\d+)\/feedbacks$/, listFeedbacks, true],
  ["POST", /^\/api\/athletes\/(\d+)\/feedbacks$/, saveFeedback, true],
  ["DELETE", /^\/api\/feedbacks\/(\d+)$/, deleteFeedback, true],
  ["GET", /^\/api\/plans$/, listPlans, true],
  ["POST", /^\/api\/plans$/, savePlan, true],
  ["GET", /^\/api\/plans\/(\d+)$/, getPlan, true],
  ["DELETE", /^\/api\/plans\/(\d+)$/, deletePlan, true],
  ["POST", /^\/api\/ai$/, aiHandler, true],
];

export function matchRoute(method, path) {
  let pathMatched = false;
  for (const [m, re, handler, needsAuth] of ROUTES) {
    const hit = re.exec(path);
    if (!hit) continue;
    pathMatched = true;
    if (m !== method) continue;
    const id = hit[1] != null ? positiveId(hit[1]) : null;
    if (hit[1] != null && !id) return { status: 404 };
    return { handler, needsAuth, params: { id } };
  }
  return { status: pathMatched ? 405 : 404 };
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const route = matchRoute(request.method, url.pathname);
  if (!route.handler) return fail(route.status, route.status === 405 ? "Método no permitido." : "Ruta no encontrada.");
  try {
    const user = route.needsAuth ? await authenticate(request, env) : null;
    if (route.needsAuth && !user) return fail(401, "Inicia sesión para continuar.");
    return await route.handler({ request, env, user, params: route.params, url });
  } catch (e) {
    if (e instanceof ValidationError) return fail(400, e.message);
    if (e instanceof HttpError) return fail(e.status, e.message);
    console.error("Error en", request.method, url.pathname, e && e.stack ? e.stack : e);
    return fail(500, "Error interno. Inténtalo de nuevo.");
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
