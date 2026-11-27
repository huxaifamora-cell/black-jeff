// Short rank names for Telegram member tags. A tag is 0-16 characters and cannot hold emoji, so the longest rank names are shortened.
// Keep the ladders equal to BASE_RANKS / BRANCHES in web/rank.js (same order, same length: Recruit, then 19 ranks per service).
export const BASE_TAGS = ['Recruit'];
export const BRANCH_TAGS = {
  army: ['Private', 'Lance Corporal', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Warrant Officer', 'Master WO', 'Army WO', 'Second Lt', 'Lieutenant', 'Captain', 'Major', 'Lt Colonel', 'Colonel', 'Brigadier Gen', 'Major General', 'Lt General', 'General', 'Field Marshal'],
  navy: ['Seaman', 'Able Seaman', 'Leading Seaman', 'Petty Officer', 'Chief PO', 'Warrant Officer', 'Master WO', 'Navy WO', 'Midshipman', 'Sub-Lieutenant', 'Lieutenant', 'Lt Commander', 'Commander', 'Captain', 'Commodore', 'Rear Admiral', 'Vice Admiral', 'Admiral', 'Fleet Admiral'],
  air: ['Airman', 'Lance Corporal', 'Corporal', 'Sergeant', 'Flight Sergeant', 'Warrant Officer', 'Master WO', 'Air WO', 'Pilot Officer', 'Flying Officer', 'Flight Lt', 'Squadron Leader', 'Wing Commander', 'Group Captain', 'Air Commodore', 'Air Vice-Marshal', 'Air Marshal', 'Air Chf Marshal', 'Marshal of AF'],
};

// i = rank position (0 = Recruit), branch = army / navy / air / null. Someone with no service yet is on the Army ladder (only Recruit is possible then).
// Returns the tag, or null when the pair is not a real rank (so a forged request changes nothing).
export function rankTag(branch, i) {
  if (!Number.isInteger(i) || i < 0) return null;
  if (branch != null && !BRANCH_TAGS[branch]) return null;
  const ladder = BASE_TAGS.concat(BRANCH_TAGS[branch || 'army']);
  return i < ladder.length ? ladder[i] : null;
}
