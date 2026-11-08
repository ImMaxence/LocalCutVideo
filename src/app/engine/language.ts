/**
 * Choice of the spoken language in automatic mode. Whisper's language token mostly hears the
 * accent: English spoken with a strong French accent comes out "French", and Whisper then
 * translates everything. So the guess is checked by writing an extract in the likely languages
 * and keeping the one Whisper is really confident in.
 */

/** Advance (in average log-probability) another language needs to replace the guess. */
const SWITCH_MARGIN = 0.3;
/** Probability from which the runner-up is worth checking. */
const RUNNER_UP_MIN = 0.1;

/** Probabilities of several samples averaged, most likely language first. */
export function rankLanguages(samples: Record<string, number>[]): [string, number][] {
  const sums = new Map<string, number>();
  for (const sample of samples) for (const [code, p] of Object.entries(sample)) sums.set(code, (sums.get(code) ?? 0) + p);
  return [...sums.entries()].map(([code, sum]): [string, number] => [code, sum / samples.length]).sort((a, b) => b[1] - a[1]);
}

/** Languages to compare with the guess: English (the usual language spoken with an accent) and the runner-up. */
export function languagesToCheck(ranked: [string, number][]): string[] {
  const [first, second] = ranked;
  if (!first) return [];
  const others = new Set<string>();
  if (first[0] !== 'en') others.add('en');
  if (second && second[1] >= RUNNER_UP_MIN) others.add(second[0]);
  return [...others];
}

/** The guess, unless another language was written with clearly more confidence. */
export function settleLanguage(guess: string, confidence: Record<string, number>): string {
  let best = guess;
  let bestScore = (confidence[guess] ?? -Infinity) + SWITCH_MARGIN;
  for (const [code, score] of Object.entries(confidence)) {
    if (code !== guess && score > bestScore) {
      best = code;
      bestScore = score;
    }
  }
  return best;
}
