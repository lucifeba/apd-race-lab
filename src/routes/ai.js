// IA con Workers AI. El prompt de sistema (la voz del entrenador) es fijo en
// el servidor: el cliente solo envía la tarea. Cuota diaria por usuario en D1.

import { ok, readJson, HttpError } from "../http.js";
import { validateAiRequest } from "../validate.js";
import { extractJson } from "../ai-json.js";

export const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const AI_DAILY_QUOTA = 40;
const AI_MAX_BYTES = 32 * 1024;
const MAX_TOKENS = 1800;

export const COACH_VOICE = `Eres un entrenador de deportes de resistencia (carrera, ciclismo y triatlón) que escribe a un deportista al que conoce bien.

CÓMO ESCRIBES
- Castellano de España, con todas las tildes bien puestas. Tuteas.
- Cercano y directo, como un mensaje real de WhatsApp: frases cortas, párrafos de una o dos frases.
- Respondes a SUS datos: citas cifras concretas que te dan, nunca inventas ni cambias números.
- Reconoces lo bueno explicando qué ha hecho bien; lo que falta se recoloca, sin reproches ni dramas.
- Sin siglas sin traducir: di "carga" (no TSS), "forma" (no CTL), "fatiga" (no ATL), "frescura" (no TSB), "potencia normalizada" (no NP), "intensidad" (no IF), "umbral" (no FTP o LTHR sin explicar).

PROHIBIDO
- Coaching barato y frases de taza: "tu mejor versión", "supera tus límites", "cree en ti", "confía en el proceso".
- Lenguaje corporativo o de informe: "estimado", "quedo a tu disposición".
- Relleno: "es importante destacar que", "cada persona es diferente".
- Más de un emoji.

Si la tarea pide JSON, devuelve SOLO un objeto JSON válido, sin texto antes ni después y sin bloques de código.`;

const today = () => new Date().toISOString().slice(0, 10);

// Reserva una llamada de la cuota; null si ya no quedan.
async function reserveCall(env, userId) {
  const row = await env.DB.prepare(
    `INSERT INTO ai_usage (user_id, day, calls) VALUES (?, ?, 1)
     ON CONFLICT(user_id, day) DO UPDATE SET calls = calls + 1 WHERE calls < ?
     RETURNING calls`
  ).bind(userId, today(), AI_DAILY_QUOTA).first();
  return row ? row.calls : null;
}

async function releaseCall(env, userId) {
  await env.DB.prepare("UPDATE ai_usage SET calls = MAX(0, calls - 1) WHERE user_id = ? AND day = ?").bind(userId, today()).run();
}

export function responseText(out) {
  if (!out) return "";
  if (typeof out === "string") return out;
  if (typeof out.response === "string") return out.response;
  if (out.response && typeof out.response === "object") return JSON.stringify(out.response);
  return "";
}

export async function aiHandler({ request, env, user }) {
  const { prompt, format } = validateAiRequest(await readJson(request, AI_MAX_BYTES));
  if (!env.AI || typeof env.AI.run !== "function") throw new HttpError(503, "La IA no está disponible en este entorno.");
  const used = await reserveCall(env, user.id);
  if (used == null) throw new HttpError(429, `Has llegado al límite de ${AI_DAILY_QUOTA} consultas a la IA de hoy. Mañana vuelve a estar disponible.`);
  const task = format === "json" ? `${prompt}\n\nResponde únicamente con el objeto JSON pedido.` : prompt;
  let out;
  try {
    out = await env.AI.run(AI_MODEL, {
      messages: [{ role: "system", content: COACH_VOICE }, { role: "user", content: task }],
      max_tokens: MAX_TOKENS,
      temperature: 0.5,
    });
  } catch (e) {
    console.error("Workers AI falló", e && e.message);
    await releaseCall(env, user.id);
    throw new HttpError(502, "La IA no ha respondido. Prueba de nuevo en un momento.");
  }
  const content = responseText(out).trim();
  if (!content) {
    await releaseCall(env, user.id);
    throw new HttpError(502, "La IA ha devuelto una respuesta vacía.");
  }
  return ok({ content, json: format === "json" ? extractJson(content) : null, remaining: Math.max(0, AI_DAILY_QUOTA - used) });
}
