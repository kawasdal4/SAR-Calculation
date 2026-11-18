/* Diagnosis layout portal cetak dengan emulasi media print. */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  for (const target of ['mobo-awa&printTab=awa', 'ups-plotter&printTab=ups']) {
    await page.goto(`http://localhost:3000/?printTarget=${target}&printPaper=a3`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => {
      const portal = document.querySelector('.portal-print-sheet');
      const svg = portal?.querySelector('svg');
      const cell = svg?.parentElement;
      const row = cell?.parentElement;
      const r = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) };
      };
      const cs = svg ? getComputedStyle(svg) : null;
      return {
        root: r(portal),
        row: r(row),
        cell: r(cell),
        svg: r(svg),
        display: cs?.display,
        width: cs?.width,
        height: cs?.height,
        bodyScrollH: document.body.scrollHeight,
        pageH: window.innerHeight,
      };
    });
    console.log(target.split('&')[0], JSON.stringify(info));
    await page.emulateMedia({ media: null });
  }
  await browser.close();
})();
