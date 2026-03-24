/**
 * Fun copy and engagement helpers to maximize user delight.
 */

/** Network error codes that indicate backend unreachable. */
const NETWORK_ERROR_CODES = new Set([
  'ERR_NETWORK', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
  'ECONNABORTED', 'ENETUNREACH', 'EAI_AGAIN',
]);

/** Returns true if the error indicates backend unreachable (connection refused, timeout, etc.). */
export function isNetworkError(error: any): boolean {
  if (!error) return false;
  if (NETWORK_ERROR_CODES.has(error?.code)) return true;
  const msg = typeof error?.message === 'string' ? error.message : '';
  return msg === 'Network Error' || /timeout|exceeded|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(msg);
}

/**
 * Get a user-facing message from an API/axios error. Avoids showing "unknown" or empty.
 */
export function getErrorMessage(
  error: any,
  fallback: string = 'Something went wrong. Please try again.'
): string {
  if (error?.response?.data?.error && typeof error.response.data.error === 'string') {
    const msg = error.response.data.error;
    const hint = error?.response?.data?.hint;
    return hint ? `${msg}\n\n${hint}` : msg;
  }
  const errors = error?.response?.data?.errors;
  if (Array.isArray(errors) && errors[0]?.msg) {
    return errors[0].msg;
  }
  const msg = error?.message || error?.error;
  if (typeof msg === 'string' && msg.trim() && !/^unknown\s*error$/i.test(msg.trim())) {
    return msg.trim();
  }
  if (isNetworkError(error)) {
    if (error?.code === 'ECONNABORTED' || /timeout|exceeded/i.test(typeof error?.message === 'string' ? error.message : '')) {
      return 'Request timed out. Start the backend: run "npm run start:backend" from the Ploop folder. Ensure EXPO_PUBLIC_PLOOP_API_URL in .env points to your Mac (e.g. http://192.168.0.2:8082 for physical devices).';
    }
    return 'Cannot reach backend. Start it with "npm run start:backend" from Ploop. Check EXPO_PUBLIC_PLOOP_API_URL in .env (use localhost:8082 for iOS Simulator).';
  }
  if (error?.response?.status === 401) return 'Please sign in again.';
  if (error?.response?.status === 403) return 'You don’t have permission to do that.';
  if (error?.response?.status === 404) return 'Not found.';
  if (error?.response?.status >= 500) return 'Server error. Please try again later.';
  return fallback;
}

const REVIEW_SUCCESS_MESSAGES = [
  "You're on a roll! 🎉",
  "Another one in the books! 📖",
  "The community thanks you! 🙌",
  "Nice flush! 💪",
  "You just made someone's day better. 🌟",
  "Legendary move. 🏆",
  "Ploop approved! ✅",
  "Your wisdom has been recorded. 📝",
];

const FIRST_REVIEW_MESSAGES = [
  "First review — you're officially a Ploop contributor! 🎊",
  "Welcome to the club! First of many. 🚀",
];

const ADD_TOILET_MESSAGES = [
  "You're a hero! Someone will thank you for this. 🏆",
  "New spot on the map — the community says thanks! 🙌",
  "Ploop approved! Your contribution is live. ✅",
  "Legendary. You just saved someone from a bad moment. 💪",
  "Added! One less mystery bathroom in the world. 🎉",
];

export function getReviewSuccessMessage(reviewCount: number): string {
  if (reviewCount <= 1) {
    return FIRST_REVIEW_MESSAGES[Math.floor(Math.random() * FIRST_REVIEW_MESSAGES.length)];
  }
  return REVIEW_SUCCESS_MESSAGES[Math.floor(Math.random() * REVIEW_SUCCESS_MESSAGES.length)];
}

export function getAddToiletSuccessMessage(): string {
  return ADD_TOILET_MESSAGES[Math.floor(Math.random() * ADD_TOILET_MESSAGES.length)];
}

export async function hapticSuccess(): Promise<void> {
  try {
    const { impactAsync, ImpactFeedbackStyle } = await import('expo-haptics');
    await impactAsync(ImpactFeedbackStyle.Medium);
  } catch {
    // ignore on web or unsupported
  }
}

export async function hapticLight(): Promise<void> {
  try {
    const { impactAsync, ImpactFeedbackStyle } = await import('expo-haptics');
    await impactAsync(ImpactFeedbackStyle.Light);
  } catch {
    // ignore
  }
}

/** Light haptic for button taps to make the app feel responsive. */
export async function hapticButton(): Promise<void> {
  return hapticLight();
}

// ─── Loading messages (fun copy) ────────────────────────────────────────────

const LOADING_MESSAGES: Array<{ emoji: string; text: string }> = [
  { emoji: '🚽', text: 'Finding the nearest throne…' },
  { emoji: '🌀', text: 'Searching for relief…' },
  { emoji: '📍', text: 'Almost there…' },
  { emoji: '✨', text: 'Locating porcelain gods…' },
  { emoji: '🧭', text: 'Zeroing in on bathrooms…' },
  { emoji: '🔍', text: 'Scanning for options…' },
  { emoji: '⏳', text: 'Hang tight…' },
  { emoji: '🛎️', text: 'Fetching the details…' },
  { emoji: '🌈', text: 'One sec…' },
  { emoji: '🎯', text: 'Pinpointing your position…' },
];

const LOCATION_LOADING_MESSAGES: Array<{ emoji: string; text: string }> = [
  { emoji: '📍', text: 'Getting your coordinates…' },
  { emoji: '🧭', text: 'Pinpointing your position…' },
  { emoji: '🌍', text: 'Zeroing in…' },
  { emoji: '📡', text: 'Finding you…' },
];

