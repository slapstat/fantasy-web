import { describe, expect, it } from 'vitest';
import { RosterSlots } from '../api/models/roster-slots';
import { Projection } from '../models/projection.model';
import { NightWorth, TeamPlayer } from '../services/player-scout.service';
import { NightWeights, priceDrop, StatShares, statShares, valueLineup } from './lineup-value';

/** Two centre seats, one wing, one defence seat, a goalie seat and a bench. */
const SLOTS: RosterSlots = { c: 2, lw: 1, rw: 0, w: 0, f: 0, d: 1, util: 0, bn: 2, g: 1 };

/** Every club plays the same ten nights, so the lineup is the whole question. */
const NIGHTS = Array.from(
  { length: 10 },
  (_, index) => `2026-11-${String(index + 1).padStart(2, '0')}`,
);

function schedule(
  clubs: Record<string, readonly string[]>,
): ReadonlyMap<string, readonly string[]> {
  return new Map(Object.entries(clubs));
}

function player(
  playerId: string,
  positions: string[],
  teamAbbrev = 'EDM',
  extra: Partial<TeamPlayer> = {},
): TeamPlayer {
  return {
    playerId,
    name: `Player ${playerId}`,
    teamAbbrev,
    type: positions.includes('G') ? 'goalie' : 'skater',
    positions,
    reserve: false,
    reserveEligible: [],
    out: false,
    projection: null,
    ...extra,
  };
}

describe('valueLineup', () => {
  // Five centres on one club, two centre seats: the third centre starts nowhere.
  const centres = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => player(id, ['C']));
  const scores: Record<string, number> = { c1: 100, c2: 80, c3: 60, c4: 40, c5: 20 };

  it('starts only as many of a kind as the lineup seats, the best of them', () => {
    const valuation = valueLineup(centres, SLOTS, schedule({ EDM: NIGHTS }), (id) => scores[id]);

    expect(valuation.byPlayer.get('c1')?.starts).toBe(10);
    expect(valuation.byPlayer.get('c2')?.starts).toBe(10);
    expect(valuation.byPlayer.get('c3')?.starts).toBe(0);
    expect(valuation.byPlayer.get('c3')?.games).toBe(10);
    // The team is worth its two starters: 100 and 80 over the ten nights.
    expect(valuation.total).toBeCloseTo(180);
  });

  it('costs the lineup only what the next man up does not replace', () => {
    const valuation = valueLineup(centres, SLOTS, schedule({ EDM: NIGHTS }), (id) => scores[id]);

    // Without c1, c3 starts in his place: the lineup loses 100 and gains 60.
    expect(valuation.byPlayer.get('c1')?.marginal).toBeCloseTo(40);
    expect(valuation.byPlayer.get('c2')?.marginal).toBeCloseTo(20);
    // The third centre is worth nothing to the lineup, whatever he would score on the bench.
    expect(valuation.byPlayer.get('c3')?.marginal).toBe(0);
    expect(valuation.byPlayer.get('c3')?.value).toBe(0);
  });

  it('seats a lone defenceman every night his club plays, and a goalie in the crease', () => {
    const team = [player('d1', ['D'], 'COL'), player('g1', ['G'], 'BOS')];
    const valuation = valueLineup(
      team,
      SLOTS,
      schedule({ COL: NIGHTS.slice(0, 4), BOS: NIGHTS.slice(0, 6) }),
      (id) => ({ d1: 20, g1: 30 })[id] ?? null,
    );

    expect(valuation.byPlayer.get('d1')).toMatchObject({
      starts: 4,
      games: 4,
      value: 20,
      marginal: 20,
    });
    expect(valuation.byPlayer.get('g1')).toMatchObject({
      starts: 6,
      games: 6,
      value: 30,
      marginal: 30,
    });
  });

  it('lets a player play on the nights another is off, so two clubs share one seat', () => {
    const team = [player('d1', ['D'], 'COL'), player('d2', ['D'], 'BOS')];
    const valuation = valueLineup(
      team,
      SLOTS,
      // COL plays the first six nights, BOS the last six: two nights clash.
      schedule({ COL: NIGHTS.slice(0, 6), BOS: NIGHTS.slice(4) }),
      (id) => ({ d1: 60, d2: 30 })[id] ?? null,
    );

    expect(valuation.byPlayer.get('d1')?.starts).toBe(6);
    // The second defenceman starts the four nights the first has no game.
    expect(valuation.byPlayer.get('d2')?.starts).toBe(4);
    expect(valuation.byPlayer.get('d2')?.marginal).toBeCloseTo(20);
  });

  it('seats a player out injured on the nights after his return, ahead of the healthy', () => {
    // The model gives the injured defenceman 4 of the club's 10 games: the last four.
    const back = {
      type: 'skater',
      playerId: 0,
      stats: { scoring: {}, utility: { gp: 4 } },
    } as unknown as Projection;
    const team = [
      player('d1', ['D']),
      player('d2', ['D']),
      player('ir', ['D'], 'EDM', { out: true, reserve: true, projection: back }),
    ];
    const scores: Record<string, number> = { d1: 40, d2: 30, ir: 80 };
    const valuation = valueLineup(team, SLOTS, schedule({ EDM: NIGHTS }), (id) => scores[id]);

    expect(valuation.byPlayer.get('ir')).toMatchObject({ starts: 4, games: 4 });
    // At 20 a game he takes the one defence seat from d1 (4 a game) for the last four nights.
    expect(valuation.byPlayer.get('d1')?.starts).toBe(6);
    expect(valuation.byPlayer.get('d2')?.starts).toBe(0);
    expect(valuation.byPlayer.get('ir')?.marginal).toBeCloseTo(4 * (20 - 4));
  });

  it('starts nobody who is out with no line, on a club with no schedule, or eligible nowhere', () => {
    const team = [
      player('out', ['C'], 'EDM', { out: true }),
      player('lost', ['C'], 'XXX'),
      player('nowhere', [], 'EDM'),
    ];
    const valuation = valueLineup(team, SLOTS, schedule({ EDM: NIGHTS }), () => 50);

    for (const id of ['out', 'lost', 'nowhere']) {
      expect(valuation.byPlayer.get(id)).toMatchObject({ starts: 0, value: 0, marginal: 0 });
    }
  });

  it('seats a player the model has no line for after everyone with one, for nothing', () => {
    const team = [player('c1', ['C']), player('c2', ['C']), player('prospect', ['C'])];
    const valuation = valueLineup(team, SLOTS, schedule({ EDM: NIGHTS }), (id) =>
      id === 'prospect' ? null : 50,
    );

    expect(valuation.byPlayer.get('prospect')).toMatchObject({ starts: 0, marginal: 0 });
    expect(valuation.byPlayer.get('c1')?.starts).toBe(10);
  });
});

