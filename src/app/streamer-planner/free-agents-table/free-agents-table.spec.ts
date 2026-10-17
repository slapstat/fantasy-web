import { By } from '@angular/platform-browser';
import { MockBuilder, MockRender, ngMocks } from 'ng-mocks';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  GOALIE_SCORING_STAT_KEYS,
  ScoringStatKey,
  SKATER_SCORING_STAT_KEYS,
} from '../../models/stat-key.model';
import { TeamLogoComponent } from '../../shared/team-logo/team-logo';
import { RankedFreeAgent } from '../planner-free-agents';
import { FreeAgentsTableComponent } from './free-agents-table';

function scoringLine<K extends string>(keys: readonly K[], set: Record<string, number>) {
  return keys.reduce(
    (line, key) => ({ ...line, [key]: set[key] ?? 0 }),
    {} as Record<K, number>,
  ) as never;
}

const SKATER_STATS = {
  goals: 2.1,
  assists: 3,
  sog: 11.2,
  pim: 1.5,
  ppp: 0.8,
  blocks: 2,
  hits: 6.4,
};
const GOALIE_STATS = { w: 1.4, sv: 57.4, svPct: 0.908, gaa: 2.61 };

const SKATER_PLAYER: RankedFreeAgent['player'] = {
  playerId: '1',
  name: 'Top Scorer',
  teamAbbrev: 'EDM',
  positions: ['C', 'LW'],
  availability: 'FREE_AGENT',
  clubGames: 4,
  expectedGames: 3.75,
  projected: new Set(Object.keys(SKATER_STATS)),
  projection: {
    type: 'skater',
    playerId: 1,
    stats: {
      scoring: scoringLine(SKATER_SCORING_STAT_KEYS, SKATER_STATS),
      utility: { gp: 3.75, toiPerGame: 1052 },
    },
  },
};

const SKATER: RankedFreeAgent = {
  rank: 1,
  score: 11.25,
  games: 3.75,
  player: SKATER_PLAYER,
  line: SKATER_PLAYER.projection,
};

const GOALIE_PLAYER: RankedFreeAgent['player'] = {
  playerId: '2',
  name: 'Waiver Goalie',
  teamAbbrev: 'TB',
  positions: ['G'],
  availability: 'WAIVERS',
  clubGames: 3,
  expectedGames: 2,
  projected: new Set(Object.keys(GOALIE_STATS)),
  projection: {
    type: 'goalie',
    playerId: 2,
    stats: {
      scoring: scoringLine(GOALIE_SCORING_STAT_KEYS, GOALIE_STATS),
      utility: { gp: 2 },
    },
  },
};

const GOALIE: RankedFreeAgent = {
  rank: 3,
  score: 4,
  games: 2,
  player: GOALIE_PLAYER,
  line: GOALIE_PLAYER.projection,
};

const SECOND_SKATER: RankedFreeAgent = {
  ...SKATER,
  rank: 2,
  score: 6,
  player: { ...SKATER_PLAYER, playerId: '4', name: 'Second Line', teamAbbrev: 'TB' },
};

/** Two skaters; the goalie joins them where a test says so. */
const ROWS: RankedFreeAgent[] = [SKATER, SECOND_SKATER];

/** A Yahoo categories league: seven for skaters, three for goalies, in the league's order. */
const CATEGORIES: ScoringStatKey[] = [
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
];

