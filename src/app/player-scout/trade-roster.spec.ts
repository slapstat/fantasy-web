import { Projection } from '../models/projection.model';
import { ScoutOwner, ScoutPlayer } from '../services/player-scout.service';
import { ScoutRow } from './scout-ranking';
import { otherRosters, teamPlayerOf, tradeable } from './trade-roster';

const LINE: Projection = {
  type: 'skater',
  playerId: 1,
  stats: { scoring: { goals: 10, assists: 10 } as never, utility: { gp: 60, toiPerGame: 1000 } },
};

function row(
  playerId: string,
  owner: ScoutOwner | null,
  extra: Partial<Pick<ScoutPlayer, 'slot' | 'injuryStatus'>> = {},
): ScoutRow {
  return {
    player: {
      playerId,
      name: `Player ${playerId}`,
      teamAbbrev: 'NJ',
      positions: ['LW', 'RW'],
      availability: owner ? 'UNKNOWN' : 'FREE_AGENT',
    },
    line: LINE,
    score: 100,
    scout: { type: 'skater', owner, ...extra },
  } as unknown as ScoutRow;
}

const RIVALS: ScoutOwner = { teamName: 'Rivals', mine: false };
const OTHERS: ScoutOwner = { teamName: 'Others', mine: false };
const MINE: ScoutOwner = { teamName: 'Mine', mine: true };

describe('trade-roster', () => {
  it('reads a healthy player in a lineup slot as holding a spot and able to start', () => {
    const player = teamPlayerOf(row('1', RIVALS, { slot: 'LW' }));

    expect(player).toMatchObject({
      playerId: '1',
      positions: ['LW', 'RW'],
      reserve: false,
      out: false,
      reserveEligible: [],
      projection: LINE,
    });
  });

  it('reads injured reserve and not-active as no spot, and out, as the BFF does', () => {
    for (const slot of ['IR', 'ir+', 'IR-LT', 'NA']) {
      expect(teamPlayerOf(row('1', RIVALS, { slot }))).toMatchObject({ reserve: true, out: true });
    }
  });

  it('reads an out injury on the bench as out, and day-to-day as not', () => {
    expect(teamPlayerOf(row('1', RIVALS, { slot: 'BN', injuryStatus: 'O' }))).toMatchObject({
      reserve: false,
      out: true,
    });
    expect(teamPlayerOf(row('1', RIVALS, { slot: 'BN', injuryStatus: 'DTD' }))).toMatchObject({
      reserve: false,
      out: false,
    });
  });

  it("groups every other team's players by team, leaving out the user's and the available", () => {
    const rosters = otherRosters([
      row('1', RIVALS),
      row('2', OTHERS),
      row('3', RIVALS),
      row('4', MINE),
      row('5', null),
    ]);

    expect([...rosters.keys()].sort((a, b) => a.localeCompare(b))).toEqual(['Others', 'Rivals']);
    expect(rosters.get('Rivals')?.map((player) => player.playerId)).toEqual(['1', '3']);
  });

  it("takes only another team's player as a trade target", () => {
    expect(tradeable(row('1', RIVALS))).toBe(true);
    expect(tradeable(row('1', MINE))).toBe(false);
    expect(tradeable(row('1', null))).toBe(false);
  });
});
