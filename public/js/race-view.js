// Presentación del plan de carrera (portado de la pestaña Competición del
// Session Builder): tarjetas de escenarios, perfil SVG, tabla por tramos con
// objetivo, paso acumulado y tomas, claves, lista previa, avisos, texto para
// WhatsApp y tarjeta imprimible con pulsera recortable.
"use strict";

(function (root) {
  const E = root.SB_RACE_ENGINE, U = root.RL_UTIL, P = root.RL_PRINT;
  const esc = U.esc;
  const SPORT_NAME = { run: "Carrera", bike: "Ciclismo", tri: "Triatlón" };
  const MAX_WA_INTAKES = 14;

  const fmtT = (s) => E.fmtTime(s);
  const gradeLabel = (g, t) => (t && t.rolling ? `ondulado ±${t.rolling} %` : g >= 2 ? `sube ${g.toFixed(1)} %` : g <= -2 ? `baja ${Math.abs(g).toFixed(1)} %` : "llano");
  const firstExtra = (input) => (input.sport === "tri" ? 12 : 5);

  function mainTarget(sc) {
    const out = [];
    for (const p of sc.parts) {
      if (p.sport === "swim") out.push(`${E.fmtPace(p.pace100)}/100 m`);
      if (p.sport === "bike") out.push(`NP ${p.np} W · ${p.avgSpeed} km/h`);
      if (p.sport === "run") out.push(`${E.fmtPace(p.avgPaceSec)}/km`);
    }
    return out.join(" · ");
  }
  function nutLine(sc) {
    const p = sc.parts.find((x) => x.nut && (x.nut.carbsH || x.nut.fluidH));
    if (!p) return "Solo agua según sed (prueba corta)";
    return `${p.nut.carbsH} g/h hidratos · ${p.nut.fluidH} ml/h · ${p.nut.sodiumH} mg/h sodio`;
  }
  function profileSvg(course) {
    const pts = course.profile || [];
    if (pts.length < 2) return "";
    const W = 640, H = 120, PAD = 6;
    const maxKm = pts[pts.length - 1].km || 1;
    const lo = Math.min(...pts.map((p) => p.ele)), hi = Math.max(...pts.map((p) => p.ele));
    const span = Math.max(30, hi - lo);
    const x = (km) => PAD + (km / maxKm) * (W - 2 * PAD), y = (e) => H - PAD - ((e - lo) / span) * (H - 2 * PAD - 14);
    const line = pts.map((p) => `${x(p.km).toFixed(1)},${y(p.ele).toFixed(1)}`).join(" ");
    const ticks = course.segments.map((s) => `<line x1="${x(s.to).toFixed(1)}" x2="${x(s.to).toFixed(1)}" y1="${H - PAD}" y2="${H - PAD - 6}" class="pf-tick"/>`).join("");
    return `<svg class="rc-profile" viewBox="0 0 ${W} ${H}" role="img" aria-label="Perfil del recorrido"><polygon points="${x(0)},${H - PAD} ${line} ${x(maxKm)},${H - PAD}" class="pf-area"/><polyline points="${line}" class="pf-line"/>${ticks}<text x="${PAD}" y="12" class="pf-text">${Math.round(hi)} m</text><text x="${W - PAD}" y="12" class="pf-text" text-anchor="end">${maxKm.toFixed(1)} km · +${Math.round(course.gain)} m${course.fromTrack ? "" : " · perfil aproximado (sin track)"}</text></svg>`;
  }
  function intakeFor(sc, part, t) {
    return sc.intake.filter((i) => i.part === part.label && i.km != null && i.km > t.cumKm - t.lenKm && i.km <= t.cumKm + 0.001);
  }
  function tramoTarget(input, part, t, i, html) {
    if (part.sport === "bike") return html ? `<b>${t.power} W</b> <span class="muted">(${t.pctFtp} % · máx ${t.powerMax})</span><br><span class="muted">${t.speed.toFixed(1)} km/h</span>` : `${t.power} W (máx ${t.powerMax}) · ${t.speed.toFixed(1)} km/h`;
    const pace = E.fmtPace(t.paceSec + (i === 0 ? firstExtra(input) : 0)) + "/km";
    return html ? `<b>${pace}</b>` : pace;
  }
  function partTable(input, sc, part, offset) {
    if (part.sport === "swim") {
      return `<div class="rc-part"><div class="rc-part-head">Natación · ${esc(part.distKm)} km</div><p>Ritmo objetivo <b>${esc(E.fmtPace(part.pace100))}/100 m</b> · tiempo ${esc(fmtT(part.totalSec))}. Primeros 200 m fuertes para coger sitio y después a ritmo; sal tranquilo del agua y respira antes de la T1.</p></div>`;
    }
    const rows = part.tramos.map((t, i) => {
      const tomas = intakeFor(sc, part, t);
      return `<tr><td>${t.from.toFixed(1)}–${t.to.toFixed(1)}</td><td>${esc(gradeLabel(t.grade, t))}</td><td>${tramoTarget(input, part, t, i, true)}</td><td>${esc(fmtT(offset + t.cumSec))}</td><td class="rc-toma">${tomas.map((x) => `${esc(x.what)} <span class="muted">(min ${esc(x.min)})</span>`).join("<br>")}</td></tr>`;
    }).join("");
    const head = part.sport === "bike" ? `NP ${part.np} W (IF ${part.IF}) · ${part.avgSpeed} km/h · ${part.kj} kJ` : `${E.fmtPace(part.avgPaceSec)}/km de media${part.hr ? ` · pulso ${part.hr.lo}-${part.hr.hi} ppm` : ""}`;
    return `<div class="rc-part"><div class="rc-part-head">${esc(part.label)} · ${esc(head)} · ${esc(fmtT(part.totalSec))}</div>
      <div class="table-wrap"><table class="table rc-table"><thead><tr><th>Km</th><th>Perfil</th><th>Objetivo</th><th>Paso</th><th>Tomas</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }
  const listBox = (title, items) => `<div class="rc-claves"><div class="rc-claves-t">${esc(title)}</div><ul>${items.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>`;

  function renderHtml(result, input, activeId) {
    const sc = result.scenarios.find((s) => s.id === activeId);
    const cards = result.scenarios.map((s) => `<button type="button" class="rc-sc rc-sc-${esc(s.id)} ${s.id === activeId ? "on" : ""}" data-rc-sc="${esc(s.id)}">
        <span class="rc-sc-l">${esc(s.label)}</span><span class="rc-sc-t">${esc(fmtT(s.totalSec))}</span>
        <span class="rc-sc-n">${esc(mainTarget(s))}</span><span class="rc-sc-n">${esc(nutLine(s))}</span><span class="rc-sc-n">${esc(s.temp)} °C</span></button>`).join("");
    let offset = 0;
    const parts = sc.parts.map((p) => { const h = partTable(input, sc, p, offset); offset += p.totalSec + (p.transitionSec || 0); return h; }).join("");
    const courses = input.sport === "tri" ? [input.courses.bike, input.courses.run] : [input.course];
    const caf = sc.intake.filter((i) => i.km == null);
    const m = input.meta;
    return `<div class="rc-title">${esc(m.name || "Prueba")}${m.date ? ` <span class="muted">· ${esc(U.fmtDate(m.date))}</span>` : ""}${m.athleteName ? `<span class="muted"> · ${esc(m.athleteName)}</span>` : ""}</div>
      ${(result.avisos || []).map((a) => `<p class="warn">${esc(a)}</p>`).join("")}
      <p class="hint">${esc(SPORT_NAME[input.sport])} · intensidad: ${esc(E.INTENT[input.cond.intent].label)}${m.source ? ` · basado en ${esc(m.source)}` : ""}</p>
      <div class="rc-scs">${cards}</div>
      ${courses.map((c) => profileSvg(c)).join("")}
      ${listBox("Claves de carrera", result.claves)}
      ${parts}
      ${caf.length ? listBox("Cafeína", caf.map((x) => x.what)) : ""}
      ${listBox("Antes de la carrera", result.pre)}
      <p class="hint">Total del escenario ${esc(sc.label.toLowerCase())}: ${esc(sc.totals.carbs)} g de hidratos y ${esc((sc.totals.ml / 1000).toFixed(1))} l de líquido. Son estimaciones de modelos de rendimiento: ajústalas con lo que sabes del deportista.</p>`;
  }

  function waText(result, input, activeId) {
    const sc = result.scenarios.find((s) => s.id === activeId);
    const m = input.meta;
    const first = (m.athleteName || "").split(" ")[0];
    const L = [`${first ? "Hola " + first + "! " : ""}Tu plan para ${m.name || "la carrera"}${m.date ? " (" + U.fmtDate(m.date) + ")" : ""}`, ""];
    L.push("Escenarios: " + result.scenarios.map((s) => `${s.label} ${fmtT(s.totalSec)}`).join(" · "), "");
    L.push(`Escenario ${sc.label.toLowerCase()}:`);
    let offset = 0;
    for (const p of sc.parts) {
      if (p.sport === "swim") L.push(`Natación: ${E.fmtPace(p.pace100)}/100 m (${fmtT(p.totalSec)})`);
      else {
        L.push(`${p.label}:`);
        p.tramos.forEach((t, i) => L.push(`· km ${t.from.toFixed(0)}-${t.to.toFixed(0)} ${gradeLabel(t.grade, t)}: ${tramoTarget(input, p, t, i, false)} → paso ${fmtT(offset + t.cumSec)}`));
      }
      offset += p.totalSec + (p.transitionSec || 0);
    }
    L.push("", `Nutrición: ${nutLine(sc)}.`, ...sc.intake.slice(0, MAX_WA_INTAKES).map((i) => `· ${i.min >= 0 ? "min " + i.min : "antes"}${i.km != null ? " (km " + i.km + ")" : ""}: ${i.what}`));
    L.push("", "Claves:", ...result.claves.map((c) => "· " + c));
    return L.join("\n");
  }

  function printCard(result, input, activeId) {
    const m = input.meta;
    const sc = result.scenarios.find((s) => s.id === activeId);
    const kp = P.kpis(result.scenarios.map((s) => ({ label: s.label, valor: fmtT(s.totalSec), nota: `${mainTarget(s)} · ${nutLine(s)}`, nivel: s.id === "optimista" ? "ok" : s.id === "normal" ? "acc" : "mid" })));
    let offset = 0, body = "", band = "";
    for (const p of sc.parts) {
      if (p.sport === "swim") body += P.section("Natación", `<p>Ritmo objetivo <b>${esc(E.fmtPace(p.pace100))}/100 m</b> · ${esc(fmtT(p.totalSec))}</p>`);
      else {
        const rows = p.tramos.map((t, i) => [`${t.from.toFixed(1)}–${t.to.toFixed(1)}`, esc(gradeLabel(t.grade, t)), `<b>${esc(tramoTarget(input, p, t, i, false))}</b>`, esc(fmtT(offset + t.cumSec)), intakeFor(sc, p, t).map((x) => esc(x.what)).join("<br>")]);
        body += P.section(`${p.label} · ${p.sport === "bike" ? "NP " + p.np + " W" : E.fmtPace(p.avgPaceSec) + "/km"} · ${fmtT(p.totalSec)}`, P.table(["Km", "Perfil", "Objetivo", "Paso", "Tomas"], rows));
        band += p.tramos.map((t) => `<span>${esc(t.to.toFixed(0))} km · ${esc(p.sport === "bike" ? t.power + " W" : E.fmtPace(t.paceSec))} · ${esc(fmtT(offset + t.cumSec))}</span>`).join("");
      }
      offset += p.totalSec + (p.transitionSec || 0);
    }
    const intakes = sc.intake.map((i) => `${i.min >= 0 ? "Min " + i.min : "Antes"}${i.km != null ? " · km " + i.km : ""}: ${i.what}`);
    const html = P.shell({
      eyebrow: "Estrategia de competición", title: m.name || "Plan de carrera",
      subtitle: `${SPORT_NAME[input.sport]} · escenario ${sc.label.toLowerCase()}${m.athleteName ? " · " + m.athleteName : ""}`,
      meta: [{ label: "Fecha", value: U.fmtDate(m.date) }, { label: "Intensidad", value: E.INTENT[input.cond.intent].label }, { label: "Temperatura", value: sc.temp + " °C" }],
      body: P.section("Tres escenarios", kp) + P.section("Claves de carrera", P.list(result.claves)) + body +
        P.section("Nutrición", `<p><b>${esc(nutLine(sc))}</b></p>${P.list(intakes)}${P.list(result.pre)}`) +
        (result.avisos && result.avisos.length ? P.section("Avisos", P.list(result.avisos)) : "") +
        P.section("Pulsera (recortar por la línea)", `<div class="band">${band || "<span>Sin tramos</span>"}</div>`),
      footRight: "Estrategia de competición",
    });
    P.open(html);
  }

  root.RL_RACE_VIEW = { SPORT_NAME, mainTarget, nutLine, gradeLabel, tramoTarget, renderHtml, waText, printCard };
})(window);
