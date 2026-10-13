// Motor de estrategia de competición (pacing + nutrición), sin DOM ni red:
// recibe el recorrido, el deportista y las condiciones y devuelve tres
// escenarios (optimista, normal, menos favorable) con objetivos por tramo,
// tiempos de paso y plan de nutrición. Lo usa race.js y se prueba con Node.
//
// Modelos:
// - Carrera: tiempo llano por VDOT (Daniels) o por ritmo umbral (Riegel 1,06),
//   ajuste por pendiente tipo GAP (subida +3,3 %/1 % y descenso con mínimo
//   hacia -8 %), calor, viento, terreno y fondo (CTL frente a la duración).
// - Ciclismo: intensidad (IF) según la duración, reparto de potencia por
//   pendiente con la NP fija y velocidad por ecuación de potencia
//   (rodadura + gravedad + aerodinámica, densidad del aire por altitud).
// - Triatlón: natación sobre CSS, bici con IF por distancia y carrera a pie
//   sobre el umbral con la fatiga de la bici.
// - Nutrición: hidratos por hora según duración y tolerancia entrenada,
//   líquido y sodio según sudoración y temperatura, cafeína 3 mg/kg.
"use strict";

(function (root) {
  const G = 9.81;
  const SCENARIOS = [
    { id: "optimista", label: "Optimista", perf: 0.025, power: 0.03, temp: -3, wind: -1 },
    { id: "normal", label: "Normal", perf: 0, power: 0, temp: 0, wind: 0 },
    { id: "desfavorable", label: "Menos favorable", perf: -0.04, power: -0.05, temp: 5, wind: 1 },
  ];
  const INTENT = {
    disfrutar: { label: "Disfrutar y terminar", run: 0.90, ifAdd: -0.08 },
    controlado: { label: "Controlado", run: 0.95, ifAdd: -0.04 },
    exigente: { label: "Exigente (objetivo de marca)", run: 1.0, ifAdd: 0 },
    atope: { label: "A tope", run: 1.015, ifAdd: 0.02 },
  };
  const BIKES = {
    carretera: { label: "Carretera", cda: 0.32, crr: 0.0040, kg: 8.5, vmax: 65 },
    cabra: { label: "Contrarreloj / triatlón", cda: 0.25, crr: 0.0038, kg: 9.5, vmax: 65 },
    gravel: { label: "Gravel", cda: 0.38, crr: 0.0070, kg: 9.5, vmax: 55 },
    mtb: { label: "MTB", cda: 0.45, crr: 0.0110, kg: 12, vmax: 45 },
  };
  const SURFACE = {
    asfalto: { label: "Asfalto", slow: 0, downCap: 1.12 },
    trail: { label: "Trail", slow: 0.05, downCap: 1.08 },
    tecnico: { label: "Trail técnico", slow: 0.12, downCap: 1.0 },
  };
  const TRI = {
    sprint: { label: "Sprint", swim: 0.75, bike: 20, run: 5, swimF: 1.02, bikeIF: 0.90, runPct: 0.97, t1: 1.5, t2: 1 },
    olimpico: { label: "Olímpico", swim: 1.5, bike: 40, run: 10, swimF: 1.04, bikeIF: 0.85, runPct: 0.94, t1: 2, t2: 1.5 },
    "703": { label: "Half (70.3)", swim: 1.9, bike: 90, run: 21.1, swimF: 1.06, bikeIF: 0.78, runPct: 0.87, t1: 3, t2: 2 },
    ironman: { label: "Ironman", swim: 3.8, bike: 180, run: 42.2, swimF: 1.09, bikeIF: 0.70, runPct: 0.79, t1: 5, t2: 3 },
  };
  const SWEAT = { poca: { ml: 400, na: 350 }, normal: { ml: 550, na: 600 }, mucha: { ml: 750, na: 1000 } };
  const GUT = { baja: 60, media: 80, alta: 110 };
  const ISO_G_PER_ML = 0.06;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r0 = (v) => Math.round(v);
  const r1 = (v) => Math.round(v * 10) / 10;

  // ---------- formatos ----------
  function fmtTime(sec) {
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
  }
  function fmtPace(secPerKm) {
    if (!isFinite(secPerKm) || secPerKm <= 0) return "-";
    const s = Math.round(secPerKm);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  function parsePace(str) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(str || ""));
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  }

  // ---------- recorrido ----------
  // GPX (trkpt/rtept) y TCX (Trackpoint) con expresiones regulares: funciona
  // igual en el navegador que en Node y no depende del DOM.
  function parseTrack(text) {
    const src = String(text || "");
    const pts = [];
    const gpx = /<(?:trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:trkpt|rtept)>)/g;
    let m;
    while ((m = gpx.exec(src))) {
      const attrs = m[1] || "";
      const lat = /lat=["']([-\d.eE+]+)["']/.exec(attrs), lon = /lon=["']([-\d.eE+]+)["']/.exec(attrs);
      if (!lat || !lon) continue;
      const ele = /<ele>([-\d.]+)<\/ele>/.exec(m[2] || "");
      pts.push({ lat: parseFloat(lat[1]), lon: parseFloat(lon[1]), ele: ele ? parseFloat(ele[1]) : null });
    }
    if (!pts.length) {
      const tcx = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/g;
      while ((m = tcx.exec(src))) {
        const lat = /<LatitudeDegrees>([-\d.]+)</.exec(m[1]), lon = /<LongitudeDegrees>([-\d.]+)</.exec(m[1]);
        if (!lat || !lon) continue;
        const ele = /<AltitudeMeters>([-\d.]+)</.exec(m[1]);
        pts.push({ lat: parseFloat(lat[1]), lon: parseFloat(lon[1]), ele: ele ? parseFloat(ele[1]) : null });
      }
    }
    const name = (/<name>([^<]{1,120})<\/name>/.exec(src) || [])[1] || "";
    return { name: name.trim(), points: pts };
  }

  function haversine(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Remuestrea cada `step` metros y suaviza la altitud (el GPS mete ruido que
  // inflaría el desnivel).
  function resample(points, step) {
    if (points.length < 2) return [];
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversine(points[i - 1], points[i]));
    const total = cum[cum.length - 1];
    const firstEle = points.find((p) => p.ele != null);
    let lastEle = firstEle ? firstEle.ele : 0;
    const eles = points.map((p) => (p.ele != null ? (lastEle = p.ele) : lastEle));
    const raw = [];
    let j = 0;
    for (let d = 0; d <= total; d += step) {
      while (j < cum.length - 2 && cum[j + 1] < d) j++;
      const span = cum[j + 1] - cum[j] || 1;
      const t = clamp((d - cum[j]) / span, 0, 1);
      raw.push({ d, ele: eles[j] + (eles[j + 1] - eles[j]) * t });
    }
    if (raw[raw.length - 1].d < total) raw.push({ d: total, ele: eles[eles.length - 1] });
    const W = 2;
    return raw.map((p, i) => {
      let s = 0, n = 0;
      for (let k = Math.max(0, i - W); k <= Math.min(raw.length - 1, i + W); k++) { s += raw[k].ele; n++; }
      return { d: p.d, ele: s / n };
    });
  }

  const gradeClass = (g) => (g <= -4 ? -2 : g <= -1.5 ? -1 : g < 2 ? 0 : g < 5 ? 1 : g < 8 ? 2 : 3);

  function makeSeg(rs, a, b) {
    let gain = 0, loss = 0;
    for (let i = a + 1; i <= b; i++) { const dz = rs[i].ele - rs[i - 1].ele; if (dz > 0) gain += dz; else loss -= dz; }
    const len = rs[b].d - rs[a].d;
    return { from: rs[a].d / 1000, to: rs[b].d / 1000, lenKm: len / 1000, gain, loss,
      grade: len > 0 ? ((rs[b].ele - rs[a].ele) / len) * 100 : 0, eleStart: rs[a].ele, eleEnd: rs[b].ele, a, b };
  }

  // Tramos homogéneos: piezas de 500 m agrupadas por tipo de pendiente, sin
  // tramos más cortos que minKm y como mucho maxSeg tramos.
  function segmentProfile(rs, opts) {
    const o = opts || {};
    const minKm = o.minKm || 1, maxSeg = o.maxSeg || 14, piece = o.pieceM || 500;
    const stepIdx = Math.max(1, Math.round(piece / ((rs[1] && rs[1].d - rs[0].d) || 100)));
    let segs = [];
    for (let a = 0; a < rs.length - 1; a += stepIdx) segs.push(makeSeg(rs, a, Math.min(rs.length - 1, a + stepIdx)));
    const merged = (i) => [...segs.slice(0, i), makeSeg(rs, segs[i].a, segs[i + 1].b), ...segs.slice(i + 2)];
    for (let i = 0; i < segs.length - 1;) {
      if (gradeClass(segs[i].grade) === gradeClass(segs[i + 1].grade)) segs = merged(i); else i++;
    }
    let guard = 0;
    while (segs.length > 1 && guard++ < 500) {
      const i = segs.findIndex((s) => s.lenKm < minKm);
      if (i < 0) break;
      const left = i > 0 ? Math.abs(segs[i - 1].grade - segs[i].grade) : Infinity;
      const right = i < segs.length - 1 ? Math.abs(segs[i + 1].grade - segs[i].grade) : Infinity;
      segs = merged(left <= right ? i - 1 : i);
    }
    while (segs.length > maxSeg) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < segs.length - 1; i++) {
        const d = Math.abs(segs[i].grade - segs[i + 1].grade) * Math.min(segs[i].lenKm, segs[i + 1].lenKm);
        if (d < bd) { bd = d; best = i; }
      }
      segs = merged(best);
    }
    return segs;
  }

  // Perfil del recorrido desde un track, o sintético desde distancia y desnivel
  // (subidas y bajadas alternas de unos 5 km que suman el desnivel indicado).
  function buildCourse(input) {
    const o = input || {};
    if (o.points && o.points.length >= 2) {
      const rs = resample(o.points, 100);
      const segs = segmentProfile(rs, { minKm: o.minKm, maxSeg: o.maxSeg });
      const gain = segs.reduce((s, x) => s + x.gain, 0), loss = segs.reduce((s, x) => s + x.loss, 0);
      const step = Math.max(1, Math.floor(rs.length / 160));
      return { distKm: rs[rs.length - 1].d / 1000, gain, loss, fromTrack: true,
        segments: segs.map(({ a, b, ...s }) => s),
        profile: rs.filter((_, i) => i % step === 0 || i === rs.length - 1).map((p) => ({ km: r1(p.d / 1000), ele: r0(p.ele) })) };
    }
    const D = Math.max(0.1, parseFloat(o.distKm) || 0), gainM = Math.max(0, parseFloat(o.gain) || 0);
    if (!gainM) {
      return { distKm: D, gain: 0, loss: 0, fromTrack: false, profile: [{ km: 0, ele: 0 }, { km: r1(D), ele: 0 }],
        segments: [{ from: 0, to: D, lenKm: D, gain: 0, loss: 0, grade: 0, eleStart: 0, eleEnd: 0 }] };
    }
    const n = Math.max(2, Math.round(D / 5)), len = D / n, ups = Math.ceil(n / 2);
    const climb = gainM / ups;
    const segments = [];
    let ele = 0;
    for (let i = 0; i < n; i++) {
      const dz = i % 2 === 0 ? climb : -Math.min(ele, climb);
      segments.push({ from: i * len, to: (i + 1) * len, lenKm: len, gain: Math.max(0, dz), loss: Math.max(0, -dz),
        grade: (dz / (len * 1000)) * 100, eleStart: ele, eleEnd: ele + dz });
      ele += dz;
    }
    return { distKm: D, gain: gainM, loss: segments.reduce((s, x) => s + x.loss, 0), fromTrack: false, segments,
      profile: [{ km: 0, ele: 0 }, ...segments.map((s) => ({ km: r1(s.to), ele: r0(s.eleEnd) }))] };
  }

  // ---------- fisiología ----------
  // VDOT de Daniels-Gilbert para una distancia (m) y tiempo (s).
  function vdotFrom(distM, sec) {
    const t = sec / 60, v = distM / t;
    const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
    const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
    return vo2 / pct;
  }
  function timeForVdot(distM, vdot) {
    let lo = 60, hi = 60 * 60 * 48;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (vdotFrom(distM, mid) > vdot) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  // Velocidad umbral (m/s): del ritmo umbral o, si no hay, del 10K por VDOT.
  function thresholdSpeed(ath) {
    const p = ath.runPaceSec || parsePace(ath.runPace);
    if (p) return 1000 / p;
    if (ath.vdot) return (10000 / timeForVdot(10000, ath.vdot)) * 0.975;
    return null;
  }
  // Coste relativo de correr en pendiente (g en %), estilo GAP.
  function gradeCost(g) {
    const x = clamp(g, -25, 40);
    if (x >= 0) return 1 + 0.033 * x + 0.00078 * x * x;
    const a = -x;
    return 1 - 0.018 * a + 0.0011 * a * a;
  }
  // Penalización por fondo: duración larga con poca carga crónica (CTL).
  function enduranceDeficit(hours, ctl) {
    if (!ctl || hours < 1.5) return 0;
    const need = Math.min(95, 15 + 9 * hours);
    return clamp((need - ctl) / 200, 0, 0.06);
  }
  function heatPenalty(tempC, hours) {
    const k = hours < 1 ? 0.0025 : hours < 3 ? 0.0035 : 0.0045;
    return Math.max(0, (tempC ?? 15) - 12) * k;
  }
  // IF sostenible según duración (interpolación en escala logarítmica).
  const IF_TABLE = [[0.5, 1.03], [1, 0.96], [2, 0.88], [3, 0.83], [4, 0.79], [5, 0.76], [6, 0.73], [8, 0.68], [10, 0.64], [14, 0.58], [24, 0.52]];
  function ifForHours(h) {
    const x = clamp(h, IF_TABLE[0][0], IF_TABLE[IF_TABLE.length - 1][0]);
    for (let i = 0; i < IF_TABLE.length - 1; i++) {
      const [h0, f0] = IF_TABLE[i], [h1, f1] = IF_TABLE[i + 1];
      if (x <= h1) { const t = (Math.log(x) - Math.log(h0)) / (Math.log(h1) - Math.log(h0)); return f0 + (f1 - f0) * t; }
    }
    return IF_TABLE[IF_TABLE.length - 1][1];
  }
  // Velocidad (m/s) para una potencia en una pendiente: rodadura + gravedad + aire.
  function bikeSpeed(P, gradePct, o) {
    const th = Math.atan(gradePct / 100);
    const rho = 1.225 * Math.exp(-(o.ele || 0) / 8500);
    const vw = o.headwind || 0, eta = 0.975;
    const f = (v) => v * o.mass * G * (o.crr * Math.cos(th) + Math.sin(th)) + 0.5 * rho * o.cda * (v + vw) * Math.abs(v + vw) * v - P * eta;
    let lo = 0.3, hi = 35;
    if (f(hi) < 0) return Math.min(hi, o.vmax / 3.6);
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
    return Math.min((lo + hi) / 2, o.vmax / 3.6);
  }
  // Peso de potencia por pendiente: más en subida, se rueda suave en bajada.
  function powerWeight(g) {
    if (g >= 2) return 1 + Math.min(0.15, 0.02 * (g - 1));
    if (g > -1) return 1;
    return Math.max(0.3, 1 - 0.13 * (-g));
  }

  // Sin track el recorrido es sintético (sube y baja cada ~5 km): para que la
  // tarjeta sea legible se agrupan los tramos de dos en dos en parciales.
  function pairUp(tramos, sport) {
    const out = [];
    for (let i = 0; i < tramos.length; i += 2) {
      const g = tramos.slice(i, i + 2), lastT = g[g.length - 1];
      const sec = g.reduce((a, x) => a + x.sec, 0), len = g.reduce((a, x) => a + x.lenKm, 0);
      const row = { from: g[0].from, to: lastT.to, lenKm: len, grade: 0, rolling: r1(Math.max(...g.map((x) => Math.abs(x.grade)))),
        gain: g.reduce((a, x) => a + x.gain, 0), loss: g.reduce((a, x) => a + x.loss, 0), eleStart: g[0].eleStart, eleEnd: lastT.eleEnd,
        sec, cumSec: lastT.cumSec, cumKm: lastT.cumKm };
      if (sport === "bike") {
        const avgP = g.reduce((a, x) => a + x.sec * x.power, 0) / sec;
        out.push({ ...row, power: r0(avgP), powerMax: Math.max(...g.map((x) => x.powerMax)), pctFtp: r0(g.reduce((a, x) => a + x.sec * x.pctFtp, 0) / sec), speed: len / (sec / 3600) });
      } else {
        out.push({ ...row, paceSec: sec / len });
      }
    }
    return out;
  }

  // ---------- carrera a pie ----------
  function runPlan(course, ath, cond, sc, extra) {
    const x = extra || {};
    const D = course.distKm * 1000;
    const surf = SURFACE[cond.surface] || SURFACE.asfalto;
    let flat;
    if (x.vT) {
      flat = D / (x.vT * x.pct);
    } else if (ath.vdot) {
      flat = timeForVdot(D, ath.vdot);
    } else {
      const vT = thresholdSpeed(ath);
      if (!vT) return null;
      flat = 3600 * Math.pow(D / (vT * 3600), 1.06);
    }
    if (flat > 4 * 3600) flat *= Math.pow(flat / (4 * 3600), 0.08);
    const hours = flat / 3600;
    const intent = INTENT[cond.intent] || INTENT.exigente;
    const temp = (cond.tempC ?? 15) + sc.temp;
    const wind = clamp((cond.wind || 0) + sc.wind, 0, 2);
    const slow = 1 + heatPenalty(temp, hours) + [0, 0.01, 0.025][wind] + surf.slow + enduranceDeficit(hours, ath.ctl);
    const vFlat = ((D / flat) * intent.run * (1 + sc.perf)) / slow;
    let t = 0, km = 0;
    const tramos = course.segments.map((s) => {
      let v = vFlat / gradeCost(s.grade);
      if (s.grade < 0) v = Math.min(v, vFlat * surf.downCap);
      if (s.grade > 15) v = Math.min(v, 1.25);
      const sec = (s.lenKm * 1000) / v;
      t += sec; km += s.lenKm;
      return { ...s, paceSec: 1000 / v, sec, cumSec: t, cumKm: km };
    });
    const shown = !course.fromTrack && tramos.length > 2 ? pairUp(tramos, "run") : tramos;
    const lthr = ath.lthr || null;
    const hrPct = hours < 0.4 ? [1.0, 1.04] : hours < 0.9 ? [0.98, 1.02] : hours < 2 ? [0.94, 0.98] : hours < 4 ? [0.88, 0.92] : [0.78, 0.85];
    return {
      sport: "run", totalSec: t, avgPaceSec: t / course.distKm, flatPaceSec: 1000 / vFlat, tramos: shown, hours: t / 3600, temp, wind,
      hr: lthr ? { lo: r0(lthr * hrPct[0]), hi: r0(lthr * hrPct[1]) } : null,
    };
  }

  // ---------- ciclismo ----------
  function bikePlan(course, ath, cond, sc, extra) {
    const x = extra || {};
    const ftp = ath.ftp;
    if (!ftp) return null;
    const bk = BIKES[cond.bike] || BIKES.carretera;
    const wind = clamp((cond.wind || 0) + sc.wind, 0, 2);
    const temp = (cond.tempC ?? 18) + sc.temp;
    const o = { mass: (ath.weight || 70) + bk.kg + 1.5, crr: bk.crr, cda: bk.cda * (cond.draft ? 0.72 : 1), vmax: bk.vmax, headwind: [0, 1.5, 3][wind] };
    const intent = INTENT[cond.intent] || INTENT.exigente;
    let hours = course.distKm / 28, res = null;
    for (let it = 0; it < 5; it++) {
      const baseIF = x.IF != null ? Math.min(x.IF, ifForHours(hours) + 0.04) : ifForHours(hours);
      let IF = baseIF + (x.IF != null ? intent.ifAdd * 0.6 : intent.ifAdd);
      IF -= enduranceDeficit(hours, ath.ctl);
      IF -= Math.max(0, temp - 22) * 0.004;
      IF = clamp(IF * (1 + sc.power), 0.45, 1.05);
      const np = IF * ftp;
      // potencia base tal que la NP ponderada por tiempo sea la objetivo
      let base = np, tramos = [];
      for (let k = 0; k < 4; k++) {
        const b = base;
        tramos = course.segments.map((s) => {
          const P = b * powerWeight(s.grade);
          const v = bikeSpeed(P, s.grade, { ...o, ele: (s.eleStart + s.eleEnd) / 2 });
          return { ...s, power: P, speed: v * 3.6, sec: (s.lenKm * 1000) / v };
        });
        const T = tramos.reduce((a, c) => a + c.sec, 0);
        const npNow = Math.pow(tramos.reduce((a, c) => a + c.sec * Math.pow(c.power, 4), 0) / T, 0.25);
        base *= np / npNow;
      }
      const T = tramos.reduce((a, c) => a + c.sec, 0);
      hours = T / 3600;
      res = { IF, np, tramos };
    }
    let t = 0, km = 0;
    const cap = ftp * (hours > 3 ? 0.95 : 1.05);
    const tramos = res.tramos.map((s) => {
      t += s.sec; km += s.lenKm;
      return { ...s, power: r0(s.power), powerMax: r0(Math.max(s.power, Math.min(s.power * 1.06, cap))), pctFtp: r0((s.power / ftp) * 100), cumSec: t, cumKm: km };
    });
    const avg = tramos.reduce((a, c) => a + c.sec * c.power, 0) / t;
    const shown = !course.fromTrack && tramos.length > 2 ? pairUp(tramos, "bike") : tramos;
    return { sport: "bike", totalSec: t, hours: t / 3600, IF: Math.round(res.IF * 100) / 100, np: r0(res.np), avgPower: r0(avg),
      avgSpeed: r1(course.distKm / (t / 3600)), tramos: shown, temp, wind, kj: r0((avg * t) / 1000) };
  }

  // ---------- natación ----------
  function swimPlan(distKm, ath, cond, sc, factor) {
    const css = ath.swimCssSec || parsePace(ath.swimCss) || 120;
    const intent = INTENT[cond.intent] || INTENT.exigente;
    let pace = (css * factor) / (Math.min(1, intent.run) * (1 + sc.perf));
    if (cond.wetsuit) pace *= 0.97;
    pace *= 1 + Math.max(0, (cond.tempC ?? 18) + sc.temp - 26) * 0.004;
    return { sport: "swim", totalSec: pace * distKm * 10, pace100: pace, distKm };
  }

  // ---------- nutrición ----------
  function nutrition(sport, hours, o) {
    const sw = SWEAT[o.sweat] || SWEAT.normal;
    const gutCap = GUT[o.gut] || GUT.media;
    let carbs = hours < 0.75 ? 0 : hours < 1.25 ? 30 : hours < 2.5 ? 60 : hours < 4 ? 80 : 90;
    if (carbs) carbs = Math.min(carbs, gutCap);
    if (sport === "run" && carbs) carbs = Math.max(30, r0((carbs * 0.85) / 5) * 5);
    if (sport === "bike-tri" && carbs) carbs = Math.min(gutCap, carbs + 10);
    let fluid = sw.ml + Math.max(0, (o.tempC ?? 18) - 18) * 20;
    fluid = Math.min(fluid, sport === "run" ? 800 : 1000);
    if (hours < 1) fluid = 0;
    const sodium = (fluid / 1000) * sw.na;
    return { carbsH: carbs, fluidH: r0(fluid / 50) * 50, sodiumH: r0(sodium / 50) * 50 };
  }

  function kmAt(part, sec) {
    if (!part.tramos) return null;
    let prev = 0, prevKm = 0;
    for (const s of part.tramos) {
      if (s.cumSec >= sec) return prevKm + ((sec - prev) / Math.max(1, s.cumSec - prev)) * (s.cumKm - prevKm);
      prev = s.cumSec; prevKm = s.cumKm;
    }
    return prevKm;
  }

  // Tomas concretas: cada 20 minutos (o 30 si la dosis es baja), con lo que
  // toca en cada una y el km aproximado según el escenario.
  function intakeSchedule(parts, o) {
    const out = [];
    let t0 = 0;
    for (const p of parts) {
      const n = p.nut;
      const startMin = t0 / 60, durMin = p.totalSec / 60;
      if (n.carbsH || n.fluidH) {
        const every = n.carbsH >= 50 ? 20 : 30;
        for (let m = every; m < durMin - 4; m += every) {
          const g = r0((n.carbsH * every) / 60), ml = r0((n.fluidH * every) / 60 / 10) * 10;
          const km = kmAt(p, m * 60);
          out.push({ min: r0(startMin + m), km: km != null ? r1(km) : null, part: p.label, carbs: g, ml, what: intakeText(p.sport, g, ml) });
        }
      }
      t0 += p.totalSec + (p.transitionSec || 0);
    }
    return withCaffeine(out, o, t0);
  }
  // Qué tomar en cada toma: en carrera, geles con agua; en bici, la bebida
  // isotónica (6 %) aporta parte de los hidratos y el resto va en gel o barrita.
  function intakeText(sport, g, ml) {
    const solid = g >= 20 ? `1 gel (${g} g)` : `medio gel (${g} g)`;
    if (!ml) return solid;
    if (sport === "run") return g >= 20 ? `${solid} + ${ml} ml de agua` : `${ml} ml de bebida isotónica (${g} g)`;
    const fromDrink = Math.min(g, r0(ml * ISO_G_PER_ML));
    const rest = g - fromDrink;
    const drink = `${ml} ml de bebida isotónica (${fromDrink} g)`;
    if (rest >= 20) return `${drink} + 1 gel (${rest} g)`;
    if (rest >= 8) return `${drink} + medio gel o media barrita (${rest} g)`;
    return drink;
  }
  // Cafeína 3 mg/kg: 2 mg/kg antes de salir y el resto en la segunda mitad
  // si la prueba pasa de dos horas.
  function withCaffeine(list, o, totalSec) {
    if (!o.caffeine || !o.weight) return [...list].sort((a, b) => a.min - b.min);
    const total = r0(o.weight * 3), pre = r0(o.weight * 2), totalMin = totalSec / 60;
    const extra = [{ min: -50, km: null, part: "Antes", carbs: 0, ml: 0, what: `Cafeína ${pre} mg (2 mg/kg) 45-60' antes de la salida` }];
    if (totalMin > 120) extra.push({ min: r0(totalMin * 0.6), km: null, part: "Cafeína", carbs: 0, ml: 0, what: `Cafeína ${total - pre} mg (gel con cafeína) para la segunda mitad` });
    return [...list, ...extra].sort((a, b) => a.min - b.min);
  }

  function preRace(hours, weight, o) {
    const w = weight || 70;
    const L = [];
    if (hours >= 1.5) L.push(`Carga de hidratos 36-48 h antes: ${r0(w * 8)}-${r0(w * 10)} g al día (8-10 g/kg), comida conocida y baja en fibra.`);
    else L.push("Cena normal la víspera con una ración generosa de hidratos; no hace falta carga especial.");
    L.push(`Desayuno 3 h antes: ${r0(w * 1.5)}-${r0(w * 2.5)} g de hidratos (1,5-2,5 g/kg), poca grasa y fibra, lo de siempre.`);
    L.push(`Hidratación: 500 ml con ${o.sweat === "mucha" ? "1000" : "500"} mg de sodio 2 h antes; sorbos hasta 20' antes.`);
    if (hours >= 1) L.push("10-15' antes de la salida: 1 gel (25 g) con agua.");
    return L;
  }

  // Reglas cortas para competir: lo que el deportista debe recordar.
  function claves(input, sc) {
    const L = [];
    const run = sc.parts.find((p) => p.sport === "run"), bike = sc.parts.find((p) => p.sport === "bike");
    if (bike) {
      const climbs = bike.tramos.filter((t) => (t.rolling || t.grade) >= 3);
      L.push(`Bici: NP objetivo ${bike.np} W (${r0(bike.IF * 100)} % del FTP). ${climbs.length ? `En subida no pases de ${Math.max(...climbs.map((c) => c.powerMax))} W` : "En llano, potencia constante"}; en bajada, rueda suave y come.`);
      L.push("Los primeros 20 minutos de bici, 5-10 W por debajo del objetivo: el pulso sube solo.");
    }
    if (run) {
      const extra = input.sport === "tri" ? 12 : 5;
      L.push(`Carrera: ritmo medio ${fmtPace(run.avgPaceSec)}/km; el primer tramo ${extra}" más lento (${fmtPace(run.tramos[0].paceSec + extra)}/km).`);
      if (run.hr) L.push(`Techo de pulso en la primera mitad: ${run.hr.hi} ppm. Si lo pasas al ritmo previsto, cambia al escenario menos favorable.`);
      if (run.tramos.some((t) => (t.rolling || t.grade) >= 4)) L.push("En las subidas manda el esfuerzo, no el ritmo: acepta perder segundos y recupéralos en llano.");
    }
    const n = sc.parts.find((p) => p.nut && p.nut.carbsH);
    if (n) L.push(`Come y bebe por reloj, no por sensaciones: ${n.nut.carbsH} g de hidratos y ${n.nut.fluidH} ml por hora desde el minuto 20.`);
    L.push("Plan B: si a mitad de prueba vas un 3 % por detrás del paso previsto o con molestias, pasa al escenario menos favorable y asegura la llegada.");
    return L;
  }

  // ---------- plan completo ----------
  // input: { sport: run|bike|tri, course | courses{bike,run}, athlete, cond, nutrition }
  function plan(input) {
    const courses = input.sport === "tri" ? [input.courses && input.courses.bike, input.courses && input.courses.run] : [input.course];
    if (courses.some((c) => !c || !(c.distKm >= 0.1) || !c.segments || !c.segments.length)) return { error: "El recorrido no tiene distancia: revisa el track o escribe los km." };
    const ath = input.athlete || {};
    const cond = input.cond || {};
    const nutO = input.nutrition || {};
    const scenarios = [];
    for (const sc of SCENARIOS) {
      const parts = [];
      if (input.sport === "run") {
        const r = runPlan(input.course, ath, cond, sc);
        if (!r) return { error: "Falta el ritmo umbral o el VDOT del deportista para calcular la carrera." };
        parts.push({ ...r, label: "Carrera" });
      } else if (input.sport === "bike") {
        const b = bikePlan(input.course, ath, cond, sc);
        if (!b) return { error: "Falta el FTP del deportista para calcular la bici." };
        parts.push({ ...b, label: "Bici" });
      } else {
        const d = TRI[cond.triDistance] || TRI.olimpico;
        const vT = thresholdSpeed(ath);
        const b = bikePlan(input.courses.bike, ath, { ...cond, draft: false, bike: cond.bike || "cabra" }, sc, { IF: d.bikeIF });
        if (!b) return { error: "Falta el FTP del deportista para calcular la bici." };
        if (!vT) return { error: "Falta el ritmo umbral o el VDOT del deportista para calcular la carrera a pie." };
        if (!ath.swimCssSec && !parsePace(ath.swimCss)) return { error: "Falta el CSS de natación (min:seg por 100 m) para calcular el segmento de agua." };
        const rn = runPlan(input.courses.run, ath, { ...cond, surface: cond.surface || "asfalto" }, sc, { vT, pct: d.runPct });
        parts.push({ ...swimPlan(d.swim, ath, cond, sc, d.swimF), label: "Natación", transitionSec: d.t1 * 60 });
        parts.push({ ...b, label: "Bici", transitionSec: d.t2 * 60 });
        parts.push({ ...rn, label: "Carrera" });
      }
      const totalSec = parts.reduce((s, p) => s + p.totalSec + (p.transitionSec || 0), 0);
      const hours = totalSec / 3600;
      const temp = (cond.tempC ?? 18) + sc.temp;
      const withNut = parts.map((p) => {
        const kind = input.sport === "tri" && p.sport === "bike" ? "bike-tri" : p.sport;
        return { ...p, nut: p.sport === "swim" ? { carbsH: 0, fluidH: 0, sodiumH: 0 } : nutrition(kind, hours, { ...nutO, tempC: temp }) };
      });
      const intake = intakeSchedule(withNut, { ...nutO, weight: ath.weight });
      const totals = intake.reduce((a, x) => ({ carbs: a.carbs + x.carbs, ml: a.ml + x.ml }), { carbs: 0, ml: 0 });
      scenarios.push({ id: sc.id, label: sc.label, totalSec, hours, temp, parts: withNut, intake, totals });
    }
    const normal = scenarios.find((s) => s.id === "normal");
    const avisos = [];
    if (nutO.caffeine && !ath.weight) avisos.push("Sin el peso del deportista no calculo la cafeína (3 mg/kg): añádelo para incluirla.");
    if (!ath.weight && input.sport !== "run") avisos.push("Sin peso se asumen 70 kg para la física de la bici y las cantidades antes de la carrera.");
    return { sport: input.sport, scenarios, pre: preRace(normal.hours, ath.weight, nutO), claves: claves(input, normal), avisos };
  }

  const API = { plan, parseTrack, buildCourse, resample, segmentProfile, vdotFrom, timeForVdot, gradeCost, ifForHours, bikeSpeed,
    nutrition, thresholdSpeed, fmtTime, fmtPace, parsePace, SCENARIOS, INTENT, BIKES, SURFACE, TRI };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.SB_RACE_ENGINE = API;
})(typeof window !== "undefined" ? window : globalThis);
