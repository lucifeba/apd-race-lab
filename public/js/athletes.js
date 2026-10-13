// Pestaña Deportistas: alta, edición y borrado de deportistas; ficha con
// forma (CTL), fatiga (ATL) y frescura (TSB) calculadas en el navegador, y
// registro de entrenos (alta manual y borrado; la importación CSV va en import.js).
"use strict";

(function (root) {
  const U = root.RL_UTIL, API = root.RL_API, STORE = root.RL_STORE, FIT = root.RL_FITNESS, CORE = root.RL_FEEDBACK_CORE;
  const { $, esc } = U;
  const PAGE = 40;
  const CHART_DAYS = 120;
  const NARROW_PX = 900;
  const isNarrow = () => root.innerWidth < NARROW_PX;
  const KPI_DAYS = 28;

  let currentId = null;
  let editingId = null;
  let workouts = [];
  let shown = PAGE;

  // ---------- lista ----------
  function thresholdsLine(a) {
    const out = [];
    if (a.ftp) out.push(`FTP ${a.ftp} W`);
    if (a.runPaceSec) out.push(`umbral ${U.fmtPace(a.runPaceSec)}/km`);
    if (a.vdot) out.push(`VDOT ${a.vdot}`);
    if (a.swimCssSec) out.push(`CSS ${U.fmtPace(a.swimCssSec)}/100 m`);
    return out.join(" · ");
  }
  function renderList(list) {
    const box = $("ath-list");
    if (!list.length) { box.innerHTML = '<p class="hint">Todavía no hay deportistas. Crea el primero con «Nuevo».</p>'; return; }
    box.innerHTML = list.map((a) => `<button type="button" class="ath-item ${String(a.id) === String(currentId) ? "on" : ""}" data-ath="${esc(a.id)}">
      <span class="ath-name">${esc(a.name)}</span>
      <span class="ath-meta">${esc(U.SPORT_LABEL[a.sport] || a.sport)} · ${esc(a.workouts ?? 0)} entrenos${a.lastDate ? " · último " + esc(U.fmtDate(a.lastDate)) : ""}</span>
      <span class="ath-meta">${esc(thresholdsLine(a))}</span></button>`).join("");
    box.querySelectorAll("[data-ath]").forEach((b) => b.addEventListener("click", () => select(b.dataset.ath)));
  }

  // ---------- formulario de deportista ----------
  const FIELDS = ["name", "sport", "ftp", "runpace", "vdot", "css", "lthr", "weight", "notes"];
  function openForm(a) {
    editingId = a ? a.id : null;
    $("ath-form-title").textContent = a ? `Editar: ${a.name}` : "Nuevo deportista";
    const v = a ? { name: a.name, sport: a.sport, ftp: a.ftp, runpace: U.fmtPace(a.runPaceSec), vdot: a.vdot, css: U.fmtPace(a.swimCssSec), lthr: a.lthr, weight: a.weight, notes: a.notes } : { sport: "run" };
    FIELDS.forEach((k) => { $("ath-" + k).value = v[k] ?? ""; });
    $("ath-form-error").classList.add("hidden");
    $("ath-form").classList.remove("hidden");
    $("ath-name").focus();
  }
  function closeForm() { $("ath-form").classList.add("hidden"); editingId = null; }
  function formBody() {
    const runPace = $("ath-runpace").value.trim(), css = $("ath-css").value.trim();
    if (runPace && !U.parsePace(runPace)) throw new Error("El ritmo umbral va en formato min:seg, por ejemplo 4:30.");
    if (css && !U.parsePace(css)) throw new Error("El CSS va en formato min:seg, por ejemplo 1:50.");
    return {
      name: $("ath-name").value.trim(), sport: $("ath-sport").value, ftp: U.numOrNull($("ath-ftp").value),
      runPaceSec: runPace ? U.parsePace(runPace) : null, vdot: U.numOrNull($("ath-vdot").value),
      swimCssSec: css ? U.parsePace(css) : null, lthr: U.numOrNull($("ath-lthr").value), weight: U.numOrNull($("ath-weight").value),
      notes: $("ath-notes").value.trim(),
    };
  }
  async function saveForm(e) {
    e.preventDefault();
    const err = $("ath-form-error");
    err.classList.add("hidden");
    try {
      const body = formBody();
      if (!body.name) throw new Error("Escribe el nombre del deportista.");
      const saved = await U.busy($("ath-save"), "Guardando…", () => (editingId ? API.put(`/api/athletes/${editingId}`, body) : API.post("/api/athletes", body)));
      closeForm();
      await STORE.loadAthletes();
      U.toast("Deportista guardado");
      await select(saved.id);
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove("hidden");
    }
  }
  async function removeAthlete(a) {
    if (!root.confirm(`¿Borrar a ${a.name} con todos sus entrenos y feedbacks? No se puede deshacer.`)) return;
    try {
      await API.del(`/api/athletes/${a.id}`);
      currentId = null;
      $("ath-detail").classList.add("hidden");
      $("ath-empty").classList.remove("hidden");
      await STORE.loadAthletes();
      U.toast("Deportista borrado");
    } catch (ex) { U.toast(ex.message); }
  }

  // ---------- ficha ----------
  async function select(id) {
    currentId = String(id);
    closeForm();
    renderList(STORE.athletes);
    $("ath-empty").classList.add("hidden");
    $("ath-detail").classList.remove("hidden");
    $("ath-head").innerHTML = '<p class="hint">Cargando entrenos…</p>';
    if (isNarrow()) $("ath-detail").scrollIntoView({ behavior: "smooth", block: "start" });
    $("ath-kpis").innerHTML = ""; $("ath-chart").innerHTML = ""; $("wk-list").innerHTML = "";
    await reloadWorkouts();
  }
  async function reloadWorkouts() {
    const a = STORE.byId(currentId);
    if (!a) return;
    try {
      workouts = await STORE.workouts(a.id);
      shown = PAGE;
      renderDetail(a);
    } catch (ex) {
      $("ath-head").innerHTML = `<p class="error">${esc(ex.message)}</p>`;
    }
  }
  function kpi(label, value, note, cls) {
    return `<div class="kpi ${cls || ""}"><div class="kpi-l">${esc(label)}</div><div class="kpi-v">${esc(value)}</div><div class="kpi-n">${esc(note || "")}</div></div>`;
  }
  function renderDetail(a) {
    const today = U.todayIso();
    const series = FIT.fitnessSeries(workouts, { to: today });
    const now = FIT.pointAt(series, today) || { ctl: 0, atl: 0, tsb: 0 };
    const f = CORE.periodFacts(workouts, U.addDays(today, -KPI_DAYS), U.addDays(today, -1), today);
    $("ath-head").innerHTML = `<div class="section-head"><div><h2>${esc(a.name)}</h2><p class="muted small">${esc(U.SPORT_LABEL[a.sport])}${thresholdsLine(a) ? " · " + esc(thresholdsLine(a)) : ""}${a.lthr ? " · LTHR " + esc(a.lthr) + " ppm" : ""}${a.weight ? " · " + esc(a.weight) + " kg" : ""}</p></div>
      <div class="btn-row"><button id="ath-edit" class="btn chip" type="button">Editar</button><button id="ath-del" class="btn chip danger" type="button">Borrar</button></div></div>
      ${a.notes ? `<p class="notes">${esc(a.notes)}</p>` : ""}`;
    $("ath-edit").addEventListener("click", () => openForm(a));
    $("ath-del").addEventListener("click", () => removeAthlete(a));
    const tsbCls = now.tsb > 5 ? "good" : now.tsb < -20 ? "bad" : "";
    $("ath-kpis").innerHTML = kpi("Forma (CTL)", Math.round(now.ctl), "media de 42 días") + kpi("Fatiga (ATL)", Math.round(now.atl), "media de 7 días") +
      kpi("Frescura (TSB)", Math.round(now.tsb), "forma menos fatiga de ayer", tsbCls) +
      kpi(`Sesiones (${KPI_DAYS} días)`, f.sesiones, `${f.horas} h · carga ${f.carga}`) +
      kpi("Cumplimiento del plan", f.adherencia != null ? f.adherencia + " %" : "-", `${f.cumplidas} de ${f.planificadas} previstas`);
    $("ath-chart").innerHTML = FIT.chartSvg(series, isNarrow() ? { days: CHART_DAYS / 2, width: 380, height: 240 } : { days: CHART_DAYS }) || '<p class="hint">Sin carga suficiente para dibujar la forma. Añade o importa entrenos.</p>';
    renderWorkouts();
  }
  function renderWorkouts() {
    const box = $("wk-list");
    if (!workouts.length) { box.innerHTML = '<p class="hint">Sin entrenos todavía.</p>'; return; }
    const today = U.todayIso();
    const rows = workouts.slice().reverse().slice(0, shown).map((w) => {
      const status = w.completed ? "" : w.date >= today ? '<span class="tag">Previsto</span>' : '<span class="tag bad">No hecho</span>';
      return `<tr><td>${esc(U.fmtDate(w.date))}</td><td>${esc(U.SPORT_LABEL[w.sport] || w.sport)}</td><td>${esc(w.title)} ${status}</td>
        <td>${esc(U.fmtHours(w.durationH))}</td><td>${esc(U.fmtHours(w.plannedH))}</td><td>${w.distanceKm != null ? esc(w.distanceKm) : ""}</td>
        <td>${w.tss != null ? esc(Math.round(w.tss)) : ""}</td><td>${esc(w.rpe ?? "")}</td><td>${esc(w.feeling ?? "")}</td><td class="wrap">${esc(w.comments)}</td>
        <td><button class="btn icon danger" type="button" data-wk-del="${esc(w.id)}" aria-label="Borrar entreno" title="Borrar entreno">×</button></td></tr>`;
    }).join("");
    box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Deporte</th><th>Sesión</th><th>Hecho</th><th>Plan</th><th>Km</th><th>TSS</th><th>RPE</th><th>Sens.</th><th>Comentario</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted small">${Math.min(shown, workouts.length)} de ${workouts.length} entrenos (los más recientes primero).</p>
      ${shown < workouts.length ? '<button id="wk-more" class="btn chip" type="button">Ver más</button>' : ""}`;
    box.querySelectorAll("[data-wk-del]").forEach((b) => b.addEventListener("click", () => removeWorkout(b.dataset.wkDel)));
    const more = $("wk-more");
    if (more) more.addEventListener("click", () => { shown += PAGE * 2; renderWorkouts(); });
  }
  async function removeWorkout(id) {
    const w = workouts.find((x) => String(x.id) === String(id));
    if (!w || !root.confirm(`¿Borrar «${w.title || "entreno"}» del ${U.fmtDate(w.date)}?`)) return;
    try {
      await API.del(`/api/workouts/${encodeURIComponent(id)}`);
      U.toast("Entreno borrado");
      await reloadWorkouts();
      STORE.loadAthletes();
    } catch (ex) { U.toast(ex.message); }
  }

  // ---------- alta manual de entreno ----------
  function workoutBody() {
    const dur = U.parseHours($("wk-dur").value), plan = U.parseHours($("wk-plan").value);
    if (Number.isNaN(dur) || Number.isNaN(plan)) throw new Error("La duración va en h:mm (1:15) o en horas (1,25).");
    return {
      date: $("wk-date").value, sport: $("wk-sport").value, title: $("wk-title").value.trim(),
      durationH: dur, plannedH: plan, distanceKm: U.numOrNull($("wk-dist").value), tss: U.numOrNull($("wk-tss").value),
      rpe: U.numOrNull($("wk-rpe").value), feeling: U.numOrNull($("wk-feel").value), comments: $("wk-comments").value.trim(),
    };
  }
  async function saveWorkout(e) {
    e.preventDefault();
    const err = $("wk-error");
    err.classList.add("hidden");
    try {
      const body = workoutBody();
      if (!body.date) throw new Error("Elige la fecha.");
      await U.busy($("wk-save"), "Guardando…", () => API.post(`/api/athletes/${currentId}/workouts`, body));
      ["wk-title", "wk-dur", "wk-plan", "wk-dist", "wk-tss", "wk-rpe", "wk-feel", "wk-comments"].forEach((k) => { $(k).value = ""; });
      U.toast("Entreno añadido");
      await reloadWorkouts();
      STORE.loadAthletes();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove("hidden");
    }
  }

  function init() {
    STORE.subscribe(renderList);
    $("ath-new").addEventListener("click", () => openForm(null));
    $("ath-cancel").addEventListener("click", closeForm);
    $("ath-form").addEventListener("submit", saveForm);
    $("wk-form").addEventListener("submit", saveWorkout);
    $("wk-add-toggle").addEventListener("click", () => {
      $("wk-form").classList.toggle("hidden");
      if (!$("wk-date").value) $("wk-date").value = U.todayIso();
    });
  }

  root.RL_ATHLETES = { init, select, reloadWorkouts, currentId: () => currentId };
})(window);
