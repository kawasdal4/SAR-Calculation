/**
 * Intercept Calculations Engine
 * Berdasarkan materi Diklat SAR Planning:
 * 1. Head-On Intercept (saling berhadapan)
 * 2. Overtaking Intercept (mengejar dari belakang)
 * 3. Beam-On / Crossing / Offset Intercept (memotong dengan sudut)
 */

import {
  type LatLng,
  project,
  distanceNm,
  bearingDeg,
} from './sarCalculations';

export type InterceptType = 'head-on' | 'overtaking' | 'beam-on';

export interface InterceptInput {
  type: InterceptType;
  /** Shared observation/reference timestamp for Target A and SRU B. */
  referenceTime?: string;
  target: {
    name: string;
    pos: LatLng;
    speedKts: number;
    courseDeg: number; // True heading
    departureTime?: string; // HH:mm
  };
  sru: {
    name: string;
    pos: LatLng;
    speedKts: number;
    departureTime?: string; // HH:mm
    enduranceHours?: number;
  };
}

export interface InterceptResult {
  type: InterceptType;
  feasible: boolean;
  message?: string;
  initialDistanceNm: number;
  bearingTargetToSru: number; // Bearing dari Target ke SRU (°T)
  bearingSruToTarget: number; // Bearing dari SRU ke Target (°T)
  interceptCourseDeg: number; // Haluan SRU menuju titik intercept (°T)
  timeToInterceptHours: number; // Jam
  timeToInterceptMin: number; // Menit
  targetDistanceTravelledNm: number;
  sruDistanceTravelledNm: number;
  interceptPos: LatLng;
  // Detail geometri untuk visualisasi
  constructionPoints?: {
    pointC?: LatLng; // Head-on / Overtaking
    pointD?: LatLng;
    pointX?: LatLng; // Beam-on (0.5 hr target run)
    pointY?: LatLng; // Parallel reference
    pointW?: LatLng; // Arc intersection point (0.5 hr SRU run)
  };
}

/**
 * Normalisasi sudut ke rentang [0, 360)
 */
export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

/**
 * Hitung selisih sudut absolut [0, 180]
 */
export function angleDiff(deg1: number, deg2: number): number {
  let diff = Math.abs(normalizeDeg(deg1) - normalizeDeg(deg2));
  if (diff > 180) diff = 360 - diff;
  return diff;
}

/**
 * Kalkulasi Intercept Head-On
 * Target dan SRU bergerak saling mendekat di sepanjang garis AB
 */
export function calculateHeadOnIntercept(input: InterceptInput): InterceptResult {
  const dist = distanceNm(input.target.pos, input.sru.pos);
  const brgTargetToSru = bearingDeg(input.target.pos, input.sru.pos);
  const brgSruToTarget = bearingDeg(input.sru.pos, input.target.pos);

  const relativeSpeed = input.target.speedKts + input.sru.speedKts;
  if (input.target.speedKts <= 0 || input.sru.speedKts <= 0 || dist <= 1e-9 || relativeSpeed <= 0) {
    return {
      type: 'head-on',
      feasible: false,
      message: dist <= 1e-9
        ? 'Posisi Target dan SRU tidak boleh sama.'
        : 'Kecepatan Target dan SRU harus lebih dari 0 knot.',
      initialDistanceNm: dist,
      bearingTargetToSru: brgTargetToSru,
      bearingSruToTarget: brgSruToTarget,
      interceptCourseDeg: brgSruToTarget,
      timeToInterceptHours: 0,
      timeToInterceptMin: 0,
      targetDistanceTravelledNm: 0,
      sruDistanceTravelledNm: 0,
      interceptPos: input.target.pos,
    };
  }

  const timeHours = dist / relativeSpeed;
  const targetDist = input.target.speedKts * timeHours;
  const sruDist = input.sru.speedKts * timeHours;

  const interceptPos = project(input.target.pos, brgTargetToSru, targetDist);

  // Geometric construction points (seperti di modul: garis tegak lurus 0.5 jam)
  const perpLeft = normalizeDeg(brgTargetToSru - 90);
  const perpRight = normalizeDeg(brgTargetToSru + 90);
  const pointC = project(input.target.pos, perpLeft, input.target.speedKts * 0.5);
  const pointD = project(input.sru.pos, perpRight, input.sru.speedKts * 0.5);

  return {
    type: 'head-on',
    feasible: true,
    initialDistanceNm: dist,
    bearingTargetToSru: brgTargetToSru,
    bearingSruToTarget: brgSruToTarget,
    interceptCourseDeg: brgSruToTarget,
    timeToInterceptHours: timeHours,
    timeToInterceptMin: timeHours * 60,
    targetDistanceTravelledNm: targetDist,
    sruDistanceTravelledNm: sruDist,
    interceptPos,
    constructionPoints: { pointC, pointD },
  };
}

/**
 * Kalkulasi Intercept Overtaking
 * Target menjauh dari SRU, SRU mengejar dari belakang di garis AB
 */
