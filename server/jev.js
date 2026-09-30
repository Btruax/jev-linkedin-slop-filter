// Jev client. Questions and thresholds here are the ones verified in test/.
// Do not change the instructions without re-running `npm test` — the
// thresholds below are fitted to this exact wording.

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';

// Wording shared by both platforms' AI-written check, so a tweak lands in both.
const AI_MARKERS =
  'Markers include: generic enthusiasm or agreement that could sit under any ' +
  'post, restating the obvious in polished language, "it is not X, it is Y" ' +
  'constructions, stacked em dashes, words like delve, game-changer, testament ' +
  'and unlock, and a tidy wrap-up with no specific detail from the author\'s ' +
  'own experience.';

/**
 * Each platform has its own questions and signals. A signal is one noul
 * question plus two thresholds: `stamp` marks the post, `kill` collapses it.
 * Kill sits higher than stamp because hiding a real post costs more than
 * stamping one. Signals are listed in stamp-label priority order.
 */
export const PLATFORMS = {
  linkedin: {
    stateKey: 'linkedin_post',
    questions: {
      is_slop: {
        type: 'noul',
        instructions:
          'This is a LinkedIn post. Is it low-value engagement-farming content ' +
          'written to a formula rather than to communicate something specific? ' +
          'Formulaic markers include: one-line paragraphs used for dramatic pacing, ' +
          'a manufactured hook, a generic life lesson, a numbered list of platitudes, ' +
          'and an explicit call to comment, repost or save.',
      },
      is_corporate_slop: {
        type: 'noul',
        instructions:
          'This is a LinkedIn post. Is it corporate or brand marketing content ' +
          'rather than a person speaking? Markers include: first-person plural on ' +
          'behalf of a company, award or milestone announcements, press-release ' +
          'phrasing, gratitude to the team and customers, and hashtag clusters.',
      },
      is_ai_written: {
        type: 'noul',
        instructions:
          'This is a LinkedIn post. Was it most likely produced by an AI model ' +
          'and posted with little human editing? ' + AI_MARKERS,
      },
      category: {
        type: 'choice',
        instructions: 'Classify what kind of LinkedIn post this is.',
        criteria: {
          engagement_bait:
            'Formulaic post engineered for reach; generic advice, fake vulnerability, ' +
            'or an explicit ask to comment/repost/save',
          humblebrag: 'Primarily announces the authors own success or status',
          genuine_update:
            'A specific, concrete update, experience, or piece of information from ' +
            'the authors actual work or life',
          job_or_notice: 'A job posting, event announcement, or practical notice',
        },
      },
    },
    signals: [
      { id: 'is_corporate_slop', label: 'Corp', stamp: 0.7, kill: 0.9 },
      { id: 'is_slop', label: 'Bait', stamp: 0.6, kill: 0.8 },
      { id: 'is_ai_written', label: 'AI', stamp: 0.7, kill: 0.9 },
    ],
  },

  x: {
    stateKey: 'x_post',
    questions: {
      is_slop: {
        type: 'noul',
        instructions:
          'This is a post on X (Twitter). Is it low-value engagement-farming ' +
          'content written to a formula rather than to communicate something ' +
          'specific? Formulaic markers include: a manufactured hook, a thread ' +
          'teaser such as "a thread" or "here is why" with a pointing emoji, a ' +
          'generic life or business lesson, a numbered list of platitudes, rage ' +
          'or ratio bait, and an explicit ask to like, repost, reply, follow or ' +
          'bookmark.',
      },
      is_promo: {
        type: 'noul',
        instructions:
          'This is a post on X (Twitter). Is it mainly selling or promoting ' +
          'something (a course, newsletter, crypto token, giveaway, paid ' +
          'community or product link) rather than a person saying something?',
      },
      is_ai_written: {
        type: 'noul',
        instructions:
          'This is a post on X (Twitter). Was it most likely produced by an AI ' +
          'model and posted with little human editing? ' + AI_MARKERS,
      },
    },
    signals: [
      { id: 'is_promo', label: 'Shill', stamp: 0.7, kill: 0.9 },
      { id: 'is_slop', label: 'Bait', stamp: 0.6, kill: 0.8 },
      { id: 'is_ai_written', label: 'AI', stamp: 0.7, kill: 0.9 },
    ],
  },
};

export const platformFor = (name) => PLATFORMS[name] ?? PLATFORMS.linkedin;

/**
 * Turns raw answers into a verdict. Kept separate from the HTTP call so the
 * test runner can re-apply thresholds without paying for new judgments.
 *
 * The stamp face comes from which judgment crossed its threshold, not from the
 * category. A corporate post can be categorised `genuine_update` and still be
 * brand marketing, which is why the category alone produced generic stamps.
 */
export const decide = (platform, answers) => {
  const scores = {};
  for (const { id } of platform.signals) scores[id] = answers[id].noul;

  const fired = platform.signals.filter((s) => scores[s.id] >= s.stamp);
  const category = answers.category?.choice ?? null;

  if (fired.length === 0) {
    return { verdict: 'show', kill: false, scores, reason: category, source: 'jev' };
  }

  let label = fired[0].label;
  if (label === 'Bait' && category === 'humblebrag') label = 'Brag';

  return {
    verdict: 'hide',
    kill: fired.some((s) => scores[s.id] >= s.kill),
    label,
    score: Math.max(...fired.map((s) => scores[s.id])),
    scores,
    reason: category,
    confidence: answers.category?.confidence ?? null,
    source: 'jev',
  };
};

export class JevError extends Error {}

export const ask = async (platform, postText, apiKey) => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      state: { [platform.stateKey]: postText },
      model: MODEL,
      questions: platform.questions,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new JevError(`Jev returned ${response.status}: ${body.slice(0, 200)}`);
  }

  const { answers } = await response.json();
  return answers;
};

export const judge = async (platformName, postText, apiKey) => {
  const platform = platformFor(platformName);
  return decide(platform, await ask(platform, postText, apiKey));
};
