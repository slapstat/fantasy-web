import { NgTemplateOutlet } from '@angular/common';
import { MockBuilder, MockRender, ngMocks } from 'ng-mocks';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LeagueProjectionSettingsResponse } from '../api/models/league-projection-settings-response';
import { Projection } from '../models/projection.model';
import { GOALIE_SCORING_STAT_KEYS } from '../models/stat-key.model';
import { EspnService } from '../services/espn.service';
import { ChosenLeague, LeagueChoiceService } from '../services/league-choice.service';
import {
  PlayerScoutService,
  ScoutList,
  ScoutOwner,
  ScoutPlayer,
  ScoutQuery,
  ScoutTeamAnswer,
  TeamPlayer,
} from '../services/player-scout.service';
import { YahooConnectReturnService } from '../services/yahoo-connect-return.service';
import { YahooService } from '../services/yahoo.service';
import { ErrorStateComponent } from '../shared/error-state/error-state';
import { YahooLeaguePicker } from '../shared/yahoo-league-picker';
import {
  DEFAULT_RECENT_GAMES,
  PlayerScoutComponent,
  SCOUT_PAGE_SIZE,
  surname,
} from './player-scout';
import { ScoutTableComponent } from './scout-table/scout-table';
import { SincePickerComponent } from './since-picker/since-picker';

const LEAGUE: ChosenLeague = { platform: 'YAHOO', leagueId: '465.l.9', name: 'The Gordie Howes' };

const SETTINGS: LeagueProjectionSettingsResponse = {
  leagueName: 'The Gordie Howes',
  scoringType: 'points',
  statWeights: { goals: 3, assists: 2 },
  activeScoringColumns: ['goals', 'assists'],
  activeUtilityColumns: ['gp'],
  // No goalie seats and no bench, so the team below fills the roster to the last spot.
  rosterSlots: { c: 2, lw: 2, rw: 2, w: 0, f: 0, d: 4, g: 0, util: 1, bn: 0 },
  leagueSize: 12,
  unsupportedRosterCodes: [],
  unsupportedStats: [],
};

/** Ten nights every club plays: the lineup is the whole question. */
const NIGHTS = Array.from(
  { length: 10 },
  (_, index) => `2026-11-${String(index + 1).padStart(2, '0')}`,
);

function skater(playerId: number, goals: number, assists: number, games = 70): Projection {
  return {
    type: 'skater',
    playerId,
    stats: {
      scoring: { goals, assists } as never,
      utility: { gp: games, toiPerGame: 1100 },
    },
  };
}

function goalie(playerId: number): Projection {
  return {
    type: 'goalie',
    playerId,
    // A whole line, as the service hands the ranking engine one: every goalie stat, zero or not.
    stats: {
      scoring: { ...Object.fromEntries(GOALIE_SCORING_STAT_KEYS.map((key) => [key, 0])), w: 20 },
      utility: { gp: 40 },
    },
  } as Projection;
}

function scoutPlayer(
  now: Projection,
  then: Projection | null,
  positions: string[] = ['C'],
  owner: ScoutOwner | null = null,
  extra: Partial<ScoutPlayer> = {},
): ScoutPlayer {
  return {
    freeAgent: {
      projection: now,
      playerId: String(now.playerId),
      name: `Player ${now.playerId}`,
      teamAbbrev: owner ? 'EDM' : 'SEA',
      positions,
      availability: owner ? 'UNKNOWN' : 'FREE_AGENT',
      clubGames: now.stats.utility.gp,
      expectedGames: now.stats.utility.gp,
      projected: new Set(['goals', 'assists']),
    },
    nhlId: 8400000 + now.playerId,
    type: now.type,
    owner,
    then,
    thenProjected: new Set(then ? ['goals', 'assists'] : []),
    usage: null,
    ...extra,
  };
}

