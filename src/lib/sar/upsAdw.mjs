/**
 * Panduan ADW ke UPS Digital — matematika plotting Aeronautical Drift Worksheet
 * ke Universal Plotting Sheet (bagian 5, 6, dan 7 panduan).
 *
 * Semua satuan jarak dalam NM (1 menit busur lintang = 1 NM), arah dalam derajat
 * True (000° di atas, searah jarum jam). Koordinat lokal lembar: x ke timur (+),
 * y ke utara (+), relatif terhadap datum X.
 *
 * Parameter kanvas (konfigurasi app, panduan bagian 5):
 *   lebar  WR = 4.7 R, tinggi HR = 3.4 R (R = jari-jari rose = S menit lintang),
 *   margin m = 0.2 R untuk label dan kepala panah.
 */

export const UPS_SHEET_WR = 4.7;
export const UPS_SHEET_HR = 3.4;
export const UPS_MARGIN_R = 0.2;

/** Skala tersedia (menit busur) — S dibagi 6 menghasilkan bilangan bulat menit/detik. */
export const UPS_SCALE_OPTIONS = [3, 6, 12, 18, 30, 60];

const DEG = Math.PI / 180;

export function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

/**
 * Vektor resultan dua segmen planar per panduan bagian 7 (dihitung numerik,
 * bukan dibaca dari gambar):
 *   N = d1·cos(dir1) + d2·cos(dir2)  (NM, utara +)
 *   E = d1·sin(dir1) + d2·sin(dir2)  (NM, timur +)
 *   jarak = √(N²+E²), arah = atan2(E, N) 0–360°
 */
export function sumPlanarVectors(v1, v2) {
  const N = v1.nm * Math.cos(v1.dir * DEG) + v2.nm * Math.cos(v2.dir * DEG);
  const E = v1.nm * Math.sin(v1.dir * DEG) + v2.nm * Math.sin(v2.dir * DEG);
  return {
    northNm: N,
    eastNm: E,
    nm: Math.hypot(N, E),
    dir: normalizeDeg(Math.atan2(E, N) / DEG),
  };
}

/**
 * Rantai ADW pesawat per panduan bagian 3 & 7:
 *   dg = glide displacement (B9 arah, B8 jarak), dd = downwind (B11),
 *   da = resultan (B12), posisi akhir glide (B14) dengan
 *   φ_akhir = φ_datum + N/60; φ_m = (φ_datum + φ_akhir)/2;
 *   λ_akhir = λ_datum + (E / cos φ_m)/60.
 */
export function computeAdwChain({ datumLat, datumLng, dgDir, dgNm, ddDir, ddNm }) {
  const da = sumPlanarVectors({ dir: dgDir, nm: dgNm }, { dir: ddDir, nm: ddNm });
  const endLat = datumLat + da.northNm / 60;
  const midLat = (datumLat + endLat) / 2;
  const cosMidLat = Math.cos(midLat * DEG);
  const endLng = datumLng + (da.eastNm / cosMidLat) / 60;
  return {
    northNm: da.northNm,
    eastNm: da.eastNm,
    daNm: da.nm,
    daDir: da.dir,
    endLat,
    endLng,
    midLat,
    cosMidLat,
  };
}

/**
 * Pemilihan skala UPS per panduan bagian 5.
 *
 * @param points Array titik relatif datum dalam NM: P0 = (0,0) datum,
 *               P1 = ujung dg, P2 = ujung da, (+ titik parasut bila ada).
 * @param midLat φm = (φdatum + φakhir)/2 derajat (selatan negatif).
 * @param scales Daftar kandidat skala menit busur, diuji dari terkecil.
 * @returns Skala terkecil yang memuat semua titik beserta pusat rose C =
 *          perpotongan grid terdekat ke tengah kotak pembatas titik:
 *          j = round(ytengah/S), i = round(xtengah/(S·cos φm)),
 *          C = (i·S·cos φm, j·S). Bila tidak ada yang lolos, fits=false.
 */
