import { describe, expect, it } from 'vitest';
import { PlannerCrease } from '../api/models/planner-crease';
import { TeamSchedule } from '../api/models/team-schedule';
import {
  GOALIE_SCORING_STAT_KEYS,
  ScoringStatKey,
  SKATER_SCORING_STAT_KEYS,
} from '../models/stat-key.model';
import { FreeAgent } from '../services/streamer-planner-free-agents.service';
import { DropRoom, NightRoom } from './planner-lineup';
import {
  addShares,
  dropShare,
  formatGames,
  formatToi,
  filterByName,
  filterByPositions,
  lineColumns,
  lineStats,
  nextSort,
  LineShare,
  nightsShare,
  NO_LINE,
  projectedStarts,
  RANKED_ORDER,
  RankedFreeAgent,
  roomShare,
  scaledProjection,
  sortFreeAgents,
  startsProjection,
  teamsByKey,
  WHOLE_LINE,
  wholeGamesShare,
} from './planner-free-agents';

function scoringLine<K extends string>(keys: readonly K[], set: Record<string, number>) {
  return keys.reduce(
    (line, key) => ({ ...line, [key]: set[key] ?? 0 }),
    {} as Record<K, number>,
  ) as never;
}

function skater(
  name: string,
  positions: string[],
  team = 'EDM',
  stats: Record<string, number> = { goals: 2, assists: 3, shPct: 0.12 },
): FreeAgent {
  return {
    playerId: name,
    name,
    teamAbbrev: team,
    positions,
    availability: 'FREE_AGENT',
    clubGames: 4,
    expectedGames: 3.8,
    projected: new Set(Object.keys(stats)),
    projection: {
      type: 'skater',
      playerId: 1,
      stats: {
        scoring: scoringLine(SKATER_SCORING_STAT_KEYS, stats),
        utility: { gp: 3.8, toiPerGame: 1052 },
      },
    },
  };
}

function goalie(stats: Record<string, number>): FreeAgent {
  return {
    playerId: 'Goalie',
    name: 'Goalie',
    teamAbbrev: 'TB',
    positions: ['G'],
    availability: 'FREE_AGENT',
    clubGames: 3,
    expectedGames: 2,
    projected: new Set(Object.keys(stats)),
    projection: {
      type: 'goalie',
      playerId: 2,
      stats: { scoring: scoringLine(GOALIE_SCORING_STAT_KEYS, stats), utility: { gp: 2 } },
    },
  };
}

function ranked(player: FreeAgent, rank: number, line = player.projection): RankedFreeAgent {
  return { player, line, score: 10 - rank, rank, games: 3 };
}

const TEAMS: TeamSchedule[] = [
  {
    team: 'TBL',
    games: 3,
    offNightGames: 0,
    backToBacks: 0,
    homeGames: 0,
    skaterScore: 3,
    skaterRank: 1,
    goalieScore: 3,
    goalieRank: 1,
    schedule: ['2026-10-12', '2026-10-14', '2026-10-17'].map((date) => ({
      date,
      opponent: 'SJS',
      home: true,
      offNight: false,
      backToBack: false,
      opponentGoalsAgainst: 1,
      opponentGoalsFor: 1,
      skaterWorth: 1.036,
      goalieWorth: 1.0363,
      statWorth: {},
      plusMinusPerMinute: 0,
    })),
  },
];

describe('filterByName', () => {
  const rows = [
    ranked(skater('Juraj Slafkovský', ['LW']), 1),
    ranked(skater('Jack Hughes', ['C']), 2),
    ranked(skater('Quinn Hughes', ['D']), 3),
  ];

  it('keeps every player while nothing is searched for', () => {
    expect(filterByName(rows, '  ')).toBe(rows);
  });

  it('keeps the players whose name holds the text, in ranked order, whatever its case', () => {
    expect(filterByName(rows, ' HUGH ').map((row) => [row.player.name, row.rank])).toEqual([
      ['Jack Hughes', 2],
      ['Quinn Hughes', 3],
    ]);
  });

  it('finds a name written with accents from one written without, and the other way round', () => {
    expect(filterByName(rows, 'slafkovsky').map((row) => row.player.name)).toEqual([
      'Juraj Slafkovský',
    ]);
    expect(
      filterByName([ranked(skater('Juraj Slafkovsky', ['LW']), 1)], 'Slafkovský'),
    ).toHaveLength(1);
  });
});

