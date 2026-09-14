import { PROFANITY_WORDS } from '../../config/profanityWordList.js';

// Lets each letter repeat 1+ times (e.g. "fuck" -> /f+u+c+k+/) so elongated
// evasions like "fuuuuck" or "ffffuccckkk" still match, while \b...\b below
// still keeps the whole run anchored to a single word (no matching inside
// unrelated words like "class").
function buildElongatedPattern(word) {
  return word
    .split('')
    .map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '+')
    .join('');
}

/**
 * Scans text for known profanity words (Stream's reserved 'profanity'
 * blocklist) and replaces each match with asterisks of the same length.
 * Word-boundary, case-insensitive, tolerant of repeated letters. Non-matching
 * text returns matchedWords: [] and masked === original.
 * @returns {{ masked: string, matchedWords: string[] }}
 */
export function maskProfanity(text) {
  if (typeof text !== 'string' || !text) {
    return { masked: text, matchedWords: [] };
  }

  const matchedWords = [];
  let masked = text;

  for (const word of PROFANITY_WORDS) {
    const pattern = new RegExp(`\\b${buildElongatedPattern(word)}\\b`, 'gi');
    masked = masked.replace(pattern, match => {
      matchedWords.push(match.toLowerCase());
      return '*'.repeat(match.length);
    });
  }

  return { masked, matchedWords };
}
