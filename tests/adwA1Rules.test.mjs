/**
 * Test aturan WAKTU INSIDEN A.1 worksheet ADW pada asisten AI (chat route).
 * Aturan pengguna:
 *  1. A.1 = tanggal & waktu KEJADIAN (MAYDAY/kejadian), bukan waktu Kantor SAR
 *     menerima informasi/laporan.
 *  2. Bila ragu antara ≥2 kandidat waktu, AI WAJIB memberikan pilihan di
 *     kolom chat (tool clarify_incident_time + candidates) — JANGAN menentukan
 *     atau menebak sendiri.
 *  3. Aplikasi mengonversi format apa pun ke format Basarnas otomatis.
 * Jalankan: node --test tests/adwA1Rules.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(join(here, '..', 'src', 'app', 'api', 'chat', 'route.ts'), 'utf8');
const panelSource = readFileSync(join(here, '..', 'src', 'components', 'sar', 'AIChatPanel.tsx'), 'utf8');
const previewSource = readFileSync(join(here, '..', 'src', 'lib', 'sar', 'chatPreview.ts'), 'utf8');

test('system prompt memuat bagian ATURAN WAKTU INSIDEN A.1', () => {
  assert.match(routeSource, /ATURAN WAKTU INSIDEN A\.1 \(worksheet ADW\)/);
  // Aturan inti: waktu kejadian vs waktu informasi diterima.
  assert.match(routeSource, /waktu KEJADIAN \(initial incident\)/);
  assert.match(routeSource, /BUKAN tanggal & waktu Kantor SAR\/RCC menerima informasi/);
  // Panduan pemisahan dua jenis waktu pada narasi soal.
  assert.match(routeSource, /WAKTU KEJADIAN/);
  assert.match(routeSource, /WAKTU INFORMASI DITERIMA/);
});

test('contoh kasus PK-XYZ pada prompt: A.1 = waktu MAYDAY 15.56, bukan 16.05', () => {
  assert.match(routeSource, /A\.1 = 17 Nov 2026 15\.56 WIT/);
  assert.match(routeSource, /16\.05 WIT HANYA konteks waktu penerimaan laporan, JANGAN dipakai sebagai A\.1/);
});

test('aturan WAJIB bertanya bila ragu: clarify_incident_time, jangan menebak', () => {
  assert.match(routeSource, /WAJIB bertanya bila ragu[^\n]*clarify_incident_time/);
  assert.match(routeSource, /JANGAN menentukan sendiri, JANGAN menebak[^;]*; panggil tool clarify_incident_time/);
});

test('tool clarify_incident_time dideklarasikan dengan schema kandidat', () => {
  assert.match(routeSource, /name: 'clarify_incident_time'/);
  // Schema: question + candidates (label, value, source) wajib.
  const toolIdx = routeSource.indexOf("name: 'clarify_incident_time'");
  const snippet = routeSource.slice(toolIdx, toolIdx + 3600);
  assert.match(snippet, /question/);
  assert.match(snippet, /candidates/);
  assert.match(snippet, /label/);
  assert.match(snippet, /value/);
  assert.match(snippet, /source/);
  assert.match(snippet, /required: \['question', 'candidates'\]/);
});

test('deskripsi incidentTime/date set_aero_drift_case merujuk aturan A.1 + klarifikasi', () => {
  assert.match(routeSource, /Waktu KEJADIAN\/insiden \(point A\.1 ADW\)/);
  assert.match(routeSource, /BUKAN waktu Kantor SAR menerima informasi/);
  assert.match(routeSource, /panggil clarify_incident_time dulu — jangan menebak/);
  assert.match(routeSource, /Tanggal KEJADIAN\/insiden \(bagian tanggal point A\.1 ADW\)/);
});

test('kartu klarifikasi waktu kejadian (ADW A.1) dirender di panel chat', () => {
  assert.match(panelSource, /clarify_incident_time/);
  assert.match(panelSource, /Klarifikasi Waktu Kejadian \(ADW A\.1\)/);
  // Jawaban kandidat dikirim ke chat untuk diteruskan ke set_aero_drift_case.
  assert.match(panelSource, /date \+ incidentTime pada set_aero_drift_case/);
});

test('clarify_incident_time terdaftar sebagai tool non-mutating', () => {
  assert.match(previewSource, /'clarify_incident_time'/);
  assert.match(previewSource, /CHAT_NON_MUTATING_TOOLS = new Set<string>\(\['ask_for_case_data', 'clarify_datum_time', 'clarify_incident_time'\]\)/);
});

test('alur konversi format Basarnas disebut pada aturan A.1', () => {
  assert.match(routeSource, /aplikasi mengonversi otomatis ke format Basarnas MMDD\.HHMM/);
});
