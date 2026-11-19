/* Uji end-to-end: plot manual di UPS lalu cetak via menu Cetak lembar (A3 & A4). */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:3000/?printTab=ups&printFreeze=1', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // Isi koordinat titik awal & plot
  const latInput = page.getByLabel('Koordinat lintang titik awal');
  const lngInput = page.getByLabel('Koordinat bujur titik awal');
  await latInput.fill("00°10'00\"S");
  await lngInput.fill("000°20'00\"E");
  await page.getByRole('button', { name: 'Plot Titik Awal' }).click();
  await page.waitForTimeout(400);

  // Leg 45° / 40 NM dari titik awal
  await page.getByLabel('Bearing °T').fill('30');
  await page.getByLabel('Jarak NM').fill('25');
  await page.getByRole('button', { name: 'Plot Leg / Titik Tujuan' }).click();
  await page.waitForTimeout(400);

  const points = await page.evaluate(() => document.body.innerText.match(/Titik \d/g)?.length ?? 0);
  console.log('titik terplot:', points);

  for (const paper of ['A3', 'A4']) {
    await page.getByRole('button', { name: 'Cetak lembar' }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: `${paper} LANDSCAPE` }).click();
    await page.waitForTimeout(900);
    const ok = await page.evaluate((p) => {
      const portal = !!document.querySelector('.portal-print-sheet');
      const cur = (document.documentElement.dataset.printPaper || '').toLowerCase();
      return portal && cur === p.toLowerCase();
    }, paper);
    console.log(`scope ${paper}:`, ok);
    await page.pdf({
      path: `/tmp/render/print_ups_vectors_${paper.toLowerCase()}.pdf`,
      preferCSSPageSize: true,
      printBackground: true,
    });
  }
  await browser.close();
  console.log('selesai');
})();
