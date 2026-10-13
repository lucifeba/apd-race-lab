// Autenticación: PBKDF2-SHA256 (100 000 iteraciones, sal aleatoria de 16 bytes),
// sesiones con token aleatorio de 32 bytes (se guarda solo su SHA-256) y límite
// de 5 intentos fallidos cada 15 minutos por email.

import { ok, fail, readJson, HttpError } from "./http.js";
import { validateLogin } from "./validate.js";

export const PBKDF2_ITERATIONS = 100000;
export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 86400000;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const DUMMY_SALT = "00112233445566778899aabbccddeeff";

const enc = new TextEncoder();

export function toHex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex) {
  const clean = String(hex || "");
  if (!/^(?:[0-9a-f]{2})*$/i.test(clean)) throw new Error("hex no válido");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomHex(bytes) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(textValue) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(textValue)));
}

export async function pbkdf2Hex(password, saltHex, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations }, key, 256);
  return toHex(bits);
}

export function timingSafeEqualHex(a, b) {
  const x = String(a || ""), y = String(b || "");
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

export async function hashPassword(password) {
  const salt = randomHex(16);
  return { salt, hash: await pbkdf2Hex(password, salt) };
}

export async function verifyPassword(password, salt, hash) {
  return timingSafeEqualHex(await pbkdf2Hex(password, salt), hash);
}

function bearer(request) {
  const h = request.headers.get("authorization") || "";
  const m = /^Bearer ([0-9a-f]{64})$/i.exec(h.trim());
  return m ? m[1].toLowerCase() : null;
}

// Usuario de la sesión o null si no hay token válido y vigente.
export async function authenticate(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
  ).bind(await sha256Hex(token), Date.now()).first();
  return row ? { id: row.id, email: row.email, name: row.name } : null;
}

export async function login({ request, env }) {
  const { email, password } = validateLogin(await readJson(request, 4096));
  const now = Date.now();
  const fails = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND at > ?").bind(email, now - FAIL_WINDOW_MS).first();
  if ((fails && fails.n) >= MAX_FAILS) return fail(429, "Demasiados intentos fallidos. Espera 15 minutos y vuelve a probar.");

  const user = await env.DB.prepare("SELECT id, email, name, pass_salt, pass_hash FROM users WHERE email = ?").bind(email).first();
  // Sin usuario se calcula igual un hash para no delatar qué emails existen por el tiempo de respuesta.
  const good = user ? await verifyPassword(password, user.pass_salt, user.pass_hash) : (await pbkdf2Hex(password, DUMMY_SALT), false);
  if (!good) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO login_attempts (email, at) VALUES (?, ?)").bind(email, now),
      env.DB.prepare("DELETE FROM login_attempts WHERE at < ?").bind(now - 86400000),
    ]);
    return fail(401, "Email o contraseña incorrectos.");
  }

  const token = randomHex(32);
  const expiresAt = now + SESSION_MS;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_attempts WHERE email = ?").bind(email),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?").bind(user.id, now),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256Hex(token), user.id, now, expiresAt),
  ]);
  return ok({ token, expiresAt, user: { id: user.id, email: user.email, name: user.name } });
}

export async function logout({ request, env }) {
  const token = bearer(request);
  if (!token) throw new HttpError(401, "Sesión no válida.");
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  return ok({ loggedOut: true });
}

export async function me({ user }) {
  return ok({ user });
}
