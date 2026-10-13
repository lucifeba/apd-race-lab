// Carga un módulo del navegador (patrón module.exports + window) en un contexto aislado de Node.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

export function loadBrowserModule(rel, extraGlobals = {}) {
  const code = readFileSync(new URL(rel, import.meta.url), "utf8");
  const sandbox = { module: { exports: {} }, globalThis: {}, ...extraGlobals };
  vm.runInNewContext(code, sandbox);
  return sandbox.module.exports;
}

// Entrenos sintéticos: `perDay(date, i)` devuelve un entreno o null.
export function makeWorkouts(start, days, perDay) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.parse(start + "T00:00:00Z") + i * 86400000).toISOString().slice(0, 10);
    const w = perDay(date, i);
    if (w) out.push({ date, ...w });
  }
  return out;
}

// Los objetos creados en otro contexto de vm tienen otros prototipos: se comparan por su JSON.
export function same(actual, expected, msg) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected, msg);
}