describe('filterByPositions', () => {
  const rows = [
    ranked(skater('Winger', ['LW']), 1),
    ranked(skater('Two-way', ['C', 'LW']), 2),
    ranked(skater('Pivot', ['C']), 3),
    ranked(skater('Blueliner', ['D']), 4),
  ];

  it('keeps every player, in ranked order, while no position is picked', () => {
    expect(filterByPositions(rows, new Set())).toBe(rows);
  });

  it('keeps anyone eligible at any position picked, once each and still best first', () => {
    const names = filterByPositions(rows, new Set(['C', 'D'] as const)).map(
      (row) => row.player.name,
    );

    expect(names).toEqual(['Two-way', 'Pivot', 'Blueliner']);
  });

  it('narrows a list of skaters and goalies to the goalies, or to them and a skater position', () => {
    const mixed = [...rows, ranked(goalie({ w: 2 }), 5)];

    expect(filterByPositions(mixed, new Set(['G'] as const)).map((row) => row.player.name)).toEqual(
      ['Goalie'],
    );
    expect(
      filterByPositions(mixed, new Set(['D', 'G'] as const)).map((row) => row.player.name),
    ).toEqual(['Blueliner', 'Goalie']);
  });
});

/** A share of a stretch with every stat at its count's share but those named. */
function share(games: number, of: Record<string, number> = {}, plusMinusPerMinute = 0): LineShare {
  return { games, of: (key) => of[key] ?? games, plusMinusPerMinute };
}

/** TB's three games again, each now worth something different to goals, hits and plus-minus. */
const WEIGHED: TeamSchedule[] = [
  {
    ...TEAMS[0],
    schedule: TEAMS[0].schedule.map((game, index) => ({
      ...game,
      statWorth: { goals: [0.8, 1, 1.2][index], hits: [1.2, 1, 0.8][index] },
      plusMinusPerMinute: [-0.01, 0, 0.01][index],
    })),
  },
];

describe('nightsShare', () => {
  const teams = teamsByKey(TEAMS);
  const bolt = skater('Bolt', ['C'], 'TB');

  it("finds the club under the platform's spelling and keeps the share of its games counted", () => {
    const kept = nightsShare(bolt, teams, new Set(['2026-10-12', '2026-10-14']), false);
    expect(kept.games).toBeCloseTo(2 / 3);
    // Every night is an average one here, so every stat is at the games' share.
    expect(kept.of('goals')).toBeCloseTo(2 / 3);
  });

  it('is the whole line while every night is counted, and for a club it cannot find', () => {
    expect(nightsShare(bolt, teams, new Set(), true)).toBe(WHOLE_LINE);
    expect(nightsShare(skater('Lost', ['C'], 'XYZ'), teams, new Set(['2026-10-12']), false)).toBe(
      WHOLE_LINE,
    );
  });

  it('weighs each night kept by its worth to the stat, not by its count', () => {
    // The hard night for goals (0.8) left out: the two kept hold 2.2 of the stretch's 3.0 goals,
    // and the same two nights are the softer ones for hits.
    const kept = nightsShare(
      bolt,
      teamsByKey(WEIGHED),
      new Set(['2026-10-14', '2026-10-17']),
      false,
    );
    expect(kept.games).toBeCloseTo(2 / 3);
    expect(kept.of('goals')).toBeCloseTo(2.2 / 3);
    expect(kept.of('hits')).toBeCloseTo(1.8 / 3);
    expect(kept.of('assists')).toBeCloseTo(2 / 3);
    // Plus-minus: the kept nights add 0.01 a minute over their count's share of the stretch's
    // nought, at the 3.8 of 4 games he dresses for.
    expect(kept.plusMinusPerMinute).toBeCloseTo((3.8 / 4) * 0.01);
  });
});

