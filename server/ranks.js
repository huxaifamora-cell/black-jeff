// Short rank names for Telegram member tags. A tag is 0-16 characters and cannot hold emoji, so the longest rank names are shortened.
// Keep the ladders equal to BASE_RANKS / BRANCHES in web/rank.js (same order, same length).
export const BASE_TAGS = ['Recruit', 'Private', 'Corporal', 'Sergeant', 'Lieutenant'];
export const BRANCH_TAGS = {
  army: ['Captain', 'Major', 'Lt Colonel', 'Colonel', 'Brigadier', 'Major General', 'Lt General', 'General', 'Field Marshal'],
  navy: ['Lt Commander', 'Commander', 'Captain', 'Commodore', 'Rear Admiral', 'Vice Admiral', 'Admiral', 'Fleet Admiral'],
  air: ['Flight Lt', 'Squadron Leader', 'Wing Commander', 'Group Captain', 'Air Commodore', 'Air Vice-Marshal', 'Air Marshal', 'Air Chf Marshal', 'Marshal of AF'],
};

// i = rank position (0 = Recruit), branch = army / navy / air / null. Someone above Lieutenant with no service yet is on the Army ladder.
// Returns the tag, or null when the pair is not a real rank (so a forged request changes nothing).
export function rankTag(branch, i) {
  if (!Number.isInteger(i) || i < 0) return null;
  if (branch != null && !BRANCH_TAGS[branch]) return null;
  const ladder = BASE_TAGS.concat(BRANCH_TAGS[branch || 'army']);
  return i < ladder.length ? ladder[i] : null;
}