export function calculateOvertakingIntercept(input: InterceptInput): InterceptResult {
  const dist = distanceNm(input.sru.pos, input.target.pos);
  const brgSruToTarget = bearingDeg(input.sru.pos, input.target.pos);
  const brgTargetToSru = bearingDeg(input.target.pos, input.sru.pos);

  if (dist <= 1e-9 || input.target.speedKts <= 0 || input.sru.speedKts <= input.target.speedKts) {
    return {
      type: 'overtaking',
      feasible: false,
      message: dist <= 1e-9
        ? 'Posisi Target dan SRU tidak boleh sama.'
        : input.target.speedKts <= 0
          ? 'Kecepatan Target harus lebih dari 0 knot.'
          : 'Kecepatan SRU harus lebih besar daripada kecepatan Target untuk mengejar.',
      initialDistanceNm: dist,
      bearingTargetToSru: brgTargetToSru,
      bearingSruToTarget: brgSruToTarget,
      interceptCourseDeg: brgSruToTarget,
      timeToInterceptHours: 0,
      timeToInterceptMin: 0,
      targetDistanceTravelledNm: 0,
      sruDistanceTravelledNm: 0,
      interceptPos: input.target.pos,
    };
  }

  const relativeSpeed = input.sru.speedKts - input.target.speedKts;
  const timeHours = dist / relativeSpeed;
  const targetDist = input.target.speedKts * timeHours;
  const sruDist = input.sru.speedKts * timeHours;

  const interceptPos = project(input.target.pos, brgSruToTarget, targetDist);

  // Geometric construction points (tegak lurus garis AB pada sisi yang sama)
  const perpRight = normalizeDeg(brgSruToTarget + 90);
  const pointC = project(input.target.pos, perpRight, input.target.speedKts * 0.5);
  const pointD = project(input.sru.pos, perpRight, input.sru.speedKts * 0.5);

  return {
    type: 'overtaking',
    feasible: true,
    initialDistanceNm: dist,
    bearingTargetToSru: brgTargetToSru,
    bearingSruToTarget: brgSruToTarget,
    interceptCourseDeg: brgSruToTarget,
    timeToInterceptHours: timeHours,
    timeToInterceptMin: timeHours * 60,
    targetDistanceTravelledNm: targetDist,
    sruDistanceTravelledNm: sruDist,
    interceptPos,
    constructionPoints: { pointC, pointD },
  };
}

/**
 * Kalkulasi Intercept Beam-On / Crossing / Offset
 * Target bergerak ke arah sembarang (courseDeg), SRU bergerak memotong lintasan target
 */
export function calculateBeamOnIntercept(input: InterceptInput): InterceptResult {
  const posA = input.target.pos;
  const posB = input.sru.pos;
  const vA = input.target.speedKts;
  const vB = input.sru.speedKts;
  const courseA = normalizeDeg(input.target.courseDeg);

  const distAB = distanceNm(posA, posB);
  const brgAB = bearingDeg(posA, posB); // Dari target ke SRU
  const brgBA = bearingDeg(posB, posA); // Dari SRU ke target

  // Sudut antara lintasan target (courseA) dan garis pandang ke SRU (brgAB)
  // alpha adalah sudut di titik A dalam segitiga ABI
  let alphaDeg = angleDiff(courseA, brgAB);
  const alphaRad = (alphaDeg * Math.PI) / 180;

  // Persamaan hukum cosinus dalam segitiga ABI:
  // (vB * t)^2 = distAB^2 + (vA * t)^2 - 2 * distAB * (vA * t) * cos(alpha)
  // (vB^2 - vA^2) * t^2 + 2 * distAB * vA * cos(alpha) * t - distAB^2 = 0
  // a * t^2 + b * t + c = 0
  const a = vB * vB - vA * vA;
  const b = 2 * distAB * vA * Math.cos(alphaRad);
  const c = -(distAB * distAB);

  let timeHours: number | null = null;

  if (Math.abs(a) < 1e-6) {
    // Kecepatan sama (vB == vA): persamaan linier b * t + c = 0
    if (b > 1e-6) {
      timeHours = -c / b;
    }
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const sqrtDisc = Math.sqrt(discriminant);
      const t1 = (-b + sqrtDisc) / (2 * a);
      const t2 = (-b - sqrtDisc) / (2 * a);

      // Pilih t positif terkecil
      const validTimes = [t1, t2].filter((t) => t > 0);
      if (validTimes.length > 0) {
        timeHours = Math.min(...validTimes);
      }
    }
  }

  if (distAB <= 1e-9 || vA <= 0 || vB <= 0 || timeHours === null || timeHours <= 0) {
    return {
      type: 'beam-on',
      feasible: false,
      message: distAB <= 1e-9
        ? 'Posisi Target dan SRU tidak boleh sama.'
        : vA <= 0 || vB <= 0
          ? 'Kecepatan Target dan SRU harus lebih dari 0 knot.'
          : 'Intercept tidak memungkinkan dengan kecepatan dan arah saat ini.',
      initialDistanceNm: distAB,
      bearingTargetToSru: brgAB,
      bearingSruToTarget: brgBA,
      interceptCourseDeg: brgBA,
      timeToInterceptHours: 0,
      timeToInterceptMin: 0,
      targetDistanceTravelledNm: 0,
      sruDistanceTravelledNm: 0,
      interceptPos: posA,
    };
  }

  const targetDist = vA * timeHours;
  const sruDist = vB * timeHours;

  // Titik Intercept I = posisi target setelah waktu timeHours bergerak di courseA
  const interceptPos = project(posA, courseA, targetDist);

  // Haluan SRU menuju titik intercept
  const interceptCourseDeg = bearingDeg(posB, interceptPos);

  // Titik-titik konstruksi geometris grafis (sesuai modul Diklat Basarnas):
  // X: Posisi target 0.5 jam (Ax = vA * 0.5 di arah courseA)
  const pointX = project(posA, courseA, vA * 0.5);

  // Garis XY sejajar AB dari titik X
  const pointY = project(pointX, brgAB, distAB);

  // W: Titik pada garis XY berjarak 0.5 * vB dari titik B
  // Secara geometris, W membagi vektor kecepatan
  const brgBW = bearingDeg(posB, interceptPos); // Arah ray BW sama dengan arah haluan ke I
  const pointW = project(posB, brgBW, vB * 0.5);

  return {
    type: 'beam-on',
    feasible: true,
    initialDistanceNm: distAB,
    bearingTargetToSru: brgAB,
    bearingSruToTarget: brgBA,
    interceptCourseDeg,
    timeToInterceptHours: timeHours,
    timeToInterceptMin: timeHours * 60,
    targetDistanceTravelledNm: targetDist,
    sruDistanceTravelledNm: sruDist,
    interceptPos,
    constructionPoints: {
      pointX,
      pointY,
      pointW,
    },
  };
}