describe('dropShare', () => {
  const teams = teamsByKey(TEAMS);
  const bolt = skater('Bolt', ['C'], 'TB');
  const room = (date: string, fits: NightRoom['fits']): NightRoom => ({
    date,
    playing: 0,
    open: fits.size,
    benched: 0,
    fits,
  });
  // The 12th has a C seat open, the 14th one only a drop opens, the 17th none at all.
  const rooms = new Map([
    ['2026-10-12', room('2026-10-12', new Set(['C']))],
    ['2026-10-14', room('2026-10-14', new Set())],
    ['2026-10-17', room('2026-10-17', new Set())],
  ]);
  const opensC: DropRoom = [{ kind: 'C', names: ['Mine'], opens: ['C'] }];
  const dropped = new Map([['2026-10-14', opensC]]);
  const all = new Set(['2026-10-12', '2026-10-14', '2026-10-17']);

  it("keeps the share of his club's games counted that only a drop makes room for", () => {
    expect(dropShare(bolt, teams, all, rooms, dropped).games).toBeCloseTo(1 / 3);
    // The night's own room is his already, and a wing is not who a C's drop makes room for.
    expect(dropShare(skater('Wing', ['LW'], 'TB'), teams, all, rooms, dropped)).toBe(NO_LINE);
  });

  it('is nothing for a night left uncounted, and for a club it cannot find', () => {
    expect(dropShare(bolt, teams, new Set(['2026-10-12']), rooms, dropped)).toBe(NO_LINE);
    expect(dropShare(skater('Lost', ['C'], 'XYZ'), teams, all, rooms, dropped)).toBe(NO_LINE);
  });

  it('weighs the night a drop opens by its worth, and adds to the nights with room', () => {
    const weighed = teamsByKey(WEIGHED);
    const opened = dropShare(bolt, weighed, all, rooms, dropped);
    const own = roomShare(bolt, weighed, all, rooms);
    expect(opened.of('goals')).toBeCloseTo(1 / 3);
    expect(own.of('goals')).toBeCloseTo(0.8 / 3);
    const both = addShares(own, opened);
    expect(both.games).toBeCloseTo(2 / 3);
    expect(both.of('goals')).toBeCloseTo(1.8 / 3);
    expect(addShares(own, NO_LINE)).toBe(own);
  });
});

describe('wholeGamesShare', () => {
  it('rounds the games a share holds and moves every stat with them', () => {
    // Half of 5.7 expected games is 2.85: three games, each stat at three games' worth.
    const whole = wholeGamesShare(share(0.5, { goals: 0.4 }, 0.01), 5.7);
    const scale = 3 / 2.85;
    expect(whole.games * 5.7).toBeCloseTo(3);
    expect(whole.of('goals')).toBeCloseTo(0.4 * scale);
    expect(whole.of('assists')).toBeCloseTo(0.5 * scale);
    expect(whole.plusMinusPerMinute).toBeCloseTo(0.01 * scale);
  });

  it('rounds down as well, to no game and no line', () => {
    const none = wholeGamesShare(share(0.1), 2);
    expect(none.games).toBe(0);
    expect(none.of('goals')).toBe(0);
  });

  it('returns the share itself when its games are whole already', () => {
    expect(wholeGamesShare(WHOLE_LINE, 3)).toBe(WHOLE_LINE);
    expect(wholeGamesShare(NO_LINE, 2.6)).toBe(NO_LINE);
    const half = share(0.5);
    expect(wholeGamesShare(half, 4)).toBe(half);
  });
});

describe('scaledProjection', () => {
  it('scales each counting stat by its own share, and leaves a rate and the ice time alone', () => {
    const scaled = scaledProjection(skater('Bolt', ['C']).projection, share(0.5, { goals: 0.4 }));

    expect(scaled.stats.scoring).toMatchObject({ goals: 0.8, assists: 1.5, shPct: 0.12 });
    expect(scaled.stats.utility).toMatchObject({ gp: 1.9, toiPerGame: 1052 });
  });

  it('moves plus-minus by its share of the games and what their opponents add a minute', () => {
    const line = skater('Bolt', ['C'], 'EDM', { plusMinus: 2 }).projection;
    const scaled = scaledProjection(line, share(0.5, {}, 0.01));
    expect(scaled.stats.scoring).toMatchObject({ plusMinus: 1 + (1052 / 60) * 0.01 });
  });

  it('returns the projection itself for the whole line', () => {
    const projection = skater('Bolt', ['C']).projection;
    expect(scaledProjection(projection, WHOLE_LINE)).toBe(projection);
  });

  it('scales a goalie line the same way', () => {
    const goalie: FreeAgent['projection'] = {
      type: 'goalie',
      playerId: 2,
      stats: {
        scoring: scoringLine(GOALIE_SCORING_STAT_KEYS, { w: 2, sv: 60, svPct: 0.91, gaa: 2.5 }),
        utility: { gp: 2 },
      },
    };
    const scaled = scaledProjection(goalie, share(0.5));
    expect(scaled.stats.scoring).toMatchObject({ w: 1, sv: 30, svPct: 0.91, gaa: 2.5 });
  });
});

