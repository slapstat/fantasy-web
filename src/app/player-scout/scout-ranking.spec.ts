import { describe, expect, it } from 'vitest';
import { Projection, ScoredProjection } from '../models/projection.model';
import { ScoutPlayer } from '../services/player-scout.service';
import {
  isRising,
  nextScoutSort,
  rankScout,
  SCOUT_MOVERS_ORDER,
  SCOUT_RANKED_ORDER,
  sortScout,
  statOf,
  toiPerGame,
} from './scout-ranking';

function skaterLine(playerId: number, points: number, games = 70, toi = 1000, ppp = 5): Projection {
  return {
    type: 'skater',
    playerId,
    stats: {
      scoring: { points, ppp } as never,
      utility: { gp: games, toiPerGame: toi },
    },
  };
}

function goalieLine(playerId: number, wins: number): Projection {
  return {
    type: 'goalie',
    playerId,
    stats: { scoring: { w: wins } as never, utility: { gp: 40 } },
  };
}

export function player(
  now: Projection,
  then: Projection | null,
  extra: Partial<ScoutPlayer> = {},
): ScoutPlayer {
  return {
    freeAgent: {
      projection: now,
      playerId: String(now.playerId),
      name: `Player ${now.playerId}`,
      positions: [now.type === 'skater' ? 'D' : 'G'],
      availability: 'FREE_AGENT',
      clubGames: now.stats.utility.gp,
      expectedGames: now.stats.utility.gp,
      projected: new Set(['points']),
    },
    nhlId: 8400000 + now.playerId,
    type: now.type,
    owner: null,
    then,
    thenProjected: new Set(then ? ['points'] : []),
    ...extra,
  };
}

/** Ranks by the one number each line carries, best first, as the engine ranks by a league. */
function byValue(projections: Projection[]): ScoredProjection[] {
  const value = (projection: Projection) =>
    projection.type === 'skater'
      ? projection.stats.scoring.points
      : (projection.stats.scoring as { w: number }).w;
  return projections
    .map((projection) => ({
      projection,
      score: { fantasyPoints: value(projection), zScore: value(projection) / 10 } as never,
      qualified: true,
    }))
    .sort((first, second) => value(second.projection) - value(first.projection));
}

const fantasyPoints = (entry: ScoredProjection) => entry.score.fantasyPoints;

describe('isRising', () => {
  it('takes a climb to the top of the league for a rise', () => {
    expect(isRising(12, 30)).toBe(true);
  });

  it('takes first from eighth for a rise, though the top has little room to climb', () => {
    expect(isRising(1, 8)).toBe(true);
  });

  it('takes a small climb low on the list for noise', () => {
    expect(isRising(100, 115)).toBe(false);
  });

  it('wants his place at least halved, and at least five places', () => {
    expect(isRising(20, 39)).toBe(false);
    expect(isRising(20, 40)).toBe(true);
    expect(isRising(2, 6)).toBe(false);
    expect(isRising(2, 7)).toBe(true);
  });

  it('says nothing of a player with no line on the day', () => {
    expect(isRising(1, null)).toBe(false);
  });
});

describe('rankScout', () => {
  // Fifteen depth skaters the model liked on the day and still does, then one who has taken a top
  // role since, a rookie it had no line for, and a goalie it has cooled on.
  const steady = Array.from({ length: 15 }, (_, index) =>
    player(skaterLine(index + 1, 40 - index), skaterLine(index + 1, 40 - index)),
  );
  const montour = player(skaterLine(99, 60, 70, 1380), skaterLine(99, 20, 70, 1050), {
    owner: { teamName: 'Slapshots', mine: true },
  });
  const rookie = player(skaterLine(77, 39.5), null);
  const goalie = player(goalieLine(50, 20), goalieLine(50, 25));

  const rows = rankScout([...steady, montour, rookie, goalie], byValue, fantasyPoints);

  it('ranks skaters and goalies in one list, on the rest of the season, whoever holds them', () => {
    expect(rows).toHaveLength(18);
    expect(rows[0].player.playerId).toBe('99');
    expect(rows[0].rank).toBe(1);
    expect(rows[0].score).toBe(60);
    expect(rows[0].scout.owner?.mine).toBe(true);
  });

  it("places and scores each player on the day's line among the same players", () => {
    // On the day's lines Montour's 20 is last of the seventeen that have one, the goalie too.
    expect(rows[0].thenRank).toBe(17);
    expect(rows[0].thenScore).toBe(20);
    expect(rows[0].delta).toBe(40);
    expect(rows[0].rise).toBe(16);
    expect(rows[0].rising).toBe(true);
  });

  it('leaves a player the model had no line for on the day unranked there, not risen', () => {
    const row = rows.find((candidate) => candidate.player.playerId === '77');
    expect(row?.thenRank).toBeNull();
    expect(row?.thenScore).toBeNull();
    expect(row?.delta).toBeNull();
    expect(row?.rise).toBeNull();
    expect(row?.rising).toBe(false);
  });

  it('reads a player the model has not moved on as unmoved in score, pushed down in places', () => {
    const row = rows.find((candidate) => candidate.player.playerId === '3');
    expect(row?.delta).toBe(0);
    // Montour and the rookie climbed past him: two places lost without the model moving on him.
    expect(row?.rise).toBe(-2);
    expect(row?.rising).toBe(false);
  });

  it('places a goalie among the skaters by his score, and reads his fall', () => {
    const row = rows.find((candidate) => candidate.player.playerId === '50');
    // His 20 wins now are below every skater; his 25 on the day were above Montour's 20.
    expect([row?.rank, row?.thenRank, row?.rise, row?.delta]).toEqual([18, 16, -2, -5]);
  });
});