/**
 * Dispatcher utama untuk menghitung Intercept
 */
export function calculateIntercept(input: InterceptInput): InterceptResult {
  switch (input.type) {
    case 'head-on':
      return calculateHeadOnIntercept(input);
    case 'overtaking':
      return calculateOvertakingIntercept(input);
    case 'beam-on':
    default:
      return calculateBeamOnIntercept(input);
  }
}

/**
 * Latihan Presets dari Diklat SAR Planning Basarnas
 */
export const INTERCEPT_EXERCISE_PRESETS = [
  {
    id: 'latihan-1',
    title: 'Latihan 1: Head-On (Kapal Ikan Asin vs RIB Kansar Kendari)',
    description:
      'Kapal Ikan Asin menemukan survivor menuju Tg Lelamu (kec 16 kts). RIB Kansar Kendari menjemput dari Tg Lelamu pukul 09.00 (kec 30 kts).',
    input: {
      type: 'head-on' as InterceptType,
      target: {
        name: 'Kapal Ikan Asin',
        pos: { lat: -4.0, lng: 123.0 },
        speedKts: 16,
        courseDeg: 90, // Menuju posisi RIB
        departureTime: '09:00',
      },
      sru: {
        name: 'RIB Kansar Kendari',
        pos: { lat: -4.0, lng: 123.5 }, // Tg Lelamu ~30 NM ke timur
        speedKts: 30,
        departureTime: '09:00',
        enduranceHours: 4,
      },
    },
  },
  {
    id: 'latihan-2',
    title: 'Latihan 2: Overtaking (MV Buru-buru vs RIB Kansar Kendari)',
    description:
      'MV Buru-buru dari timur P. Manui tujuan Ambon (kec 10 kts) minta medevac. RIB Kansar Kendari berangkat mengejar dg kec 28 kts pada jam 07.00.',
    input: {
      type: 'overtaking' as InterceptType,
      target: {
        name: 'MV Buru-buru',
        pos: { lat: -3.0, lng: 123.3 }, // Lebih dulu di depan
        speedKts: 10,
        courseDeg: 27,
        departureTime: '07:00',
      },
      sru: {
        name: 'RIB Kansar Kendari',
        pos: { lat: -3.0, lng: 123.0 },
        speedKts: 28,
        departureTime: '07:00',
        enduranceHours: 5,
      },
    },
  },
  {
    id: 'latihan-3',
    title: 'Latihan 3: Crossing/Beam-On (MV Gajah Laut vs Heli Dauphin Basarnas)',
    description:
      'MV Gajah Laut tolong MOB di Laut Banda (kec 12 kts, heading 350°). Heli Dauphin Basarnas berangkat dari Tg Buton pukul 15.00 dg kec 60 kts.',
    input: {
      type: 'beam-on' as InterceptType,
      target: {
        name: 'MV Gajah Laut',
        pos: { lat: -(4 + 5 / 60), lng: 123 + 47 / 60 }, // 04°05'S, 123°47'E
        speedKts: 12,
        courseDeg: 350,
        departureTime: '15:00',
      },
      sru: {
        name: 'Heli Dauphin HR-3601',
        pos: { lat: -5.0, lng: 123.2 }, // Tanjung Buton
        speedKts: 60,
        departureTime: '15:00',
        enduranceHours: 3.5,
      },
    },
  },
];