export function selectUpsScale({ points, midLat, scales = UPS_SCALE_OPTIONS }) {
  const cosMidLat = Math.cos(midLat * DEG);
  const xs = points.map((p) => p.xNm);
  const ys = points.map((p) => p.yNm);
  const xMid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const yMid = (Math.min(...ys) + Math.max(...ys)) / 2;
  const xLimitFactor = UPS_SHEET_WR / 2 - UPS_MARGIN_R;
  const yLimitFactor = UPS_SHEET_HR / 2 - UPS_MARGIN_R;

  let last = null;
  for (const scaleMin of scales) {
    const j = Math.round(yMid / scaleMin);
    const i = Math.round(xMid / (scaleMin * cosMidLat));
    const roseCenterNm = { xNm: i * scaleMin * cosMidLat, yNm: j * scaleMin };
    const maxDevXNm = Math.max(...points.map((p) => Math.abs(p.xNm - roseCenterNm.xNm)));
    const maxDevYNm = Math.max(...points.map((p) => Math.abs(p.yNm - roseCenterNm.yNm)));
    const xLimitNm = xLimitFactor * scaleMin;
    const yLimitNm = yLimitFactor * scaleMin;
    last = { scaleMin, i, j, roseCenterNm, maxDevXNm, maxDevYNm, xLimitNm, yLimitNm };
    if (maxDevXNm <= xLimitNm + 1e-9 && maxDevYNm <= yLimitNm + 1e-9) {
      return { ...last, fits: true, cosMidLat, midLat };
    }
  }
  return { ...last, fits: false, cosMidLat, midLat };
}

/**
 * Tambahkan jangkar grid ke hasil pemilihan skala (panduan bagian 6):
 *   φC = φdatum + j·S′ ; λC = λdatum + i·S′
 * Garis lintang pada φC + k·S′ (jarak antar garis = R),
 * garis bujur pada λC + k·S′ (jarak antar garis = cos φm · R).
 */
export function withGridAnchors(scaleResult, { datumLat, datumLng }) {
  const { scaleMin, fits, j, i } = scaleResult;
  if (!fits || !scaleMin) return scaleResult;
  return {
    ...scaleResult,
    latCenterDeg: datumLat + (j * scaleMin) / 60,
    lngCenterDeg: datumLng + (i * scaleMin) / 60,
  };
}

/**
 * Bangun rencana gambar lengkap ADW → UPS untuk komponen sheet:
 * rantai pesawat (dg, dd, da) dan rantai parasut (lanjutan dari ujung pesawat
 * bila ada). Semua titik yang digambar disertakan dalam pemeriksaan skala agar
 * tidak ada vektor yang keluar batas lembar.
 *
 * @param {object} p
 * @param {number} p.datumLat  Lintang datum X (derajat desimal, selatan negatif)
 * @param {number} p.datumLng  Bujur datum X (derajat desimal, barat negatif)
 * @param {{dir:number,nm:number}|null} [p.dg]  Vektor glide pesawat (B8/B9)
 * @param {{dir:number,nm:number}|null} [p.dd]  Vektor downwind (B11)
 * @param {{dir:number,nm:number}|null} [p.pg]  Glide parasut
 * @param {{dir:number,nm:number}|null} [p.pw]  Drift angin parasut
 * @param {{dir:number,nm:number}|null} [p.pp]  Resultan parasut (diubah ke vektor planar)
 */
