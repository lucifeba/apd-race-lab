// Pruebas de forma (CTL), fatiga (ATL) y frescura (TSB): npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBrowserModule, makeWorkouts, same } from "./helpers.mjs";

const F = loadBrowserModule("../public/js/fitness.js");

test("un día de 100 TSS: CTL = 100/42, ATL = 100/7 y TSB del día anterior", () => {
  const s = F.fitnessSeries([{ date: "2026-01-01", tss: 100, completed: true }], { to: "2026-01-02" });
  assert.equal(s.length, 2);
  assert.equal(s[0].ctl, Math.round((100 / 42) * 10) / 10);
  assert.equal(s[0].atl, Math.round((100 / 7) * 10) / 10);
  assert.equal(s[0].tsb, 0, "TSB del primer día usa CTL y ATL de la víspera (0)");
  assert.equal(s[1].tsb, Math.round((100 / 42 - 100 / 7) * 10) / 10);
});

test("carga constante: CTL tiende a la carga diaria y ATL llega antes", () => {
  const ws = makeWorkouts("2026-01-01", 300, () => ({ tss: 60, completed: true }));
  const s = F.fitnessSeries(ws);
  const last = s[s.length - 1];
  assert.ok(Math.abs(last.ctl - 60) < 0.5, `CTL ${last.ctl}`);
  assert.ok(Math.abs(last.atl - 60) < 0.1, `ATL ${last.atl}`);
  const day20 = s[19];
  assert.ok(day20.atl > day20.ctl, "a los 20 días la fatiga va por delante de la forma");
});

test("solo cuentan los entrenos hechos; sin TSS se estima 50 por hora", () => {
  assert.equal(F.workoutLoad({ completed: false, tss: 80 }), 0);
  assert.equal(F.workoutLoad({ completed: true, tss: 80 }), 80);
  assert.equal(F.workoutLoad({ completed: true, tss: null, durationH: 1.5 }), 75);
  const daily = F.dailyLoad([
    { date: "2026-02-01", completed: true, tss: 40 },
    { date: "2026-02-01", completed: true, tss: 30 },
    { date: "2026-02-02", completed: false, plannedH: 1 },
  ]);
  assert.equal(daily.get("2026-02-01"), 70);
  assert.equal(daily.has("2026-02-02"), false);
});

test("los días sin entreno bajan la forma y suben la frescura", () => {
  const ws = makeWorkouts("2026-01-01", 60, () => ({ tss: 80, completed: true }));
  const s = F.fitnessSeries(ws, { to: "2026-03-15" });
  const end = F.pointAt(s, "2026-03-01"), rest = F.pointAt(s, "2026-03-15");
  assert.ok(rest.ctl < end.ctl);
  assert.ok(rest.tsb > end.tsb);
});

test("pointAt y ctlAt: antes de la primera carga la forma es 0", () => {
  const s = F.fitnessSeries([{ date: "2026-05-10", tss: 50, completed: true }], { to: "2026-05-20" });
  assert.equal(F.ctlAt(s, "2026-01-01"), 0);
  assert.equal(F.pointAt(s, "2026-05-15").date, "2026-05-15");
  assert.equal(F.pointAt(s, "2027-01-01").date, "2026-05-20", "después del final devuelve el último punto");
  assert.equal(F.ctlAt([], "2026-01-01"), null);
});

test("serie vacía y rango invertido no rompen", () => {
  same(F.fitnessSeries([]), []);
  same(F.fitnessSeries([{ date: "2026-05-10", tss: 50, completed: true }], { to: "2026-05-01" }), []);
});

test("el gráfico SVG solo lleva números y necesita al menos dos puntos", () => {
  const ws = makeWorkouts("2026-01-01", 30, (d, i) => (i % 2 ? { tss: 70, completed: true } : null));
  const svg = F.chartSvg(F.fitnessSeries(ws), { days: 30 });
  assert.match(svg, /^<svg class="fitness-chart"/);
  assert.match(svg, /fc-ctl/);
  assert.equal(F.chartSvg([{ date: "2026-01-01", ctl: 1, atl: 1, tsb: 0, tss: 10 }]), "");
});
