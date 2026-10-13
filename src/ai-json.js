// Extrae un objeto JSON de la respuesta de un modelo de lenguaje: tolera
// bloques ```json, texto antes y después, saltos de línea sin escapar dentro
// de las cadenas y comas finales. Devuelve el objeto o null. Función pura.

function tryParse(candidate) {
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
}

const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

export function extractJson(input) {
  if (isPlainObject(input)) return input;
  const src = String(input ?? "").replace(/```(?:json)?/gi, "");
  const start = src.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false, out = "";
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      if (escaped) { escaped = false; out += c; continue; }
      if (c === "\\") { escaped = true; out += c; continue; }
      if (c === '"') inString = false;
      if (c === "\n") { out += "\\n"; continue; }
      if (c === "\r") continue;
      if (c === "\t") { out += "\\t"; continue; }
      out += c;
      continue;
    }
    out += c;
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        const parsed = tryParse(out);
        return isPlainObject(parsed) ? parsed : null;
      }
    }
  }
  return null;
}
