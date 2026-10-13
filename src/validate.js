// Validación de entradas en la frontera de la API. Funciones puras (sin D1 ni
// red) que devuelven valores limpios o lanzan ValidationError con un mensaje
// para el usuario. Se prueban con Node en test/validate.test.mjs.

export const ATHLETE_SPORTS = ["run", "bike", "tri"];
export const WORKOUT_SPORTS = ["run", "bike", "swim", "strength", "other"];
export const MAX_IMPORT_ROWS = 3000;
export const LIST_MAX = 8;
export const LIST_ITEM_MAX = 400;

export class ValidationError extends Error {
  constructor(message) {
    super(String(message).charAt(0).toUpperCase() + String(message).slice(1));
    this.name = "ValidationError";
  }
}

const isBlank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

export function isIsoDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return y >= 1990 && y <= 2100 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function text(v, label, { max = 200, required = false } = {}) {
  if (isBlank(v)) {
    if (required) throw new ValidationError(`Falta ${label}.`);
    return null;
  }
  if (typeof v !== "string") throw new ValidationError(`${label} debe ser texto.`);
  const s = v.trim();
  if (s.length > max) throw new ValidationError(`${label}: máximo ${max} caracteres.`);
  return s;
}

export function number(v, label, { min = -Infinity, max = Infinity, int = false, required = false } = {}) {
  if (isBlank(v)) {
    if (required) throw new ValidationError(`Falta ${label}.`);
    return null;
  }
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim().replace(",", ".")) : NaN;
  if (!Number.isFinite(n)) throw new ValidationError(`${label} debe ser un número.`);
  if (int && !Number.isInteger(n)) throw new ValidationError(`${label} debe ser un número entero.`);
  if (n < min || n > max) throw new ValidationError(`${label} debe estar entre ${min} y ${max}.`);
  return n;
}

export function oneOf(v, label, list, { required = true } = {}) {
  if (isBlank(v)) {
    if (required) throw new ValidationError(`Falta ${label}.`);
    return null;
  }
  if (!list.includes(v)) throw new ValidationError(`${label} no es válido.`);
  return v;
}

export function date(v, label, { required = false } = {}) {
  if (isBlank(v)) {
    if (required) throw new ValidationError(`Falta ${label}.`);
    return null;
  }
  if (!isIsoDate(v)) throw new ValidationError(`${label} debe tener el formato AAAA-MM-DD.`);
  return v;
}

// Ritmo en segundos: acepta un número de segundos o un texto m:ss.
export function paceSec(v, label, { min, max }) {
  if (isBlank(v)) return null;
  let s = v;
  if (typeof v === "string") {
    const m = /^\s*(\d{1,2}):([0-5]\d)\s*$/.exec(v);
    if (!m) throw new ValidationError(`${label} va en formato min:seg, por ejemplo 4:30.`);
    s = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  return number(s, label, { min, max, int: true });
}

export function textList(v, label) {
  if (isBlank(v)) return [];
  if (!Array.isArray(v)) throw new ValidationError(`${label} debe ser una lista.`);
  if (v.length > LIST_MAX) throw new ValidationError(`${label}: máximo ${LIST_MAX} elementos.`);
  return v.map((x) => text(String(x ?? ""), label, { max: LIST_ITEM_MAX })).filter(Boolean);
}

export function positiveId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : null;
}

