import { TeamPlayer } from '../services/player-scout.service';
import { ScoutRow } from './scout-ranking';

/** Slots that hold a player out of the lineup, on either platform: the BFF's `OUT_SLOTS`. */
const OUT_SLOTS = new Set(['IR', 'IR+', 'IR-LT', 'IR-NR', 'NA']);

/** Injury statuses that keep a player out, on either platform; day-to-day is not one. */
export const OUT_STATUSES: ReadonlySet<string> = new Set([
  'O',
  'IR',
  'IR-LT',
  'IR-NR',
  'NA',
  'SUSP',
  'OUT',
  'INJURY_RESERVE',
  'SUSPENSION',
]);

/** Whether the slot is injured reserve or not-active: one that takes no roster spot. */
function parked(slot: string | undefined): boolean {
  return slot !== undefined && OUT_SLOTS.has(slot.toUpperCase());
}

/**
 * Another team's player as the lineup weighs him, read off the league list: the same rules the
 * BFF applies to the user's own roster (`LeagueOwnTeam`), so both sides of a trade are priced
 * alike. Nobody on another team is offered a move to injured reserve: what their manager would do
 * with a free IR slot is not the user's to guess.
 */
export function teamPlayerOf(row: ScoutRow): TeamPlayer {
  const slot = row.scout.slot;
  const injury = row.scout.injuryStatus;
  const reserve = parked(slot);
  return {
    playerId: row.player.playerId,
    name: row.player.name,
    teamAbbrev: row.player.teamAbbrev,
    type: row.scout.type,
    positions: row.player.positions,
    injuryStatus: injury,
    slot,
    reserve,
    reserveEligible: [],
    out: reserve || (injury !== undefined && OUT_STATUSES.has(injury.toUpperCase())),
    projection: row.line,
  };
}

/** Every other team's roster, by the team's name, as the lineup weighs it. */
export function otherRosters(rows: readonly ScoutRow[]): ReadonlyMap<string, TeamPlayer[]> {
  const rosters = new Map<string, TeamPlayer[]>();
  for (const row of rows) {
    const owner = row.scout.owner;
    if (owner === null || owner.mine) {
      continue;
    }
    const roster = rosters.get(owner.teamName) ?? [];
    roster.push(teamPlayerOf(row));
    rosters.set(owner.teamName, roster);
  }
  return rosters;
}

/** Whether he is a trade target: held by a team in the league that is not the user's. */
export function tradeable(row: ScoutRow): boolean {
  return row.scout.owner !== null && !row.scout.owner.mine;
}