/** A club's crease: each goalie by id (none for one the league has rostered) and his nightly shares. */
function crease(
  dates: readonly string[],
  goalies: [string | undefined, number[]][],
): PlannerCrease {
  return {
    team: 'NJD',
    goalies: goalies.map(([playerId, shares]) => ({
      ...(playerId === undefined ? {} : { playerId }),
      nights: shares.map((share, index) => ({ date: dates[index], share })),
    })),
  };
}

describe('projectedStarts', () => {
  const SATURDAY = ['2026-10-17'];
  const WEEK = ['2026-10-13', '2026-10-15', '2026-10-17', '2026-10-18'];
  const all = (dates: readonly string[]) => new Set(dates);

  it("gives a club's one game to its likeliest starter and none to the man behind him", () => {
    // New Jersey's weekend: a little under half a start each, and a rostered third the rest.
    const starts = projectedStarts(
      [
        crease(SATURDAY, [
          ['allen', [0.48]],
          ['daws', [0.44]],
          [undefined, [0.08]],
        ]),
      ],
      all(SATURDAY),
      false,
    );

    expect(starts.get('allen')).toBe(1);
    expect(starts.get('daws')).toBe(0);
  });

  it('gives a free agent nothing behind a rostered goalie likelier to start', () => {
    const starts = projectedStarts(
      [
        crease(SATURDAY, [
          [undefined, [0.55]],
          ['backup', [0.45]],
        ]),
      ],
      all(SATURDAY),
      false,
    );

    expect(starts.get('backup')).toBe(0);
  });

  it('splits a week by the starts each is expected to make, not every night to the starter', () => {
    const shares = (share: number) => WEEK.map(() => share);
    const week = crease(WEEK, [
      ['starter', shares(0.7)],
      ['backup', shares(0.3)],
    ]);

    // Over four nights at seventy-thirty the backup is expected to make 1.2 starts.
    const four = projectedStarts([week], all(WEEK), true);
    expect([four.get('starter'), four.get('backup')]).toEqual([3, 1]);
    // Over two, 1.4 and 0.6: one each.
    const two = projectedStarts([week], all(WEEK.slice(2)), false);
    expect([two.get('starter'), two.get('backup')]).toEqual([1, 1]);
  });

  it('gives the backup his start when the rest of the crease is spread over two of them', () => {
    // Edmonton's 22 and 24 October 2026: Jarry is expected to make 1.14 starts, Levi 0.47 and
    // Tomkins 0.39. Both to Jarry is the single likeliest split, but it is not what he is expected
    // to make.
    const nights = WEEK.slice(2);
    const starts = projectedStarts(
      [
        crease(nights, [
          ['jarry', [0.571, 0.571]],
          ['levi', [0.235, 0.235]],
          ['tomkins', [0.194, 0.194]],
        ]),
      ],
      all(nights),
      false,
    );

    expect([starts.get('jarry'), starts.get('levi'), starts.get('tomkins')]).toEqual([1, 1, 0]);
  });

  it('leaves a game of a long stretch to a goalie the model does not name when his share adds up to it', () => {
    // Fifteen nights at 0.60 and 0.35: 9, 5.25, and 0.75 left to nobody named.
    const nights = Array.from(
      { length: 15 },
      (_, day) => `2026-11-${String(day + 1).padStart(2, '0')}`,
    );
    const starts = projectedStarts(
      [
        crease(nights, [
          ['starter', nights.map(() => 0.6)],
          ['backup', nights.map(() => 0.35)],
        ]),
      ],
      all(nights),
      false,
    );

    expect([starts.get('starter'), starts.get('backup')]).toEqual([9, 5]);
  });

  it('gives a crease of three even thirds one start each over three nights', () => {
    const nights = WEEK.slice(1);
    const third = nights.map(() => 1 / 3);
    const starts = projectedStarts(
      [
        crease(nights, [
          ['a', third],
          ['b', third],
          ['c', third],
        ]),
      ],
      all(nights),
      false,
    );

    expect([starts.get('a'), starts.get('b'), starts.get('c')]).toEqual([1, 1, 1]);
  });

  it("reads each night's own shares, so a starter back from injury takes the nights after", () => {
    // Out until the Saturday: his backup has the first two nights to himself.
    const week = crease(WEEK, [
      ['starter', [0, 0, 0.75, 0.75]],
      ['backup', [1, 1, 0.25, 0.25]],
    ]);

    const weekend = projectedStarts([week], all(WEEK.slice(2)), false);
    expect([weekend.get('starter'), weekend.get('backup')]).toEqual([2, 0]);
    const midweek = projectedStarts([week], all(WEEK.slice(0, 2)), false);
    expect([midweek.get('starter'), midweek.get('backup')]).toEqual([0, 2]);
  });

  it('counts every night of the stretch while none is left out', () => {
    const week = crease(WEEK, [['starter', WEEK.map(() => 1)]]);

    expect(projectedStarts([week], new Set(), true).get('starter')).toBe(4);
    expect(projectedStarts([week], new Set(), false).get('starter')).toBe(0);
  });

  it('breaks a tie for the goalie listed first, who has the most starts over the stretch', () => {
    const starts = projectedStarts(
      [
        crease(SATURDAY, [
          ['first', [0.5]],
          ['second', [0.5]],
        ]),
      ],
      all(SATURDAY),
      false,
    );

    expect([starts.get('first'), starts.get('second')]).toEqual([1, 0]);
  });

  it('leaves a game to a goalie the model does not name when the shares fall short of it', () => {
    const starts = projectedStarts([crease(SATURDAY, [['lone', [0.3]]])], all(SATURDAY), false);

    expect(starts.get('lone')).toBe(0);
  });

  it('holds a crease whose shares run past one start to the one start a night has', () => {
    const starts = projectedStarts(
      [
        crease(SATURDAY, [
          ['incumbent', [0.7]],
          ['arrival', [0.6]],
        ]),
      ],
      all(SATURDAY),
      false,
    );

    expect([starts.get('incumbent'), starts.get('arrival')]).toEqual([1, 0]);
  });
});

