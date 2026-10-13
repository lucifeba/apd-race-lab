// Respuestas JSON homogéneas {ok, data?, error?} y lectura segura del cuerpo.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

export function ok(data, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), { status, headers: JSON_HEADERS });
}

export function fail(status, error) {
  return new Response(JSON.stringify({ ok: false, error }), { status, headers: JSON_HEADERS });
}

// Lee un cuerpo JSON (objeto) con tope de tamaño. Rechaza otros content-type
// para que un formulario de otro origen no pueda enviar peticiones válidas.
export async function readJson(request, maxBytes) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) throw new HttpError(415, "El cuerpo debe ser JSON.");
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new HttpError(413, "La petición es demasiado grande.");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError(413, "La petición es demasiado grande.");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, "El cuerpo no es un JSON válido.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Se esperaba un objeto JSON.");
  return value;
}