export function buildAdwUpsPlot(p) {
  const { datumLat, datumLng } = p;
  const dg = p.dg && p.dg.nm > 0 ? p.dg : null;
  const dd = p.dd && p.dd.nm > 0 ? p.dd : null;
  const pg = p.pg && p.pg.nm > 0 ? p.pg : null;
  const pw = p.pw && p.pw.nm > 0 ? p.pw : null;
  const pp = p.pp && p.pp.nm > 0 ? p.pp : null;

  const hasAircraft = Boolean(dg || dd);
  const hasParachute = Boolean(pg || pw || pp);
  if (!hasAircraft && !hasParachute) {
    return { ready: false, reason: 'Belum ada vektor hasil ADW untuk digambar.' };
  }

  const segments = [];
  const points = [{ xNm: 0, yNm: 0 }];
  let midLat = datumLat;
  let aircraftTipNm = { xNm: 0, yNm: 0 };
  let aircraftEnd = { lat: datumLat, lng: datumLng };

  if (hasAircraft) {
    const dgNm = dg ? dg.nm : 0;
    const dgDir = dg ? dg.dir : 0;
    const ddNm = dd ? dd.nm : 0;
    const ddDir = dd ? dd.dir : 0;
    const chain = computeAdwChain({ datumLat, datumLng, dgDir, dgNm, ddDir, ddNm });
    midLat = chain.midLat;
    const dgTip = {
      xNm: dgNm * Math.sin(dgDir * DEG),
      yNm: dgNm * Math.cos(dgDir * DEG),
    };
    const ddTip = {
      xNm: dgTip.xNm + ddNm * Math.sin(ddDir * DEG),
      yNm: dgTip.yNm + ddNm * Math.cos(ddDir * DEG),
    };
    if (dg) segments.push({ id: 'dg', fromNm: { xNm: 0, yNm: 0 }, toNm: dgTip, dir: dgDir, nm: dgNm, tipNm: dgTip });
    if (dd) segments.push({ id: 'dd', fromNm: dgTip, toNm: ddTip, dir: ddDir, nm: ddNm, tipNm: ddTip });
    points.push(dgTip, ddTip);
    aircraftTipNm = ddTip;
    aircraftEnd = { lat: chain.endLat, lng: chain.endLng };
  }

  let parachute = null;
  if (hasParachute) {
    const startNm = hasAircraft ? aircraftTipNm : { xNm: 0, yNm: 0 };
    const startLL = hasAircraft ? aircraftEnd : { lat: datumLat, lng: datumLng };
    const pgNm = pg ? pg.nm : 0;
    const pgDir = pg ? pg.dir : 0;
    const pwNm = pw ? pw.nm : 0;
    const pwDir = pw ? pw.dir : 0;
    const pgTip = {
      xNm: startNm.xNm + pgNm * Math.sin(pgDir * DEG),
      yNm: startNm.yNm + pgNm * Math.cos(pgDir * DEG),
    };
    const pwTip = {
      xNm: pgTip.xNm + pwNm * Math.sin(pwDir * DEG),
      yNm: pgTip.yNm + pwNm * Math.cos(pwDir * DEG),
    };
    if (pg) segments.push({ id: 'pg', fromNm: startNm, toNm: pgTip, dir: pgDir, nm: pgNm, tipNm: pgTip });
    if (pw) segments.push({ id: 'pw', fromNm: pgTip, toNm: pwTip, dir: pwDir, nm: pwNm, tipNm: pwTip });
    if (pp) {
      segments.push({ id: 'pp', fromNm: startNm, toNm: pwTip, dir: pp.dir, nm: pp.nm, tipNm: pwTip });
    }
    points.push(pgTip, pwTip);
    const chainP = sumPlanarVectors({ dir: pgDir, nm: pgNm }, { dir: pwDir, nm: pwNm });
    const endLatP = startLL.lat + chainP.northNm / 60;
    const midLatP = (startLL.lat + endLatP) / 2;
    parachute = {
      startNm,
      pgTip,
      pwTip,
      resultNm: chainP.nm,
      resultDir: chainP.dir,
      endLat: endLatP,
      endLng: startLL.lng + (chainP.eastNm / Math.cos(midLatP * DEG)) / 60,
    };
  }

  const daInfo = hasAircraft
    ? {
        nm: Math.hypot(aircraftTipNm.xNm, aircraftTipNm.yNm),
        dir: normalizeDeg(Math.atan2(aircraftTipNm.xNm, aircraftTipNm.yNm) / DEG),
        endLat: aircraftEnd.lat,
        endLng: aircraftEnd.lng,
      }
    : null;

  const rawScale = selectUpsScale({ points, midLat });
  const scale = withGridAnchors(rawScale, { datumLat, datumLng });

  return { ready: true, datum: { lat: datumLat, lng: datumLng }, segments, points, daInfo, parachute, scale, midLat };
}

/**
 * Label garis besar & kecil skala per panduan bagian 6 (tabel nilai skala):
 *   S=60′ → garis besar 10′, garis kecil 1′ (60″), dst.
 */
export function scaleTickInfo(scaleMin) {
  const majorMin = scaleMin / 6;
  const minorSec = scaleMin; // S/60 menit = S detik busur
  return { majorMin, minorSec };
}