describe('startsProjection', () => {
  const line = goalie({ gs: 2, w: 1.2, sv: 56, sa: 61, svPct: 0.918, gaa: 2.5, toi: 7200 });

  it('is his line a start at a time, times the starts he is given', () => {
    const one = startsProjection(line.projection, 2, 1);

    expect(one.stats.scoring).toMatchObject({ gs: 1, w: 0.6, sv: 28, svPct: 0.918, gaa: 2.5 });
    expect(one.stats.utility.gp).toBe(1);
  });

  it('is nought in every stat, the rates too, for a goalie given no start', () => {
    const none = startsProjection(line.projection, 2, 0);

    expect(Object.values(none.stats.scoring).every((value) => value === 0)).toBe(true);
    expect(none.stats.utility.gp).toBe(0);
  });

  it('weighs a start by the nights kept against the stretch average start', () => {
    // Half the nights kept, holding 0.4 of his wins: a start on them is worth 0.8 of an average one.
    const one = startsProjection(line.projection, 2, 1, share(0.5, { w: 0.4 }));

    expect(one.stats.scoring).toMatchObject({ gs: 1, w: 0.48, sv: 28, svPct: 0.918 });
  });
});

describe('lineStats', () => {
  /** A Yahoo categories league: seven for skaters, four for goalies, in the league's order. */
  const CATEGORIES = [
    'goals',
    'assists',
    'sog',
    'pim',
    'ppp',
    'blocks',
    'hits',
    'w',
    'gaa',
    'svPct',
    'sho',
  ] as const;

  function written(row: RankedFreeAgent, categories: readonly ScoringStatKey[] = CATEGORIES) {
    return lineStats(row, categories).map((stat) => `${stat.value} ${stat.label}`);
  }

  it("writes a skater's line in every skater category the league scores, in its order", () => {
    const row = ranked(
      skater('Winger', ['LW'], 'EDM', {
        goals: 1.84,
        assists: 2,
        sog: 15.06,
        pim: 3.2,
        ppp: 0.8,
        blocks: 4.1,
        hits: 6,
        // Projected, and not a category of this league: left out.
        fw: 12,
      }),
      1,
    );

    expect(written(row)).toEqual([
      '1.8 G',
      '2.0 A',
      '15.1 SOG',
      '3.2 PIM',
      '0.8 PPP',
      '4.1 BLK',
      '6.0 HIT',
    ]);
    expect(lineStats(row, CATEGORIES).map((stat) => stat.name)).toContain('Shots on Goal');
  });

  it("writes a goalie's in the goalie categories, a rate as the editor writes it", () => {
    const row = ranked(goalie({ w: 1.4, gaa: 2.613, svPct: 0.9084, sho: 0.12, sv: 57.4 }), 1);

    expect(written(row)).toEqual(['1.4 W', '2.61 GAA', '0.908 SV%', '0.1 SHO']);
    // Saves run to dozens in a week, so they are written whole.
    expect(written(row, ['sv'])).toEqual(['57 SV']);
  });

  it('writes a goalie given no start as nought, with no rate', () => {
    const player = goalie({ w: 1.4, gaa: 2.613, svPct: 0.9084, sho: 0.12 });
    const row = { ...ranked(player, 1, startsProjection(player.projection, 2, 0)), games: 0 };

    expect(written(row)).toEqual(['0.0 W', '— GAA', '— SV%', '0.0 SHO']);
  });

  it('reads the line over the nights counted, not the whole stretch', () => {
    const player = skater('Winger', ['LW'], 'EDM', { goals: 2, assists: 3 });
    const row = ranked(player, 1, scaledProjection(player.projection, share(0.5)));

    expect(written(row, ['goals', 'assists'])).toEqual(['1.0 G', '1.5 A']);
  });

  // The projection holds a zero for every stat, projected or not, because the ranking engine
  // needs a whole line. Written out, that zero would read as the model's own number.
  it('leaves out a category the model gave no number for', () => {
    const row = ranked(skater('Defender', ['D'], 'EDM', { goals: 1, assists: 2 }), 1);

    expect(written(row, ['goals', 'defPoints', 'assists'])).toEqual(['1.0 G', '2.0 A']);
  });

  it('signs a plus/minus, drops the decimal past a hundred, and writes ice time as a clock', () => {
    const row = ranked(
      skater('Grinder', ['C'], 'EDM', { plusMinus: 0.62, hits: 104.4, pim: 0, shPct: 11.94 }),
      1,
    );
    expect(written(row, ['plusMinus', 'hits', 'pim', 'shPct'])).toEqual([
      '+0.6 +/-',
      '104 HIT',
      '0.0 PIM',
      '11.9 SH%',
    ]);

    const minus = ranked(skater('Minus', ['C'], 'EDM', { plusMinus: -0.31 }), 1);
    expect(written(minus, ['plusMinus'])).toEqual(['-0.3 +/-']);
    const even = ranked(skater('Even', ['C'], 'EDM', { plusMinus: 0.04 }), 1);
    expect(written(even, ['plusMinus'])).toEqual(['0.0 +/-']);

    const starter = ranked(goalie({ toi: 7100 }), 1);
    expect(written(starter, ['toi'])).toEqual(['118:20 TOI']);
  });
});

