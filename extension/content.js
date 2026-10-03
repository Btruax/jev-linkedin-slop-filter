// Watches the LinkedIn or X feed, sends unseen posts to the local Jev proxy,
// and either stamps the ones that come back as slop or kills them outright.

const ENDPOINT = 'http://127.0.0.1:8787/judge';
const BATCH_SIZE = 8;
const BATCH_DELAY_MS = 350;
const MIN_TEXT_LENGTH = 40;
const MAX_TEXT_LENGTH = 3000;
// Below this a post is not really on screen. Brave's ad blocker hides
// promoted posts with display:none and leaves a 2px wrapper behind; judging
// those costs a Jev call and centres a stamp on the gap between two posts.
const MIN_RENDERED_HEIGHT = 40;

// Scored with textContent (cheap, no reflow); the winner is re-read with
// innerText because the line breaks are a slop signal in their own right.
const TEXT_CANDIDATES = 'p, span[dir], div[dir], div, span';
const WRAPPER_RATIO = 0.95;

/**
 * Returns the post body. Any element holding ~all of the container's text is a
 * wrapper, not the body, so the body is the longest block strictly below that.
 */
const readLongestBlock = (post) => {
  const total = (post.textContent ?? '').trim().length;
  if (total < MIN_TEXT_LENGTH) return '';

  const ceiling = total * WRAPPER_RATIO;
  let best = null;
  let bestLength = 0;

  for (const node of post.querySelectorAll(TEXT_CANDIDATES)) {
    const length = (node.textContent ?? '').trim().length;
    if (length > bestLength && length < ceiling) {
      bestLength = length;
      best = node;
    }
  }

  return ((best ?? post).innerText ?? '').trim();
};

const ADAPTERS = {
  linkedin: {
    // LinkedIn hashes every class name and rotates them each build, so the only
    // durable hook is the componentkey, which still carries the feed type.
    selectors: [
      '[componentkey*="FeedType_MAIN_FEED"]',
      'div.feed-shared-update-v2',            // older layout, harmless if absent
      'div[data-id^="urn:li:activity"]',
    ],
    readText: readLongestBlock,
    idFor: (post) => post.getAttribute('componentkey'),
    rootMargin: '400px 0px',
  },
  x: {
    // X keeps stable data-testid hooks. The first tweetText is the post itself;
    // a second one belongs to a quoted tweet and is ignored.
    selectors: ['article[data-testid="tweet"]'],
    readText: (post) =>
      (post.querySelector('[data-testid="tweetText"]')?.innerText ?? '').trim(),
    idFor: (post) => post.querySelector('a[href*="/status/"] time')?.closest('a')?.getAttribute('href'),
    // X scrolls fast. Judge well ahead of the viewport so a killed post is
    // gone before it arrives.
    rootMargin: '1200px 0px',
  },
};

const PLATFORM = /(^|\.)(x|twitter)\.com$/.test(location.hostname) ? 'x' : 'linkedin';
const adapter = ADAPTERS[PLATFORM];

// Post state lives in a data attribute, not a class. X is React, and React
// rewrites an element's whole className on re-render, which silently undid
// kills (the bar stayed, the post came back). It leaves unknown attributes alone.
const setState = (post, state) => {
  if (state) post.dataset.slop = state;
  else delete post.dataset.slop;
};

const seen = new WeakSet();
const queue = [];
const pending = new Map();
let counterEl = null;
let stampedCount = 0;
let killedCount = 0;
let timer = null;
let nextId = 0;

const settings = { enabled: true, mode: 'stamp' };

const isRendered = (post) => post.getBoundingClientRect().height >= MIN_RENDERED_HEIGHT;

const readText = (post) => {
  const text = adapter.readText(post);
  return text.length >= MIN_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : '';
};

const renderCounter = () => {
  if (!counterEl) {
    counterEl = document.createElement('div');
    counterEl.className = 'slop-counter';
    document.body.appendChild(counterEl);
  }
  counterEl.textContent =
    killedCount > 0 ? `${stampedCount} stamped · ${killedCount} killed` : `${stampedCount} stamped`;
};

const metaFor = (result) =>
  result.source === 'local' ? 'rule' : `jev ${(result.score ?? 0).toFixed(2)}`;