describe('what a line reads', () => {
  it('reads a skater ice time a game, and none for a goalie', () => {
    expect(toiPerGame(skaterLine(1, 10, 70, 1380))).toBe(1380);
    expect(toiPerGame(goalieLine(2, 10))).toBeUndefined();
    expect(toiPerGame(null)).toBeUndefined();
  });

  it('reads a stat off a line, and nothing off none', () => {
    expect(statOf(skaterLine(1, 10, 70, 1380, 7), 'ppp')).toBe(7);
    expect(statOf(skaterLine(1, 10), 'hits')).toBeNull();
    expect(statOf(null, 'points')).toBeNull();
  });
});

describe('sorting the scout list', () => {
  // Ranked 1 to 4 now; on the day's lines 4 was first, 3 second and 2 third, 1 had none.
  const rows = rankScout(
    [
      player(skaterLine(1, 30), null),
      player(skaterLine(2, 20), skaterLine(2, 10)),
      player(skaterLine(3, 10), skaterLine(3, 30)),
      player(skaterLine(4, 5), skaterLine(4, 40)),
    ],
    byValue,
    fantasyPoints,
  );
  const ids = (sorted: readonly { player: { playerId: string } }[]) =>
    sorted.map((row) => row.player.playerId);

  it('leaves the ranked order as it came', () => {
    expect(sortScout(rows, SCOUT_RANKED_ORDER)).toBe(rows);
  });

  it('sorts by the change in score, the biggest gain first, a player with no then-line last', () => {
    expect(rows.map((row) => row.delta)).toEqual([null, 10, -20, -35]);
    expect(ids(sortScout(rows, SCOUT_MOVERS_ORDER))).toEqual(['2', '3', '4', '1']);
    expect(ids(sortScout(rows, { key: 'delta', descending: false }))).toEqual(['4', '3', '2', '1']);
  });

  it('sorts by the rise, the furthest risen first, a player with no then-line last', () => {
    expect(rows.map((row) => row.rise)).toEqual([null, 1, -1, -3]);
    expect(ids(sortScout(rows, { key: 'rise', descending: true }))).toEqual(['2', '3', '4', '1']);
    expect(ids(sortScout(rows, { key: 'rise', descending: false }))).toEqual(['4', '3', '2', '1']);
  });

  it('sorts by the gain against the chosen drop, the biggest first, a pickup it could not price last', () => {
    const gains = new Map<string, number | null>([
      ['1', -4],
      ['2', 12.5],
      ['3', null],
      ['4', 30],
    ]);

    expect(ids(sortScout(rows, { key: 'gain', descending: true }, gains))).toEqual([
      '4',
      '2',
      '1',
      '3',
    ]);
    expect(ids(sortScout(rows, { key: 'gain', descending: false }, gains))).toEqual([
      '1',
      '2',
      '4',
      '3',
    ]);
    // Without any gains handed in, the column says nothing: the ranked order stands.
    expect(ids(sortScout(rows, { key: 'gain', descending: true }))).toEqual(['1', '2', '3', '4']);
  });

  it('sorts the other columns as the planner does', () => {
    expect(ids(sortScout(rows, { key: 'score', descending: false }))).toEqual(['4', '3', '2', '1']);
    expect(ids(sortScout(rows, { key: 'name', descending: true }))).toEqual(['4', '3', '2', '1']);
  });

  it("opens the scout's own columns at the biggest move, and turns them round on a second press", () => {
    const rise = nextScoutSort(SCOUT_RANKED_ORDER, 'rise');
    expect(rise).toEqual({ key: 'rise', descending: true });
    expect(nextScoutSort(rise, 'rise')).toEqual({ key: 'rise', descending: false });
    expect(nextScoutSort(rise, 'delta')).toEqual({ key: 'delta', descending: true });
    expect(nextScoutSort(rise, 'gain')).toEqual({ key: 'gain', descending: true });
  });

  it('opens every other column best first, from the rise too', () => {
    const rise = { key: 'rise', descending: false } as const;
    expect(nextScoutSort(rise, 'score')).toEqual({ key: 'score', descending: true });
    expect(nextScoutSort(rise, 'name')).toEqual({ key: 'name', descending: false });
    expect(nextScoutSort(rise, 'goals')).toEqual({ key: 'goals', descending: true });
  });
});