function teamPlayer(now: Projection, positions: string[], reserve = false): TeamPlayer {
  return {
    playerId: String(now.playerId),
    name: `Mine ${now.playerId}`,
    teamAbbrev: 'EDM',
    type: now.type,
    positions,
    reserve,
    out: reserve,
    reserveEligible: [],
    projection: now,
  };
}

const MINE: ScoutOwner = { teamName: 'Slapshots', mine: true };
const THEIRS: ScoutOwner = { teamName: 'Someone Else', mine: false };

/**
 * The user's team against the league's 2 C / 2 LW / 2 RW / 4 D / 1 Util lineup, a full roster:
 * seven forwards for the seven forward and Util seats, exactly four D, and a player on injured
 * reserve who holds no roster spot. Everyone with a seat starts every night.
 */
const TEAM_LINES: readonly [Projection, string[], boolean?][] = [
  [skater(201, 40, 50), ['C']],
  [skater(202, 1, 2), ['C']],
  [skater(203, 1, 1), ['C']],
  ...([204, 205, 206, 212] as const).map(
    (id) => [skater(id, 20, 20), ['LW', 'RW']] as [Projection, string[]],
  ),
  [skater(207, 10, 20), ['D']],
  [skater(208, 10, 20), ['D']],
  [skater(209, 10, 20), ['D']],
  [skater(210, 1, 4), ['D']],
  [skater(211, 0, 0), ['C'], true],
];

function team(): ScoutTeamAnswer {
  return {
    team: {
      found: true,
      teamName: 'Slapshots',
      players: TEAM_LINES.map(([line, positions, reserve]) => teamPlayer(line, positions, reserve)),
    },
    schedule: new Map([
      ['EDM', NIGHTS],
      ['SEA', NIGHTS],
    ]),
  };
}

/**
 * Twenty depth forwards the model rated the same on the day and now, one defenceman who has since
 * taken a top role, a goalie, a player on waivers, the user's own players, and one of another
 * team's.
 */
function league(): ScoutList {
  const depth = Array.from({ length: 20 }, (_, index) =>
    scoutPlayer(skater(index + 1, 10, 20 - index * 0.5), skater(index + 1, 10, 20 - index * 0.5)),
  );
  const waived = scoutPlayer(skater(98, 8, 8), skater(98, 8, 8), ['LW']);
  return {
    inSeason: true,
    since: { requested: '2026-10-07', kind: 'SNAPSHOT', resolved: '2026-10-07' },
    recentGames: DEFAULT_RECENT_GAMES,
    players: [
      ...depth,
      scoutPlayer(skater(99, 12, 40), skater(99, 4, 10), ['D']),
      scoutPlayer(goalie(50), goalie(50), ['G']),
      {
        ...waived,
        freeAgent: { ...waived.freeAgent, availability: 'WAIVERS', teamAbbrev: 'TB' },
      },
      ...TEAM_LINES.map(([line, positions]) => scoutPlayer(line, line, positions, MINE)),
      scoutPlayer(skater(301, 30, 30), skater(301, 35, 35), ['C'], THEIRS),
    ],
  };
}