describe('lineColumns', () => {
  function stat(key: ScoringStatKey, label: string) {
    return { key, label, name: label, value: '1.0' };
  }

  it("is every category any of the players has a number for, in the league's order", () => {
    const first = [stat('goals', 'G'), stat('sog', 'SOG')];
    const second = [stat('goals', 'G'), stat('assists', 'A')];

    expect(
      lineColumns([first, second], ['assists', 'goals', 'hits', 'sog']).map(
        (column) => column.label,
      ),
    ).toEqual(['A', 'G', 'SOG']);
  });

  it('is no column at all for players with nothing to write', () => {
    expect(lineColumns([[], []], ['goals'])).toEqual([]);
    expect(lineColumns([], ['goals'])).toEqual([]);
  });
});

describe('formatting', () => {
  it('writes ice time as minutes and seconds', () => {
    expect(formatToi(1052)).toBe('17:32');
    expect(formatToi(600)).toBe('10:00');
    expect(formatToi(undefined)).toBe('');
    expect(formatToi(0)).toBe('');
  });

  it('writes games as a whole number, however fractional the expectation', () => {
    expect(formatGames(3)).toBe('3');
    expect(formatGames(2.97)).toBe('3');
    expect(formatGames(3.75)).toBe('4');
    expect(formatGames(2.49)).toBe('2');
  });
});

