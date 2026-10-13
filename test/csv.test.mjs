// Pruebas de la importación CSV (formato de exportación de TrainingPeaks).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBrowserModule, same } from "./helpers.mjs";

const CSV = loadBrowserModule("../public/js/csv.js");

const TP_HEADER = "Title,WorkoutType,WorkoutDescription,PlannedDuration,PlannedDistanceInMeters,WorkoutDay,CoachComments,DistanceInMeters,PowerAverage,TimeTotalInHours,TSS,Rpe,Feeling,AthleteComments";

test("detecta el separador y respeta las comillas", () => {
  assert.equal(CSV.detectDelimiter(TP_HEADER), ",");
  assert.equal(CSV.detectDelimiter("Title;WorkoutDay;TSS"), ";");
  assert.equal(CSV.detectDelimiter('"a;b",c,d'), ",");
  const rows = CSV.parseCsv('a,b\n"uno, dos","con ""comillas""\ny salto"\r\n\n3,4', ",");
  same(rows, [["a", "b"], ["uno, dos", 'con "comillas"\ny salto'], ["3", "4"]]);
});

test("mapea columnas sin importar mayúsculas, tildes ni espacios", () => {
  const m = CSV.autoMap(["title", "WORKOUTTYPE", "Workout Day", "TimeTotalInHours", "PlannedDuration (hours)", "tss", "Comentarios"]);
  assert.equal(m.title, 0);
  assert.equal(m.type, 1);
  assert.equal(m.date, 2);
  assert.equal(m.durationH, 3);
  assert.equal(m.plannedH, 4);
  assert.equal(m.tss, 5);
  assert.equal(m.comments, 6);
  same(CSV.missingFields({ title: 0 }), ["la fecha", "la duración, la duración planificada o la carga"]);
});

test("números con coma decimal y fechas en varios formatos", () => {
  assert.equal(CSV.parseNumber("1,5"), 1.5);
  assert.equal(CSV.parseNumber("1.234,5"), 1234.5);
  assert.equal(CSV.parseNumber("1,234.5"), 1234.5);
  assert.equal(CSV.parseNumber(""), null);
  assert.equal(CSV.parseNumber("abc"), null);
  assert.equal(CSV.parseDate("2026-05-03"), "2026-05-03");
  assert.equal(CSV.parseDate("2026-05-03 00:00:00"), "2026-05-03");
  assert.equal(CSV.parseDate("3/5/2026"), "2026-05-03");
  assert.equal(CSV.parseDate("31/02/2026"), null);
  assert.equal(CSV.parseDate("ayer"), null);
});

test("deporte desde WorkoutType; los días de descanso se omiten", () => {
  assert.equal(CSV.mapSport("Run"), "run");
  assert.equal(CSV.mapSport("Mountain Bike"), "bike");
  assert.equal(CSV.mapSport("Swim"), "swim");
  assert.equal(CSV.mapSport("Strength"), "strength");
  assert.equal(CSV.mapSport("Day Off"), null);
  assert.equal(CSV.mapSport("Rowing"), "other");
  assert.equal(CSV.mapSport(""), "other");
});

test("analyze: exportación de TP con punto y coma, válidas y omitidas", () => {
  const csv = [
    "Title;WorkoutType;WorkoutDay;TimeTotalInHours;DistanceInMeters;TSS;PlannedDuration;Rpe;Feeling;AthleteComments",
    "Series;Run;2026-09-01;1,02;12000;72,4;1;7;2;Muy bien",
    "Previsto;Bike;2026-09-02;;;;1,5;;;",
    "Descanso;Day Off;2026-09-03;;;;;;;",
    "Sin datos;Run;2026-09-04;;;;;;;",
    "Mala fecha;Run;04-09;1;;;;;;",
    "Fuera de rango;Run;2026-09-05;45;;;;;;",
  ].join("\n");
  const a = CSV.analyze(csv);
  assert.equal(a.delimiter, ";");
  same(a.missing, []);
  assert.equal(a.total, 6);
  assert.equal(a.rows.length, 2);
  same(a.rows[0], { date: "2026-09-01", sport: "run", title: "Series", durationH: 1.02, plannedH: 1, distanceKm: 12, tss: 72.4, rpe: 7, feeling: 2, comments: "Muy bien", completed: true });
  assert.equal(a.rows[1].completed, false);
  same(a.errors.map((e) => e.error), ["día de descanso", "sin duración, distancia, carga ni planificado", "fecha no válida", "duración fuera de rango"]);
  assert.equal(a.errors[0].line, 4);
});

test("analyze: mapeo manual cuando las columnas no se reconocen", () => {
  const csv = "Día,Cosa,Tiempo\n2026-09-01,Rodaje,0.75\n";
  const auto = CSV.analyze(csv);
  assert.ok(auto.missing.length > 0);
  const manual = CSV.analyze(csv, { date: 0, title: 1, durationH: 2 });
  assert.equal(manual.rows.length, 1);
  assert.equal(manual.rows[0].durationH, 0.75);
});

test("analyze: tope de 3000 filas", () => {
  const lines = ["WorkoutDay,TSS"];
  for (let i = 0; i < 3005; i++) lines.push(`2026-01-01,${(i % 90) + 1}`);
  const a = CSV.analyze(lines.join("\n"));
  assert.equal(a.overCap, true);
  assert.equal(a.total, 3000);
  assert.equal(a.rows.length, 3000);
});

test("TP con cabecera real y BOM", () => {
  const a = CSV.analyze("﻿" + TP_HEADER + '\n"Tirada larga",Run,,1.5,,2026-09-07,,21000,,1.62,95,6,2,"Bien, con calor"\n');
  assert.equal(a.rows.length, 1);
  assert.equal(a.rows[0].comments, "Bien, con calor");
  assert.equal(a.rows[0].plannedH, 1.5);
  assert.equal(a.rows[0].distanceKm, 21);
});