describe('FreeAgentsTableComponent', () => {
  beforeEach(() => MockBuilder(FreeAgentsTableComponent));

  function render(
    scoringType: 'points' | 'category' = 'points',
    categories: ScoringStatKey[] = CATEGORIES,
    rows: RankedFreeAgent[] = ROWS,
    top = 0,
    listed?: RankedFreeAgent[],
  ) {
    const fixture = MockRender(FreeAgentsTableComponent, {
      rows,
      listed,
      scoringType,
      categories,
      top,
    });
    fixture.detectChanges();
    return fixture;
  }

  function headings(fixture: ReturnType<typeof render>): string[] {
    return ngMocks.findAll(fixture, 'thead .stat-col').map((cell) => ngMocks.formatText(cell));
  }

  /** Each player's stat cells: a cell a column. */
  function cells(fixture: ReturnType<typeof render>): string[][] {
    return ngMocks
      .findAll(fixture, 'tbody tr')
      .map((row) => ngMocks.findAll(row, 'td.stat-col').map((cell) => ngMocks.formatText(cell)));
  }

  it('writes the players as one list in the order given, each with the rank he was given', () => {
    const fixture = render();
    const rows = ngMocks.findAll(fixture, 'tbody tr.player-row');

    expect(rows.map((row) => ngMocks.formatText(ngMocks.find(row, '.rank-col')))).toEqual([
      '1',
      '2',
    ]);
    expect(ngMocks.formatText(rows[0])).toContain('Top Scorer');
    expect(ngMocks.formatText(rows[1])).toContain('Second Line');
  });

  /** Each row's medal, by its rank badge's class; null for a row that wears none. */
  function medals(fixture: ReturnType<typeof render>): (string | null)[] {
    return ngMocks.findAll(fixture, 'tbody tr.player-row').map((row) => {
      const badge = ngMocks.find(row, '.rank').nativeElement as HTMLElement;
      const medal = [...badge.classList].find((name) => name.startsWith('rank--'));
      return medal ? medal.slice('rank--'.length) : null;
    });
  }

  it('sets off as many places as the page asks for, and none unasked', () => {
    expect(medals(render())).toEqual([null, null]);

    const fixture = render('points', CATEGORIES, [SKATER, SECOND_SKATER, GOALIE], 2);
    expect(medals(fixture)).toEqual(['gold', 'silver', null]);
    expect(
      ngMocks
        .findAll(fixture, 'tbody tr.player-row')
        .map((row) => row.nativeElement.classList.contains('player-row--top')),
    ).toEqual([true, true, false]);
    // Said, not only drawn: the badge is colour and shape alone.
    expect(ngMocks.findAll(fixture, 'tbody .rank-col .sr-only')).toHaveLength(2);
  });

  it('gives the medal for the rank shown, not for the row, in a list narrowed to some positions', () => {
    // Second, fourth and sixth of everyone: only the second is one of the best three.
    const at = (rank: number, playerId: string): RankedFreeAgent => ({
      ...SKATER,
      rank,
      player: { ...SKATER_PLAYER, playerId },
    });
    const fixture = render('points', CATEGORIES, [at(2, '10'), at(4, '11'), at(6, '12')], 3);

    expect(medals(fixture)).toEqual(['silver', null, null]);
    expect(ngMocks.findAll(fixture, 'tbody .rank-col .sr-only')).toHaveLength(1);
  });

  it('writes the rate a game under the score, in the same cell rather than a column', () => {
    const fixture = render();

    const rates = ngMocks.findAll(fixture, 'tbody td.score .per-game');
    expect(rates.map((cell) => ngMocks.formatText(cell))).toEqual(['3.0/G', '1.6/G']);
    expect(ngMocks.findAll(fixture, 'td.rate-col')).toHaveLength(0);
  });

  it("writes the score the way the league's scoring is written, with the rate a game", () => {
    const fixture = render();
    const table = fixture.point.componentInstance;

    expect(table.scoreHeading()).toBe('Proj. pts');
    expect(table.score(SKATER)).toBe('11.3');
    expect(table.perGame(SKATER)).toBe('3.0/G');

    const category = render('category');
    expect(category.point.componentInstance.scoreHeading()).toBe('Z-Score');
    expect(category.point.componentInstance.score(SKATER)).toBe('11.25');
  });

  it('gives a skater his ice time and his games, and a goalie a dash for ice time', () => {
    const fixture = render();
    const table = fixture.point.componentInstance;

    expect(table.toi(SKATER)).toBe('17:32');
    expect(table.toi(GOALIE)).toBe('—');
    expect(table.games(SKATER)).toBe('4');
  });

  it('heads a column with each skater category the league scores, named once', () => {
    const fixture = render();

    expect(headings(fixture)).toEqual(['G', 'A', 'SOG', 'PIM', 'PPP', 'BLK', 'HIT']);
    expect(cells(fixture)[0]).toEqual(['2.1', '3.0', '11.2', '1.5', '0.8', '2.0', '6.4']);
  });

  it("lists skaters and goalies together, each a faint dash under the other kind's categories", () => {
    const fixture = render('points', CATEGORIES, [SKATER, GOALIE]);

    expect(headings(fixture)).toEqual([
      'G',
      'A',
      'SOG',
      'PIM',
      'PPP',
      'BLK',
      'HIT',
      'W',
      'GAA',
      'SV%',
    ]);
    expect(cells(fixture)).toEqual([
      ['2.1', '3.0', '11.2', '1.5', '0.8', '2.0', '6.4', '—', '—', '—'],
      ['—', '—', '—', '—', '—', '—', '—', '1.4', '2.61', '0.908'],
    ]);
    // Seven skater categories on the goalie's row, three goalie ones on the skater's, and his ice time.
    expect(ngMocks.findAll(fixture, 'tbody td.not-his')).toHaveLength(11);
    // A rule before the first category, and another before the goalies' first.
    expect(
      ngMocks.findAll(fixture, 'thead .stat-col--start').map((cell) => ngMocks.formatText(cell)),
    ).toEqual(['G', 'W']);
    // Ice time a game: the skater's, and a dash on the goalie's row.
    expect(
      ngMocks.findAll(fixture, 'tbody td.toi-col').map((cell) => ngMocks.formatText(cell)),
    ).toEqual(['17:32', '—']);
  });

  it('draws no ice-time column over goalies alone', () => {
    const fixture = render('points', CATEGORIES, [GOALIE]);

    expect(headings(fixture)).toEqual(['W', 'GAA', 'SV%']);
    expect(ngMocks.findAll(fixture, 'thead .stat-col--start')).toHaveLength(1);
    expect(ngMocks.findAll(fixture, '.toi-col').length).toBe(0);
  });

  it("keeps the whole list's columns on a page that has none of its goalies", () => {
    const fixture = render('points', CATEGORIES, ROWS, 0, [...ROWS, GOALIE]);

    expect(headings(fixture)).toEqual([
      'G',
      'A',
      'SOG',
      'PIM',
      'PPP',
      'BLK',
      'HIT',
      'W',
      'GAA',
      'SV%',
    ]);
    // The skaters on the page have nothing of their own under the goalies' categories.
    expect(cells(fixture)[0].slice(7)).toEqual(['—', '—', '—']);
  });

  it("keeps the whole list's ice-time column on a page of goalies alone", () => {
    const fixture = render('points', CATEGORIES, [GOALIE], 0, [SKATER, GOALIE]);

    expect(headings(fixture)).toHaveLength(10);
    expect(
      ngMocks.findAll(fixture, 'tbody td.toi-col').map((cell) => ngMocks.formatText(cell)),
    ).toEqual(['—']);
  });

  it('follows the league: other categories, other columns', () => {
    const fixture = render('points', ['goals', 'assists', 'sv']);

    expect(headings(fixture)).toEqual(['G', 'A']);
    expect(cells(fixture)).toEqual([
      ['2.1', '3.0'],
      ['2.1', '3.0'],
    ]);
  });

  it('leaves a cell empty where the model gave the player no number, and keeps the column', () => {
    const bare: RankedFreeAgent = {
      ...SKATER,
      rank: 3,
      player: { ...SKATER_PLAYER, playerId: '3', projected: new Set(['goals']) },
    };
    const fixture = render('points', ['goals', 'assists'], [SKATER, bare]);

    expect(cells(fixture)).toEqual([
      ['2.1', '3.0'],
      ['2.1', ''],
    ]);
    // A number left out is not a category he cannot have: blank, not the dash.
    expect(ngMocks.findAll(fixture, 'tbody td.not-his')).toHaveLength(0);
  });

  it('draws no stat cells where the league scores nothing for the players listed', () => {
    const fixture = render('points', ['w']);

    expect(headings(fixture)).toEqual([]);
    expect(cells(fixture)).toEqual([[], []]);
  });

  // A 0.0 in grey read as another font beside the figures around it.
  it('shows a category he is projected nothing in like any other figure', () => {
    const idle: RankedFreeAgent = {
      ...SKATER,
      line: {
        ...SKATER_PLAYER.projection,
        stats: {
          scoring: scoringLine(SKATER_SCORING_STAT_KEYS, { ...SKATER_STATS, ppp: 0 }),
          utility: { gp: 3.75, toiPerGame: 1052 },
        },
      } as RankedFreeAgent['line'],
    };
    const fixture = render('points', ['goals', 'ppp'], [idle]);

    const zero = ngMocks
      .findAll(fixture, 'td.stat-col')
      .find((cell) => ngMocks.formatText(cell) === '0.0');
    expect(zero).toBeDefined();
    expect(zero?.nativeElement.classList.contains('nil')).toBe(false);
  });

  // The crest already says which club; the abbreviation beside it said it twice.
  it('names the club by its crest alone, which then carries the name for a screen reader', () => {
    const fixture = render();
    const logos = ngMocks.findAll(fixture, TeamLogoComponent);

    expect(logos.map((logo) => ngMocks.input(logo, 'alt'))).toEqual(['EDM', 'TB']);
    expect(ngMocks.formatText(ngMocks.findAll(fixture, '.player-name')[0])).toBe('Top Scorer');
  });

  // A game only a drop opens takes the dropped player's place, so it sits beside the games.
  it('marks beside his games, in whole games, those only a drop makes room for', () => {
    const fixture = render('points', CATEGORIES, [
      { ...SKATER, dropGames: 1.6 },
      { ...SECOND_SKATER, dropGames: 0.4 },
      GOALIE,
    ]);
    const marks = ngMocks.findAll(fixture, '.drop-games');

    expect(marks.map((mark) => ngMocks.formatText(mark))).toEqual(['+2']);
    // In the games cell, raised after his own four, and a mark rather than a control.
    expect(ngMocks.formatText(marks[0].parent!)).toBe('4 +2');
    expect(marks[0].nativeElement.tagName).toBe('SPAN');
    expect(marks[0].attributes['aria-label']).toBe('2 additional games from a position drop.');
    expect(
      fixture.point.componentInstance
        .dropGamesTip({ ...SKATER, dropGames: 1 })
        .startsWith('1 additional game from'),
    ).toBe(true);
  });

  // Counted by the page, the games are his already: no mark, but his score, his games and each
  // count in yellow, the games figure saying how many of them are his only with a drop.
  it('draws, once the page counts the games, his figures in yellow instead of marking them', () => {
    const fixture = MockRender(FreeAgentsTableComponent, {
      rows: [{ ...SKATER, dropGames: 1.6 }, GOALIE],
      scoringType: 'points',
      categories: CATEGORIES,
      dropsCounted: true,
    });
    fixture.detectChanges();
    const rows = ngMocks.findAll(fixture, 'tbody tr');

    expect(ngMocks.findAll(fixture, '.drop-games')).toHaveLength(0);
    expect(ngMocks.findAll(fixture, '.lift')).toHaveLength(0);
    // The score, the games and the categories he scores in; not the rate a game or the ice time.
    expect(ngMocks.findAll(rows[0], 'td.score .figure--drop')).toHaveLength(1);
    const his = ngMocks.findAll(rows[0], 'td.stat-col:not(.not-his)');
    expect(his.length).toBeGreaterThan(0);
    expect(ngMocks.findAll(rows[0], 'td.stat-col:not(.not-his) .figure--drop')).toHaveLength(
      his.length,
    );
    expect(ngMocks.findAll(rows[0], 'td.not-his .figure--drop')).toHaveLength(0);
    expect(ngMocks.findAll(rows[0], '.figure--drop .per-game')).toHaveLength(0);
    expect(ngMocks.findAll(rows[0], 'td.toi-col .figure--drop')).toHaveLength(0);
    const games = ngMocks.find(rows[0], '.games-in-drop');
    expect(ngMocks.formatText(games)).toBe('4');
    // No tip of its own: the tick box's help says what the yellow means.
    expect(games.attributes['role']).toBeUndefined();
    expect(games.attributes['aria-label']).toBeUndefined();
    // The goalie, who has no such game, keeps his figures as they were.
    expect(ngMocks.findAll(rows[1], '.figure--drop')).toHaveLength(0);
  });

  // What the drop's games would give him is marked beside each number they move, and the score,
  // where the reader can take it or leave it; the figures and the order stay the list's own.
  describe('with the line a drop would give him', () => {
    const liftedLine = {
      ...SKATER_PLAYER.projection,
      stats: {
        scoring: scoringLine(SKATER_SCORING_STAT_KEYS, {
          ...SKATER_STATS,
          goals: 2.8,
          assists: 4,
          ppp: 0.8,
        }),
        utility: { gp: 5, toiPerGame: 1052 },
      },
    } as RankedFreeAgent['line'];
    const liftable: RankedFreeAgent = {
      ...SKATER,
      dropGames: 1.25,
      lifted: { line: liftedLine, score: 15 },
    };

    it('marks beside the score and each count that moves what the games would add, and nothing else', () => {
      const fixture = render('points', ['goals', 'assists', 'ppp'], [liftable, GOALIE]);
      const row = ngMocks.findAll(fixture, 'tbody tr')[0];
      const figures = row
        .queryAll(By.css('td.num:not(.rank-col)'))
        .map((cell) => ngMocks.formatText(cell));

      // His own figures, each with the mark after it: the score, the games, goals and assists.
      // Not the rate a game stacked under the score, the ice time, or the power-play points the
      // game leaves at 0.8.
      expect(figures).toEqual([
        '11.3 +3.8' + '3.0/G',
        '4 +1',
        '17:32',
        '2.1 +0.7',
        '3.0 +1.0',
        '0.8',
      ]);
      expect(ngMocks.findAll(row, '.lift').map((mark) => mark.attributes['aria-label'])).toEqual([
        'would add +3.8',
        'would add +0.7',
        'would add +1.0',
      ]);
      // The goalie, whom a drop adds nothing to, has none.
      expect(ngMocks.findAll(ngMocks.findAll(fixture, 'tbody tr')[1], '.lift')).toHaveLength(0);
    });

    // The marks hang off the figures, outside the cell's width; the table makes room for them in
    // every number column at once, so the one lifted row never widens a column on its own.
    it('keeps room for the marks in every number column while any row wears one', () => {
      const fixture = render('points', CATEGORIES, [liftable, GOALIE]);
      const table = ngMocks.find(fixture, 'table');

      expect(table.classes['free-agents-table--marked']).toBe(true);
    });

    // Counted, nothing hangs off a figure, but the table keeps the room: ticking the box once
    // narrowed every number column under the reader's pointer.
    it('keeps the room once the games are counted, and none where no row has any', () => {
      const counted = MockRender(FreeAgentsTableComponent, {
        rows: [{ ...liftable, lifted: undefined }, GOALIE],
        scoringType: 'points',
        categories: CATEGORIES,
        dropsCounted: true,
      });
      counted.detectChanges();
      expect(ngMocks.find(counted, 'table').classes['free-agents-table--marked']).toBe(true);
      expect(ngMocks.findAll(counted, '.lift, .drop-games')).toHaveLength(0);

      const bare = render('points', CATEGORIES, [SKATER, GOALIE]);
      expect(ngMocks.find(bare, 'table').classes['free-agents-table--marked']).toBeFalsy();
    });

    it('marks nothing beside a score the games leave as it was', () => {
      const fixture = render('points', CATEGORIES, [
        { ...liftable, lifted: { line: liftedLine, score: SKATER.score + 0.04 } },
      ]);

      expect(ngMocks.findAll(fixture, 'td.score .lift')).toHaveLength(0);
    });
  });

  // An add is what the list is a list of; only a claim changes what the reader does next.
  it('tags a player on waivers and nobody else', () => {
    const claim: RankedFreeAgent = {
      ...SECOND_SKATER,
      player: { ...SECOND_SKATER.player, availability: 'WAIVERS' },
    };
    const fixture = render('points', CATEGORIES, [SKATER, claim]);
    const tags = ngMocks.findAll(fixture, '.player-status');

    expect(tags.length).toBe(1);
    expect(ngMocks.formatText(tags[0])).toBe('Waivers');
    // After the positions, not among them, where a W would read as a wing.
    expect(tags[0].parent?.classes['player-role']).toBe(true);
    expect(ngMocks.formatText(ngMocks.find(fixture, '.player-row'))).not.toContain('Free agent');
  });
  // Ranked by a few categories, those are the columns the order is read from.
  it('marks the columns the list is ranked by, and steps the rest back', () => {
    const fixture = MockRender(FreeAgentsTableComponent, {
      rows: [SKATER],
      scoringType: 'category',
      categories: ['goals', 'ppp', 'sog'],
      focus: new Set<ScoringStatKey>(['ppp']),
    });
    fixture.detectChanges();

    const text = (selector: string) =>
      ngMocks.findAll(fixture, selector).map((cell) => ngMocks.formatText(cell));
    expect(text('thead .stat-col--focus')).toEqual(['PPP']);
    expect(text('thead .stat-col--muted')).toEqual(['G', 'SOG']);
    expect(text('tbody .stat-col--focus')).toEqual(['0.8']);
  });

  it('names the score and the rate a game under it by how the league scores', () => {
    const points = render('points').point.componentInstance;
    expect(points.scoreTip()).toBe('Projected points, and per game under it');

    const categories = render('category').point.componentInstance;
    expect(categories.scoreTip()).toBe('Z-Score across your categories, and per game under it');
  });

  it('marks no column while the list is ranked by every category', () => {
    const fixture = render('category', ['goals', 'ppp'], [SKATER]);

    expect(ngMocks.findAll(fixture, '.stat-col--focus, .stat-col--muted')).toHaveLength(0);
  });

  describe('percent rostered', () => {
    it("has no such column on a league's list", () => {
      const fixture = render();

      expect(ngMocks.findAll(fixture, '.rostered-col')).toHaveLength(0);
    });

    it('is a column of its own beside the games on the demo list', () => {
      const rows: RankedFreeAgent[] = [
        { ...SKATER, player: { ...SKATER_PLAYER, percentRostered: 41 } },
        { ...SECOND_SKATER, player: { ...SECOND_SKATER.player, percentRostered: 3 } },
      ];
      const fixture = render('points', CATEGORIES, rows);

      const heads = ngMocks.findAll(fixture, 'thead th').map((cell) => ngMocks.formatText(cell));
      expect(heads.indexOf('% Rost.')).toBe(heads.indexOf('GP') + 1);
      expect(
        ngMocks.findAll(fixture, 'td.rostered-col').map((cell) => ngMocks.formatText(cell)),
      ).toEqual(['41%', '3%']);
    });
  });
});

