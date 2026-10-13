// Forma, fatiga y frescura a partir de la carga diaria (TSS), en el navegador:
//   CTL (forma)    = media exponencial de 42 días de la carga diaria
//   ATL (fatiga)   = media exponencial de 7 días
//   TSB (frescura) = CTL - ATL del día anterior
// Un entreno hecho sin TSS cuenta 50 por hora (estimación conservadora).
// Sin DOM: lo usan athletes.js, race.js, feedback.js y los tests de Node.
"use strict";

(function (root) {
  const DAY = 86400000;
  const CTL_DAYS = 42;
  const ATL_DAYS = 7;
  const EST_TSS_PER_HOUR = 50;
  const MAX_SPAN_DAYS = 3660;

  const toT = (iso) => Date.parse(iso + "T00:00:00Z");
  const isoOf = (t) => new Date(t).toISOString().slice(0, 10);
  const r1 = (v) => Math.round(v * 10) / 10;

  function workoutLoad(w) {
    if (!w || !w.completed) return 0;
    if (w.tss != null && isFinite(w.tss)) return Math.max(0, Number(w.tss));
    const h = Number(w.durationH) || 0;
    return h > 0 ? h * EST_TSS_PER_HOUR : 0;
  }

  function dailyLoad(workouts) {
    const m = new Map();
    for (const w of workouts || []) {
      if (!w || typeof w.date !== "string") continue;
      const l = workoutLoad(w);
      if (l > 0) m.set(w.date, (m.get(w.date) || 0) + l);
    }
    return m;
  }

  // Serie diaria desde el primer día con carga (o `from` si es anterior) hasta
  // `to` (por defecto el último día con carga).
  function fitnessSeries(workouts, opts) {
    const o = opts || {};
    const loads = dailyLoad(workouts);
    const dates = [...loads.keys()].sort();
    let start = dates[0];
    if (o.from && (!start || o.from < start)) start = o.from;
    if (!start) return [];
    const end = o.to || dates[dates.length - 1] || start;
    if (end < start) return [];
    const span = Math.round((toT(end) - toT(start)) / DAY);
    if (span > MAX_SPAN_DAYS) start = isoOf(toT(end) - MAX_SPAN_DAYS * DAY);
    let ctl = 0, atl = 0;
    const out = [];
    for (let t = toT(start); t <= toT(end); t += DAY) {
      const date = isoOf(t);
      const tss = loads.get(date) || 0;
      const tsb = ctl - atl;
      ctl += (tss - ctl) / CTL_DAYS;
      atl += (tss - atl) / ATL_DAYS;
      out.push({ date, tss: Math.round(tss), ctl: r1(ctl), atl: r1(atl), tsb: r1(tsb) });
    }
    return out;
  }

  // Punto de la serie en una fecha (el último anterior o igual). Antes de la
  // primera carga la forma es 0.
  function pointAt(series, date) {
    if (!Array.isArray(series) || !series.length) return null;
    if (date < series[0].date) return { date, tss: 0, ctl: 0, atl: 0, tsb: 0 };
    let best = null;
    for (const p of series) {
      if (p.date <= date) best = p;
      else break;
    }
    return best;
  }

  function ctlAt(series, date) {
    const p = pointAt(series, date);
    return p ? p.ctl : null;
  }

  // Gráfico SVG (solo números, sin texto del usuario): barras de carga diaria,
  // forma, fatiga y frescura de los últimos `days` días.
  function chartSvg(series, opts) {
    const o = opts || {};
    const days = o.days || 120;
    const pts = (series || []).slice(-days);
    if (pts.length < 2) return "";
    const W = o.width || 640, H = o.height || 200, PL = 30, PR = 8, PT = 18, PB = 22;
    const maxV = Math.max(20, ...pts.map((p) => Math.max(p.ctl, p.atl, p.tss)));
    const minV = Math.min(0, ...pts.map((p) => p.tsb));
    const x = (i) => PL + (i / (pts.length - 1)) * (W - PL - PR);
    const y = (v) => PT + (1 - (v - minV) / (maxV - minV)) * (H - PT - PB);
    const line = (key) => pts.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
    const bw = Math.max(1, (W - PL - PR) / pts.length - 1);
    const bars = pts.map((p, i) => (p.tss ? `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${y(p.tss).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, y(0) - y(p.tss)).toFixed(1)}" class="fc-bar"/>` : "")).join("");
    const grid = [0, Math.round(maxV / 2), Math.round(maxV)].map((v) => `<line x1="${PL}" x2="${W - PR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="fc-grid"/><text x="${PL - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" class="fc-axis">${v}</text>`).join("");
    const first = pts[0].date, last = pts[pts.length - 1].date;
    return `<svg class="fitness-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución de forma, fatiga y frescura">${grid}${bars}` +
      `<polyline points="${line("tsb")}" class="fc-tsb"/><polyline points="${line("atl")}" class="fc-atl"/><polyline points="${line("ctl")}" class="fc-ctl"/>` +
      `<text x="${PL}" y="${H - 6}" class="fc-axis">${first}</text><text x="${W - PR}" y="${H - 6}" text-anchor="end" class="fc-axis">${last}</text>` +
      `<text x="${PL}" y="12" class="fc-legend"><tspan class="fc-ctl-t">Forma (CTL)</tspan>  <tspan class="fc-atl-t">Fatiga (ATL)</tspan>  <tspan class="fc-tsb-t">Frescura (TSB)</tspan>  <tspan class="fc-bar-t">Carga diaria</tspan></text></svg>`;
  }

  const API = { CTL_DAYS, ATL_DAYS, EST_TSS_PER_HOUR, workoutLoad, dailyLoad, fitnessSeries, pointAt, ctlAt, chartSvg };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.RL_FITNESS = API;
})(typeof window !== "undefined" ? window : globalThis);
