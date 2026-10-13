// Documentos imprimibles: abre una ventana con HTML blanco tamaño A4 y lanza
// window.print(). Todo el contenido que llega de fuera va escapado con esc().
"use strict";

(function (root) {
  const U = root.RL_UTIL;
  const esc = U.esc;
  const PRINT_DELAY_MS = 350;

  const CSS = `
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 10.5pt/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1b2430; background: #fff; }
    .bar { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 2px solid #1b2430; margin-bottom: 14px; }
    .bar button { font: inherit; padding: 6px 14px; border: 1px solid #1b2430; background: #fff; border-radius: 6px; cursor: pointer; }
    .eyebrow { font-size: 8.5pt; letter-spacing: .08em; text-transform: uppercase; color: #5b6878; }
    h1 { font-size: 19pt; margin: 2px 0 2px; }
    .sub { color: #5b6878; margin: 0 0 10px; }
    .meta { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 9pt; color: #3a4553; margin-bottom: 10px; }
    .meta b { color: #1b2430; }
    .sec { margin: 14px 0; break-inside: avoid-page; }
    .sec h2 { font-size: 12pt; margin: 0 0 6px; padding-bottom: 3px; border-bottom: 1px solid #d5dbe3; }
    .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .kpi { border: 1px solid #d5dbe3; border-radius: 8px; padding: 8px 10px; }
    .kpi .l { font-size: 8.5pt; color: #5b6878; } .kpi .v { font-size: 15pt; font-weight: 700; } .kpi .n { font-size: 8.5pt; color: #3a4553; }
    .kpi.ok { border-color: #2e9b5f; } .kpi.acc { border-color: #1f6fb2; border-width: 2px; } .kpi.mid { border-color: #c98a12; }
    table { width: 100%; border-collapse: collapse; font-size: 9pt; font-variant-numeric: tabular-nums; }
    th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e3e7ec; vertical-align: top; }
    th { background: #f2f4f7; font-weight: 600; }
    ul { margin: 4px 0; padding-left: 18px; } li { margin: 2px 0; }
    pre { white-space: pre-wrap; font: inherit; margin: 0; }
    .band { display: flex; flex-wrap: wrap; gap: 3px 12px; border: 1.5px dashed #888; border-radius: 8px; padding: 8px 10px; font-size: 9pt; font-variant-numeric: tabular-nums; }
    .foot { margin-top: 18px; padding-top: 6px; border-top: 1px solid #d5dbe3; font-size: 8pt; color: #5b6878; display: flex; justify-content: space-between; }
    @media print { .bar button { display: none; } }`;

  const section = (title, html) => `<div class="sec"><h2>${esc(title)}</h2>${html}</div>`;
  const list = (items) => `<ul>${(items || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  // Las celdas llegan ya escapadas (pueden llevar <b> o <br>).
  const table = (head, rows) => `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const kpis = (items) => `<div class="kpis">${items.map((k) => `<div class="kpi ${esc(k.nivel || "")}"><div class="l">${esc(k.label)}</div><div class="v">${esc(k.valor)}</div><div class="n">${esc(k.nota || "")}</div></div>`).join("")}</div>`;

  function shell(o) {
    const meta = (o.meta || []).filter((m) => m.value).map((m) => `<span>${esc(m.label)}: <b>${esc(m.value)}</b></span>`).join("");
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(o.title)}</title><style>${CSS}</style></head><body>
      <div class="bar"><span class="eyebrow">APD Race Lab · ${esc(o.eyebrow || "")}</span><button type="button" id="print-btn">Imprimir o guardar en PDF</button></div>
      <h1>${esc(o.title)}</h1>${o.subtitle ? `<p class="sub">${esc(o.subtitle)}</p>` : ""}<div class="meta">${meta}</div>
      ${o.body}
      <div class="foot"><span>Generado con APD Race Lab el ${esc(U.fmtDate(U.todayIso()))}</span><span>${esc(o.footRight || "")}</span></div></body></html>`;
  }

  // Abre la ventana, escribe el documento y lanza la impresión.
  function open(html) {
    const w = root.open("", "_blank");
    if (!w) { U.toast("El navegador ha bloqueado la ventana: permite las ventanas emergentes para imprimir."); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    const btn = w.document.getElementById("print-btn");
    if (btn) btn.addEventListener("click", () => w.print());
    w.focus();
    setTimeout(() => w.print(), PRINT_DELAY_MS);
  }

  root.RL_PRINT = { shell, section, list, table, kpis, open };
})(window);