describe('FreeAgentsTableComponent headings', () => {
  beforeEach(() => MockBuilder(FreeAgentsTableComponent));

  it('asks the page to sort by a heading pressed, and marks the column the list is sorted by', () => {
    const asked: string[] = [];
    const fixture = MockRender(FreeAgentsTableComponent, {
      rows: [SKATER, SECOND_SKATER],
      scoringType: 'points',
      categories: ['goals', 'blocks'],
      sort: { key: 'blocks', descending: true },
      sortBy: (key: string) => asked.push(key),
    });
    fixture.detectChanges();

    const sorted = ngMocks.findAll(fixture, 'thead th[aria-sort]');
    expect(sorted.map((cell) => [ngMocks.formatText(cell), cell.attributes['aria-sort']])).toEqual([
      ['BLK', 'descending'],
    ]);

    const buttons = ngMocks.findAll(fixture, 'thead button.sort');
    expect(buttons.map((button) => ngMocks.formatText(button))).toEqual([
      'Player',
      'Proj. pts',
      'GP',
      'TOI',
      'G',
      'BLK',
    ]);
    for (const button of buttons) {
      (button.nativeElement as HTMLButtonElement).click();
    }
    expect(asked).toEqual(['name', 'score', 'games', 'toi', 'goals', 'blocks']);
  });
});
