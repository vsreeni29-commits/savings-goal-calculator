/**
 * End-to-end smoke test.
 *
 * Drives the built app in a real browser at phone size and walks the journey a
 * first-time user takes: setup, dashboard, adding a second goal, logging money,
 * and the what-if sliders. It asserts on the numbers the app puts on screen,
 * not just that pages render — a projection that silently returns nonsense
 * would still "load fine".
 *
 *   node tools/smoke.mjs [--headed] [--shots]
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, 'screenshots');
const wantShots = process.argv.includes('--shots');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
};

function serve(port) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path = join(DIST, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
    if (!existsSync(path) || path.endsWith('/')) path = join(DIST, 'index.html');
    try {
      const body = await readFile(path);
      res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

let failures = 0;
let checks = 0;

function check(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function shot(page, name) {
  if (!wantShots) return;
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

async function main() {
  const port = 4319;
  const server = await serve(port);
  const browser = await chromium.launch({
    headless: !process.argv.includes('--headed'),
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  });

  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-IN',
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  const money = (text) => Number(String(text).replace(/[^0-9.]/g, '')) || 0;

  try {
    console.log('\nOnboarding');
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=Know the date');
    check('welcome screen renders', await page.isVisible('text=Know the date'));
    await shot(page, '01-welcome');

    await page.click('button:has-text("Continue")');
    await page.waitForSelector('text=Which currency?');
    check('currency step reached', await page.isVisible('text=Which currency?'));

    await page.click('button:has-text("Continue")');
    await page.waitForSelector('text=lands in your account');
    check('income step blocks an empty amount', await page.isDisabled('button:has-text("Continue")'));

    await page.fill('.amount-input input', '100000');
    await page.click('button:has-text("Continue")');
    await page.waitForSelector('text=And what goes out?');

    await page.fill('.amount-input input', '60000');
    await page.waitForSelector('text=spare a month');
    check(
      'spare cash is computed live during setup',
      (await page.textContent('.notice__title'))?.includes('40,000'),
      await page.textContent('.notice__title'),
    );
    await shot(page, '02-spending');

    await page.click('button:has-text("Continue")');
    await page.waitForSelector('text=What are you saving for?');
    await page.fill('input[placeholder="House deposit"]', 'House deposit');
    const amounts = page.locator('.amount-input input');
    await amounts.nth(0).fill('2400000');
    await page.click('button:has-text("See my plan")');

    console.log('\nDashboard');
    await page.waitForSelector('.hero__value');
    const finish = await page.textContent('.hero__value');
    // 24,00,000 at 40,000 a month is 60 months — five years out.
    check('headline finish date is computed', /\b20\d\d\b/.test(finish ?? ''), finish ?? '');
    const note = await page.textContent('.hero__note');
    check('headline says how far away it is', /5 years/.test(note ?? ''), note ?? '');
    check('per-month figure is right', /40,000/.test(note ?? ''), note ?? '');
    await shot(page, '03-dashboard');

    console.log('\nTimescale switching');
    await page.click('.segmented__item:has-text("Day")');
    const dayNote = await page.textContent('.hero__note');
    // 40,000 a month is about 1,314 a day.
    const perDay = money((dayNote ?? '').match(/₹[\d,]+/)?.[0]);
    check('daily figure is a sane conversion', perDay > 1200 && perDay < 1400, String(perDay));

    await page.click('.segmented__item:has-text("Year")');
    const yearNote = await page.textContent('.hero__note');
    check('yearly figure is twelve months', /4,80,000|480,000/.test(yearNote ?? ''), yearNote ?? '');
    await page.click('.segmented__item:has-text("Month")');

    console.log('\nAdding a second goal');
    await page.click('.tabbar__item:has-text("Goals")');
    await page.waitForSelector('text=The order here decides');
    await page.click('button:has-text("＋ Add a goal")');
    await page.waitForSelector('.sheet__title:has-text("New goal")');
    await page.fill('input[placeholder="House deposit"]', 'Japan trip');
    await page.locator('.sheet .amount-input input').nth(0).fill('300000');
    await page.click('.sheet__foot button:has-text("Add goal")');
    await page.waitForSelector('text=Japan trip');
    check('second goal appears', await page.isVisible('text=Japan trip'));

    const goalCards = await page.locator('.goal-card').count();
    check('both goals are listed', goalCards === 2, `found ${goalCards}`);

    // Priority order drives funding: the house deposit is first, so the trip
    // should be getting nothing yet.
    const trip = page.locator('.goal-card', { hasText: 'Japan trip' });
    const tripPerMonth = money(await trip.locator('.goal-card__foot .num').textContent());
    check('lower-priority goal waits its turn', tripPerMonth === 0, String(tripPerMonth));

    await page.locator('.goal-card', { hasText: 'Japan trip' }).getByLabel('Move Japan trip up').click();
    await page.waitForTimeout(120);
    const tripAfter = money(
      await page.locator('.goal-card', { hasText: 'Japan trip' }).locator('.goal-card__foot .num').textContent(),
    );
    check('promoting a goal funds it immediately', tripAfter === 40000, String(tripAfter));
    await shot(page, '04-goals');

    console.log('\nMoney and debt');
    await page.click('.tabbar__item:has-text("Money")');
    await page.waitForSelector('text=The honest version');
    await page.click('.segmented__item:has-text("Debt")');
    await page.click('button:has-text("＋ Add")');
    await page.waitForSelector('.sheet__title:has-text("Add debt")');
    await page.fill('.sheet input[placeholder="Credit card"]', 'HDFC card');
    await page.locator('.sheet .amount-input input').nth(0).fill('50000');
    await page.locator('.sheet .amount-input input').nth(1).fill('2500');
    const advice = await page.textContent('.sheet .notice__title');
    check('payoff advice is shown while typing', /a month clears this in a year/.test(advice ?? ''), advice ?? '');
    await page.click('.sheet__foot button:has-text("Save")');
    await page.waitForSelector('text=HDFC card');
    check('debt is saved', await page.isVisible('text=HDFC card'));
    await shot(page, '05-money');

    console.log('\nExpenses that end with a goal');
    // The loan-preclosure case: tie the living-costs expense to a goal and the
    // plan should say what finishing that goal frees up.
    await page.click('.tabbar__item:has-text("Money")');
    await page.click('.segmented__item:has-text("Spending")');
    await page.click('text=Monthly living costs');
    await page.waitForSelector('.sheet__title:has-text("Edit expense")');
    await page.click('.sheet [role="switch"]:near(:text("This stops when a goal is reached"))');
    await page.waitForSelector('text=Which goal ends it');
    await page.selectOption('.sheet select >> nth=-1', { label: '🎯 House deposit' });
    await page.click('.sheet__foot button:has-text("Save")');
    await page.waitForSelector('.toast:has-text("Expense updated")');
    check('the link is shown on the expense', await page.isVisible('text=ends with a goal'));

    await page.click('.tabbar__item:has-text("Goals")');
    const frees = page.locator('.goal-card', { hasText: 'House deposit' }).locator('text=/Frees/');
    check('the goal says what it frees up', await frees.isVisible());
    check(
      'the freed amount matches the expense',
      /60,000/.test((await frees.textContent()) ?? ''),
      (await frees.textContent()) ?? '',
    );

    console.log('\nForecast');
    await page.click('.tabbar__item:has-text("Forecast")');
    await page.waitForSelector('text=Monthly saving over time');
    const capacity = await page.textContent('.hero__value');
    check('the forecast shows a monthly figure', /₹/.test(capacity ?? ''), capacity ?? '');
    check(
      'the capacity chart steps up when the expense stops',
      /→/.test(capacity ?? ''),
      capacity ?? '',
    );

    // The house deposit is the goal the living-costs expense was tied to, so
    // its milestone is the one that should mention a payment stopping.
    const milestone = await page
      .locator('.milestone', { hasText: 'House deposit' })
      .textContent();
    check(
      'the linked goal explains what it frees',
      /a month of payments stops/.test(milestone ?? ''),
      (milestone ?? '').slice(0, 110),
    );
    const tripMilestone = await page
      .locator('.milestone', { hasText: 'Japan trip' })
      .textContent();
    check(
      'a goal with nothing tied to it does not claim to free a payment',
      !/payments stops/.test(tripMilestone ?? ''),
      (tripMilestone ?? '').slice(0, 110),
    );
    check('the schedule table renders', (await page.locator('.table tbody tr').count()) > 0);

    await page.click('.segmented__item:has-text("Yearly")');
    await page.waitForTimeout(150);
    check('the yearly view renders', (await page.locator('.table tbody tr').count()) > 0);

    const [csv] = await Promise.all([
      page.waitForEvent('download'),
      page.click('button:has-text("Everything in one file")'),
    ]);
    const csvPath = await csv.path();
    const csvBody = csvPath ? await readFile(csvPath, 'utf8') : '';
    check('the report downloads', csv.suggestedFilename().endsWith('.csv'), csv.suggestedFilename());
    check(
      'the report carries all three tables',
      csvBody.includes('MILESTONES') && csvBody.includes('YEAR BY YEAR') && csvBody.includes('MONTH BY MONTH'),
      `${csvBody.length} bytes`,
    );
    check(
      'the report has a column for the goal',
      csvBody.includes('House deposit (INR)'),
      csvBody.split('\r\n').find((l) => l.includes('Month #'))?.slice(0, 80) ?? '',
    );

    console.log('\nTracking');
    await page.click('.tabbar__item:has-text("Track")');
    await page.waitForSelector('text=What you actually did');
    await page.click('button:has-text("＋ Deposit")');
    await page.waitForSelector('.sheet__title:has-text("Log a deposit")');
    await page.locator('.sheet .amount-input input').first().fill('15000');
    await page.click('.sheet__foot button:has-text("Log it")');
    await page.waitForSelector('.toast');
    check('deposit is confirmed', (await page.textContent('.toast'))?.includes('Deposit logged'));

    // A logged deposit moves the goal's balance, so deleting one has to move
    // it back — otherwise a mistyped amount is stuck in the plan for good.
    await page.click('.tabbar__item:has-text("Goals")');
    const meta = () =>
      page.locator('.goal-card', { hasText: 'House deposit' }).locator('.goal-card__meta').textContent();

    const savedBefore = await meta();
    check('the deposit landed on the goal', /15K/.test(savedBefore ?? ''), savedBefore ?? '');

    await page.locator('.goal-card', { hasText: 'House deposit' }).getByText('Details').click();
    await page.waitForSelector('text=Recent deposits');
    await page.locator('.sheet button[aria-label^="Delete the deposit"]').first().click();
    await page.waitForSelector('.toast:has-text("Deposit removed")');
    await page.click('.sheet__head button[aria-label="Close"]');
    await page.waitForTimeout(150);

    const savedAfter = await meta();
    check(
      'deleting a deposit takes it back off the goal',
      /^₹0\s+of/.test((savedAfter ?? '').trim()),
      `${savedBefore} → ${savedAfter}`,
    );

    await page.click('.tabbar__item:has-text("Track")');
    await page.click('button:has-text("＋ Spending")');
    await page.waitForSelector('.sheet__title:has-text("Log spending")');
    await page.locator('.sheet .amount-input input').first().fill('850');
    await page.click('.sheet__foot button:has-text("Log it")');
    await page.waitForSelector('text=Recent spending');
    check('spending appears in the log', await page.isVisible('text=Recent spending'));
    check('calendar heatmap renders', (await page.locator('.heatmap__day').count()) > 0);
    await shot(page, '06-track');

    console.log('\nWhat-if');
    await page.click('.tabbar__item:has-text("What if")');
    await page.waitForSelector('text=Move the sliders');
    const baseFinish = await page.textContent('.hero__value');

    const cutSlider = page.locator('input[aria-label="Spending cut"]');
    await cutSlider.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(el, '50');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(200);
    const cutFinish = await page.textContent('.hero__value');
    check('cutting spending moves the finish date', cutFinish !== baseFinish, `${baseFinish} → ${cutFinish}`);
    check('the change is described as sooner', await page.isVisible('text=sooner'));
    await shot(page, '07-whatif');

    console.log('\nPersistence');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.tabbar');
    await page.click('.tabbar__item:has-text("Goals")');
    await page.waitForSelector('text=Japan trip');
    check('data survives a reload', await page.isVisible('text=Japan trip'));

    console.log('\nLayout');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check('nothing pushes the page sideways', overflow <= 0, `${overflow}px of overflow`);

    const tapTargets = await page.evaluate(() => {
      const small = [];
      for (const el of document.querySelectorAll('button')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.height < 32) small.push(el.className || el.textContent);
      }
      return small;
    });
    check('tap targets are big enough', tapTargets.length === 0, tapTargets.join(', '));

    console.log('\nLight theme');
    await page.click('.tabbar__item:has-text("Home")');
    await page.click('button[aria-label="Settings"]');
    await page.waitForSelector('text=Everything stays on this device');
    await page.click('.segmented__item:has-text("Light")');
    await page.waitForTimeout(150);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('light theme repaints the background', bg !== 'rgb(8, 11, 20)', bg);
    await shot(page, '08-settings-light');
    await page.click('.segmented__item:has-text("Dark")');

    check('no console errors along the way', consoleErrors.length === 0, consoleErrors.join(' | '));
  } catch (error) {
    failures += 1;
    console.log(`\n  ✗ walkthrough threw: ${error?.message ?? error}`);
    await shot(page, 'failure');
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