export type LoadingContext = 'toilets' | 'location' | 'details' | 'generic';

export function getLoadingMessage(context: LoadingContext = 'generic'): { emoji: string; text: string } {
  const pool = context === 'location' ? LOCATION_LOADING_MESSAGES : LOADING_MESSAGES;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Bathroom trivia (facts) ────────────────────────────────────────────────

const BATHROOM_TRIVIA = [
  'The average person spends 92 days of their life on the toilet.',
  "Thomas Crapper didn't invent the toilet, but he popularized it in Victorian England.",
  'Japan has an estimated 5.5 million public toilets.',
  'The first flushing toilet was in Crete around 3,000 years ago.',
  'Singapore has toilets with a cleanliness grading system.',
  '"Loo" may come from "Waterloo," a London street with many toilets.',
  'A modern toilet uses about 1.6 gallons per flush.',
  'The toilet seat was invented in 1885.',
  'The International Space Station has a $19 million toilet.',
  'October 19 is World Toilet Day.',
  'The Romans had public toilets with 20+ seats in a row.',
  'Medieval castles had garderobes — toilets that dropped straight into the moat.',
];

export function getRandomTrivia(): string {
  return BATHROOM_TRIVIA[Math.floor(Math.random() * BATHROOM_TRIVIA.length)];
}

// ─── Toilet trivia quiz (multiple choice) ────────────────────────────────────

export interface TriviaQuestion {
  question: string;
  options: string[];
  correctIndex: number;
}

const TOILET_TRIVIA_QUESTIONS: TriviaQuestion[] = [
  { question: 'How many days does the average person spend on the toilet in their lifetime?', options: ['46 days', '92 days', '180 days', '365 days'], correctIndex: 1 },
  { question: "Who popularized the flush toilet in Victorian England (but didn't invent it)?", options: ['Thomas Crapper', 'Alexander Cummings', 'John Harington', 'Joseph Bramah'], correctIndex: 0 },
  { question: 'When is World Toilet Day?', options: ['March 22', 'October 19', 'November 19', 'December 15'], correctIndex: 2 },
  { question: 'Approximately how many gallons does a modern toilet use per flush?', options: ['0.5', '1.6', '3.0', '5.0'], correctIndex: 1 },
  { question: 'When was the toilet seat invented?', options: ['1785', '1855', '1885', '1925'], correctIndex: 2 },
  { question: 'What did the Romans call their public toilets?', options: ['Latrines', 'Garderobes', 'Foricas', 'Both A and C'], correctIndex: 3 },
  { question: "What's the estimated cost of the ISS toilet?", options: ['$1.9M', '$19M', '$190M', '$1.9B'], correctIndex: 1 },
  { question: "Where does 'loo' likely come from?", options: ['French "lieu"', 'London Waterloo street', 'Latin "lavare"', 'Unknown'], correctIndex: 1 },
  { question: 'Japan has roughly how many public toilets?', options: ['550K', '1.5M', '5.5M', '15M'], correctIndex: 2 },
  { question: 'Where were the first flushing toilets found?', options: ['Ancient Rome', 'Egypt', 'Crete', 'China'], correctIndex: 2 },
  { question: 'Medieval castle toilets that dropped into the moat were called?', options: ['Latrines', 'Garderobes', 'Privies', 'All of the above'], correctIndex: 1 },
  { question: 'Which country has a cleanliness grading system for toilets?', options: ['Japan', 'Singapore', 'South Korea', 'All of the above'], correctIndex: 1 },
];

export function getRandomTriviaQuestion(): TriviaQuestion {
  return TOILET_TRIVIA_QUESTIONS[Math.floor(Math.random() * TOILET_TRIVIA_QUESTIONS.length)];
}

export function getTriviaQuestionExcluding(seen: Set<number>): { question: TriviaQuestion; index: number } | null {
  const available = TOILET_TRIVIA_QUESTIONS
    .map((q, i) => ({ question: q, index: i }))
    .filter(({ index }) => !seen.has(index));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// ─── Health tips (gut health & toilet hygiene) ────────────────────────────────

const HEALTH_TAGLINES = [
  'Staying hydrated helps keep things moving—aim for 8 glasses a day.',
  'Sitting too long on the toilet can strain blood vessels—keep it under 10 minutes.',
  'Fiber from fruits and veggies supports regular, healthy digestion.',
  'Washing hands for 20 seconds helps prevent the spread of germs.',
  'Squatting or using a footstool can make bowel movements easier.',
  "Don't rush—taking your time reduces strain and supports gut health.",
  'Probiotics in yogurt and fermented foods support a healthy gut.',
  'Always flush with the lid down to reduce spray and bacteria spread.',
];

export function getOxymoronicTagline(): string {
  return HEALTH_TAGLINES[Math.floor(Math.random() * HEALTH_TAGLINES.length)];
}

// ─── Emoji tap messages (Start screen) ───────────────────────────────────────

const EMOJI_TAP_MESSAGES: Record<number, string> = {
  5: "You're eager. We like it.",
  8: 'Almost there…',
  10: "Okay, we're ready when you are.",
  15: 'Still here? 🚽',
  20: "You've tapped 20 times. Legend.",
};

export function getEmojiTapMessage(tapCount: number): string | null {
  return EMOJI_TAP_MESSAGES[tapCount] ?? null;
}
