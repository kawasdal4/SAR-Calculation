/* Uji cetak PDF lembar plotting (A3/A4 Landscape) dengan preferCSSPageSize. */
const { chromium } = require('playwright');

const CASES = [
  { name: 'ups_a3', url: 'http://localhost:3000/?printTarget=ups-plotter&printPaper=a3&printTab=ups' },
  { name: 'ups_a4', url: 'http://localhost:3000/?printTarget=ups-plotter&printPaper=a4&printTab=ups' },
  { name: 'mobo_awa_a3', url: 'http://localhost:3000/?printTarget=mobo-awa&printPaper=a3&printTab=awa' },
  { name: 'mobo_awa_a4', url: 'http://localhost:3000/?printTarget=mobo-awa&printPaper=a4&printTab=awa' },
  { name: 'mobo_asw_a3', url: 'http://localhost:3000/?printTarget=mobo-asw&printPaper=a3&printTab=asw' },
  { name: 'adwups_a3', url: 'http://localhost:3000/?printTarget=adw-ups&printPaper=a3&printTab=ups' },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  for (const c of CASES) {
    await page.goto(c.url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const portal = await page.evaluate(() => !!document.querySelector('.portal-print-sheet'));
    const scope = await page.evaluate(() => document.documentElement.dataset.printScope || null);
    await page.pdf({
      path: `/tmp/render/print_${c.name}.pdf`,
      preferCSSPageSize: true,
      printBackground: true,
    });
    console.log(`${c.name}: portal=${portal} scope=${scope}`);
  }
  await browser.close();
})();
