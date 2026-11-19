/* Cetak PDF lembar plot dengan preferCSSPageSize (menghormati @page A3/A4). */
const { chromium } = require('playwright-core');

const EXEC = process.env.HOME + '/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome';
const BASE = 'http://localhost:3000';

async function gen(page, url, out) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
  console.log('saved', out);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: EXEC,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  // 1) MOBO AWA — A3 Landscape, muat contoh data setelah scope aktif
  await page.goto(BASE + '/?printTab=awa&printTarget=mobo-awa&printPaper=a3', { waitUntil: 'networkidle', timeout: 60000 });
  const contoh = page.getByRole('button', { name: 'Contoh', exact: true });
  if (await contoh.count()) { await contoh.first().click(); await page.waitForTimeout(1500); }
  await page.pdf({ path: '/tmp/pdf_mobo_awa_a3.pdf', preferCSSPageSize: true, printBackground: true });
  console.log('saved mobo-awa a3');

  // 2) MOBO ASW — A4 Landscape
  await page.goto(BASE + '/?printTab=asw&printTarget=mobo-asw&printPaper=a4', { waitUntil: 'networkidle', timeout: 60000 });
  const contoh2 = page.getByRole('button', { name: 'Muat Contoh Kasus' });
  if (await contoh2.count()) { await contoh2.first().click(); await page.waitForTimeout(1500); }
  await page.pdf({ path: '/tmp/pdf_mobo_asw_a4.pdf', preferCSSPageSize: true, printBackground: true });
  console.log('saved mobo-asw a4');

  // 3) UPS — A3 Landscape (default LKP)
  await gen(page, BASE + '/?printTab=ups&printTarget=ups-plotter&printPaper=a3', '/tmp/pdf_ups_a3.pdf');

  // 4) UPS — A4 Landscape
  await gen(page, BASE + '/?printTab=ups&printTarget=ups-plotter&printPaper=a4', '/tmp/pdf_ups_a4.pdf');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
