// Pestaña Feedback personalizado: deportista + periodo → hechos frente al
// periodo anterior (RL_FEEDBACK_CORE) → la IA redacta dos versiones (escrita
// para WhatsApp y hablada para una nota de voz). Si la IA falla, texto de
// respaldo con los datos. Guarda en el servidor y el siguiente feedback del
// mismo deportista revisa los próximos pasos marcados.
"use strict";

(function (root) {
  const U = root.RL_UTIL, API = root.RL_API, STORE = root.RL_STORE, FIT = root.RL_FITNESS, CORE = root.RL_FEEDBACK_CORE, P = root.RL_PRINT;
  const { $, esc } = U;
  const HISTORY_SHOWN = 6;

  let last = null;
  let history = [];

  // ---------- deportistas y periodo ----------
  function fillAthletes(list) {
    const sel = $("fb-athlete");
    const cur = sel.value;
    sel.innerHTML = list.length ? list.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("") : '<option value="">Crea primero un deportista</option>';
    if (cur && list.some((a) => String(a.id) === cur)) sel.value = cur;
    loadHistory();
  }
  function setRange(kind) {
    const r = CORE.quickRange(kind, U.todayIso());
    $("fb-start").value = r.start;
    $("fb-end").value = r.end;
  }

  // ---------- flujo principal ----------
  async function gather(athleteId, start, end) {
    const [workouts, feedbacks, plans] = await Promise.all([
      STORE.workouts(athleteId, end),
      API.get(`/api/athletes/${encodeURIComponent(athleteId)}/feedbacks`),
      API.get(`/api/plans?athleteId=${encodeURIComponent(athleteId)}`).catch(() => []),
    ]);
    const next = plans.filter((p) => p.raceDate && p.raceDate > end).sort((a, b) => a.raceDate.localeCompare(b.raceDate))[0];
    return { workouts, feedbacks, nextRace: next ? { name: next.name, date: next.raceDate } : null };
  }

  async function run() {
    const athleteId = $("fb-athlete").value;
    const start = $("fb-start").value, end = $("fb-end").value;
    if (!athleteId) { U.toast("Elige un deportista"); return; }
    if (!start || !end || start > end) { U.toast("Elige un periodo válido"); return; }
    const btn = $("fb-run");
    btn.disabled = true;
    btn.textContent = "Leyendo el periodo…";
    $("fb-status").textContent = "Leyendo los entrenos del periodo y del anterior de igual duración…";
    try {
      const a = STORE.byId(athleteId);
      const d = await gather(athleteId, start, end);
      const series = FIT.fitnessSeries(d.workouts, { to: end });
      const facts = CORE.buildFacts({ workouts: d.workouts, series, start, end, today: U.todayIso(), name: a ? a.name.replace(/\s*\(fictici[oa]\)\s*/i, "") : "",
        feedbacks: d.feedbacks, nextRace: d.nextRace, ctx: a && a.notes ? a.notes : "" });
      facts.athleteId = athleteId;
      renderFacts(facts);
      btn.textContent = "Redactando el feedback…";
      $("fb-status").textContent = "La IA está analizando el periodo y redactando las dos versiones (puede tardar un poco)…";
      let out = null;
      try {
        const r = await API.post("/api/ai", { prompt: CORE.buildPrompt(facts, { tone: $("fb-tone").value, length: $("fb-length").value, focus: $("fb-focus").value.trim() }), format: "json" });
        out = CORE.parseAI(r.content, r.json);
        $("fb-status").textContent = out ? `Feedback del ${U.fmtDate(start)} al ${U.fmtDate(end)}. Revísalo antes de enviarlo.` : "La IA respondió en un formato inesperado: te dejo una versión base con los datos.";
      } catch (ex) {
        $("fb-status").textContent = `La IA no respondió (${ex.message}): te dejo una versión base con los datos.`;
      }
      last = { facts, out: out || CORE.fallback(facts), start, end };
      renderOut();
    } catch (ex) {
      $("fb-status").textContent = "";
      $("fb-out").innerHTML = `<p class="error">Error: ${esc(ex.message)}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "Generar feedback";
    }
  }

  // ---------- vista ----------
  function kpi(label, val, prev, unit, invert, points) {
    const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
    const d = prev != null && val != null ? (points ? val - prev : prev !== 0 ? pct(val, prev) : null) : null;
    const good = d == null || d === 0 ? "" : (invert ? d < 0 : d > 0) ? "up" : "down";
    const u = unit ? " " + unit : "";
    return `<div class="kpi"><div class="kpi-l">${esc(label)}</div><div class="kpi-v">${esc(val ?? "-")}${val != null ? esc(u) : ""}</div><div class="kpi-n">antes ${esc(prev ?? "-")}${prev != null ? esc(u) : ""}${d ? ` · <span class="${good}">${d > 0 ? "+" : ""}${esc(d)}${points ? " puntos" : " %"}</span>` : ""}</div></div>`;
  }
  function renderFacts(f) {
    const c = f.cur, p = f.prev;
    const sports = Object.entries(c.porDeporte).map(([k, v]) => `${CORE.SPORT_LABEL[k] || k}: ${v.sesiones} ses · ${v.horas} h${v.km ? " · " + v.km + " km" : ""}`).join(" · ");
    const li = (arr, empty) => arr.map((x) => `<li>${esc(x)}</li>`).join("") || `<li>${esc(empty)}</li>`;
    $("fb-facts").innerHTML = `
      <div class="kpi-grid">
        ${kpi("Sesiones hechas", c.sesiones, p.sesiones)}
        ${kpi("Horas", c.horas, p.horas, "h")}
        ${kpi("Carga", c.carga, p.carga)}
        ${kpi("Cumplimiento del plan", c.adherencia, p.adherencia, "%", false, true)}
        ${kpi("Hueco máximo sin entrenar", c.huecoMax, p.huecoMax, "días", true)}
        ${kpi("Semanas constantes", `${c.semanasConstantes}/${c.semanas}`, `${p.semanasConstantes}/${p.semanas}`)}
        ${f.forma.inicio != null ? `<div class="kpi"><div class="kpi-l">Forma (CTL)</div><div class="kpi-v">${esc(f.forma.inicio)} → ${esc(f.forma.fin)}</div><div class="kpi-n">al inicio y al final del periodo</div></div>` : ""}
      </div>
      ${sports ? `<p class="hint">${esc(sports)}</p>` : ""}
      <p class="hint">Comparado con ${esc(U.fmtDate(p.start))} a ${esc(U.fmtDate(p.end))}.${f.next ? ` Próxima competición: ${esc(f.next.name)} (${esc(U.fmtDate(f.next.date))}).` : ""}</p>
      <div class="two-col">
        <div><div class="list-t up">Va a mejor</div><ul class="fb-list">${li(f.lecturas.up, "Sin cambios claros frente al periodo anterior")}</ul></div>
        <div><div class="list-t down">A vigilar</div><ul class="fb-list">${li(f.lecturas.watch, "Nada preocupante")}</ul></div>
      </div>
      ${c.comentarios.length ? `<details class="map-box"><summary>Comentarios del deportista (${c.comentarios.length})</summary><ul class="fb-list">${li(c.comentarios, "")}</ul></details>` : ""}
      ${f.prevSteps ? `<p class="hint">Se revisan los próximos pasos del feedback del ${esc(U.fmtDate(f.prevSteps.fecha))}: ${esc(f.prevSteps.pasos.join(" · "))}</p>` : ""}`;
  }

  function renderOut() {
    const { out } = last;
    const box = $("fb-out");
    box.innerHTML = `
      ${out.fallback ? '<p class="warn">Versión base generada con los datos (la IA no respondió). Puedes editarla o volver a generar.</p>' : ""}
      <div class="btn-row"><button class="btn chip primary" data-fb-v="escrito" type="button">Escrito (WhatsApp)</button><button class="btn chip" data-fb-v="audio" type="button">Para leer en voz alta</button></div>
      <textarea id="fb-text-escrito" rows="16" aria-label="Versión escrita"></textarea>
      <textarea id="fb-text-audio" class="hidden" rows="16" aria-label="Versión para audio"></textarea>
      <div class="btn-row top-gap">
        <button id="fb-copy" class="btn chip" type="button">Copiar</button>
        <a id="fb-wa" class="btn chip wa" target="_blank" rel="noopener noreferrer">Abrir en WhatsApp</a>
        <button id="fb-speak" class="btn chip" type="button">▶ Escuchar</button>
        <button id="fb-stop" class="btn chip hidden" type="button">■ Parar</button>
      </div>`;
    $("fb-text-escrito").value = out.escrito || "";
    $("fb-text-audio").value = out.audio || "";
    let view = "escrito";
    const ta = () => $("fb-text-" + view);
    const setHref = () => { $("fb-wa").href = "https://wa.me/?text=" + encodeURIComponent($("fb-text-escrito").value); };
    setHref();
    $("fb-text-escrito").addEventListener("input", setHref);
    box.querySelectorAll("[data-fb-v]").forEach((b) => b.addEventListener("click", () => {
      view = b.dataset.fbV;
      box.querySelectorAll("[data-fb-v]").forEach((x) => x.classList.toggle("primary", x === b));
      $("fb-text-escrito").classList.toggle("hidden", view !== "escrito");
      $("fb-text-audio").classList.toggle("hidden", view !== "audio");
    }));
    $("fb-copy").addEventListener("click", async () => U.toast((await U.copyText(ta().value)) ? "Copiado" : "Selecciona y copia el texto"));
    $("fb-speak").addEventListener("click", () => speak($("fb-text-audio").value || ta().value));
    $("fb-stop").addEventListener("click", stopSpeak);
    $("fb-print").classList.remove("hidden");
    $("fb-save").classList.remove("hidden");
  }

  // ---------- acciones ----------
  function speak(textValue) {
    if (!("speechSynthesis" in root)) { U.toast("Este navegador no puede leer en voz alta"); return; }
    stopSpeak();
    const u = new SpeechSynthesisUtterance(String(textValue).replace(/\*/g, ""));
    u.lang = "es-ES";
    const voices = speechSynthesis.getVoices();
    const v = voices.find((x) => x.lang === "es-ES") || voices.find((x) => /^es/.test(x.lang));
    if (v) u.voice = v;
    u.onend = () => { $("fb-stop").classList.add("hidden"); $("fb-speak").classList.remove("hidden"); };
    $("fb-stop").classList.remove("hidden");
    $("fb-speak").classList.add("hidden");
    speechSynthesis.speak(u);
  }
  function stopSpeak() {
    if ("speechSynthesis" in root) speechSynthesis.cancel();
    const s = $("fb-stop"), p = $("fb-speak");
    if (s) s.classList.add("hidden");
    if (p) p.classList.remove("hidden");
  }
  async function save() {
    const { facts: f, out } = last;
    const body = { start: last.start, end: last.end, escrito: $("fb-text-escrito").value, audio: $("fb-text-audio").value,
      mejorado: out.mejorado || [], mejorar: out.mejorar || [], pasos: out.pasos || [] };
    try {
      await U.busy($("fb-save"), "Guardando…", () => API.post(`/api/athletes/${encodeURIComponent(f.athleteId)}/feedbacks`, body));
      U.toast("Feedback guardado: el próximo revisará estos pasos");
      loadHistory();
    } catch (ex) { U.toast(ex.message); }
  }
  async function loadHistory() {
    const id = $("fb-athlete").value;
    history = [];
    if (id) {
      try { history = await API.get(`/api/athletes/${encodeURIComponent(id)}/feedbacks`); } catch (ex) { U.toast(ex.message); }
    }
    if (id !== $("fb-athlete").value) return;
    $("fb-hist-head").classList.toggle("hidden", !history.length);
    $("fb-hist").innerHTML = history.slice(0, HISTORY_SHOWN).map((h, i) => `<details class="fb-h"><summary>${esc(U.fmtDate(h.start))} → ${esc(U.fmtDate(h.end))} · ${esc(h.pasos.slice(0, 2).join(" · ") || "feedback")}</summary><pre class="fb-pre">${esc(h.escrito)}</pre>
      <div class="btn-row"><button class="btn chip" type="button" data-fb-copy="${i}">Copiar</button><button class="btn chip danger" type="button" data-fb-del="${i}">Borrar</button></div></details>`).join("");
    $("fb-hist").querySelectorAll("[data-fb-copy]").forEach((b) => b.addEventListener("click", async () => U.toast((await U.copyText(history[+b.dataset.fbCopy].escrito)) ? "Copiado" : "No se pudo copiar")));
    $("fb-hist").querySelectorAll("[data-fb-del]").forEach((b) => b.addEventListener("click", async () => {
      const h = history[+b.dataset.fbDel];
      if (!h || !root.confirm("¿Borrar este feedback guardado?")) return;
      try { await API.del(`/api/feedbacks/${h.id}`); U.toast("Feedback borrado"); loadHistory(); } catch (ex) { U.toast(ex.message); }
    }));
  }
  function print() {
    const { facts: f, out } = last;
    const c = f.cur, p = f.prev;
    const kp = P.kpis([
      { label: "Sesiones", valor: c.sesiones, nota: `antes ${p.sesiones}` },
      { label: "Horas", valor: c.horas + " h", nota: `antes ${p.horas} h` },
      { label: "Cumplimiento", valor: c.adherencia != null ? c.adherencia + " %" : "-", nota: `${c.cumplidas} de ${c.planificadas} previstas`, nivel: c.adherencia == null ? "" : c.adherencia >= 85 ? "ok" : c.adherencia >= 70 ? "mid" : "" },
      { label: "Carga", valor: c.carga, nota: `antes ${p.carga}` },
      { label: "Forma", valor: f.forma.inicio != null ? `${f.forma.inicio} → ${f.forma.fin}` : "-", nota: "inicio → final" },
      { label: "Hueco máximo", valor: c.huecoMax + " días", nota: `antes ${p.huecoMax}` },
    ]);
    const html = P.shell({
      eyebrow: "Feedback personalizado", title: `Feedback de ${f.name || "tu periodo"}`, subtitle: `Del ${U.fmtDate(c.start)} al ${U.fmtDate(c.end)}`,
      meta: [{ label: "Periodo", value: `${c.days} días` }, { label: "Comparado con", value: `${U.fmtDate(p.start)} a ${U.fmtDate(p.end)}` }],
      body: P.section("El periodo en cifras", kp) +
        P.section("Lo que hemos mejorado", P.list(out.mejorado && out.mejorado.length ? out.mejorado : f.lecturas.up)) +
        P.section("Lo que hay que seguir mejorando", P.list(out.mejorar && out.mejorar.length ? out.mejorar : f.lecturas.watch)) +
        P.section("Próximos pasos", P.list(out.pasos)) +
        P.section("Mensaje", `<pre>${esc($("fb-text-escrito").value.replace(/\*/g, ""))}</pre>`),
      footRight: "Feedback personalizado",
    });
    P.open(html);
  }

  function init() {
    setRange("28");
    document.querySelectorAll(".fb-quick").forEach((b) => b.addEventListener("click", () => setRange(b.dataset.days)));
    $("fb-run").addEventListener("click", run);
    $("fb-save").addEventListener("click", save);
    $("fb-print").addEventListener("click", print);
    $("fb-athlete").addEventListener("change", loadHistory);
    STORE.subscribe(fillAthletes);
  }

  root.RL_FEEDBACK = { init, onShow: loadHistory };
})(window);
