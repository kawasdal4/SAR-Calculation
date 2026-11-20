/**
 * Sesi STUDIO PETA SCAN — mempertahankan peta terunggah + titik kalibrasi saat
 * pengguna pindah tab worksheet (Radix TabsContent me-unmount komponen).
 *
 * Batasan sesuai permintaan pemilik: hasil gambar & peta TIDAK di permanenkan.
 * Registry ini hanya hidup di memori modul (SPA): hilang saat browser
 * di-refresh, dan berkas peta di storage ikut dihapus oleh beacon release
 * (tempMapClient) pada pagehide. Tidak ada penulisan ke DB/localStorage.
 */

import type { CalibrationPoint } from './scanCalib';
import type { TempMapInfo } from './tempMapStorage';

export interface ScanStudioSession {
  mapInfo: TempMapInfo;
  calibPoints: CalibrationPoint[];
}

const sessions = new Map<string, ScanStudioSession>();

export function readScanSession(key: string): ScanStudioSession | null {
  return sessions.get(key) ?? null;
}

export function writeScanSession(key: string, session: ScanStudioSession): void {
  sessions.set(key, session);
}

export function clearScanSession(key: string): void {
  sessions.delete(key);
}
