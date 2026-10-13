// Utilidades compartidas: escape de HTML, fechas, ritmos y avisos en pantalla.
"use strict";

(function (root) {
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
  const pad = (n) => String(n).padStart(2, "0");
  const SPORT_LABEL = { run: "Carrera", bike: "Ciclismo", tri: "Triatlón", swim: "Natación", strength: "Fuerza", other: "Otros" };
  const TOAST_MS = 3200;

  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  const fmtDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

  function parsePace(str) {
    const m = /^\s*(\d{1,2}):([0-5]\d)\s*$/.exec(String(str || ""));
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  }
  function fmtPace(sec) {
    if (!isFinite(sec) || sec <= 0) return "";
    const s = Math.round(sec);
    return `${Math.floor(s / 60)}:${pad(s % 60)}`;
  }
  function fmtHours(h) {
    if (h == null || !isFinite(h) || h <= 0) return "";
    const min = Math.round(h * 60);
    return min >= 60 ? `${Math.floor(min / 60)} h ${pad(min % 60)} min` : `${min} min`;
  }
  // "1:30", "1,5" o "90 min" → horas.
  function parseHours(v) {
    const s = String(v ?? "").trim().toLowerCase();
    if (!s) return null;
    let m = /^(\d{1,2}):([0-5]\d)$/.exec(s);
    if (m) return parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
    m = /^(\d+(?:[.,]\d+)?)\s*min$/.exec(s);
    if (m) return parseFloat(m[1].replace(",", ".")) / 60;
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  }
  function numOrNull(v) {
    const s = String(v ?? "").trim().replace(",", ".");
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  const $ = (id) => document.getElementById(id);
  let toastTimer = null;
  function toast(msg) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), TOAST_MS);
  }
  async function copyText(textValue) {
    try {
      await navigator.clipboard.writeText(textValue);
      return true;
    } catch {
      return false;
    }
  }
  // Ejecuta una acción asíncrona con el botón desactivado y un texto de espera.
  async function busy(btn, label, fn) {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
  }

  const API = { esc, todayIso, addDays, fmtDate, parsePace, fmtPace, fmtHours, parseHours, numOrNull, SPORT_LABEL, $, toast, copyText, busy };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.RL_UTIL = API;
})(typeof window !== "undefined" ? window : globalThis);