export function validateLogin(body) {
  const email = text(body.email, "el email", { max: 254, required: true }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("El email no es válido.");
  if (typeof body.password !== "string" || !body.password || body.password.length > 200) throw new ValidationError("Falta la contraseña.");
  return { email, password: body.password };
}

export function validateAthlete(body) {
  return {
    name: text(body.name, "el nombre", { max: 80, required: true }),
    sport: oneOf(body.sport, "el deporte principal", ATHLETE_SPORTS),
    ftp: number(body.ftp, "El FTP", { min: 50, max: 600, int: true }),
    runPaceSec: paceSec(body.runPaceSec ?? body.runPace, "El ritmo umbral", { min: 150, max: 600 }),
    vdot: number(body.vdot, "El VDOT", { min: 20, max: 90 }),
    swimCssSec: paceSec(body.swimCssSec ?? body.swimCss, "El CSS", { min: 50, max: 300 }),
    lthr: number(body.lthr, "El LTHR", { min: 90, max: 220, int: true }),
    weight: number(body.weight, "El peso", { min: 30, max: 200 }),
    notes: text(body.notes, "las notas", { max: 2000 }),
  };
}

// Un entreno: realizado (duración, distancia o carga) y/o planificado.
export function validateWorkout(body) {
  const w = {
    date: date(body.date, "la fecha", { required: true }),
    sport: oneOf(body.sport, "el deporte", WORKOUT_SPORTS),
    title: text(body.title, "el título", { max: 120 }),
    durationH: number(body.durationH, "La duración", { min: 0, max: 30 }),
    plannedH: number(body.plannedH, "La duración planificada", { min: 0, max: 30 }),
    distanceKm: number(body.distanceKm, "La distancia", { min: 0, max: 1500 }),
    tss: number(body.tss, "La carga (TSS)", { min: 0, max: 2000 }),
    rpe: number(body.rpe, "El RPE", { min: 0, max: 10, int: true }),
    feeling: number(body.feeling, "La sensación", { min: 0, max: 10, int: true }),
    comments: text(body.comments, "los comentarios", { max: 1000 }),
  };
  const done = (w.durationH || 0) > 0 || (w.distanceKm || 0) > 0 || (w.tss || 0) > 0;
  if (!done && !((w.plannedH || 0) > 0)) throw new ValidationError("El entreno necesita duración, distancia, carga o duración planificada.");
  return { ...w, completed: typeof body.completed === "boolean" ? body.completed && done : done };
}

export function validateRange(params) {
  const from = date(params.get("from"), "La fecha inicial");
  const to = date(params.get("to"), "La fecha final");
  if (from && to && from > to) throw new ValidationError("El rango de fechas está invertido.");
  return { from, to };
}

export function validatePlan(body) {
  const form = body.form;
  if (!form || typeof form !== "object" || Array.isArray(form)) throw new ValidationError("Falta el formulario de la estrategia.");
  const formJson = JSON.stringify(form);
  if (formJson.length > 200000) throw new ValidationError("La estrategia guardada es demasiado grande.");
  return {
    athleteId: body.athleteId == null || body.athleteId === "" ? null : positiveIdOrThrow(body.athleteId),
    name: text(body.name, "el nombre de la prueba", { max: 120, required: true }),
    raceDate: date(body.raceDate, "la fecha de la prueba"),
    sport: oneOf(body.sport, "la modalidad", ATHLETE_SPORTS),
    formJson,
    summary: text(body.summary, "el resumen", { max: 300 }),
  };
}

export function validateFeedback(body) {
  const start = date(body.start, "el inicio del periodo", { required: true });
  const end = date(body.end, "el final del periodo", { required: true });
  if (start > end) throw new ValidationError("El periodo está invertido.");
  return {
    start,
    end,
    escrito: text(body.escrito, "el texto escrito", { max: 8000, required: true }),
    audio: text(body.audio, "el texto para audio", { max: 8000 }),
    mejorado: textList(body.mejorado, "Lo mejorado"),
    mejorar: textList(body.mejorar, "Lo que hay que mejorar"),
    pasos: textList(body.pasos, "Los próximos pasos"),
  };
}

export function validateAiRequest(body) {
  return {
    prompt: text(body.prompt, "el texto para la IA", { max: 14000, required: true }),
    format: oneOf(body.format ?? "text", "el formato", ["text", "json"]),
  };
}

function positiveIdOrThrow(v) {
  const id = positiveId(v);
  if (!id) throw new ValidationError("Identificador no válido.");
  return id;
}