describe('priceDrop', () => {
  const centres = ['c1', 'c2', 'c3'].map((id) => player(id, ['C']));
  const wing = player('w1', ['LW']);
  const team = [...centres, wing];
  const scores: Record<string, number> = { c1: 100, c2: 80, c3: 60, w1: 10 };
  const score = (id: string) => scores[id] ?? null;
  const nights = schedule({ EDM: NIGHTS });
  const byId = (id: string) => team.find((player) => player.playerId === id)!;
  const pickup = (positions: string[], total: number, teamAbbrev = 'EDM') => ({
    playerId: 'p',
    positions,
    teamAbbrev,
    score: total,
  });

  it('prices a pickup by the seats, not the projections: a benched drop costs nothing', () => {
    // c3 starts nowhere behind c1 and c2. A centre scoring 70 cannot start either, so the swap
    // gains nothing; dropped for a centre scoring 90, the pickup starts over c2: ten gained.
    const pricing = priceDrop(byId('c3'), team, SLOTS, nights, score);

    expect(pricing.gainFor(pickup(['C'], 70))).toBeCloseTo(0);
    expect(pricing.gainFor(pickup(['C'], 90))).toBeCloseTo(10);
  });

  it('charges a starter his starts: the pickup has to replace what the lineup loses', () => {
    // Without c2, c3 starts in his place: the lineup is 20 worse off. A centre scoring 70 then
    // starts over c3, so the swap nets 70 less 80.
    const pricing = priceDrop(byId('c2'), team, SLOTS, nights, score);

    expect(pricing.gainFor(pickup(['C'], 70))).toBeCloseTo(-10);
    // A wing scoring 50 takes the wing seat from w1 (40 gained) while c3 fills c2's seat (20 lost).
    expect(pricing.gainFor(pickup(['LW'], 50))).toBeCloseTo(20);
  });

  it('weighs a pickup at a thin position against the man he replaces there', () => {
    const pricing = priceDrop(byId('w1'), team, SLOTS, nights, score);

    expect(pricing.gainFor(pickup(['LW'], 50))).toBeCloseTo(40);
  });

  it('counts only the nights either of them plays', () => {
    // The drop plays the first six nights, the pickup the last six: on the four nights only the
    // drop plays the lineup loses his seat, on the four only the pickup plays it gains his, and
    // on the two they share the pickup replaces him.
    const roster = [player('d1', ['D'], 'COL'), player('c1', ['C'], 'COL')];
    const pricing = priceDrop(
      roster[0],
      roster,
      SLOTS,
      schedule({ COL: NIGHTS.slice(0, 6), BOS: NIGHTS.slice(4) }),
      (id) => ({ d1: 60, c1: 10 })[id] ?? null,
    );

    // d1 is worth 10 a night over six nights; the pickup 20 a night over six.
    expect(pricing.gainFor(pickup(['D'], 120, 'BOS'))).toBeCloseTo(120 - 60);
  });

  it('cannot price a pickup whose club has no night in the schedule', () => {
    const pricing = priceDrop(byId('c3'), team, SLOTS, nights, score);

    expect(pricing.gainFor(pickup(['C'], 90, 'XXX'))).toBeNull();
  });

  it('prices a drop who is out with no line as costing nothing: he is back for no game', () => {
    const hurt = player('hurt', ['LW'], 'EDM', { out: true });
    const pricing = priceDrop(hurt, [...team, hurt], SLOTS, nights, (id) =>
      id === 'hurt' ? 90 : score(id),
    );

    // The wing seat holds w1 at 10 a game; the pickup takes it for his whole 50.
    expect(pricing.gainFor(pickup(['LW'], 50))).toBeCloseTo(40);
  });

  it('prices a goalie against a skater drop the same way: the seats decide', () => {
    const goalie = player('g1', ['G'], 'EDM');
    const roster = [...team, goalie];
    const value = (id: string) => (id === 'g1' ? 30 : score(id));

    // Dropping the benched c3 for a goalie scoring 50: he takes the crease from g1 (20 gained).
    expect(
      priceDrop(byId('c3'), roster, SLOTS, nights, value).gainFor(pickup(['G'], 50)),
    ).toBeCloseTo(20);
    // Dropping the goalie for him: the crease changes hands, 20 gained as well.
    expect(priceDrop(goalie, roster, SLOTS, nights, value).gainFor(pickup(['G'], 50))).toBeCloseTo(
      20,
    );
  });
});