describe('PlayerScoutComponent', () => {
  let chosen: ChosenLeague | null;
  let players: ReturnType<typeof vi.fn<(...args: unknown[]) => Observable<ScoutList>>>;
  let myTeam: ReturnType<typeof vi.fn<() => Observable<ScoutTeamAnswer>>>;
  let settings: LeagueProjectionSettingsResponse;

  beforeEach(() => {
    chosen = LEAGUE;
    settings = SETTINGS;
    players = vi.fn(() => of(league()));
    myTeam = vi.fn(() => of(team()));
    return MockBuilder(PlayerScoutComponent)
      .mock(PlayerScoutService, { players, myTeam })
      .keep(YahooLeaguePicker)
      .keep(NgTemplateOutlet)
      .mock(YahooConnectReturnService)
      .mock(LeagueChoiceService, {
        get league() {
          return () => chosen;
        },
        on: (platform: string) => (chosen?.platform === platform ? chosen : null),
      } as never)
      .mock(YahooService, {
        leagueProjectionSettings: () => of(settings),
        connectionStatus: () => of({ connected: true }),
        // Two, so that neither is picked for the reader: only a remembered league is read.
        myLeagues: () =>
          of({
            leagues: [
              { leagueKey: LEAGUE.leagueId, name: LEAGUE.name },
              { leagueKey: '465.l.2', name: 'Work League' },
            ],
          }),
      } as never)
      .mock(EspnService, { leagueProjectionSettings: () => of(SETTINGS) });
  });

  async function render() {
    const fixture = MockRender(PlayerScoutComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const ids = (rows: readonly { player: { playerId: string } }[]) =>
    rows.map((row) => row.player.playerId);
  const query = (call: unknown[]) => call[2] as ScoutQuery;

  it('asks for a league before anything else', async () => {
    chosen = null;
    const fixture = await render();

    expect(ngMocks.formatText(fixture)).toContain('Select a league above');
    expect(players).not.toHaveBeenCalled();
  });

  it("reads the chosen league's players with no day and the ice over the last five games", async () => {
    await render();

    expect(players).toHaveBeenCalledWith('YAHOO', '465.l.9', {
      since: null,
      recentGames: DEFAULT_RECENT_GAMES,
    });
  });

  it("opens on today's projection of the available players, best first, with no comparison", async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;

    expect(page.view()).toBe('projection');
    expect(page.compare()).toBe(false);
    expect(page.pool()).toBe('available');
    expect(page.sort()).toEqual({ key: 'score', descending: true });
    expect(ids(page.sorted())[0]).toBe('99');
    expect(ids(page.filtered())).not.toContain('201');
    expect(ids(page.filtered())).not.toContain('301');
    const table = ngMocks.find(fixture, ScoutTableComponent);
    expect(ngMocks.input(table, 'compare')).toBe(false);
    expect(ngMocks.input(table, 'view')).toBe('projection');
    expect(ngMocks.input(ngMocks.find(fixture, SincePickerComponent), 'on')).toBe(false);
    expect(page.sinceAnswer()).toBeNull();
    expect(page.sinceCaption()).toBe('');
  });

  it('ranks everyone in the league on the rest of the season, scored by the league', async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;

    expect(page.ranked()[0].player.playerId).toBe('201');
    const montour = page.ranked().find((row) => row.player.playerId === '99');
    // 12 goals at 3 and 40 assists at 2, the league's own weights, and his place among everyone.
    expect(montour?.score).toBe(116);
    expect(montour?.rank).toBe(3);
    // The league scores no goalie stat, so the goalie scores nothing, with the empty line on IR.
    expect(
      page
        .ranked()
        .slice(-2)
        .map((row) => row.score),
    ).toEqual([0, 0]);
  });

  it('switches the comparison on against the preseason, then a day, and reads again for the day', async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;

    page.toggleCompare();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(players).toHaveBeenCalledTimes(1);
    expect(ngMocks.input(ngMocks.find(fixture, SincePickerComponent), 'on')).toBe(true);
    // The day asked for answered, so the caption has nothing to add to the label.
    expect(page.sinceCaption()).toEqual('');
    expect(ngMocks.input(ngMocks.find(fixture, ScoutTableComponent), 'compare')).toBe(true);
    expect(page.sinceLabel()).toBe('vs 7 Oct');
    const montour = page.ranked().find((row) => row.player.playerId === '99');
    expect(montour?.rising).toBe(true);
    expect(page.risingCount()).toBe(1);

    page.since.set('2026-10-05');
    await fixture.whenStable();

    expect(query(players.mock.lastCall!)).toEqual({ since: '2026-10-05', recentGames: 5 });
  });

  it('narrows to the risers, or the fallers, only with a comparison on', async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;

    page.movers.set('risers');
    expect(page.filtered().length).toBeGreaterThan(1);

    page.toggleCompare();
    expect(ids(page.filtered())).toEqual(['99']);

    page.pool.set('all');
    page.movers.set('fallers');
    expect(ids(page.filtered())).toEqual(['301']);
  });

  it("shows free agents, waivers, taken players, everyone, or one team's roster", async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;

    page.pool.set('fa');
    expect(ids(page.filtered())).not.toContain('98');
    expect(page.filtered()).toHaveLength(22);

    page.pool.set('waivers');
    expect(ids(page.filtered())).toEqual(['98']);

    page.pool.set('taken');
    expect(page.filtered()).toHaveLength(13);

    page.pool.set('all');
    expect(page.filtered()).toHaveLength(36);

    expect(page.leagueTeams().map((team) => team.name)).toEqual(['Slapshots', 'Someone Else']);
    expect(page.leagueTeams()[0].mine).toBe(true);
    page.pool.set('team:Someone Else');
    expect(ids(page.filtered())).toEqual(['301']);
  });

  it("adds the user's own players beside the pool on the tick, and reads the tick as moot where they are shown anyway", async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;

    expect(page.poolShowsMine()).toBe(false);
    page.toggleShowMine();
    expect(page.filtered()).toHaveLength(23 + 12);
    expect(ids(page.filtered())).toContain('201');
    expect(ids(page.filtered())).not.toContain('301');

    page.pool.set('team:Slapshots');
    expect(page.poolShowsMine()).toBe(true);
    expect(page.filtered()).toHaveLength(12);
    page.pool.set('all');
    expect(page.poolShowsMine()).toBe(true);
  });

  it('narrows to an NHL club, by any spelling of it', async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;

    expect(page.nhlTeams()).toEqual(['EDM', 'SEA', 'TBL']);
    page.nhlTeam.set('TBL');
    expect(ids(page.filtered())).toEqual(['98']);
  });

  it('narrows the list to the positions picked, and finds a name', async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;

    page.togglePosition('D');
    expect(ids(page.filtered())).toEqual(['99']);

    page.clearPositions();
    page.togglePosition('G');
    expect(ids(page.filtered())).toEqual(['50']);

    page.clearPositions();
    page.search.set('player 1');
    expect(ids(page.filtered())).toEqual([
      '1',
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
      '16',
      '17',
      '18',
      '19',
    ]);
  });

  it('switches to the ice view, with its window read over the last games or since the day', async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;

    page.view.set('ice');
    fixture.detectChanges();

    expect(ngMocks.input(ngMocks.find(fixture, ScoutTableComponent), 'view')).toBe('ice');
    expect(page.iceLabel()).toBe("each club's last 5 games");
    expect(page.gains()).toBeNull();

    page.recentGames.set(10);
    await fixture.whenStable();
    expect(query(players.mock.lastCall!)).toEqual({ since: null, recentGames: 10 });

    // "Since the day" needs a day: without a comparison on a day it falls back to the last games.
    page.iceWindowPicked.set('since');
    expect(page.iceWindow()).toBe('last');
    page.compare.set(true);
    page.since.set('2026-10-05');
    await fixture.whenStable();
    expect(page.iceWindow()).toBe('since');
    expect(page.iceLabel()).toBe('since 5 Oct');
    expect(query(players.mock.lastCall!)).toEqual({ since: '2026-10-05', recentGames: null });
  });

  it('hands the table a page at a time, saying who holds whom only beyond the wire', async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;

    const table = ngMocks.find(fixture, ScoutTableComponent);
    expect(ngMocks.input(table, 'rows')).toHaveLength(23);
    expect(ngMocks.input(table, 'showOwner')).toBe(false);
    expect(page.rangeText()).toBe('1–23 of 23');

    page.pool.set('all');
    fixture.detectChanges();
    expect(ngMocks.input(table, 'rows')).toHaveLength(SCOUT_PAGE_SIZE);
    expect(ngMocks.input(table, 'showOwner')).toBe(true);
    expect(page.pageCount()).toBe(2);
  });

  it('sorts the whole list by a column before paging it, and falls back when the column leaves', async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;

    page.sortBy('games');
    page.sortBy('games');
    fixture.detectChanges();
    expect(page.sort()).toEqual({ key: 'games', descending: false });
    expect(ngMocks.input(ngMocks.find(fixture, ScoutTableComponent), 'sort')).toEqual({
      key: 'games',
      descending: false,
    });

    // A change without a comparison, or games in the ice view, sorts by blanks: ranked instead.
    page.sortBy('delta');
    expect(page.sort()).toEqual({ key: 'score', descending: true });
    page.toggleCompare();
    page.sortBy('rise');
    expect(page.sort().key).toBe('rise');
    page.view.set('ice');
    expect(page.sort()).toEqual({ key: 'score', descending: true });
    page.sortBy('ice');
    expect(page.sort().key).toBe('ice');
  });

  it('says the season is not under way rather than listing nobody', async () => {
    players.mockReturnValue(
      of({ inSeason: false, since: { kind: 'NONE' }, recentGames: null, players: [] }),
    );
    const fixture = await render();

    expect(ngMocks.formatText(fixture)).toContain("The season hasn't started yet.");
    expect(ngMocks.findAll(fixture, ScoutTableComponent)).toHaveLength(0);
  });

  it('offers a retry when the players cannot be read', async () => {
    players.mockReturnValue(throwError(() => new Error('502')));
    const fixture = await render();

    const error = ngMocks
      .findAll(fixture, ErrorStateComponent)
      .find((element) => ngMocks.input(element, 'title') === "Couldn't load the players");
    expect(error).toBeDefined();
  });

  it("reads the user's own team in the same league", async () => {
    await render();

    expect(myTeam).toHaveBeenCalledWith('YAHOO', '465.l.9');
  });

  it('opens on suggested drops, the roster folded, with nobody chosen and no gain column', async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;

    expect(page.rosterOpen()).toBe(false);
    expect(ngMocks.findAll(fixture, '.roster-table')).toHaveLength(0);
    // Everyone with a seat starts every night, so the cheapest is the lowest scorer who holds a
    // spot: the C on injured reserve scores lowest but holds none.
    expect(page.dropCandidates()[0]?.player.playerId).toBe('203');
    expect(page.drop()).toBeNull();
    expect(page.gains()).toBeNull();
    expect(ngMocks.input(ngMocks.find(fixture, ScoutTableComponent), 'gains')).toBeNull();
    expect(page.valuation()?.byPlayer.get('203')?.starts).toBe(10);
    const floor = ngMocks.find(fixture, '.floor');
    expect(ngMocks.formatText(floor)).toContain('Suggested drops');
    const chips = ngMocks.findAll(fixture, '.pill--drop');
    const chipText = (selector: string) =>
      chips.map((chip) => ngMocks.formatText(ngMocks.find(chip, selector)));
    expect(chipText('.pill-name')).toEqual(['Mine 203', 'Mine 202', 'Mine 210', 'Mine 207']);
    expect(chipText('.pill-cost')).toEqual(['5.0', '7.0', '11.0', '70.0']);
    expect(chips.map((chip) => chip.attributes['aria-checked'])).toEqual([
      'false',
      'false',
      'false',
      'false',
    ]);
    expect(ngMocks.findAll(fixture, '.room-caption')).toHaveLength(0);
    const toggle = ngMocks.find(fixture, '.roster-toggle');
    expect(ngMocks.formatText(toggle)).toBe('Show all (12)');
    expect(toggle.attributes['aria-expanded']).toBe('false');
    ngMocks.click(toggle);
    fixture.detectChanges();
    expect(page.rosterOpen()).toBe(true);
    expect(ngMocks.formatText(toggle)).toBe('Show less');
    ngMocks.click(toggle);
    fixture.detectChanges();
    expect(page.rosterOpen()).toBe(false);
    expect(ngMocks.formatText(toggle)).toBe('Show all (12)');
  });

  it('unfolds the whole roster, none chosen, and narrows it to the few a drop would be on request', async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;

    ngMocks.click(ngMocks.find(fixture, '.roster-toggle'));
    fixture.detectChanges();
    expect(ngMocks.find(fixture, '.roster-toggle').attributes['aria-expanded']).toBe('true');
    const order = page.roster().map((entry) => entry.player.playerId);
    expect(order[0]).toBe('203');
    expect(order.at(-1)).toBe('211');
    let rows = ngMocks.findAll(fixture, '.roster-table tbody tr');
    // Eleven who hold a spot, the line for injured reserve, and the one on it, with no radio.
    expect(rows).toHaveLength(13);
    expect(ngMocks.formatText(rows[11])).toBe('On IR, no spot to free');
    expect(ngMocks.formatText(rows[12])).toContain('Mine 211');
    expect(ngMocks.findAll(rows[12], 'input[type=radio]')).toHaveLength(0);

    const fewer = ngMocks.find(fixture, '.roster-more');
    expect(ngMocks.formatText(fewer)).toBe('Show fewer');
    ngMocks.click(fewer);
    fixture.detectChanges();

    rows = ngMocks.findAll(fixture, '.roster-table tbody tr');
    expect(rows).toHaveLength(4);
    expect(ngMocks.formatText(rows[0])).toContain('10 / 10');
    expect(rows[0].nativeElement.classList).not.toContain('roster-row--drop');
    expect(ngMocks.find(rows[0], 'input[type=radio]').properties['checked']).toBe(false);
    // No comparison on: no Change column in the roster either.
    const headings = ngMocks
      .findAll(fixture, '.roster-table thead th')
      .map((th) => ngMocks.formatText(th));
    expect(headings).toEqual(['Player', 'Points', 'Starts/Games left', 'Cost to drop']);
    expect(ngMocks.formatText(ngMocks.find(fixture, '.roster-more'))).toBe('Show all 12');
  });

  it('re-prices the list against the drop picked, from a chip or from the roster, and forgets him with the league', async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;

    ngMocks.click(ngMocks.findAll(fixture, '.pill--drop')[1]);
    fixture.detectChanges();

    expect(page.drop()?.player.playerId).toBe('202');
    expect(page.dropSurname()).toBe('202');
    expect(ngMocks.findAll(fixture, '.pill--drop')[1].attributes['aria-checked']).toBe('true');
    const table = ngMocks.find(fixture, ScoutTableComponent);
    expect(ngMocks.input(table, 'dropName')).toBe('202');

    // Show all unfolds the whole roster, and any row of it can be the drop.
    ngMocks.click(ngMocks.find(fixture, '.roster-toggle'));
    fixture.detectChanges();
    expect(page.rosterOpen()).toBe(true);
    expect(page.rosterAll()).toBe(true);
    const rows = ngMocks.findAll(fixture, '.roster-table tbody tr');
    const makar = rows.find((row) => ngMocks.formatText(row).includes('Mine 201'))!;
    ngMocks.change(ngMocks.find(makar, 'input[type=radio]'), true);
    fixture.detectChanges();
    expect(page.drop()?.player.playerId).toBe('201');
    // A fifth chip, since he is none of the four cheapest.
    expect(ngMocks.findAll(fixture, '.pill--drop')).toHaveLength(5);

    // Pressing the one picked lets him go, and the gain column with him.
    page.pickDrop('201');
    expect(page.drop()).toBeNull();
    expect(page.gains()).toBeNull();

    // A pick that is not on the roster, as after a league change, chooses nobody.
    page.pickDrop('nobody');
    expect(page.drop()).toBeNull();
  });

  it('names the player whose going costs the lineup least, not the lowest scorer, and prices every pickup against him', async () => {
    // Two centre seats and one defence seat: the third centre starts nowhere, so he costs
    // nothing to drop, though he outscores the lone defenceman, who starts every night.
    settings = {
      ...SETTINGS,
      rosterSlots: { c: 2, lw: 0, rw: 0, w: 0, f: 0, d: 1, g: 0, util: 0, bn: 1 },
    };
    const lines: [Projection, string[]][] = [
      [skater(401, 20, 20), ['C']],
      [skater(402, 16, 16), ['C']],
      [skater(403, 12, 12), ['C']],
      [skater(404, 4, 4), ['D']],
    ];
    myTeam.mockReturnValue(
      of({
        team: {
          found: true,
          teamName: 'Slapshots',
          players: lines.map(([line, positions]) => teamPlayer(line, positions)),
        },
        schedule: new Map([
          ['EDM', NIGHTS],
          ['SEA', NIGHTS],
        ]),
      }),
    );
    players.mockReturnValue(
      of({
        ...league(),
        players: [
          scoutPlayer(skater(99, 10, 10), skater(99, 4, 4), ['D']),
          scoutPlayer(skater(98, 14, 14), skater(98, 4, 4), ['C']),
          ...lines.map(([line, positions]) => scoutPlayer(line, line, positions, MINE)),
        ],
      }),
    );
    const fixture = await render();
    const page = fixture.point.componentInstance;

    expect(page.dropCandidates()[0]?.player.playerId).toBe('403');
    expect(page.valuation()?.byPlayer.get('403')?.marginal).toBe(0);
    expect(page.valuation()?.byPlayer.get('404')?.marginal).toBe(20);
    page.pickDrop('403');
    // The available D replaces the lone D for a gain; the available C cannot start, so dropping
    // the benched centre for him gains nothing.
    expect(page.gains()?.get('99')).toBeCloseTo(30);
    expect(page.gains()?.get('98')).toBeCloseTo(0);

    // Dropping the lone defenceman instead: the D pickup nets his 50 less the 20 lost; the C
    // pickup still cannot start and the D seat stands empty.
    page.pickDrop('404');
    expect(page.gains()?.get('99')).toBeCloseTo(30);
    expect(page.gains()?.get('98')).toBeCloseTo(-20);
  });

  it('sorts the whole list by the gain, not the page, and offers the column only with a drop', async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;

    page.pool.set('all');
    expect(page.gains()).toBeNull();
    page.pickDrop('203');
    // Two pages, every available player priced whether on screen or not.
    expect(page.pageCount()).toBe(2);
    expect(page.gains()?.size).toBe(23);
    page.sortBy('gain');
    expect(page.sort()).toEqual({ key: 'gain', descending: true });
    const first = page.sorted()[0];
    expect(first.scout.owner).toBeNull();
    expect(page.gains()?.get(first.player.playerId)).toBe(
      Math.max(...[...page.gains()!.values()].map((gain) => gain ?? -Infinity)),
    );

    // Without a gain column the sort falls back to the ranking.
    page.view.set('ice');
    expect(page.sort()).toEqual({ key: 'score', descending: true });
  });

  it('offers neither a drop nor a gain column while a pickup costs nobody', async () => {
    settings = {
      ...SETTINGS,
      rosterSlots: { ...SETTINGS.rosterSlots, bn: 1 },
    };
    const fixture = await render();
    const page = fixture.point.componentInstance;

    expect(page.room().openSpots).toBe(1);
    expect(page.fullRoster()).toBe(false);
    expect(page.gains()).toBeNull();
    expect(ngMocks.findAll(fixture, '.pill--drop')).toHaveLength(0);
    expect(ngMocks.formatText(fixture)).toContain('1 open roster spot');
  });

  it('keeps a player who is out off the chips, and prices him at the nights he plays once back', async () => {
    const answer = team();
    myTeam.mockReturnValue(
      of({
        ...answer,
        team: {
          ...answer.team,
          players: answer.team.players.map((player) =>
            player.playerId === '203' ? { ...player, out: true, injuryStatus: 'O' } : player,
          ),
        },
      }),
    );
    const fixture = await render();
    const page = fixture.point.componentInstance;

    // The chips suggest the healthy; he can still be picked.
    expect(page.dropCandidates()[0]?.player.playerId).toBe('202');
    expect(page.dropChips().map((chip) => chip.player.playerId)).toEqual([
      '202',
      '210',
      '207',
      '208',
    ]);

    page.pickDrop('203');
    fixture.detectChanges();
    expect(page.drop()?.player.playerId).toBe('203');
    const chosen = ngMocks
      .findAll(fixture, '.pill--drop')
      .find((chip) => chip.attributes['aria-checked'] === 'true')!;
    expect(ngMocks.formatText(ngMocks.find(chosen, '.pill-name'))).toBe('Mine 203');
    expect(ngMocks.formatText(ngMocks.find(chosen, '.pill-cost'))).toBe('5.0');
    expect(ngMocks.formatText(ngMocks.find(chosen, '.drop-tag--out'))).toBe('O');
  });

  it('prices no pickup while the team is not his', async () => {
    myTeam.mockReturnValue(
      of({ team: { found: false, teamName: null, players: [] }, schedule: new Map() }),
    );
    const fixture = await render();
    const page = fixture.point.componentInstance;

    expect(page.teamStatus()).toBe('not-found');
    expect(page.gains()).toBeNull();
    expect(ngMocks.formatText(fixture)).toContain('You have no team in this league');
  });

  it('keeps the list when the team cannot be read, and offers to try again', async () => {
    myTeam.mockReturnValue(throwError(() => new Error('424')));
    const fixture = await render();
    const page = fixture.point.componentInstance;

    expect(page.teamStatus()).toBe('error');
    expect(ngMocks.findAll(fixture, ScoutTableComponent)).toHaveLength(1);
    expect(ngMocks.formatText(fixture)).toContain("Couldn't load your team");
  });

  it('hands the picker what answered the day, once a comparison is on', async () => {
    players.mockReturnValue(
      of({
        ...league(),
        since: { kind: 'NONE' },
        players: league().players.map((player) => ({ ...player, then: null })),
      }),
    );
    const fixture = await render();
    const page = fixture.point.componentInstance;

    page.toggleCompare();
    fixture.detectChanges();

    expect(page.sinceLabel()).toBe('no earlier projection');
    expect(page.sinceCaption()).toEqual('No earlier projection to compare with yet.');
  });

  it('switches the comparison on with the day picked, and off with the day kept', async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;

    page.pickSince('2026-10-05');
    await fixture.whenStable();

    expect(page.compare()).toBe(true);
    expect(query(players.mock.lastCall!)).toEqual({ since: '2026-10-05', recentGames: 5 });

    page.clearCompare();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(page.compare()).toBe(false);
    expect(page.since()).toBe('2026-10-05');
    expect(query(players.mock.lastCall!)).toEqual({ since: null, recentGames: 5 });
    expect(ngMocks.input(ngMocks.find(fixture, SincePickerComponent), 'since')).toBe('2026-10-05');
  });

  it('keeps the view band on the list through a reload, and the room line off until it is back', async () => {
    const fixture = await render();
    const page = fixture.point.componentInstance;
    expect(page.listReady()).toBe(true);
    expect(ngMocks.findAll(fixture, '.room-box')).toHaveLength(1);

    // A read that never answers: the list is loading until the test ends.
    players.mockReturnValue(new Observable<ScoutList>());
    page.pickSince('2026-10-05');
    fixture.detectChanges();

    expect(page.loading()).toBe(true);
    expect(page.listReady()).toBe(false);
    expect(ngMocks.findAll(fixture, '.viewbar')).toHaveLength(1);
    expect(ngMocks.findAll(fixture, '.room-box')).toHaveLength(0);
  });

  it('heads the gain column by the surname', () => {
    expect(surname('T.J. Hughes')).toBe('Hughes');
    expect(surname('Nathan MacKinnon')).toBe('MacKinnon');
    expect(surname('Mine 203')).toBe('203');
  });
});