describe('sorting the free agents', () => {
  const blocker = ranked(skater('Blocker', ['D'], 'EDM', { goals: 0.2, blocks: 9 }), 3);
  const scorer = ranked(skater('Ace', ['C'], 'EDM', { goals: 3, blocks: 1 }), 1);
  const middle = ranked(skater('Middle', ['RW'], 'EDM', { goals: 1, blocks: 4 }), 2);
  const netminder = ranked(goalie({ w: 1.2, gaa: 2.4 }), 4);
  const list = [scorer, middle, blocker, netminder];
  const names = (rows: readonly RankedFreeAgent[]) => rows.map((row) => row.player.name);

  it('leaves the list as ranked until a column is picked', () => {
    expect(sortFreeAgents(list, RANKED_ORDER)).toBe(list);
  });

  it('sorts by a category, most first, with the other kind last whichever way it points', () => {
    const blocks = nextSort(RANKED_ORDER, 'blocks');
    expect(blocks).toEqual({ key: 'blocks', descending: true });
    expect(names(sortFreeAgents(list, blocks))).toEqual(['Blocker', 'Middle', 'Ace', 'Goalie']);

    const fewest = nextSort(blocks, 'blocks');
    expect(fewest).toEqual({ key: 'blocks', descending: false });
    expect(names(sortFreeAgents(list, fewest))).toEqual(['Ace', 'Middle', 'Blocker', 'Goalie']);
  });

  it('opens a name from A and GAA from the lowest, which is best first for each', () => {
    expect(nextSort(RANKED_ORDER, 'name')).toEqual({ key: 'name', descending: false });
    expect(names(sortFreeAgents(list, nextSort(RANKED_ORDER, 'name')))).toEqual([
      'Ace',
      'Blocker',
      'Goalie',
      'Middle',
    ]);
    expect(nextSort(RANKED_ORDER, 'gaa')).toEqual({ key: 'gaa', descending: false });
  });

  it('turns the score round on a second press, and back to the ranked order on a third', () => {
    const worst = nextSort(RANKED_ORDER, 'score');
    expect(names(sortFreeAgents(list, worst))).toEqual(['Goalie', 'Blocker', 'Middle', 'Ace']);
    expect(nextSort(worst, 'score')).toEqual(RANKED_ORDER);
  });

  it('keeps the ranked order among players level on the column', () => {
    const level = [scorer, middle, blocker].map((row) => ({ ...row, games: 3 }));
    expect(names(sortFreeAgents(level, nextSort(RANKED_ORDER, 'games')))).toEqual([
      'Ace',
      'Middle',
      'Blocker',
    ]);
  });

  it('puts a goalie with no starts last on a rate, and a goalie last on ice time', () => {
    const benched = { ...ranked(goalie({ w: 0, gaa: 0 }), 5), games: 0 };
    expect(names(sortFreeAgents([benched, netminder], nextSort(RANKED_ORDER, 'gaa')))).toEqual([
      'Goalie',
      'Goalie',
    ]);
    expect(sortFreeAgents([benched, netminder], nextSort(RANKED_ORDER, 'gaa'))[0]).toBe(netminder);
    expect(names(sortFreeAgents([netminder, blocker], nextSort(RANKED_ORDER, 'toi')))).toEqual([
      'Blocker',
      'Goalie',
    ]);
  });
});
