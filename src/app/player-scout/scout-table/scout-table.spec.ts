import { MockBuilder, MockRender, ngMocks } from 'ng-mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Projection } from '../../models/projection.model';
import { ScoutPlayer } from '../../services/player-scout.service';
import { ScoutRow } from '../scout-ranking';
import { usageChange } from '../scout-usage';
import { ScoutTableComponent, ScoutView } from './scout-table';

function skater(playerId: number, goals: number, toi: number, games = 70): Projection {
  return {
    type: 'skater',
    playerId,
    stats: {
      scoring: { goals, assists: 20 } as never,
      utility: { gp: games, toiPerGame: toi },
    },
  };
}

interface RowOptions {
  readonly thenRank?: number | null;
  readonly thenToi?: number | null;
  readonly thenGoals?: number;
  readonly thenGames?: number;
  readonly delta?: number | null;
  readonly rising?: boolean;
  readonly owner?: ScoutPlayer['owner'];
  readonly availability?: ScoutPlayer['freeAgent']['availability'];
  readonly usage?: ScoutPlayer['usage'];
}

function row(playerId: number, name: string, rank: number, options: RowOptions = {}): ScoutRow {
  const line = skater(playerId, 15, 1380);
  const thenRank = options.thenRank ?? null;
  const then =
    options.thenToi === null || options.thenToi === undefined
      ? null
      : skater(playerId, options.thenGoals ?? 5, options.thenToi, options.thenGames ?? 70);
  const scout: ScoutPlayer = {
    freeAgent: {
      projection: line,
      playerId: String(playerId),
      name,
      teamAbbrev: 'SEA',
      positions: ['D'],
      availability: options.availability ?? 'FREE_AGENT',
      clubGames: 70,
      expectedGames: 70,
      projected: new Set(['goals', 'assists']),
    },
    nhlId: 8400000 + playerId,
    type: 'skater',
    owner: options.owner ?? null,
    then,
    thenProjected: new Set(then ? ['goals', 'assists'] : []),
    usage: options.usage ?? null,
  };
  return {
    scout,
    player: scout.freeAgent,
    line,
    score: 85,
    rank,
    games: 70,
    then,
    thenScore: then ? 85 - (options.delta ?? 0) : null,
    thenRank,
    delta: then ? (options.delta ?? 0) : null,
    rise: thenRank === null ? null : thenRank - rank,
    rising: options.rising ?? false,
    usage: usageChange(scout.usage),
  };
}

/** A goalie's row: no ice time, now or then, and no usage. */
function goalieRow(playerId: number, rank: number): ScoutRow {
  const line: Projection = {
    type: 'goalie',
    playerId,
    stats: { scoring: { w: 20 } as never, utility: { gp: 40 } },
  };
  const skaterRow = row(playerId, 'Joey Daccord', rank);
  return {
    ...skaterRow,
    scout: {
      ...skaterRow.scout,
      type: 'goalie',
      freeAgent: { ...skaterRow.player, projection: line, positions: ['G'] },
    },
    player: { ...skaterRow.player, projection: line, positions: ['G'] },
    line,
    then: null,
  };
}

const USAGE: ScoutPlayer['usage'] = {
  recent: { games: 4, toiPerGame: 1380, ppToiPerGame: 200, ppShare: 0.8 },
  baseline: { games: 6, toiPerGame: 1050, ppToiPerGame: 60, ppShare: 0.1 },
  baselineSource: 'SEASON',
  listedNow: { seenOn: '2026-10-13', line: 'd1', powerPlayUnit: 1, outOfLineup: false },
  listedBefore: { seenOn: '2026-10-06', line: 'd3', outOfLineup: false },
};

/** Presses the heading whose label this is. */
function press(fixture: ReturnType<typeof MockRender<ScoutTableComponent>>, label: string): void {
  ngMocks
    .findAll(fixture, 'th button.sort')
    .find((button) => ngMocks.formatText(button) === label)
    ?.nativeElement.click();
}

