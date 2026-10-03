// Local rules run before Jev. Cheap, deterministic, and they catch the
// obvious cases so we only pay for the genuinely uncertain ones.

const RULES = {
  linkedin: {
    bait: [
      'agree?', 'thoughts?', 'what do you think?', "that's the post",
      'repost if', '♻️', 'save this post', 'let that sink in',
      'unpopular opinion', 'here\'s what i learned', 'your move',
      'comment below', 'drop a', 'who else', 'am i the only one',
    ],
    promo: [
      'we are excited to announce', 'we are thrilled', 'proud to announce',
      'delighted to share', 'magic quadrant', 'great place to work',
      'testament to our', 'our greatest asset', 'we are hiring',
    ],
    promoLabel: 'Corp',
    // LinkedIn padding makes a short, plain post a reliable "fine".
    maxSafeLength: 180,
    minShortLines: 4,
  },
  x: {
    bait: [
      'a thread', '🧵', "here's why", 'here’s why', '👇', 'let that sink in',
      'bookmark this', 'bookmark for later', 'follow me for', 'like and repost',
      'retweet if', 'repost if', 'unpopular opinion', 'most people don',
      'nobody talks about', 'who else', 'agree?', 'thoughts?',
    ],
    promo: [
      'link in bio', 'link in my bio', 'dm me "', 'comment "', 'free guide',
      'giveaway', 'airdrop', 'presale', 'use code', 'join my newsletter',
      'join 10,000', 'sign up now',
    ],
    promoLabel: 'Shill',
    // Tweets are short by design, so length alone says little. Only skip
    // posts too short to carry a formula at all.
    maxSafeLength: 60,
    minShortLines: 3,
  },
};

const countShortLines = (text) =>
  text.split('\n').filter((line) => {
    const t = line.trim();
    return t.length > 0 && t.length < 60;
  }).length;

const hits = (text, phrases) =>
  phrases.filter((p) => text.includes(p)).length;

/**
 * Returns a verdict without calling Jev when the answer is obvious,
 * or null when the post needs a real judgment. Rule verdicts need two
 * independent hits, so they are trusted enough to kill.
 */
export const prefilter = (rawText, platformName = 'linkedin') => {
  const rules = RULES[platformName] ?? RULES.linkedin;
  const text = rawText.toLowerCase();
  const baitHits = hits(text, rules.bait);
  const promoHits = hits(text, rules.promo);
  const shortLines = countShortLines(rawText);

  if (baitHits >= 2 && shortLines >= rules.minShortLines) {
    return { verdict: 'hide', kill: true, label: 'Bait', reason: 'engagement_bait', source: 'local' };
  }
  if (promoHits >= 2) {
    return { verdict: 'hide', kill: true, label: rules.promoLabel, reason: 'promo', source: 'local' };
  }
  if (rawText.length < rules.maxSafeLength && baitHits === 0 && promoHits === 0 && shortLines <= 2) {
    return { verdict: 'show', kill: false, reason: 'short_and_plain', source: 'local' };
  }
  return null;
};
