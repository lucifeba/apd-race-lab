// Importación CSV en la ficha del deportista: lee el archivo, detecta el
// separador y las columnas (RL_CSV), deja corregir el mapeo a mano, enseña
// una vista previa con las filas válidas y omitidas e importa en el servidor.
"use strict";

(function (root) {
  const U = root.RL_UTIL, API = root.RL_API, STORE = root.RL_STORE, CSV = root.RL_CSV;
  const { $, esc } = U;
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const PREVIEW_ROWS = 8;
  const SHOWN_ERRORS = 6;

  let fileText = "";
  let analysis = null;

  function reset() {
    fileText = ""; analysis = null;
    $("imp-file").value = "";
    $("imp-map").innerHTML = ""; $("imp-preview").innerHTML = ""; $("imp-result").textContent = "";
    $("imp-run").classList.add("hidden");
  }

  function readFile(input) {
    const f = input.files && input.files[0];
    $("imp-result").textContent = "";
    if (!f) { reset(); return; }
    if (f.size > MAX_FILE_BYTES) { $("imp-preview").innerHTML = '<p class="error">El archivo pasa de 10 MB.</p>'; return; }
    const fr = new FileReader();
    fr.onload = () => { fileText = String(fr.result || ""); analysis = CSV.analyze(fileText); render(); };
    fr.onerror = () => { $("imp-preview").innerHTML = '<p class="error">No se pudo leer el archivo.</p>'; };
    fr.readAsText(f);
  }

  function renderMapping() {
    const opts = (sel) => `<option value="">(no usar)</option>` + analysis.headers.map((h, i) => `<option value="${i}" ${sel === i ? "selected" : ""}>${esc(h || "columna " + (i + 1))}</option>`).join("");
    const open = analysis.missing.length ? "open" : "";
    $("imp-map").innerHTML = `<details class="map-box" ${open}><summary>Columnas detectadas (separador «${esc(analysis.delimiter === "\t" ? "tabulador" : analysis.delimiter)}»). Corrige el mapeo si hace falta</summary>
      <div class="grid-fields">${CSV.FIELDS.map((f) => `<label class="field"><span>${esc(f.label)}${f.required ? " *" : ""}</span><select data-map="${esc(f.key)}">${opts(analysis.mapping[f.key])}</select></label>`).join("")}</div></details>`;
    $("imp-map").querySelectorAll("[data-map]").forEach((s) => s.addEventListener("change", () => {
      const mapping = {};
      $("imp-map").querySelectorAll("[data-map]").forEach((x) => { if (x.value !== "") mapping[x.dataset.map] = parseInt(x.value, 10); });
      analysis = CSV.analyze(fileText, mapping);
      renderPreview();
    }));
  }

  function renderPreview() {
    const a = analysis;
    const box = $("imp-preview");
    $("imp-run").classList.toggle("hidden", !a.rows.length);
    if (a.missing.length) {
      box.innerHTML = `<p class="error">No encuentro ${esc(a.missing.join(" ni "))}. Elige la columna correspondiente en el mapeo.</p>`;
      return;
    }
    const rows = a.rows.slice(0, PREVIEW_ROWS).map((r) => `<tr><td>${esc(U.fmtDate(r.date))}</td><td>${esc(U.SPORT_LABEL[r.sport] || r.sport)}</td><td>${esc(r.title || "")}</td><td>${esc(U.fmtHours(r.durationH))}</td><td>${esc(U.fmtHours(r.plannedH))}</td><td>${esc(r.distanceKm ?? "")}</td><td>${esc(r.tss ?? "")}</td></tr>`).join("");
    const errs = a.errors.slice(0, SHOWN_ERRORS).map((e) => `<li>Línea ${esc(e.line)}: ${esc(e.error)}</li>`).join("");
    box.innerHTML = `<p class="hint"><b>${a.rows.length}</b> filas válidas de ${a.total}${a.errors.length ? ` · <b>${a.errors.length}</b> se omitirán` : ""}${a.overCap ? ` · el archivo tiene más de ${CSV.MAX_ROWS} filas: solo se leen las primeras ${CSV.MAX_ROWS}` : ""}.</p>
      ${rows ? `<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Deporte</th><th>Título</th><th>Hecho</th><th>Plan</th><th>Km</th><th>TSS</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
      ${errs ? `<ul class="small muted">${errs}${a.errors.length > SHOWN_ERRORS ? `<li>y ${a.errors.length - SHOWN_ERRORS} más</li>` : ""}</ul>` : ""}`;
  }

  function render() {
    if (!analysis.headers.length) { $("imp-map").innerHTML = ""; $("imp-preview").innerHTML = '<p class="error">El archivo está vacío.</p>'; $("imp-run").classList.add("hidden"); return; }
    renderMapping();
    renderPreview();
  }

  async function runImport() {
    const id = root.RL_ATHLETES.currentId();
    if (!id || !analysis || !analysis.rows.length) return;
    const clientSkipped = analysis.errors.length;
    try {
      const r = await U.busy($("imp-run"), "Importando…", () => API.post(`/api/athletes/${encodeURIComponent(id)}/workouts/import`, { rows: analysis.rows }));
      const skipped = r.skipped + clientSkipped;
      reset();
      $("imp-result").textContent = `Importadas ${r.imported} filas. Omitidas ${skipped}: ${r.duplicates} ya estaban registradas, ${r.invalid + clientSkipped} no eran válidas.`;
      U.toast(`Importadas ${r.imported} filas`);
      await root.RL_ATHLETES.reloadWorkouts();
      STORE.loadAthletes();
    } catch (ex) {
      $("imp-result").textContent = "No se pudo importar: " + ex.message;
    }
  }

  function init() {
    $("imp-toggle").addEventListener("click", () => $("imp-panel").classList.toggle("hidden"));
    $("imp-file").addEventListener("change", (e) => readFile(e.target));
    $("imp-run").addEventListener("click", runImport);
  }

  root.RL_IMPORT = { init, reset };
})(window);
