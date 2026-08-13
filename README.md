# GoalVault — Savings Goal Calculator

Work out the **date** you actually hit your savings goals, given what you earn,
what you spend, and what you still owe on a card — then adjust anything and
watch the date move.

Runs on Android and iOS from one codebase, and installs from a browser as an
offline web app.

---

## Get it on your phone

### Android — install the APK

1. Open **[the latest release](../../releases/latest)** on your phone.
2. Tap the `GoalVault-*.apk` file.
3. Android asks whether to allow installs from your browser — say yes.
4. Open **GoalVault** from your app drawer.

The build is debug-signed for testing, so Play Protect shows a warning; choose
**Install anyway**. Installing a newer APK over the top upgrades in place and
keeps your data.

Every push builds a fresh APK. You can also grab one from the **Actions →
Build Android APK → Artifacts** if you would rather not use a release.

### iPhone, or Android without sideloading — install the web app

The web version needs GitHub Pages switched on once, and only a repository admin
can do that — a workflow is not allowed to. In **Settings → Pages → Build and
deployment**, set **Source** to **GitHub Actions**. The `Deploy web app`
workflow then publishes on every push, and tells you the URL. (Until then that
workflow finishes green and explains this in its summary; the APK is built by a
separate workflow and is unaffected.)

Once it is live, open the site on your phone and:

- **iPhone:** Share → *Add to Home Screen*
- **Android:** menu → *Install app*

It then behaves like an installed app, works with no signal, and stores
everything on the device.

> Publishing to the App Store needs a paid Apple Developer account and a Mac to
> archive the build. The `ios/` project here is ready for that — open
> `ios/App/App.xcworkspace` in Xcode and archive.

---

## What it does

**Tells you the date, not just the amount.** Give it your goals, income,
expenses and card balances and it simulates your money month by month until
every goal is funded, then puts the finishing date on the front screen.

**Handles several goals at once.** Goals compete for the same spare cash, so
the order matters. Goals with a deadline are funded first at exactly the amount
that deadline demands; whatever is left over is shared by the rule you pick:

| Rule | What it does |
| --- | --- |
| Top first | Pours everything into your highest-priority goal, then the next |
| Split | Shares it out, weighted by priority |
| Quick wins | Finishes whichever goal is closest to done |

**Knows that paying something off frees the money up.** An expense can be tied
to a goal, so it stops the month after that goal is funded. That is what makes a
loan preclosure work properly: the EMI is an expense, the lump sum you are
saving to clear it is a goal, and once you reach it the EMI stops and its money
is shared across everything else — the plan rebalances itself and every later
date moves in. Each goal shows what it unlocks.

**Takes debt seriously.** A credit card accrues interest, absorbs the spending
you charge to it, and takes its minimum payment before anything can be saved.
You choose how much spare cash goes at the debt above the minimums, and whether
to attack the most expensive balance (avalanche) or the smallest (snowball).
When a card's interest and spending outrun the payments, the app says so
instead of quietly projecting a fantasy.

**Shows the whole road ahead.** The Forecast screen turns the projection into
a timeline: a stepped chart of what you put into goals each month, a milestone
for every goal landing that says in plain words what it changes, and a schedule
you can read by month or by year. It is careful about one thing people conflate
— when a goal lands, the payments tied to it stopping is genuinely new money,
while the amount that goal was absorbing was already in the pool and is merely
freed for other goals. Adding those together would double count, so they are
always reported separately.

**Exports the numbers.** Download the forecast as CSV — milestones, year by
year, and month by month with a column per goal — and open it in Excel or
Sheets. On a phone this goes through the share sheet, so you can drop it into
Drive or mail it to yourself.

**Any timescale.** Every figure switches between per day, per week, per month
and per year with one tap — because "₹1,314 a day" lands differently to
"₹40,000 a month".

**Works backwards from a date.** Tell the What-if screen when you want
everything done and it computes what that takes: the amount per day or month,
and how much extra income or trimmed spending closes the gap.

**Keeps you honest.** Log deposits and spending to build a monthly streak, a
quiet-day streak, a spending heatmap and a set of milestones. Past months are
measured against the target you are working to now — stated plainly in the app,
because it does not keep a history of old plans.

---

## How the projection works

Each simulated month runs in a fixed order, chosen to match how a real month
behaves:

1. Cards accrue interest and absorb that month's card spending.
2. Minimum payments and cash expenses leave the bank account.
3. What remains is scaled by your savings factor.
4. Extra debt payments come off the top of that.
5. The rest is shared across goals — deadlines first, then by your chosen rule.
6. Goal balances earn their return, then the month's contribution lands.

The simulation runs one month past the last goal on purpose. Payments tied to
the final goal only stop the month after it lands, so without that trailing
month the plan would never show the state it ends in — what you are left free
to save once everything is funded.

Expenses tied to a goal that finished in an earlier month are dropped from step
2, which is what frees a precleared loan's EMI back into the pool. It is a month
behind on purpose: in the month a goal completes, that month's payment has
already left your account.

A few properties the code holds itself to, each pinned by a test:

- **Money is integer minor units everywhere.** No floating-point currency, and
  splitting a pot across goals uses the largest-remainder method, so totals
  reconcile to the cent.
- **The headline and the chart cannot disagree.** The cash-flow summary on the
  dashboard is asserted to equal what the simulation actually does in month one.
- **Nothing is allocated twice.** For every month, contributions plus
  unallocated money equal the budget exactly.
- **"Never" is a real answer.** A goal that cannot be funded says so rather than
  showing an invented date.

Everything stays on the device. There is no account, no server and no analytics.
Settings → Back up writes a JSON file you can restore on another phone.

---

## Working on it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 172 unit tests over the finance engine
npm run typecheck
npm run build
```

End-to-end walkthrough in a real browser at phone size:

```bash
npm install --no-save playwright && npx playwright install chromium
node tools/smoke.mjs --shots      # 39 checks; screenshots land in screenshots/
```

Native builds:

```bash
npm run cap:sync                  # build the web app and copy it into android/ and ios/
npm run android:apk               # needs the Android SDK; APK lands in android/app/build/outputs/apk/debug/
npm run android:open              # open in Android Studio
python3 tools/make-icons.py       # regenerate every app icon (needs Pillow)
```

### Layout

```
src/domain/     the finance engine — pure, framework-free, fully tested
  money.ts        integer-cent arithmetic and exact splitting
  dates.ts        month-index calendar maths in UTC
  finance.ts      time-value-of-money formulas
  engine.ts       the month-by-month projection
  scenario.ts     what-if overrides and the reverse solve
  forecast.ts     the forward timeline and the CSV reports
  tracking.ts     streaks, spending, milestones
  schema.ts       validation for stored and imported data
src/store/      zustand state, persisted to the device
src/components/ interface primitives and hand-rolled SVG charts
src/screens/    dashboard, goals, money, track, what-if, settings, onboarding
tools/          icon generator and the browser walkthrough
```

The domain layer has no React in it, which is what makes it testable without a
browser — and the reason a change to the maths is a change to one file.

---

Figures are estimates, not financial advice. Interest and return rates are
assumptions you set and can change.
