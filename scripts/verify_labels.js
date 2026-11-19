/* Verifikasi visual label vektor: MOBO (AWA/ASW), UPS, peta + PDF cetak A3/A4.
   Jalankan saat dev server hidup. Output ke /tmp/verify_labels/. */
const { chromium } = require('playwright-core');
const fs = require('fs');

const EXEC = process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome';
const BASE = 'http://localhost:3000';
const OUT = '/tmp/verify_labels';

async function shoot(page, name, clip) {
  const path = `${OUT}/${name}.png`;
  if (clip) await page.screenshot({ path, clip });
  else await page.screenshot({ path, fullPage: true });
  console.log('shot', name);
}

async function pdfPage(page, url, out) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
  console.log('pdf', out);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: EXEC,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();

  // 1) AWA + MOBO dengan contoh data
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 90000 });
  await page.getByRole('tab', { name: '1. AWA + MoBo' }).click();
  await page.waitForTimeout(800);
  const contoh = page.getByRole('button', { name: 'Contoh', exact: true });
  if (await contoh.count()) { await contoh.first().click(); await page.waitForTimeout(1200); }
  // Screenshot area MOBO (svg papan manuver)
  const moboSvg = page.locator('svg[aria-label*="Maneuvering Board"]').first();
  await moboSvg.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const boxA = await moboSvg.boundingBox();
  if (boxA) await shoot(page, 'mobo_awa_screen', { x: Math.max(0, boxA.x - 10), y: Math.max(0, boxA.y - 10), width: boxA.width + 20, height: boxA.height + 20 });

  // 2) ASW + MOBO dengan contoh kasus
  await page.getByRole('tab', { name: '3. ASW + MoBo' }).click();
  await page.waitForTimeout(800);
  const contohKasus = page.getByRole('button', { name: /Muat Contoh Kasus/ });
  if (await contohKasus.count()) { await contohKasus.first().click(); await page.waitForTimeout(1500); }
  const moboSvg2 = page.locator('svg[aria-label*="Maneuvering Board"]').first();
  await moboSvg2.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const boxB = await moboSvg2.boundingBox();
  if (boxB) await shoot(page, 'mobo_asw_screen', { x: Math.max(0, boxB.x - 10), y: Math.max(0, boxB.y - 10), width: boxB.width + 20, height: boxB.height + 20 });

  // 3) Peta utama (panel kanan) — label garis dirotasi
  const mapEl = page.locator('.leaflet-container').first();
  await mapEl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  const boxM = await mapEl.boundingBox();
  if (boxM) await shoot(page, 'map_lines', { x: Math.max(0, boxM.x), y: Math.max(0, boxM.y), width: Math.min(boxM.width, 720), height: Math.min(boxM.height, 560) });

  // 4) UPS dengan titik & leg — label vektor dirotasi
  await page.getByRole('tab', { name: 'UPS Plotter' }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Plot Titik Awal' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('spinbutton', { name: 'Bearing °T' }).fill('45');
  await page.getByRole('spinbutton', { name: 'Jarak NM' }).fill('30');
  await page.getByRole('button', { name: 'Plot Leg / Titik Tujuan' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('spinbutton', { name: 'Bearing °T' }).fill('150');
  await page.getByRole('spinbutton', { name: 'Jarak NM' }).fill('45');
  await page.getByRole('button', { name: 'Plot Leg / Titik Tujuan' }).click();
  await page.waitForTimeout(600);
  const upsSvg = page.locator('svg[aria-label*="Universal Plotting Sheet"]').first();
  await upsSvg.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const boxU = await upsSvg.boundingBox();
  if (boxU) await shoot(page, 'ups_screen', { x: Math.max(0, boxU.x - 10), y: Math.max(0, boxU.y - 10), width: boxU.width + 20, height: boxU.height + 20 });

  // 5) PDF cetak: MOBO AWA A3, MOBO ASW A4, UPS A3 + A4 (dengan data contoh yang dimuat sebelum pdf)
  await pdfPage(page, BASE + '/?printTab=awa&printTarget=mobo-awa&printPaper=a3', `${OUT}/mobo_awa_a3.pdf`);
  // muat contoh AWA dulu agar vektor muncul di PDF
  // (printFreeze scope aktif; klik contoh setelah scope)
  await page.pdf({ path: `${OUT}/mobo_awa_a3_data.pdf`, preferCSSPageSize: true, printBackground: true });

  await pdfPage(page, BASE + '/?printTab=asw&printTarget=mobo-asw&printPaper=a4', `${OUT}/mobo_asw_a4.pdf`);
  await page.pdf({ path: `${OUT}/mobo_asw_a4_data.pdf`, preferCSSPageSize: true, printBackground: true });

  await pdfPage(page, BASE + '/?printTab=ups&printTarget=ups-plotter&printPaper=a3', `${OUT}/ups_a3.pdf`);
  await page.pdf({ path: `${OUT}/ups_a4.pdf`, preferCSSPageSize: true, printBackground: true });

  await browser.close();
  console.log('ALL DONE');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