describe('ScoutTableComponent', () => {
  beforeEach(() => MockBuilder(ScoutTableComponent));

  function render(
    rows: ScoutRow[],
    extra: {
      view?: ScoutView;
      compare?: boolean;
      gains?: ReadonlyMap<string, number | null> | null;
      dropName?: string;
      showOwner?: boolean;
    } = {},
  ) {
    return MockRender(ScoutTableComponent, {
      rows,
      scoringType: 'points',
      categories: ['goals', 'assists'],
      sinceLabel: 'vs 7 Oct',
      iceLabel: "each club's last 5 games",
      ...extra,
    });
  }

  const risen = () =>
    row(1, 'Brandon Montour', 1, { thenRank: 140, thenToi: 1050, delta: 32.5, rising: true });

  it("opens on today's projection alone: no change under any figure, no tag, no group heading", () => {
    const fixture = render([risen()]);

    expect(ngMocks.findAll(fixture, '.delta')).toHaveLength(0);
    expect(ngMocks.findAll(fixture, '.group-row')).toHaveLength(0);
    expect(ngMocks.findAll(fixture, '.scout-tag')).toHaveLength(0);
    expect(ngMocks.formatText(ngMocks.find(fixture, 'td.rank-col'))).toBe('1');
    expect(ngMocks.formatText(ngMocks.find(fixture, 'td.score-col'))).toBe('85.0');
  });

  it('with a comparison on, tags the riser and writes the places gained under his rank and the change under his score', () => {
    const fixture = render([risen()], { compare: true });

    expect(ngMocks.formatText(fixture)).toContain('Rising');
    const rank = ngMocks.find(fixture, 'td.rank-col');
    expect(ngMocks.formatText(ngMocks.find(rank, '.figure-now'))).toBe('1');
    expect(ngMocks.formatText(ngMocks.find(rank, '.delta'))).toBe('+139');
    expect(ngMocks.find(rank, '.delta').nativeElement.classList).toContain('delta--up');
    expect(ngMocks.formatText(fixture)).not.toContain('was 140');
    const score = ngMocks.find(fixture, 'td.score-col');
    expect(ngMocks.formatText(ngMocks.find(score, '.score'))).toBe('85.0');
    expect(ngMocks.formatText(ngMocks.find(score, '.delta'))).toBe('+32.5');
    const group = ngMocks.find(fixture, '.group-col--start');
    expect(ngMocks.formatText(group)).toContain('Projection');
    expect(ngMocks.formatText(group)).toContain('vs 7 Oct');
  });

  it("writes each figure with its change underneath, in the stat's own precision and sense", () => {
    const fixture = render(
      [row(1, 'Brandon Montour', 1, { thenRank: 3, thenToi: 1050, thenGoals: 5, thenGames: 74 })],
      { compare: true },
    );

    const toi = ngMocks.find(fixture, 'td.toi-col');
    expect(ngMocks.formatText(ngMocks.find(toi, '.figure-now'))).toBe('23:00');
    expect(ngMocks.formatText(ngMocks.find(toi, '.delta'))).toBe('+5:30');
    const goals = ngMocks.findAll(fixture, 'td.stat-col')[0];
    expect(ngMocks.formatText(ngMocks.find(goals, '.figure-now'))).toBe('15.0');
    expect(ngMocks.formatText(ngMocks.find(goals, '.delta'))).toBe('+10.0');
    // Four games fewer than the day's line expected: down, and said so.
    const cells = ngMocks.findAll(fixture, 'td.num');
    const games = cells.find((cell) => ngMocks.formatText(cell).startsWith('70'));
    expect(games && ngMocks.formatText(ngMocks.find(games, '.delta'))).toBe('-4');
  });

  it('greys a change too small to mean anything', () => {
    const fixture = render(
      [row(1, 'Steady Eddie', 1, { thenRank: 1, thenToi: 1370, thenGoals: 15 })],
      { compare: true },
    );

    const toi = ngMocks.find(fixture, 'td.toi-col .delta');
    expect(ngMocks.formatText(toi)).toBe('+0:10');
    expect(toi.nativeElement.classList).toContain('delta--flat');
    expect(ngMocks.formatText(ngMocks.find(fixture, 'td.rank-col .delta'))).toBe('±0');
  });

  it('marks a player the model had no line for on the day as new, with no change', () => {
    const fixture = render([row(2, 'Ivan Demidov', 3)], { compare: true });

    const text = ngMocks.formatText(fixture);
    expect(text).toContain('New');
    expect(ngMocks.findAll(fixture, '.delta')).toHaveLength(0);
  });

  it('writes a fall as a fall, without a tag', () => {
    const fixture = render(
      [row(3, 'Steady Eddie', 30, { thenRank: 26, thenToi: 1380, delta: -3 })],
      {
        compare: true,
      },
    );

    expect(ngMocks.formatText(ngMocks.find(fixture, 'td.rank-col .delta'))).toBe('-4');
    expect(ngMocks.formatText(fixture)).not.toContain('Rising');
    expect(ngMocks.find(fixture, 'td.score-col .delta').nativeElement.classList).toContain(
      'delta--down',
    );
  });

  it('shows the ice view: the games, ice and power play with their changes, and the lineup', () => {
    const fixture = render([row(1, 'Brandon Montour', 1, { usage: USAGE })], { view: 'ice' });

    const group = ngMocks.find(fixture, '.group-col--start');
    expect(ngMocks.formatText(group)).toContain('On the ice');
    expect(ngMocks.formatText(group)).toContain("each club's last 5 games");
    const headings = ngMocks
      .findAll(fixture, 'thead tr:last-child th')
      .map((th) => ngMocks.formatText(th));
    expect(headings).toEqual([
      '#',
      'Player',
      'Proj. pts',
      'Games',
      'Ice / game',
      'PP / game',
      'PP share',
      'Lineup',
    ]);
    expect(ngMocks.findAll(fixture, 'th.toi-col')).toHaveLength(0);
    expect(ngMocks.findAll(fixture, 'th.stat-col')).toHaveLength(0);
    const cells = ngMocks.findAll(fixture, 'tbody td').map((td) => ngMocks.formatText(td));
    expect(cells[0]).toBe('1');
    expect(cells[1]).toBe('85.0');
    expect(cells[2]).toBe('4');
    expect(cells[3]).toBe('23:00+5:30');
    expect(cells[4]).toBe('3:20+2:20');
    expect(cells[5]).toBe('80%+70 pts');
    const lineup = ngMocks.find(fixture, 'td.lineup-col');
    expect(ngMocks.formatText(ngMocks.find(lineup, '.listed'))).toBe('D1 · PP1');
    expect(ngMocks.find(lineup, '.listed').nativeElement.classList).toContain('listed--up');
    expect(ngMocks.formatText(ngMocks.find(lineup, '.delta--note'))).toBe('was D3 · No PP');
  });

  it('leaves the comparison to the projection view', () => {
    const fixture = render([risen()], { view: 'ice', compare: true });

    expect(ngMocks.findAll(fixture, 'td.score-col .delta')).toHaveLength(0);
    expect(ngMocks.findAll(fixture, 'td.rank-col .delta')).toHaveLength(0);
    expect(ngMocks.findAll(fixture, '.scout-tag--rising')).toHaveLength(0);
  });

  it('leaves the ice cells of a goalie, or a skater with no recent game, empty', () => {
    const fixture = render([row(1, 'Brandon Montour', 1), goalieRow(2, 2)], { view: 'ice' });

    const rows = ngMocks.findAll(fixture, 'tbody tr');
    expect(ngMocks.formatText(ngMocks.findAll(rows[0], 'td')[3])).toBe('');
    expect(ngMocks.formatText(ngMocks.findAll(rows[1], 'td')[3])).toBe('');
    expect(ngMocks.findAll(fixture, 'td.lineup-col')).toHaveLength(2);
  });

  it('lists a goalie among the skaters with his ice time cell empty, and heads none over goalies alone', () => {
    const fixture = render([row(1, 'Brandon Montour', 1), goalieRow(2, 2)]);
    const toi = ngMocks.findAll(fixture, 'td.toi-col');
    expect(toi).toHaveLength(2);
    expect(ngMocks.formatText(toi[1])).toBe('');

    const goalies = render([goalieRow(2, 2)]);
    expect(ngMocks.findAll(goalies, 'th.toi-col')).toHaveLength(0);
  });

  it('says who holds each player when asked to', () => {
    const fixture = render(
      [
        row(1, 'Brandon Montour', 1),
        row(2, 'Cale Makar', 2, { owner: { teamName: 'Slapshots', mine: true } }),
        row(3, 'Nathan MacKinnon', 3, { owner: { teamName: 'Someone Else', mine: false } }),
      ],
      { showOwner: true },
    );

    const tags = ngMocks.findAll(fixture, '.scout-tag').map((tag) => ngMocks.formatText(tag));
    expect(tags).toEqual(['FA', 'Your team: Slapshots', 'Someone Else']);
    expect(ngMocks.findAll(fixture, '.scout-tag--free')).toHaveLength(1);
    const mine = ngMocks.findAll(fixture, '.scout-tag--mine');
    expect(mine).toHaveLength(1);
    expect(ngMocks.formatText(mine[0])).toBe('Your team: Slapshots');
    // Another team's name is plain text, not a chip: context, not a thing to find.
    const held = ngMocks.findAll(fixture, '.scout-tag--held');
    expect(held).toHaveLength(1);
    expect(ngMocks.formatText(held[0])).toBe('Someone Else');
  });

  it('marks a waivers player as such, with or without the owners shown', () => {
    const rows = [
      row(1, 'Brandon Montour', 1),
      row(2, 'Jake Walman', 2, { availability: 'WAIVERS' }),
    ];

    const plain = render(rows);
    expect(ngMocks.findAll(plain, '.scout-tag').map((tag) => ngMocks.formatText(tag))).toEqual([
      'Waivers',
    ]);

    const withOwners = render(rows, { showOwner: true });
    expect(ngMocks.findAll(withOwners, '.scout-tag').map((tag) => ngMocks.formatText(tag))).toEqual(
      ['FA', 'Waivers'],
    );
    // Yellow for the claim, a wait; the add keeps the green.
    expect(ngMocks.findAll(withOwners, '.scout-tag--waivers')).toHaveLength(1);
  });

  it("dims another team's player only on a list with someone to pick up", () => {
    const taken = { teamName: 'Someone Else', mine: false };
    const mixed = render(
      [
        row(1, 'Brandon Montour', 1),
        row(2, 'Cale Makar', 2, { owner: { teamName: 'Slapshots', mine: true } }),
        row(3, 'Nathan MacKinnon', 3, { owner: taken }),
      ],
      { showOwner: true },
    );
    const dimmed = (fixture: typeof mixed) =>
      ngMocks
        .findAll(fixture, 'tr.player-row')
        .map((tr) => tr.nativeElement.classList.contains('player-row--held'));
    expect(dimmed(mixed)).toEqual([false, false, true]);

    const takenOnly = render(
      [row(1, 'Brandon Montour', 1, { owner: taken }), row(2, 'Cale Makar', 2, { owner: taken })],
      { showOwner: true },
    );
    expect(dimmed(takenOnly)).toEqual([false, false]);
  });

  it("heads a column for each of the league's categories", () => {
    const fixture = render([row(1, 'Brandon Montour', 1)]);

    const headings = ngMocks.findAll(fixture, 'th.stat-col').map((th) => ngMocks.formatText(th));
    expect(headings).toEqual(['G', 'A']);
  });

  it('asks the page to sort by a heading pressed, the change only with a comparison on', () => {
    const sortBy = vi.fn();
    const fixture = MockRender(ScoutTableComponent, {
      rows: [row(1, 'Brandon Montour', 1, { thenRank: 3, thenToi: 1050 })],
      scoringType: 'points',
      categories: ['goals', 'assists'],
      compare: true,
      sortBy,
    });
    press(fixture, 'change');
    press(fixture, 'GP');
    ngMocks.find(fixture, 'th.stat-col button.sort').nativeElement.click();

    expect(sortBy.mock.calls).toEqual([['delta'], ['games'], ['goals']]);
    expect(ngMocks.findAll(render([row(1, 'Brandon Montour', 1)]), '.sort--delta')).toHaveLength(0);
  });

  it('asks the page to sort the ice view by the ice or the power play', () => {
    const sortBy = vi.fn();
    const fixture = MockRender(ScoutTableComponent, {
      rows: [row(1, 'Brandon Montour', 1, { usage: USAGE })],
      scoringType: 'points',
      categories: ['goals', 'assists'],
      view: 'ice',
      sortBy,
    });
    press(fixture, 'Ice / game');
    press(fixture, 'PP share');

    expect(sortBy.mock.calls).toEqual([['ice'], ['powerPlay']]);
  });

  it('marks the column the list is sorted by, and which way', () => {
    const fixture = MockRender(ScoutTableComponent, {
      rows: [row(1, 'Brandon Montour', 1)],
      scoringType: 'points',
      categories: ['goals', 'assists'],
      sort: { key: 'assists', descending: false },
    });

    const sorted = ngMocks.findAll(fixture, 'th[aria-sort]');
    expect(sorted).toHaveLength(1);
    expect(ngMocks.formatText(sorted[0])).toBe('A');
    expect(sorted[0].nativeElement.getAttribute('aria-sort')).toBe('ascending');
  });

  it('has no gain column without a drop, nor in the ice view', () => {
    expect(ngMocks.formatText(render([row(1, 'Brandon Montour', 1)]))).not.toContain('Gain');
    expect(
      ngMocks.formatText(
        render([row(1, 'Brandon Montour', 1)], {
          view: 'ice',
          gains: new Map(),
          dropName: 'Hughes',
        }),
      ),
    ).not.toContain('Gain');
  });

  it('heads a sortable gain column by the drop, each gain inked by its sign, the three biggest washed in green and a pickup it could not price as a question', () => {
    const sortBy = vi.fn();
    const fixture = MockRender(ScoutTableComponent, {
      rows: [
        row(1, 'Brandon Montour', 1),
        row(2, 'Ryan Graves', 2),
        row(3, 'Nobody', 3),
        row(4, 'Pavel Zacha', 4),
        row(5, 'Conor Garland', 5),
        row(6, 'Cale Makar', 6, { owner: { teamName: 'Slapshots', mine: true } }),
        row(7, 'Steady Eddie', 7),
      ],
      scoringType: 'points',
      categories: ['goals', 'assists'],
      gains: new Map<string, number | null>([
        ['1', 25],
        ['2', -4.25],
        ['3', null],
        ['4', 80],
        ['5', 70],
        ['7', 0.04],
      ]),
      dropName: 'Hughes',
      sortBy,
    });

    const heading = ngMocks.find(fixture, 'th.gain-col');
    expect(ngMocks.formatText(heading)).toBe('vs Hughes');
    expect(ngMocks.findAll(fixture, 'td[tabindex]')).toHaveLength(0);
    const cells = ngMocks.findAll(fixture, 'td.gain-col');
    expect(cells.map((cell) => ngMocks.formatText(cell))).toEqual([
      '+25.0',
      '-4.3',
      '?',
      '+80.0',
      '+70.0',
      '',
      '0.0',
    ]);
    expect(cells.map((cell) => cell.nativeElement.classList.contains('gain-col--top'))).toEqual([
      true,
      false,
      false,
      true,
      true,
      false,
      false,
    ]);
    const tone = (cell: { nativeElement: HTMLElement }) =>
      cell.nativeElement.querySelector('.gain')?.className.match(/gain--\w+/)?.[0] ?? null;
    expect(cells.map(tone)).toEqual([
      'gain--up',
      'gain--down',
      null,
      'gain--up',
      'gain--up',
      null,
      'gain--flat',
    ]);
    // The phone's line in the player cell says the same, for every pickup.
    const lines = ngMocks.findAll(fixture, '.player-gain');
    expect(lines.map((line) => ngMocks.formatText(line))).toEqual([
      'Gain +25.0',
      'Gain -4.3',
      'Gain ?',
      'Gain +80.0',
      'Gain +70.0',
      'Gain 0.0',
    ]);
    expect(lines[3].nativeElement.classList).toContain('player-gain--top');

    press(fixture, 'vs Hughes');
    expect(sortBy.mock.calls).toEqual([['gain']]);
  });
});
