# Slop Filter for LinkedIn and X

Judges every LinkedIn and X post as it scrolls into view and slams a rubber
stamp on it — **BAIT**, **CORP**, **BRAG**, **AI**, or **SHILL** — with the
confidence score printed on the stamp. The post stays readable underneath.

Turn on **Kill instead of stamp** in the popup and posts Jev is confident about
collapse to a one-line bar with a **show** button. Anything below the kill line
is still stamped.

Decisions come from [Jev](https://typesafe.ai), TypeSafe's System One model. It
returns a typed probability instead of text, so the extension branches on a
number rather than parsing prose.

![Jev stamping the LinkedIn feed live](docs/demo.gif)

## Run it

You need Node 20+, Chrome, and a TypeSafe API key from
[typesafe.ai](https://typesafe.ai).

```bash
git clone https://github.com/Btruax/jev-linkedin-slop-filter
cd jev-linkedin-slop-filter
cp .env.example .env          # then paste your key into it
cd server && npm start        # http://127.0.0.1:8787
```

Then in Chrome:

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick the `extension/` folder
4. Open [linkedin.com/feed](https://www.linkedin.com/feed/) or [x.com](https://x.com/home) and scroll

The popup shows how many posts were judged and whether the proxy is connected.

### Keep it running (macOS)

`npm start` stops when the terminal closes. To run the proxy all the time as a
launchd agent (starts at login, restarts if it crashes):

```bash
scripts/launchd.sh install     # also re-run after changing server/ or .env
scripts/launchd.sh status
scripts/launchd.sh uninstall
```

`install` copies `server/` and `.env` to `~/.slop-filter/` and runs it from
there, because macOS privacy protection often blocks background jobs from
reading `~/Documents`. Logs, including one line per flagged post, are in
`~/.slop-filter/logs/`.

## Why a local server

Anything bundled into a Chrome extension is readable by everyone who installs
it, so the API key lives in `server/` and never reaches the browser. That is
also why this is not on the Chrome Web Store: shipping it there means either
leaking a key or asking every user to paste their own.

## What it costs

Local keyword rules run first and settle the obvious cases for free. Only posts
that are genuinely ambiguous reach Jev, and results are cached per post, so
scrolling back up costs nothing.

## Stamp vs kill

Every signal is a Jev `noul` with two thresholds, in `server/jev.js`:

| Platform | Signal | Stamp | Kill | Label |
|---|---|---|---|---|
| LinkedIn | `is_corporate_slop` | 0.70 | 0.70 | CORP |
| LinkedIn | `is_slop` | 0.60 | 0.60 | BAIT / BRAG |
| LinkedIn | `is_ai_written` | 0.70 | 0.70 | AI |
| X | `is_promo` | 0.70 | 0.70 | SHILL |
| X | `is_slop` | 0.60 | 0.60 | BAIT |
| X | `is_ai_written` | 0.70 | 0.70 | AI |

Both platforms kill at the stamp line. A higher kill line (0.8-0.9) was tried
first: real feeds put most flagged posts at 0.6-0.8, so kill mode only ever
stamped them, and the stamp lines flag no genuine sample. The two thresholds
stay separate so kill can be raised again if a real post gets hidden. Local rule verdicts need two independent phrase hits,
so they kill too.

The server logs one line per flagged post (`[linkedin] kill  AI    0.85 ...`),
so thresholds can be checked against your real feed.

## Accuracy

Measured on 32 labelled samples (`test/samples/`), raw answers in
`test/results/`:

| Platform | Slop caught | Slop killed | Genuine stamped | Genuine killed | Batch latency |
|---|---|---|---|---|---|
| LinkedIn (14) | 8/8 | 8/8 | 0/4 | 0/4 | 763ms for 14 in parallel |
| X (18) | 10/10 | 10/10 | 0/6 | 0/6 | 474ms for 18 in parallel |

Highest score any genuine post got on any signal: 0.63 (`is_corporate_slop`
on a team-launch post, under its 0.70 stamp line). AI-written samples scored
0.72–0.90 on `is_ai_written`; genuine posts 0.07–0.20.

The samples are small and hand-written. Thresholds are fitted to the exact
question wording in `server/jev.js`. Change the wording and re-run before
trusting them:

```bash
cd server
npm test                          # offline: decision + prefilter rules
npm run calibrate                 # live: every sample through Jev
npm run calibrate -- x --cached   # re-apply thresholds to saved answers, free
```

`calibrate` exits non-zero if any genuine sample would be killed.

Jev's default 0.5 threshold underperforms on most tasks. Fit your own against
labelled data rather than inheriting these.

## Known limits

- **English only.** Jev is weaker in other languages and will need its own
  thresholds per locale.
- **Text only.** Image posts and video are judged on their caption or skipped.
- **No explanation.** Jev returns a score, never a reason. The stamp shows the
  number; it cannot tell you which sentence convicted the post.
- **LinkedIn will break this.** Every class name LinkedIn ships is hashed and
  rotates each build. The only durable hook is
  `[componentkey*="FeedType_MAIN_FEED"]`. If stamps stop appearing, that is the
  first thing to check.
- **X hooks are `data-testid`s.** `article[data-testid="tweet"]` and
  `[data-testid="tweetText"]`. More stable than LinkedIn's, but check them first
  if X stops getting judged.
- **X costs more.** Tweets are short, so the local "short and plain" skip only
  applies under 60 characters. Nearly every tweet you scroll past is one Jev
  call (cached after that).

## Failure behaviour

If the proxy is down or Jev errors, every post stays visible. A broken judgment
must never hide a real post.

## Preview the stamp without LinkedIn

```bash
python3 -m http.server 8899
open http://127.0.0.1:8899/test/stamp-preview.html
```

Slam runs 380ms: enters at 5.2x scale with motion blur, squashes to 0.84,
overshoots to 1.06, settles at a random tilt. A shock ring fires off the
bottom-out and the card recoils 150ms later. Transform and opacity only;
honours `prefers-reduced-motion`.

## Layout

```
extension/   Chrome MV3 extension (content script, popup, stamp CSS, icons)
scripts/     launchd.sh: run the proxy permanently on macOS
server/      Local proxy: holds the key, runs local rules, calls Jev
test/        Labelled samples, calibration runner, unit tests, stamp preview
```

MIT.