describe('nights with a worth', () => {
  // Two defencemen for one defence seat, near enough level: d1 a hair better on the season.
  const team = [player('d1', ['D'], 'COL'), player('d2', ['D'], 'BOS')];
  const scores: Record<string, number> = { d1: 50.5, d2: 50 };
  const score = (id: string) => scores[id] ?? null;
  const both = schedule({ COL: NIGHTS, BOS: NIGHTS });
  // Each holds 30 of his score in points, counted from nothing, and nothing in plus-minus.
  const shares: StatShares = { byStat: { points: 30 }, plusMinus: 0 };
  const SOFT: NightWorth = { stat: { points: 1.2 }, plusMinusPerMinute: 0 };
  const STRONG: NightWorth = { stat: { points: 0.85 }, plusMinusPerMinute: 0 };
  // The third night d1 visits a stingy defence and d2 is at home to a leaky one.
  const skewed: NightWeights = {
    worth: new Map([
      ['COL', new Map([[NIGHTS[2], STRONG]])],
      ['BOS', new Map([[NIGHTS[2], SOFT]])],
    ]),
    shares: () => shares,
  };

  it('starts the better of a near tie every night when every night is alike', () => {
    const valuation = valueLineup(team, SLOTS, both, score);

    expect(valuation.byPlayer.get('d1')?.starts).toBe(10);
    expect(valuation.byPlayer.get('d2')?.starts).toBe(0);
  });

  it('starts the other of a near tie on the night his opponent is the softer', () => {
    const valuation = valueLineup(team, SLOTS, both, score, skewed);

    expect(valuation.byPlayer.get('d1')?.starts).toBe(9);
    expect(valuation.byPlayer.get('d2')?.starts).toBe(1);
    // d2's night is worth his 5 a game plus 30 / 10 of points at 1.2 over his nights' 1.02.
    expect(valuation.byPlayer.get('d2')?.value).toBeCloseTo(5 + 3 * (1.2 / 1.02 - 1));
    // The lineup is better for it than seating d1 every night, which it is worth 50.5.
    expect(valuation.total).toBeGreaterThan(50.5);
  });

  it('keeps the better of a near tie on every night when the nights favour neither', () => {
    const even: NightWeights = {
      worth: new Map([
        ['COL', new Map([[NIGHTS[2], SOFT]])],
        ['BOS', new Map([[NIGHTS[2], SOFT]])],
      ]),
      shares: () => shares,
    };

    expect(valueLineup(team, SLOTS, both, score, even).byPlayer.get('d1')?.starts).toBe(10);
  });

  it("still adds a player's nights up to his score: the worth only places it", () => {
    const valuation = valueLineup([team[0]], SLOTS, both, score, skewed);

    expect(valuation.byPlayer.get('d1')?.value).toBeCloseTo(50.5);
  });

  it("moves plus-minus by the night's amount, not a share of it", () => {
    // No points to move, only plus-minus: 0.01 a minute of his ice on d2's third night is worth
    // 400 / 10 of score a unit, less his nights' average amount.
    const minus: NightWeights = {
      worth: new Map([['BOS', new Map([[NIGHTS[2], { stat: {}, plusMinusPerMinute: 0.01 }]])]]),
      shares: () => ({ byStat: {}, plusMinus: 400 }),
    };
    const valuation = valueLineup(team, SLOTS, both, score, minus);

    expect(valuation.byPlayer.get('d2')?.starts).toBe(1);
    expect(valuation.byPlayer.get('d2')?.value).toBeCloseTo(5 + 40 * (0.01 - 0.001));
  });

  it('counts every night alike for a player whose shares are not known', () => {
    const unknown: NightWeights = { ...skewed, shares: (id) => (id === 'd1' ? shares : null) };

    // d1 still loses value on the third night; d2, unweighed, is worth 5 then as every night.
    const valuation = valueLineup(team, SLOTS, both, score, unknown);
    expect(valuation.byPlayer.get('d2')?.starts).toBe(1);
    expect(valuation.byPlayer.get('d2')?.value).toBeCloseTo(5);
  });

  it('prices a near-tie pickup by the nights his opponents are the softer', () => {
    // Dropping d2 for a pickup level with him on the season but at home to the leaky defence
    // on the third night: he takes that night from d1, which d2 did as well.
    const pricing = priceDrop(team[1], team, SLOTS, both, score, skewed);
    const level = { playerId: 'p', positions: ['D'], teamAbbrev: 'BOS', score: 50 };

    expect(pricing.gainFor({ ...level, shares })).toBeCloseTo(0);
    // Unweighed he is worth his even 5 on the third night, short of what d2 made of it.
    expect(pricing.gainFor(level)).toBeLessThan(0);
  });
});

describe('statShares', () => {
  const line = {
    playerId: 1,
    type: 'skater',
    stats: {
      scoring: { goals: 20, hits: 100, plusMinus: 10 },
      utility: { gp: 80, toiPerGame: 1200 },
    },
  } as unknown as Projection;

  it("holds each stat's count times what one more of it scores", () => {
    const shares = statShares(line, { skater: { goals: 0.1, hits: 0.02 }, goalie: {} });

    expect(shares.byStat['goals']).toBeCloseTo(2);
    expect(shares.byStat['hits']).toBeCloseTo(2);
    expect(shares.plusMinus).toBe(0);
  });

  it('weighs plus-minus over his games and minutes, since a night moves it by an amount', () => {
    const shares = statShares(line, { skater: { plusMinus: 0.1 }, goalie: {} });

    expect(shares.byStat['plusMinus']).toBeUndefined();
    // 0.1 a unit, over 80 games of 20 minutes.
    expect(shares.plusMinus).toBeCloseTo(0.1 * 80 * 20);
  });
});