const stamp = (post, result) => {
  const word = result.label ?? 'Slop';

  const mark = document.createElement('div');
  mark.className = 'slop-stamp';
  mark.dataset.label = word.toLowerCase();

  const wordEl = document.createElement('span');
  wordEl.className = 'slop-word';
  wordEl.textContent = word;

  const metaEl = document.createElement('span');
  metaEl.className = 'slop-meta';
  metaEl.textContent = metaFor(result);

  mark.append(wordEl, metaEl);
  // Fit the word to the card and give each stamp its own tilt, so a feed of
  // them looks hand-stamped rather than CSS-generated.
  const width = post.clientWidth || 480;
  const tilt = -14 + Math.random() * 9;
  const size = Math.min(76, Math.max(22, (width * 0.74) / (word.length * 0.68)));
  mark.style.setProperty('--stamp-size', `${Math.round(size)}px`);
  mark.style.setProperty('--stamp-tilt', `${tilt}deg`);

  setState(post, 'stamped');
  post.appendChild(mark);

  // Rotation widens the footprint, so the estimate above can still overhang the
  // card. Measure the untransformed box and shrink once to fit.
  const radians = Math.abs(tilt) * (Math.PI / 180);
  const footprint =
    mark.offsetWidth * Math.cos(radians) + mark.offsetHeight * Math.sin(radians);
  const limit = width * 0.8;
  if (footprint > limit) {
    mark.style.setProperty('--stamp-size', `${Math.round((size * limit) / footprint)}px`);
  }

  stampedCount += 1;
  renderCounter();
};

/**
 * Collapses the post to a one-line bar. The post stays in the DOM so "show"
 * can bring it back, and so the feed's own virtualisation is not disturbed.
 */
const kill = (post, result) => {
  const bar = document.createElement('div');
  bar.className = 'slop-killbar';
  bar.dataset.label = (result.label ?? 'Slop').toLowerCase();

  const text = document.createElement('span');
  text.textContent = `Killed · ${result.label ?? 'Slop'} · ${metaFor(result)}`;

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'show';
  // Clicks inside a post navigate on X, so keep this one to ourselves.
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    bar.remove();
    setState(post, null);
    killedCount -= 1;
    stamp(post, result);
  });

  bar.append(text, button);
  setState(post, 'killed');
  post.prepend(bar);

  killedCount += 1;
  renderCounter();
};

const apply = (results) => {
  for (const result of results) {
    const post = pending.get(result.id);
    pending.delete(result.id);
    if (!post?.isConnected) continue;
    setState(post, null);
    // Hidden since it was queued (an ad blocker got to it): nothing to mark.
    if (result.verdict !== 'hide' || !isRendered(post)) continue;
    if (settings.mode === 'kill' && result.kill) kill(post, result);
    else stamp(post, result);
  }
};

const flush = async () => {
  timer = null;
  const batch = queue.splice(0, BATCH_SIZE);
  if (batch.length === 0) return;

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: PLATFORM,
        posts: batch.map(({ id, text }) => ({ id, text })),
      }),
    });
    if (!response.ok) throw new Error(`proxy ${response.status}`);
    const { results } = await response.json();
    apply(results);
  } catch (error) {
    // Fail open: leave every post visible and stop pulsing it.
    console.warn('[slop-filter] proxy unreachable —', error.message);
    for (const { id } of batch) {
      const post = pending.get(id);
      if (post) setState(post, null);
      pending.delete(id);
    }
  }

  if (queue.length > 0) schedule();
};

const schedule = () => {
  if (timer !== null) return;
  timer = setTimeout(flush, BATCH_DELAY_MS);
};

const enqueue = (post) => {
  if (seen.has(post) || !settings.enabled) return;
  // Not marked seen, so the next DOM change re-observes it in case it renders.
  if (!isRendered(post)) return;
  const text = readText(post);
  if (text.length < MIN_TEXT_LENGTH) return;

  seen.add(post);
  // The same post can render twice on X (timeline + a reply chain), so ids
  // are made unique per element even when the post id repeats.
  const id = `${adapter.idFor(post) ?? 'p'}#${nextId++}`;
  pending.set(id, post);
  setState(post, 'pending');
  queue.push({ id, text });
  schedule();
};

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      enqueue(entry.target);
    }
  },
  { rootMargin: adapter.rootMargin }
);

/**
 * LinkedIn nests two FeedType_MAIN_FEED containers per post, so a naive
 * querySelectorAll judges (and bills) every post twice. Keep only the
 * outermost match of each nest.
 */
const outermost = (nodes) =>
  nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));

const scan = () => {
  const found = new Set();
  for (const selector of adapter.selectors) {
    for (const post of document.querySelectorAll(selector)) found.add(post);
  }
  for (const post of outermost([...found])) {
    if (!seen.has(post)) observer.observe(post);
  }
};

// Mode changes apply to the next post judged; no reload needed.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.mode) settings.mode = changes.mode.newValue;
});

chrome.storage.sync.get({ enabled: true, mode: 'stamp' }, (stored) => {
  settings.enabled = stored.enabled;
  settings.mode = stored.mode;
  if (!settings.enabled) return;
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  renderCounter();
});
