import { describe, expect, it } from 'vitest';
import { Projection, ScoredProjection } from '../models/projection.model';
import { ScoutPlayer } from '../services/player-scout.service';
import {
  changeOf,
  changeSortKey,
  changeValue,
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

describe('rankScout, position-adjusted', () => {
  // A league of two teams, each starting one centre and two defencemen: four defencemen start to
  // two centres, so the fifth defenceman's 30 is the level, against the third centre's 80.
  const lineup = {
    slots: { c: 1, lw: 0, rw: 0, w: 0, f: 0, d: 2, g: 0, util: 0, bn: 0 },
    teams: 2,
  };
  const centre = (id: number, now: number, then: number) =>
    player(skaterLine(id, now), skaterLine(id, then), {});
  const at = (positions: string[], scout: ScoutPlayer): ScoutPlayer => ({
    ...scout,
    freeAgent: { ...scout.freeAgent, positions },
  });
  const players = [
    at(['C'], centre(1, 100, 100)),
    at(['C'], centre(2, 90, 90)),
    at(['C'], centre(3, 80, 80)),
    // On the day he was the fifth defenceman, the level himself.
    at(['D'], player(skaterLine(11, 50), skaterLine(11, 30))),
    at(['D'], player(skaterLine(12, 45), skaterLine(12, 45))),
    at(['D'], player(skaterLine(13, 40), skaterLine(13, 40))),
    at(['D'], player(skaterLine(14, 35), skaterLine(14, 35))),
    at(['D'], player(skaterLine(15, 30), skaterLine(15, 32))),
  ];

  const rows = rankScout(players, byValue, fantasyPoints, lineup);
  const ids = rows.map((row) => row.player.playerId);

  it('ranks by the score over his position’s replacement, the score’s order breaking a tie', () => {
    // 1 and 11 are both 20 over; 12 is 15 over, ahead of the second centre's 10.
    expect(ids.slice(0, 4)).toEqual(['1', '11', '12', '2']);
    expect(rows.map((row) => row.rank).slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(rows[1].adjusted).toBeCloseTo(20, 9);
    expect(rows[1].positionRank).toBe('D1');
  });

  it('keeps the score and its change the score’s', () => {
    expect(rows[1].score).toBe(50);
    expect(rows[1].delta).toBe(20);
  });

  it("ranks the day's line by its own levels, so the rise reads the adjusted places", () => {
    // On the day the defencemen ran 45, 40, 35, 32, 30: 30 was the level, so 11 was last.
    expect(rows[1].thenRank).toBe(8);
    expect(rows[1].rise).toBe(6);
  });

  it('ranks by the score alone without a lineup', () => {
    const plain = rankScout(players, byValue, fantasyPoints);
    expect(plain.map((row) => row.player.playerId).slice(0, 4)).toEqual(['1', '2', '3', '11']);
    expect(plain[0].adjusted).toBeNull();
    expect(plain[0].positionRank).toBeNull();
  });

  it('sorts a position-adjusted list by the score when asked, not taking it for the ranked order', () => {
    const sorted = sortScout(rows, SCOUT_RANKED_ORDER);
    expect(sorted.map((row) => row.player.playerId).slice(0, 4)).toEqual(['1', '2', '3', '11']);
  });

  it('sorts by the adjusted figure under its own key', () => {
    const sorted = sortScout(rows, { key: 'adjusted', descending: false });
    expect(sorted[0].adjusted).toBeLessThanOrEqual(sorted[sorted.length - 1].adjusted ?? 0);
    expect(nextScoutSort(SCOUT_RANKED_ORDER, 'adjusted')).toEqual({
      key: 'adjusted',
      descending: true,
    });
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

  it("sorts by a figure's change since the day, the biggest first, a player with no then-line last", () => {
    // Points went 30 (none), 20 from 10, 10 from 30, 5 from 40: up 10, down 20, down 35.
    expect(rows.map((row) => changeValue(row, 'points'))).toEqual([null, 10, -20, -35]);
    expect(ids(sortScout(rows, { key: 'change:points', descending: true }))).toEqual([
      '2',
      '3',
      '4',
      '1',
    ]);
    expect(ids(sortScout(rows, { key: 'change:points', descending: false }))).toEqual([
      '4',
      '3',
      '2',
      '1',
    ]);
  });

  it("reads a figure's change as the cell writes it: games, ice time, and fewer goals against as a gain", () => {
    const [skater] = rankScout(
      [player(skaterLine(1, 30, 72, 1100), skaterLine(1, 30, 70, 1000))],
      byValue,
      fantasyPoints,
    );
    expect(changeValue(skater, 'games')).toEqual(2);
    expect(changeValue(skater, 'toi')).toEqual(100);
    // A category the day's line was not projected in says nothing.
    expect(changeValue(skater, 'hits')).toBeNull();

    const goalieWith = (ga: number): Projection => ({
      type: 'goalie',
      playerId: 2,
      stats: { scoring: { w: 20, ga } as never, utility: { gp: 40 } },
    });
    const [goalie] = rankScout(
      [player(goalieWith(120), goalieWith(130), { thenProjected: new Set(['w', 'ga']) })],
      byValue,
      fantasyPoints,
    );
    // Ten goals fewer against is a change for the better: positive, so it sorts as a gain.
    expect(changeValue(goalie, 'ga')).toEqual(10);
    expect(changeValue(goalie, 'toi')).toBeNull();
  });

  it("sorts by his projection less the drop's as by his projection, under its own key", () => {
    expect(ids(sortScout(rows, { key: 'scoreGain', descending: true }))).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(ids(sortScout(rows, { key: 'scoreGain', descending: false }))).toEqual([
      '4',
      '3',
      '2',
      '1',
    ]);
  });

  it('names the figure a change key is the change of', () => {
    expect(changeSortKey('goals')).toEqual('change:goals');
    expect(changeOf('change:goals')).toEqual('goals');
    expect(changeOf('change:toi')).toEqual('toi');
    expect(changeOf('goals')).toBeNull();
    expect(changeOf('delta')).toBeNull();
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
    expect(nextScoutSort(rise, 'scoreGain')).toEqual({ key: 'scoreGain', descending: true });
    expect(nextScoutSort(rise, 'change:sog')).toEqual({ key: 'change:sog', descending: true });
    expect(nextScoutSort({ key: 'change:sog', descending: true }, 'change:sog')).toEqual({
      key: 'change:sog',
      descending: false,
    });
  });

  it('opens every other column best first, from the rise too', () => {
    const rise = { key: 'rise', descending: false } as const;
    expect(nextScoutSort(rise, 'score')).toEqual({ key: 'score', descending: true });
    expect(nextScoutSort(rise, 'name')).toEqual({ key: 'name', descending: false });
    expect(nextScoutSort(rise, 'goals')).toEqual({ key: 'goals', descending: true });
  });
});
