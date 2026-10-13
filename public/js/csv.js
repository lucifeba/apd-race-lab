// Importación CSV de entrenos (exportación de TrainingPeaks u hojas parecidas).
// Tolerante: detecta el separador (, o ;), reconoce las columnas sin importar
// mayúsculas, tildes o espacios, admite decimales con coma y fechas
// AAAA-MM-DD o DD/MM/AAAA, y deja corregir el mapeo a mano. Sin DOM.
"use strict";

(function (root) {
  const MAX_ROWS = 3000;
  const FIELDS = [
    { key: "date", label: "Fecha (WorkoutDay)", aliases: ["workoutday", "date", "fecha", "day", "dia"], required: true },
    { key: "title", label: "Título (Title)", aliases: ["title", "titulo", "name", "nombre", "workout"] },
    { key: "type", label: "Deporte (WorkoutType)", aliases: ["workouttype", "type", "sport", "deporte", "tipo", "actividad"] },
    { key: "durationH", label: "Duración en horas (TimeTotalInHours)", aliases: ["timetotalinhours", "durationh", "duration", "duracion", "horas", "hours", "time"] },
    { key: "distanceM", label: "Distancia en metros (DistanceInMeters)", aliases: ["distanceinmeters", "distancem", "distance", "distancia", "metros", "meters"] },
    { key: "tss", label: "Carga (TSS)", aliases: ["tss", "carga", "load"] },
    { key: "plannedH", label: "Planificado en horas (PlannedDuration)", aliases: ["plannedduration", "planneddurationhours", "plannedh", "planned", "planificado", "duracionplanificada"] },
    { key: "rpe", label: "RPE (Rpe)", aliases: ["rpe", "esfuerzo"] },
    { key: "feeling", label: "Sensación (Feeling)", aliases: ["feeling", "sensacion", "sensaciones"] },
    { key: "comments", label: "Comentarios (AthleteComments)", aliases: ["athletecomments", "comments", "comentarios", "notas", "notes"] },
  ];

  const normHeader = (h) => String(h || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

  function detectDelimiter(textValue) {
    const firstLine = String(textValue || "").replace(/^﻿/, "").split(/\r?\n/).find((l) => l.trim()) || "";
    const count = (ch) => {
      let n = 0, quoted = false;
      for (const c of firstLine) {
        if (c === '"') quoted = !quoted;
        else if (c === ch && !quoted) n++;
      }
      return n;
    };
    const semi = count(";"), comma = count(","), tab = count("\t");
    if (tab > semi && tab > comma) return "\t";
    return semi > comma ? ";" : ",";
  }

  // CSV con comillas (RFC 4180): campos entre comillas con "" escapado y saltos de línea dentro.
  function parseCsv(textValue, delimiter, maxRecords) {
    const src = String(textValue || "").replace(/^﻿/, "");
    const limit = maxRecords || Infinity;
    const rows = [];
    let row = [], field = "", quoted = false;
    const endRow = () => {
      row.push(field);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = []; field = "";
    };
    for (let i = 0; i < src.length && rows.length < limit; i++) {
      const c = src[i];
      if (quoted) {
        if (c === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else field += c;
      } else if (c === '"' && field === "") quoted = true;
      else if (c === delimiter) { row.push(field); field = ""; }
      else if (c === "\n") endRow();
      else if (c !== "\r") field += c;
    }
    if ((field !== "" || row.length) && rows.length < limit) endRow();
    return rows;
  }

  function autoMap(headers) {
    const norm = headers.map(normHeader);
    const mapping = {};
    for (const f of FIELDS) {
      const idx = norm.findIndex((h) => f.aliases.includes(h));
      if (idx >= 0) mapping[f.key] = idx;
    }
    return mapping;
  }

  function missingFields(mapping) {
    const miss = [];
    if (mapping.date == null) miss.push("la fecha");
    if (mapping.durationH == null && mapping.plannedH == null && mapping.tss == null) miss.push("la duración, la duración planificada o la carga");
    return miss;
  }

  function parseNumber(v) {
    let s = String(v ?? "").trim().replace(/\s/g, "");
    if (!s) return null;
    if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    else s = s.replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function validDate(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return y >= 1990 && y <= 2100 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  const pad = (n) => String(n).padStart(2, "0");

  function parseDate(v) {
    const s = String(v ?? "").trim();
    let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/.exec(s);
    if (m) { const [y, mo, d] = [+m[1], +m[2], +m[3]]; return validDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null; }
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T].*)?$/.exec(s);
    if (m) { const [d, mo, y] = [+m[1], +m[2], +m[3]]; return validDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null; }
    return null;
  }

  // Deporte de la app a partir del WorkoutType; null = día de descanso (se omite).
  function mapSport(type) {
    const t = normHeader(type);
    if (!t) return "other";
    if (/dayoff|descanso|rest/.test(t)) return null;
    if (/swim|nata|nado/.test(t)) return "swim";
    if (/bike|cycl|bici|mtb|mountain|ciclis|ride|gravel/.test(t)) return "bike";
    if (/run|carrera|correr|trail|walk|camin/.test(t)) return "run";
    if (/strength|fuerza|gym|weight/.test(t)) return "strength";
    return "other";
  }

  const cell = (cells, mapping, key) => (mapping[key] != null ? cells[mapping[key]] : undefined);
  const inRange = (n, lo, hi) => (n != null && n >= lo && n <= hi ? n : null);
  const intIn = (n, lo, hi) => { const r = n == null ? null : Math.round(n); return inRange(r, lo, hi); };

  // Fila del CSV → entreno normalizado ({row}) o motivo para omitirla ({error}).
  function normalizeRow(cells, mapping) {
    const date = parseDate(cell(cells, mapping, "date"));
    if (!date) return { error: "fecha no válida" };
    const sport = mapSport(cell(cells, mapping, "type"));
    if (sport === null) return { error: "día de descanso" };
    const durationH = parseNumber(cell(cells, mapping, "durationH"));
    const plannedH = parseNumber(cell(cells, mapping, "plannedH"));
    const meters = parseNumber(cell(cells, mapping, "distanceM"));
    const tss = parseNumber(cell(cells, mapping, "tss"));
    if ([durationH, plannedH].some((h) => h != null && (h < 0 || h > 30))) return { error: "duración fuera de rango" };
    if (meters != null && (meters < 0 || meters > 1500000)) return { error: "distancia fuera de rango" };
    if (tss != null && (tss < 0 || tss > 2000)) return { error: "carga fuera de rango" };
    const row = {
      date, sport,
      title: String(cell(cells, mapping, "title") ?? "").trim().slice(0, 120) || null,
      durationH: durationH ? Math.round(durationH * 1000) / 1000 : null,
      plannedH: plannedH ? Math.round(plannedH * 1000) / 1000 : null,
      distanceKm: meters ? Math.round(meters / 10) / 100 : null,
      tss: tss ? Math.round(tss * 10) / 10 : null,
      rpe: intIn(parseNumber(cell(cells, mapping, "rpe")), 0, 10),
      feeling: intIn(parseNumber(cell(cells, mapping, "feeling")), 0, 10),
      comments: String(cell(cells, mapping, "comments") ?? "").replace(/\s+/g, " ").trim().slice(0, 1000) || null,
    };
    const done = (row.durationH || 0) > 0 || (row.distanceKm || 0) > 0 || (row.tss || 0) > 0;
    if (!done && !(row.plannedH > 0)) return { error: "sin duración, distancia, carga ni planificado" };
    return { row: { ...row, completed: done } };
  }

  // Análisis completo del archivo; `mappingOverride` viene del mapeo manual.
  function analyze(textValue, mappingOverride) {
    const delimiter = detectDelimiter(textValue);
    const records = parseCsv(textValue, delimiter, MAX_ROWS + 2);
    if (!records.length) return { delimiter, headers: [], mapping: {}, missing: ["la cabecera"], rows: [], errors: [], total: 0, overCap: false };
    const headers = records[0].map((h) => h.trim());
    const mapping = mappingOverride || autoMap(headers);
    const missing = missingFields(mapping);
    const data = records.slice(1);
    const overCap = data.length > MAX_ROWS;
    const rows = [], errors = [];
    if (!missing.length) {
      data.slice(0, MAX_ROWS).forEach((cells, i) => {
        const r = normalizeRow(cells, mapping);
        if (r.row) rows.push(r.row);
        else errors.push({ line: i + 2, error: r.error });
      });
    }
    return { delimiter, headers, mapping, missing, rows, errors, total: Math.min(data.length, MAX_ROWS), overCap };
  }

  const API = { MAX_ROWS, FIELDS, normHeader, detectDelimiter, parseCsv, autoMap, missingFields, parseNumber, parseDate, mapSport, normalizeRow, analyze };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.RL_CSV = API;
})(typeof window !== "undefined" ? window : globalThis);
