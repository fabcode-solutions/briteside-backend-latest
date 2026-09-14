// Category bitmask — a domain can belong to more than one category at once.
export const CATEGORY = Object.freeze({
  ADULT: 1 << 0,
  GAMBLING: 1 << 1,
  MALWARE: 1 << 2,
  PHISHING: 1 << 3,
  DRUGS: 1 << 4,
  PIRACY: 1 << 5,
  SCAM: 1 << 6,
  OTHER: 1 << 7,
});

const CATEGORY_ENTRIES = Object.entries(CATEGORY);

export function addCategory(bitmask, category) {
  return (bitmask || 0) | category;
}

export function categoryNamesFromBitmask(bitmask) {
  if (!bitmask) return [];
  return CATEGORY_ENTRIES.filter(([, bit]) => (bitmask & bit) === bit).map(([name]) => name);
}
