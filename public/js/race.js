// Pestaña Estrategia de competición: formulario por pasos (modalidad →
// deportista → recorrido → preguntas) → SB_RACE_ENGINE.plan → tres escenarios.
// Los umbrales salen de la ficha del deportista y la forma (CTL) de su
// registro de entrenos. Guarda estrategias en el servidor (race_plans) y pide
// a la IA la explicación del entrenador.
"use strict";

(function (root) {
  const E = root.SB_RACE_ENGINE, U = root.RL_UTIL, API = root.RL_API, STORE = root.RL_STORE, FIT = root.RL_FITNESS, V = root.RL_RACE_VIEW;
  const { $, esc } = U;
  const MAX_TRACK_BYTES = 25 * 1024 * 1024;
  const FORM_IDS = ["rc-athlete", "rc-name", "rc-date", "rc-ftp", "rc-runpace", "rc-vdot", "rc-css", "rc-lthr", "rc-weight", "rc-ctl", "rc-tri-dist", "rc-wetsuit", "rc-dist", "rc-gain", "rc-dist-run", "rc-gain-run", "rc-surface", "rc-bike", "rc-draft", "rc-intent", "rc-temp", "rc-wind", "rc-gut", "rc-sweat", "rc-caffeine", "rc-exp", "rc-notes"];

  let sport = "run";
  let tracks = { main: null, run: null };
  let result = null, lastInput = null, activeScenario = "normal", historySource = "", currentPlanId = null, loadSeq = 0;

  // ---------- deportistas ----------
  function fillAthletes(list) {
    const sel = $("rc-athlete");
    const cur = sel.value;
    sel.innerHTML = '<option value="">Datos manuales</option>' + list.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("");
    if (cur && list.some((a) => String(a.id) === cur)) sel.value = cur;
  }
  const nameFor = (id) => { const a = STORE.byId(id); return a ? a.name : ""; };
  const setVal = (id, v) => { $(id).value = v == null ? "" : v; };

  // Umbrales de la ficha y forma actual calculada con su registro de entrenos.
  async function applyAthlete(id) {
    const a = STORE.byId(id);
    ["rc-ftp", "rc-runpace", "rc-vdot", "rc-css", "rc-lthr", "rc-weight", "rc-ctl"].forEach((k) => setVal(k, ""));
    historySource = "";
    $("rc-history-status").textContent = "";
    if (!a) return;
    setSport(a.sport);
    setVal("rc-ftp", a.ftp); setVal("rc-runpace", U.fmtPace(a.runPaceSec)); setVal("rc-vdot", a.vdot);
    setVal("rc-css", U.fmtPace(a.swimCssSec)); setVal("rc-lthr", a.lthr); setVal("rc-weight", a.weight);
    historySource = "umbrales de la ficha";
    const seq = ++loadSeq;
    $("rc-history-status").textContent = "Calculando la forma actual con su registro de entrenos…";
    try {
      const today = U.todayIso();
      const ws = await STORE.workouts(a.id, today);
      if (seq !== loadSeq) return;
      const p = FIT.pointAt(FIT.fitnessSeries(ws, { to: today }), today);
      if (p) { setVal("rc-ctl", Math.round(p.ctl)); historySource = `umbrales de la ficha y forma actual ${Math.round(p.ctl)} (frescura ${Math.round(p.tsb)})`; }
      $("rc-history-status").textContent = `Datos cargados: ${historySource}. Revísalos o corrígelos antes de calcular.`;
    } catch (ex) {
      if (seq === loadSeq) $("rc-history-status").textContent = "No se pudo calcular la forma: " + ex.message;
    }
  }
  function demo() {
    $("rc-athlete").value = "";
    const v = { "rc-ftp": 255, "rc-runpace": "4:25", "rc-vdot": 49, "rc-css": "1:48", "rc-lthr": 168, "rc-weight": 71, "rc-ctl": 62 };
    Object.entries(v).forEach(([k, x]) => setVal(k, x));
    if (!$("rc-name").value) $("rc-name").value = sport === "bike" ? "Gran fondo de ejemplo" : sport === "tri" ? "Triatlón de ejemplo" : "Media maratón de ejemplo";
    if (!tracks.main && !$("rc-dist").value) { $("rc-dist").value = sport === "bike" ? 120 : sport === "tri" ? 40 : 21.1; $("rc-gain").value = sport === "bike" ? 1800 : sport === "tri" ? 350 : 120; }
    if (sport === "tri" && !tracks.run && !$("rc-dist-run").value) { $("rc-dist-run").value = 10; $("rc-gain-run").value = 40; }
    historySource = "deportista de ejemplo (ficticio)";
    $("rc-history-status").textContent = "Datos de un deportista ficticio para probar el módulo.";
  }

  // ---------- modalidad ----------
  function setSport(s) {
    sport = s;
    const toggle = (sel, hide) => document.querySelectorAll(sel).forEach((el) => el.classList.toggle("hidden", hide));
    document.querySelectorAll("[data-rc-sport]").forEach((b) => b.classList.toggle("primary", b.dataset.rcSport === s));
    toggle(".rc-tri-only", s !== "tri");
    toggle(".rc-bike-only", s === "run");
    toggle(".rc-bike-solo", s !== "bike");
    toggle(".rc-run-only", s === "bike");
    toggle(".rc-bike", s === "run");
    toggle(".rc-run", s === "bike");
    toggle(".rc-swim", s !== "tri");
    $("rc-course-main-title").textContent = s === "tri" ? "Track del segmento de bici" : "Track de la prueba";
    if (s === "tri") $("rc-bike").value = "cabra";
  }

  // ---------- tracks ----------
  function readTrack(input, key, statusId) {
    const f = input.files && input.files[0];
    if (!f) { tracks[key] = null; $(statusId).textContent = ""; return; }
    if (f.size > MAX_TRACK_BYTES) { tracks[key] = null; $(statusId).textContent = "El archivo pasa de 25 MB."; return; }
    const fr = new FileReader();
    fr.onload = () => {
      const t = E.parseTrack(fr.result);
      if (t.points.length < 2) { tracks[key] = null; $(statusId).textContent = "No encuentro puntos en el archivo (¿es un GPX o TCX con track?)."; return; }
      const course = E.buildCourse({ points: t.points, maxSeg: key === "main" && sport !== "run" ? 16 : 14 });
      if (!(course.distKm >= 0.1)) { tracks[key] = null; $(statusId).textContent = "El track no tiene distancia (todos los puntos en el mismo sitio)."; return; }
      tracks[key] = { name: t.name.slice(0, 120), course };
      $(statusId).textContent = `Track leído: ${t.name ? t.name.slice(0, 120) + " · " : ""}${course.distKm.toFixed(1)} km · +${Math.round(course.gain)} m / -${Math.round(course.loss)} m · ${course.segments.length} tramos`;
      if (key === "main" && t.name && !$("rc-name").value) $("rc-name").value = t.name.slice(0, 120);
    };
    fr.onerror = () => { $(statusId).textContent = "No se pudo leer el archivo."; };
    fr.readAsText(f);
  }
  function courseFrom(key, distId, gainId, fallbackKm) {
    if (tracks[key]) return tracks[key].course;
    const d = parseFloat($(distId).value) || fallbackKm;
    if (!d) return null;
    return E.buildCourse({ distKm: d, gain: parseFloat($(gainId).value) || 0 });
  }

  // ---------- cálculo ----------
  function collect() {
    const num = (id) => { const v = parseFloat($(id).value); return isFinite(v) ? v : null; };
    const athlete = {
      ftp: num("rc-ftp"), runPace: $("rc-runpace").value.trim() || null, vdot: num("rc-vdot"),
      swimCss: $("rc-css").value.trim() || null, lthr: num("rc-lthr"), weight: num("rc-weight"), ctl: num("rc-ctl"),
    };
    const cond = {
      intent: $("rc-intent").value, tempC: num("rc-temp") ?? 16, wind: parseInt($("rc-wind").value, 10) || 0,
      surface: $("rc-surface").value, bike: $("rc-bike").value, draft: $("rc-draft").value === "1",
      triDistance: $("rc-tri-dist").value, wetsuit: $("rc-wetsuit").value === "1",
    };
    const nutrition = { gut: $("rc-gut").value, sweat: $("rc-sweat").value, caffeine: $("rc-caffeine").value === "1" };
    const meta = { name: $("rc-name").value.trim(), date: $("rc-date").value, athleteId: $("rc-athlete").value, athleteName: nameFor($("rc-athlete").value),
      experience: $("rc-exp").value, notes: $("rc-notes").value.trim(), source: historySource };
    return { sport, athlete, cond, nutrition, meta };
  }
  function fail(msg) { $("rc-error").textContent = msg; $("rc-error").classList.remove("hidden"); }
  function calc() {
    $("rc-error").classList.add("hidden");
    const inp = collect();
    if (inp.athlete.runPace && !E.parsePace(inp.athlete.runPace)) return fail("El ritmo umbral va en formato min:seg, por ejemplo 4:30.");
    if (inp.athlete.swimCss && !E.parsePace(inp.athlete.swimCss)) return fail("El CSS va en formato min:seg por 100 m, por ejemplo 1:50.");
    let input;
    if (sport === "tri") {
      const d = E.TRI[inp.cond.triDistance];
      input = { ...inp, courses: { bike: courseFrom("main", "rc-dist", "rc-gain", d.bike), run: courseFrom("run", "rc-dist-run", "rc-gain-run", d.run) } };
    } else {
      const course = courseFrom("main", "rc-dist", "rc-gain", null);
      if (!course) return fail("Sube el track de la prueba o escribe la distancia.");
      input = { ...inp, course };
    }
    const r = E.plan(input);
    if (r.error) return fail(r.error);
    result = r; lastInput = input; activeScenario = "normal";
    render();
    ["rc-print", "rc-wa", "rc-save"].forEach((k) => $(k).classList.remove("hidden"));
    $("rc-ai-head").classList.remove("hidden");
    $("rc-ai-out").innerHTML = "";
  }
  function render() {
    $("rc-result").innerHTML = V.renderHtml(result, lastInput, activeScenario);
    document.querySelectorAll("[data-rc-sc]").forEach((b) => b.addEventListener("click", () => { activeScenario = b.dataset.rcSc; render(); }));
  }

  // ---------- guardar y cargar ----------
  function formState() {
    // el track se guarda ya convertido en recorrido (tramos + perfil), no el archivo
    return { ...Object.fromEntries(FORM_IDS.map((k) => [k, $(k).value])), sport, tracks: { main: tracks.main, run: tracks.run } };
  }
  async function save() {
    const m = lastInput.meta;
    if (!m.name) { fail("Pon nombre a la prueba para guardar la estrategia."); return; }
    const body = { athleteId: m.athleteId || null, name: m.name, raceDate: m.date || null, sport, form: formState(),
      summary: result.scenarios.map((s) => `${s.label} ${E.fmtTime(s.totalSec)}`).join(" · ") };
    try {
      const r = await U.busy($("rc-save"), "Guardando…", () => API.post("/api/plans", body));
      currentPlanId = r.id;
      $("rc-delete").classList.remove("hidden");
      U.toast(r.replaced ? "Estrategia actualizada" : "Estrategia guardada");
      fillSaved();
    } catch (ex) { U.toast(ex.message); }
  }
  async function fillSaved() {
    try {
      const list = await API.get("/api/plans");
      $("rc-saved").innerHTML = '<option value="">Estrategias guardadas…</option>' + list.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.athleteName || "manual")}${x.raceDate ? " · " + esc(U.fmtDate(x.raceDate)) : ""}</option>`).join("");
    } catch (ex) { U.toast(ex.message); }
  }
  async function loadSaved(id) {
    try {
      const x = await API.get(`/api/plans/${encodeURIComponent(id)}`);
      if (!x.form) throw new Error("La estrategia guardada está dañada.");
      loadSeq++;
      setSport(x.sport);
      FORM_IDS.forEach((k) => { if (x.form[k] != null) $(k).value = x.form[k]; });
      if (x.form["rc-athlete"] && !STORE.byId(x.form["rc-athlete"])) $("rc-athlete").value = "";
      const t = x.form.tracks || {};
      tracks = { main: t.main && t.main.course ? t.main : null, run: t.run && t.run.course ? t.run : null };
      $("rc-gpx").value = ""; $("rc-gpx-run").value = "";
      $("rc-gpx-status").textContent = tracks.main ? `Track guardado · ${tracks.main.course.distKm.toFixed(1)} km` : "";
      $("rc-gpx-run-status").textContent = tracks.run ? `Track guardado · ${tracks.run.course.distKm.toFixed(1)} km` : "";
      historySource = "estrategia guardada";
      $("rc-history-status").textContent = `Estrategia guardada: ${x.summary || x.name}`;
      currentPlanId = x.id;
      $("rc-delete").classList.remove("hidden");
      calc();
    } catch (ex) { U.toast(ex.message); }
  }
  async function deleteSaved() {
    if (!currentPlanId || !root.confirm("¿Borrar la estrategia guardada?")) return;
    try {
      await API.del(`/api/plans/${currentPlanId}`);
      currentPlanId = null;
      $("rc-delete").classList.add("hidden");
      U.toast("Estrategia borrada");
      fillSaved();
    } catch (ex) { U.toast(ex.message); }
  }

  // ---------- IA ----------
  function partOffsets(sc) {
    let offset = 0;
    return sc.parts.map((p) => { const o = { p, offset }; offset += p.totalSec + (p.transitionSec || 0); return o; });
  }
  async function explain() {
    const m = lastInput.meta;
    const sc = result.scenarios.find((s) => s.id === "normal");
    const a = STORE.byId(m.athleteId);
    const resumen = {
      prueba: m.name, fecha: m.date, modalidad: V.SPORT_NAME[lastInput.sport], intensidad: E.INTENT[lastInput.cond.intent].label, primeraVez: m.experience === "no", notas: m.notes,
      formaActual: lastInput.athlete.ctl,
      escenarios: result.scenarios.map((s) => ({ escenario: s.label, tiempo: E.fmtTime(s.totalSec), objetivo: V.mainTarget(s), nutricion: V.nutLine(s), temperatura: s.temp })),
      tramosNormal: partOffsets(sc).filter(({ p }) => p.tramos).map(({ p, offset }) => ({ parte: p.label, tramos: p.tramos.map((t, i) => ({ km: `${t.from.toFixed(1)}-${t.to.toFixed(1)}`, perfil: V.gradeLabel(t.grade, t), objetivo: V.tramoTarget(lastInput, p, t, i, false), paso: E.fmtTime(offset + t.cumSec) })) })),
      claves: result.claves, antes: result.pre,
    };
    const name = (m.athleteName || "").split(" ")[0];
    const ctx = a && a.notes ? `\nCONTEXTO DEL DEPORTISTA (notas del entrenador)\n${a.notes}` : "";
    const prompt = `Explica a ${name || "tu deportista"} la estrategia de su próxima competición para que la entienda y la ejecute. Los números ya están calculados: NO inventes ni cambies cifras, úsalas.

ESTRATEGIA CALCULADA (JSON)
${JSON.stringify(resumen)}
${ctx}

ESCRIBE 220-320 palabras en castellano de España, sin markdown ni listas, en 5 párrafos cortos: 1) cómo afrontar la prueba según su perfil y la intensidad elegida; 2) el reparto del esfuerzo por partes del recorrido, citando 2-3 tramos clave con su objetivo; 3) la nutrición e hidratación con horarios concretos; 4) cuándo pasar al escenario menos favorable (señales de alarma) o atreverse con el optimista; 5) cierre con confianza y algo concreto de su preparación. Siglas traducidas (NP = potencia normalizada). Devuelve solo el texto.`;
    $("rc-ai-out").innerHTML = '<p class="hint">La IA está leyendo la estrategia…</p>';
    try {
      const r = await U.busy($("rc-ai"), "Redactando…", () => API.post("/api/ai", { prompt, format: "text" }));
      const ta = document.createElement("textarea");
      ta.rows = 12; ta.value = String(r.content || "").trim();
      const copy = document.createElement("button");
      copy.className = "btn chip"; copy.type = "button"; copy.textContent = "Copiar";
      copy.addEventListener("click", async () => U.toast((await U.copyText(ta.value)) ? "Copiado" : "Selecciona y copia el texto"));
      $("rc-ai-out").innerHTML = "";
      $("rc-ai-out").append(ta, copy);
    } catch (ex) {
      $("rc-ai-out").innerHTML = `<p class="error">La IA no está disponible ahora mismo (${esc(ex.message)}). La estrategia calculada sigue siendo válida: usa las claves y la tarjeta.</p>`;
    }
  }

  function init() {
    if (!E) return;
    document.querySelectorAll("[data-rc-sport]").forEach((b) => b.addEventListener("click", () => setSport(b.dataset.rcSport)));
    $("rc-athlete").addEventListener("change", (e) => applyAthlete(e.target.value));
    $("rc-demo").addEventListener("click", demo);
    $("rc-gpx").addEventListener("change", (e) => readTrack(e.target, "main", "rc-gpx-status"));
    $("rc-gpx-run").addEventListener("change", (e) => readTrack(e.target, "run", "rc-gpx-run-status"));
    $("rc-calc").addEventListener("click", calc);
    $("rc-print").addEventListener("click", () => V.printCard(result, lastInput, activeScenario));
    $("rc-wa").addEventListener("click", async () => U.toast((await U.copyText(V.waText(result, lastInput, activeScenario))) ? "Plan copiado: pégalo en WhatsApp" : "No se pudo copiar"));
    $("rc-save").addEventListener("click", save);
    $("rc-delete").addEventListener("click", deleteSaved);
    $("rc-ai").addEventListener("click", explain);
    $("rc-saved").addEventListener("change", (e) => { if (e.target.value) loadSaved(e.target.value); e.target.value = ""; });
    STORE.subscribe(fillAthletes);
    setSport("run");
  }

  root.RL_RACE = { init, onShow: fillSaved, calc };
})(window);
