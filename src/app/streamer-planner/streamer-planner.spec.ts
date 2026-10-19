import { signal } from '@angular/core';
import { MockBuilder, MockedDebugElement, MockRender, ngMocks } from 'ng-mocks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { Api } from '../api/api';
import { streamerPlannerMyTeam } from '../api/fn/streamer-planner/streamer-planner-my-team';
import { streamerPlannerTeams } from '../api/fn/streamer-planner/streamer-planner-teams';
import { streamerPlannerWeeks } from '../api/fn/streamer-planner/streamer-planner-weeks';
import { LeagueProjectionSettingsResponse } from '../api/models/league-projection-settings-response';
import { PlannerMyTeamResponse } from '../api/models/planner-my-team-response';
import { PlannerWeeksResponse } from '../api/models/planner-weeks-response';
import { ScheduleStrengthResponse } from '../api/models/schedule-strength-response';
import { TeamSchedule } from '../api/models/team-schedule';
import { GOALIE_SCORING_STAT_KEYS, SKATER_SCORING_STAT_KEYS } from '../models/stat-key.model';
import { AuthService } from '../services/auth.service';
import { ProjectionRankingService } from '../services/projection-ranking.service';
import { EspnService } from '../services/espn.service';
import {
  FreeAgentWeek,
  StreamerPlannerFreeAgentsService,
} from '../services/streamer-planner-free-agents.service';
import { ChosenLeague, LeagueChoiceService } from '../services/league-choice.service';
import { YahooConnectReturnService } from '../services/yahoo-connect-return.service';
import { YahooService } from '../services/yahoo.service';
import { ErrorStateComponent } from '../shared/error-state/error-state';
import { TooltipDirective } from '../shared/tooltip/tooltip.directive';
import { YahooLeaguePicker } from '../shared/yahoo-league-picker';
import { FreeAgentsTableComponent } from './free-agents-table/free-agents-table';
import { RosterTableComponent } from './roster-table/roster-table';
import { PLANNER_LAYOUT, PlannerLayout } from './planner-page-size';
import { PLANNER_TODAY } from './planner-schedule';
import { StreamerPlannerComponent } from './streamer-planner';

const WEEKS: PlannerWeeksResponse = {
  season: 2026,
  currentWeek: 2,
  weeks: [
    { week: 1, start: '2026-10-07', end: '2026-10-11', games: 30 },
    { week: 2, start: '2026-10-12', end: '2026-10-18', games: 50 },
    { week: 3, start: '2026-10-19', end: '2026-10-25', games: 50 },
    { week: 4, start: '2026-10-26', end: '2026-11-01', games: 50 },
    { week: 5, start: '2026-11-02', end: '2026-11-08', games: 50 },
    { week: 6, start: '2026-11-09', end: '2026-11-15', games: 50 },
  ],
};

function team(name: string, skaterRank: number, goalieRank: number): TeamSchedule {
  return {
    team: name,
    games: 2,
    offNightGames: 1,
    backToBacks: 0,
    homeGames: 1,
    skaterScore: 2.3,
    skaterRank,
    goalieScore: 2.2,
    goalieRank,
    schedule: [
      {
        date: '2026-10-13',
        opponent: 'SJS',
        home: false,
        offNight: true,
        backToBack: true,
        opponentGoalsAgainst: 1.12,
        opponentGoalsFor: 1.08,
        skaterWorth: 1.351,
        goalieWorth: 1.1172,
        statWorth: {},
        plusMinusPerMinute: 0,
      },
      {
        date: '2026-10-15',
        opponent: 'CGY',
        home: true,
        offNight: false,
        backToBack: false,
        opponentGoalsAgainst: 0.9,
        opponentGoalsFor: 1.0,
        skaterWorth: 0.9324,
        goalieWorth: 1.0363,
        statWorth: {},
        plusMinusPerMinute: 0,
      },
    ],
  };
}

function strength(start: string, end: string): ScheduleStrengthResponse {
  return {
    season: 2026,
    start,
    end,
    offNightMaxGames: 7,
    nights: [
      { date: '2026-10-13', games: 3, offNight: true },
      { date: '2026-10-15', games: 9, offNight: false },
    ],
    teams: [team('EDM', 1, 2), team('TBL', 2, 1)],
  };
}

const LEAGUE: ChosenLeague = { platform: 'YAHOO', leagueId: '465.l.9', name: 'The Gordie Howes' };

/** A points league that pays 3 for a goal, 2 for an assist and nothing else. */
const SETTINGS: LeagueProjectionSettingsResponse = {
  leagueName: 'The Gordie Howes',
  scoringType: 'points',
  statWeights: { goals: 3, assists: 2 },
  activeScoringColumns: ['goals', 'assists'],
  activeUtilityColumns: ['gp'],
  rosterSlots: { c: 2, lw: 2, rw: 2, w: 0, f: 0, d: 4, g: 2, util: 1, bn: 4 },
  leagueSize: 12,
  unsupportedRosterCodes: [],
  unsupportedStats: [],
};

function scoringLine<K extends string>(keys: readonly K[], set: Record<string, number>) {
  return keys.reduce(
    (line, key) => ({ ...line, [key]: set[key] ?? 0 }),
    {} as Record<K, number>,
  ) as never;
}

function skater(
  playerId: string,
  name: string,
  goals: number,
  assists: number,
  team = 'EDM',
  positions = ['C'],
): FreeAgentWeek['players'][number] {
  return {
    playerId,
    name,
    teamAbbrev: team,
    positions,
    availability: 'FREE_AGENT',
    clubGames: 2,
    expectedGames: 2,
    projected: new Set(['goals', 'assists', 'points']),
    projection: {
      type: 'skater',
      playerId: Number(playerId),
      stats: {
        scoring: scoringLine(SKATER_SCORING_STAT_KEYS, { goals, assists, points: goals + assists }),
        utility: { gp: 2, toiPerGame: 1100 },
      },
    },
  };
}

/** A skater in a category league, with whatever line the test needs. */
function lineSkater(
  playerId: string,
  name: string,
  line: Record<string, number>,
): FreeAgentWeek['players'][number] {
  const player = skater(playerId, name, 0, 0);
  return {
    ...player,
    projected: new Set(Object.keys(line)),
    projection: {
      ...player.projection,
      stats: {
        scoring: scoringLine(SKATER_SCORING_STAT_KEYS, line),
        utility: { gp: 2, toiPerGame: 1100 },
      },
    } as never,
  };
}

function goalie(playerId: string, name: string, wins: number): FreeAgentWeek['players'][number] {
  return {
    playerId,
    name,
    teamAbbrev: 'TB',
    positions: ['G'],
    availability: 'WAIVERS',
    clubGames: 2,
    expectedGames: 1.5,
    projected: new Set(['w', 'sv', 'svPct']),
    projection: {
      type: 'goalie',
      playerId: Number(playerId),
      stats: {
        scoring: scoringLine(GOALIE_SCORING_STAT_KEYS, { w: wins, sv: 57, svPct: 0.908 }),
        utility: { gp: 1.5 },
      },
    },
  };
}

function dateInput(value: string): Event {
  return { target: { value } } as unknown as Event;
}

describe('StreamerPlannerComponent', () => {
  const invoke = vi.fn();
  const freeAgents = vi.fn();
  const poolFreeAgents = vi.fn();
  const admin = signal(false);
  let chosen: ChosenLeague | null = null;
  /** The Monday of week 2 unless a test says otherwise. */
  let today = '2026-10-12';
  let settings = SETTINGS;
  /** The user's own team, as the BFF answers with it. */
  let myTeam: PlannerMyTeamResponse = { found: false, players: [], lines: [] };
  /** Whether the account is connected to Yahoo, and the leagues it lists. */
  let connected = true;
  let leagues = [
    { leagueKey: LEAGUE.leagueId, name: LEAGUE.name },
    { leagueKey: '465.l.2', name: 'Work League' },
  ];
  const layout = signal<PlannerLayout>('desktop');

  beforeEach(() => {
    layout.set('desktop');
    chosen = null;
    today = '2026-10-12';
    settings = SETTINGS;
    myTeam = { found: false, players: [], lines: [] };
    connected = true;
    leagues = [
      { leagueKey: LEAGUE.leagueId, name: LEAGUE.name },
      { leagueKey: '465.l.2', name: 'Work League' },
    ];
    localStorage.clear();
    invoke.mockReset();
    freeAgents.mockReset();
    poolFreeAgents.mockReset();
    admin.set(false);
    invoke.mockImplementation((fn: unknown, params?: { start: string; end: string }) => {
      if (fn === streamerPlannerWeeks) {
        return Promise.resolve(WEEKS);
      }
      if (fn === streamerPlannerTeams && params) {
        return Promise.resolve(strength(params.start, params.end));
      }
      if (fn === streamerPlannerMyTeam) {
        return Promise.resolve(myTeam);
      }
      return Promise.reject(new Error('unexpected call'));
    });
    freeAgents.mockReturnValue(
      of<FreeAgentWeek>({
        creases: [],
        players: [
          skater('1', 'Second Best', 1, 1),
          skater('2', 'Top Scorer', 3, 1, 'EDM', ['C', 'LW']),
          goalie('3', 'Waiver Goalie', 1),
        ],
      }),
    );
    return MockBuilder(StreamerPlannerComponent)
      .provide({ provide: Api, useValue: { invoke } })
      .provide({ provide: PLANNER_TODAY, useValue: () => today })
      .provide({ provide: PLANNER_LAYOUT, useValue: layout.asReadonly() })
      .mock(StreamerPlannerFreeAgentsService, { freeAgents, poolFreeAgents })
      .mock(AuthService, { isAdmin: admin.asReadonly() } as never)
      .keep(YahooLeaguePicker)
      .mock(YahooConnectReturnService)
      .mock(LeagueChoiceService, {
        get league() {
          return () => chosen;
        },
        on: (platform: string) => (chosen?.platform === platform ? chosen : null),
      } as never)
      .mock(YahooService, {
        leagueProjectionSettings: () => of(settings),
        connectionStatus: () => of({ connected }),
        // Two, so that neither is picked for the reader: only a remembered league is read.
        myLeagues: () => of({ leagues }),
      } as never)
      .mock(EspnService, { leagueProjectionSettings: () => of(settings) });
  });

  async function render() {
    const fixture = MockRender(StreamerPlannerComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('opens on the rest of this week, with every night of it', async () => {
    const fixture = await render();
    const planner = fixture.point.componentInstance;

    expect(invoke).toHaveBeenCalledWith(streamerPlannerTeams, {
      start: '2026-10-12',
      end: '2026-10-18',
    });
    expect(planner.days().map((day) => day.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    expect(planner.days()[1]).toEqual({ date: '2026-10-13', games: 3, offNight: true });
    expect(planner.activePreset()).toBe('this-week');
    expect(planner.counted().size).toBe(2);
    expect(planner.leadingDays()).toEqual([]);
    // Monday has no days before it, so nothing is asked for them.
    expect(invoke.mock.calls.filter(([fn]) => fn === streamerPlannerTeams)).toHaveLength(1);
  });

  // A night already played is not a night to stream for.
  it('starts today rather than on Monday, and draws the days before it as the week they were', async () => {
    today = '2026-10-14';
    const fixture = await render();
    const planner = fixture.point.componentInstance;

    expect(invoke).toHaveBeenCalledWith(streamerPlannerTeams, {
      start: '2026-10-14',
      end: '2026-10-18',
    });
    expect(planner.days().length).toBe(5);
    expect(invoke).toHaveBeenCalledWith(streamerPlannerTeams, {
      start: '2026-10-12',
      end: '2026-10-13',
    });
    expect(planner.leadingDays()).toEqual([
      { date: '2026-10-12', games: 0 },
      { date: '2026-10-13', games: 3 },
    ]);
    expect(planner.presets().map((preset) => [preset.key, preset.stretch])).toEqual([
      ['this-week', { start: '2026-10-14', end: '2026-10-18' }],
      ['next-week', { start: '2026-10-19', end: '2026-10-25' }],
      ['two-weeks', { start: '2026-10-14', end: '2026-10-25' }],
    ]);
    const past = ngMocks.findAll(fixture, '.day--past');
    expect(past.length).toBe(2);
    expect(past[0].nativeElement.textContent).toContain('No games');
    expect(past[1].nativeElement.querySelector('.day-count').textContent).toBe('3');
    expect(past[1].nativeElement.querySelector('input')).toBeNull();
    const nights = ngMocks.findAll(fixture, 'div.day');
    expect(nights.length).toBe(5);
    // The month sits in an element of its own, which a phone hides to fit the cell.
    const date = ngMocks.find(nights[0], '.day-date');
    expect(ngMocks.formatText(date)).toBe('Oct 14');
    expect(ngMocks.formatText(ngMocks.find(date, '.day-month'))).toBe('Oct');
  });

  it('moves to next week, or to both weeks, at a word', async () => {
    const fixture = await render();
    const planner = fixture.point.componentInstance;

    planner.applyPreset('next-week');
    await fixture.whenStable();
    expect(planner.activePreset()).toBe('next-week');
    expect(invoke).toHaveBeenCalledWith(streamerPlannerTeams, {
      start: '2026-10-19',
      end: '2026-10-25',
    });

    planner.applyPreset('two-weeks');
    await fixture.whenStable();
    expect(invoke).toHaveBeenCalledWith(streamerPlannerTeams, {
      start: '2026-10-12',
      end: '2026-10-25',
    });
  });

  it('takes any two dates, held to today, the season and the longest stretch the server rates', async () => {
    const fixture = await render();
    const planner = fixture.point.componentInstance;

    // The rest of this week and Monday and Tuesday of the next: no preset says that.
    planner.setEnd(dateInput('2026-10-20'));
    expect(planner.stretch()).toEqual({ start: '2026-10-12', end: '2026-10-20' });
    expect(planner.activePreset()).toBeNull();

    // A start past the end takes the end with it.
    planner.setStart(dateInput('2026-10-21'));
    expect(planner.stretch()).toEqual({ start: '2026-10-21', end: '2026-10-21' });

    // A start in the past is today; an end too far off is the longest stretch.
    planner.setStart(dateInput('2026-10-01'));
    expect(planner.stretch()?.start).toBe('2026-10-12');
    planner.setEnd(dateInput('2026-12-25'));
    expect(planner.stretch()?.end).toBe('2026-11-11');
    expect(planner.latestEnd()).toBe('2026-11-11');

    // Nothing typed, nothing changed; the box is put back to what is on screen.
    const box = { value: 'not a date' };
    planner.setEnd({ target: box } as unknown as Event);
    expect(planner.stretch()?.end).toBe('2026-11-11');
    expect(box.value).toBe('2026-11-11');
  });

  it("ranks the teams by the server's skater rank alone", async () => {
    const fixture = await render();
    const planner = fixture.point.componentInstance;

    // TBL has the better goalie rank, which the page does not read.
    expect(planner.teamRows().map((row) => row.team)).toEqual(['EDM', 'TBL']);
  });

  it('asks no skaters-or-goalies question: the free agents are one list', async () => {
    const fixture = await render();

    expect(ngMocks.findAll(fixture, '.segmented')).toHaveLength(0);
  });

  it('re-rates the teams over the nights left when one is unticked, and forgets that on a new stretch', async () => {
    const fixture = await render();
    const planner = fixture.point.componentInstance;

    planner.toggleDay(planner.days()[1]);

    expect(planner.counted().size).toBe(1);
    // Only the Oct 15 game is left, a home game the server put at 0.9324, for both teams alike.
    expect(planner.teamRows().map((row) => [row.team, row.score, row.games])).toEqual([
      ['EDM', 0.93, 1],
      ['TBL', 0.93, 1],
    ]);

    planner.applyPreset('next-week');
    await fixture.whenStable();
    expect(planner.everyNightCounted()).toBe(true);
  });

  it('renders a night per day with its games, and a row per team', async () => {
    const fixture = await render();

    const nights = ngMocks.findAll(fixture, 'div.day');
    expect(nights.length).toBe(7);
    expect(ngMocks.formatText(nights[1])).toContain('3 games');
    expect(ngMocks.formatText(nights[0])).toContain('No games');
    // The off-night is marked with the word on the night itself, read out in full; its tooltip
    // says what the short word stands for, and nothing under the strip repeats it.
    const marks = ngMocks.findAll(nights[1], '.day-mark');
    expect(marks.length).toEqual(1);
    expect(ngMocks.find(marks[0], '[aria-hidden="true"]').nativeElement.textContent).toEqual('Off');
    expect(ngMocks.find(marks[0], '.sr-only').nativeElement.textContent).toEqual('Off-night');
    expect(ngMocks.input(marks[0], 'appTooltip')).toEqual('Off-night');
    expect(ngMocks.findAll(nights[0], '.day-mark').length).toEqual(0);
    expect(ngMocks.findAll(fixture, '.range-legend')).toHaveLength(0);
    // Nothing under the strip names the week or counts the days kept: the strip itself says both.
    expect(ngMocks.formatText(fixture)).not.toContain('Week 2');
    expect(ngMocks.formatText(fixture)).not.toContain('days selected');
    expect(ngMocks.formatText(fixture)).toContain('Select a league above');
  });

  it('says so when no schedule is published', async () => {
    invoke.mockImplementation(() => Promise.resolve({ weeks: [] }));
    const fixture = await render();

    expect(ngMocks.formatText(fixture)).toContain("hasn't published this season's schedule");
  });

  /** Which of the two tables is on screen: the cards not hidden. */
  function shown(fixture: Awaited<ReturnType<typeof render>>): string[] {
    return ['free-agents', 'roster', 'teams'].filter(
      (card) => !ngMocks.find(fixture, `section.${card}`).nativeElement.hidden,
    );
  }

  it('opens on the free agents while no league is picked, their card asking for one', async () => {
    const fixture = await render();

    expect(fixture.point.componentInstance.view()).toBe('free-agents');
    expect(shown(fixture)).toEqual(['free-agents']);
    expect(ngMocks.formatText(ngMocks.find(fixture, 'section.free-agents'))).toContain(
      'Select a league above',
    );
  });

  describe('with a league chosen', () => {
    beforeEach(() => {
      chosen = LEAGUE;
    });

    it('shows one table at a time, opening on the free agents', async () => {
      const fixture = await render();
      const buttons = ngMocks.findAll(fixture, '.views button');
      const pressed = () =>
        buttons.map((button) => button.nativeElement.getAttribute('aria-pressed'));

      expect(buttons.map((button) => ngMocks.formatText(button))).toEqual([
        'Free Agents',
        'My Roster',
        'Team Schedules',
      ]);
      expect(pressed()).toEqual(['true', 'false', 'false']);
      expect(shown(fixture)).toEqual(['free-agents']);

      ngMocks.click(buttons[2]);
      fixture.detectChanges();
      expect(pressed()).toEqual(['false', 'false', 'true']);
      expect(shown(fixture)).toEqual(['teams']);

      ngMocks.click(buttons[1]);
      fixture.detectChanges();
      expect(shown(fixture)).toEqual(['roster']);

      ngMocks.click(buttons[0]);
      fixture.detectChanges();
      expect(shown(fixture)).toEqual(['free-agents']);
    });

    it("ranks the free agents by the league's own scoring, not by the raw stat line", async () => {
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      expect(freeAgents).toHaveBeenCalledWith('YAHOO', '465.l.9', '2026-10-12', '2026-10-18');
      // 3 goals and an assist pays 11; one of each pays 5. Order follows the money.
      expect(planner.ranked().map((row) => row.player.name)).toEqual([
        'Top Scorer',
        'Second Best',
        'Waiver Goalie',
      ]);
      expect(planner.ranked()[0].score).toBeCloseTo(11, 5);
      expect(planner.scoringType()).toBe('points');
      // The table writes each line in the league's categories, in the league's order.
      expect(planner.categories()).toEqual(['goals', 'assists']);
    });

    it('sets off the best three in one list of skaters and goalies that positions narrow', async () => {
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      expect(planner.topRows()).toBe(3);
      expect(ngMocks.findInstance(FreeAgentsTableComponent).top()).toBe(3);
      const names = () => planner.visible().map((row) => row.player.name);
      expect(names()).toEqual(['Top Scorer', 'Second Best', 'Waiver Goalie']);
      expect(ngMocks.formatText(fixture)).toContain('1–3 of 3');
      expect(planner.positionOptions).toEqual(['C', 'LW', 'RW', 'D', 'G']);

      planner.togglePosition('LW');
      expect(names()).toEqual(['Top Scorer']);
      planner.togglePosition('LW');
      planner.togglePosition('D');
      fixture.detectChanges();
      expect(ngMocks.formatText(fixture)).toContain('No available player at these positions');
      planner.clearPositions();
      expect(names()).toHaveLength(3);

      // "All skaters" picks the four skater positions, so the goalie leaves and LW can follow.
      planner.toggleAllSkaters();
      expect(planner.allSkaters()).toBe(true);
      expect([...planner.positions()]).toEqual(['C', 'LW', 'RW', 'D']);
      expect(names()).toEqual(['Top Scorer', 'Second Best']);
      planner.togglePosition('LW');
      expect(planner.allSkaters()).toBe(false);
      planner.toggleAllSkaters();
      expect(planner.allSkaters()).toBe(true);
      planner.toggleAllSkaters();
      expect(planner.positions().size).toBe(0);
    });

    it('narrows the list to the goalies, each keeping his place among everyone', async () => {
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      planner.togglePosition('G');
      fixture.detectChanges();

      // Third of everyone available: one of the best three, whatever the list is narrowed to.
      expect(planner.visible().map((row) => [row.player.name, row.rank])).toEqual([
        ['Waiver Goalie', 3],
      ]);
      expect(ngMocks.formatText(fixture)).toContain('1 of 1');
      expect(ngMocks.findInstance(FreeAgentsTableComponent).top()).toBe(3);

      planner.togglePosition('LW');
      expect(planner.visible().map((row) => row.player.name)).toEqual([
        'Top Scorer',
        'Waiver Goalie',
      ]);
    });

    it('searches the list by name, each player keeping his place among everyone', async () => {
      const fixture = await render();
      const planner = fixture.point.componentInstance;
      const input = () => ngMocks.find(fixture, 'input.search-input');

      input().nativeElement.value = 'goalie';
      input().nativeElement.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(planner.visible().map((row) => [row.player.name, row.rank])).toEqual([
        ['Waiver Goalie', 3],
      ]);

      planner.togglePosition('LW');
      fixture.detectChanges();
      expect(ngMocks.formatText(fixture)).toContain(
        'No available player at these positions matches "goalie".',
      );
      planner.clearPositions();
      input().nativeElement.value = '';
      input().nativeElement.dispatchEvent(new Event('input'));
      expect(planner.visible()).toHaveLength(3);
    });

    function longList(length: number): FreeAgentWeek {
      return {
        creases: [],
        players: Array.from({ length }, (_, index) =>
          skater(`${index + 1}`, `Skater ${index + 1}`, length - index, 0, 'EDM', [
            index % 2 === 0 ? 'C' : 'D',
          ]),
        ),
      };
    }

    function select(value: number): Event {
      return { target: { value: String(value) } } as unknown as Event;
    }

    it('sorts the whole list by a column before paging it, in a points league too', async () => {
      // Goals rank them; the assists run the other way, so the most assists are at the bottom.
      freeAgents.mockReturnValue(
        of({
          creases: [],
          players: Array.from({ length: 30 }, (_, index) =>
            skater(`${index + 1}`, `Skater ${index + 1}`, 30 - index, index),
          ),
        }),
      );
      const fixture = await render();
      const planner = fixture.point.componentInstance;
      planner.goToPage(1);
      fixture.detectChanges();
      expect(planner.visible().some((row) => row.rank <= planner.topRows())).toBe(false);

      planner.sortBy('assists');
      fixture.detectChanges();

      // The most assists of all thirty, not of the page on screen, and the list from its top.
      expect(planner.currentPage()).toBe(0);
      expect(planner.visible()[0].player.name).toBe('Skater 30');
      expect(planner.visible()[0].rank).toBe(30);
      // The head of a list sorted by assists is not the best picks.
      expect(planner.topRows()).toBe(0);
      expect(ngMocks.findInstance(FreeAgentsTableComponent).sort()).toEqual({
        key: 'assists',
        descending: true,
      });

      // Pressed again, the fewest first; the score heading brings the ranked list back.
      planner.sortBy('assists');
      expect(planner.visible()[0].player.name).toBe('Skater 1');
      planner.sortBy('score');
      expect(planner.visible()[0].rank).toBe(1);
      expect(planner.topRows()).toBe(3);
    });

    it('shows a long list a page at a time, and starts over on other positions', async () => {
      freeAgents.mockReturnValue(of(longList(60)));
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      expect(planner.visible()).toHaveLength(25);
      expect(planner.visible()[0].rank).toBe(1);
      expect(ngMocks.formatText(fixture)).toContain('1–25 of 60');
      expect(ngMocks.formatText(fixture)).toContain('Page 1 of 3');

      planner.goToPage(1);
      fixture.detectChanges();
      expect(planner.visible().map((row) => row.rank)).toEqual(
        Array.from({ length: 25 }, (_, index) => index + 26),
      );
      expect(ngMocks.formatText(fixture)).toContain('26–50 of 60');
      // Nobody on a later page is one of the best picks.
      expect(planner.visible().some((row) => row.rank <= planner.topRows())).toBe(false);

      // The last page holds what is left, and there is no page past it.
      planner.goToPage(2);
      planner.goToPage(3);
      expect(planner.currentPage()).toBe(2);
      expect(planner.visible()).toHaveLength(10);
      expect(planner.visible()[0].rank).toBe(51);

      // Thirty defensemen: another list, so its first page.
      planner.togglePosition('D');
      expect(planner.currentPage()).toBe(0);
      expect(planner.pageCount()).toBe(2);
      // A narrowed list keeps each player's place among all of them.
      expect(planner.visible()[0].rank).toBe(2);

      // Back to everyone: another list again.
      planner.goToPage(1);
      planner.clearPositions();
      expect(planner.currentPage()).toBe(0);
    });

    it('turns the page buttons off at either end, and draws none for a single page', async () => {
      freeAgents.mockReturnValue(of(longList(30)));
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      const button = (label: string) =>
        ngMocks.find(fixture, `button[aria-label="${label}"]`).nativeElement as HTMLButtonElement;
      expect(button('Previous page').disabled).toBe(true);
      expect(button('Next page').disabled).toBe(false);

      button('Next page').click();
      fixture.detectChanges();
      expect(planner.currentPage()).toBe(1);
      expect(button('Previous page').disabled).toBe(false);
      expect(button('Next page').disabled).toBe(true);

      planner.setPageSize(select(50));
      fixture.detectChanges();
      expect(ngMocks.findAll(fixture, 'nav.pager')).toHaveLength(0);
      expect(ngMocks.formatText(fixture)).toContain('1–30 of 30');
    });

    it('opens on ten a page on a phone and twenty-five on a desktop', async () => {
      freeAgents.mockReturnValue(of(longList(60)));
      layout.set('phone');
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      expect(planner.pageSize()).toBe(10);
      expect(planner.visible()).toHaveLength(10);
      expect(planner.pageCount()).toBe(6);

      layout.set('desktop');
      expect(planner.pageSize()).toBe(25);
    });

    it('keeps the page size picked for its layout alone, and keeps the first player on screen', async () => {
      freeAgents.mockReturnValue(of(longList(120)));
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      // On the third page, 51 to 75; at 10 a page, the page holding 51 is the sixth.
      planner.goToPage(2);
      planner.setPageSize(select(10));
      expect(planner.currentPage()).toBe(5);
      expect(planner.visible()[0].rank).toBe(51);

      // Not a size on offer: nothing changes.
      planner.setPageSize(select(7));
      expect(planner.pageSize()).toBe(10);

      // The desktop's choice is remembered, on its first page.
      fixture.destroy();
      const again = (await render()).point.componentInstance;
      expect(again.pageSize()).toBe(10);
      expect(again.currentPage()).toBe(0);

      // The phone has a choice of its own, and picking it leaves the desktop's alone.
      layout.set('phone');
      again.setPageSize(select(50));
      layout.set('desktop');
      expect(again.pageSize()).toBe(10);
      layout.set('phone');
      expect(again.pageSize()).toBe(50);
    });

    it("scales a free agent's line to the share of his club's games on the nights counted", async () => {
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      // EDM plays Oct 13 and Oct 15; leaving Oct 13 out halves every Oilers' line.
      planner.toggleDay(planner.days()[1]);

      const top = planner.ranked()[0];
      expect(top.player.name).toBe('Top Scorer');
      expect(top.score).toBeCloseTo(5.5, 5);
      expect(top.games).toBe(1);
      // The line the table writes is the one the score was reached from, not the whole stretch's.
      expect(top.line.stats.scoring).toMatchObject({ goals: 1.5, assists: 0.5 });
      expect(top.player.projection.stats.scoring).toMatchObject({ goals: 3, assists: 1 });
      // The Lightning goalie's club is spelt TB by the platform and TBL by the NHL. In no crease,
      // his 1.5 starts come to 0.75 on the nights counted, and a start is whole: one, not two.
      const waiver = planner.ranked().find((row) => row.player.name === 'Waiver Goalie');
      expect(waiver?.games).toBe(1);
    });

    it('gives a skater the line of the whole games he is shown on, not of the fraction', async () => {
      freeAgents.mockReturnValue(
        of<FreeAgentWeek>({
          creases: [],
          players: [{ ...skater('2', 'Top Scorer', 3, 1), expectedGames: 1.8 }],
        }),
      );
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      const scoring = () => planner.ranked()[0].line.stats.scoring as Record<string, number>;

      // Every night counted: 1.8 games is two, and his 3 goals over 1.8 games become two games'.
      let top = planner.ranked()[0];
      expect(top.games).toBe(2);
      expect(scoring()['goals']).toBeCloseTo((3 * 2) / 1.8);

      // Oct 13 left out: 0.9 games is one, and the line one game's, not 0.9's.
      planner.toggleDay(planner.days()[1]);
      top = planner.ranked()[0];
      expect(top.games).toBe(1);
      expect(scoring()['goals']).toBeCloseTo(1.5 / 0.9);
      expect(scoring()['assists']).toBeCloseTo(0.5 / 0.9);
      // Scored on the engine's two decimals: 1.67 goals at 3 and 0.56 assists at 2.
      expect(top.score).toBeCloseTo(6.13, 5);
    });

    it("gives a club's one counted game to its likelier starter, and the other no line", async () => {
      settings = {
        ...SETTINGS,
        statWeights: { goals: 3, assists: 2, w: 4 },
        activeScoringColumns: ['goals', 'assists', 'w'],
      };
      const nights = (share: number) => [
        { date: '2026-10-13', share },
        { date: '2026-10-15', share },
      ];
      freeAgents.mockReturnValue(
        of<FreeAgentWeek>({
          creases: [
            {
              team: 'TBL',
              goalies: [
                { playerId: '3', nights: nights(0.48) },
                { playerId: '4', nights: nights(0.44) },
                // Rostered in the league, so not a row: his starts are still not theirs.
                { nights: nights(0.08) },
              ],
            },
          ],
          players: [goalie('4', 'Backup', 1), goalie('3', 'Likelier Starter', 1)],
        }),
      );
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      // Only Oct 15 is left: one game, and it is the likelier starter's.
      planner.toggleDay(planner.days()[1]);

      const [first, second] = planner.ranked();
      expect(first.player.name).toBe('Likelier Starter');
      expect(first.games).toBe(1);
      // A win in one and a half starts is two thirds of one a start.
      expect(first.line.stats.scoring).toMatchObject({ w: 2 / 3 });
      // Scored on the two decimals the engine keeps: 0.67 wins at 4 apiece.
      expect(first.score).toBeCloseTo(2.68, 5);
      expect(second.player.name).toBe('Backup');
      expect(second.games).toBe(0);
      expect(second.score).toBe(0);
      expect(second.line.stats.scoring).toMatchObject({ w: 0, sv: 0, svPct: 0 });
    });

    describe("with the user's own team", () => {
      /** A Lightning skater on the user's roster: TB plays both of the stretch's game days. */
      const mine = (playerId: string, positions: string[], out = false) => ({
        playerId,
        name: `Mine ${playerId}`,
        teamAbbrev: 'TB',
        type: 'skater',
        positions,
        out,
      });

      beforeEach(() => {
        // Two Cs, a Util and two LWs taken every night; the RWs, the Ds and the Gs are open.
        myTeam = {
          found: true,
          teamName: 'Howe Hard',
          players: [
            mine('10', ['C']),
            mine('11', ['C']),
            mine('12', ['C']),
            mine('13', ['LW']),
            mine('14', ['LW']),
            mine('15', ['D'], true),
          ],
          lines: [],
        };
      });

      it('marks each game day with who would still start, and asks for the team once', async () => {
        const fixture = await render();
        const planner = fixture.point.componentInstance;

        // With the stretch, so each player's line over it comes with the roster.
        expect(invoke).toHaveBeenCalledWith(streamerPlannerMyTeam, {
          platform: 'YAHOO',
          leagueId: '465.l.9',
          start: '2026-10-12',
          end: '2026-10-18',
        });
        const night = planner.days().find((day) => day.date === '2026-10-13')!;
        expect(planner.roomLabel(planner.room(night)!)).toBe('RW, D, G');
        // A day without games has no lineup to fill.
        expect(planner.room(planner.days()[0])).toBeUndefined();
        // The room as the lineup stands is a run of green chips, one a position, as the yellow
        // a drop opens is, and the line under the nights says what green means.
        expect(
          ngMocks
            .findAll(fixture, '.day-room:not(.day-room--drop)')
            .map((run) => ngMocks.findAll(run, '.room-chip').map((c) => ngMocks.formatText(c))),
        ).toEqual([
          ['RW', 'D', 'G'],
          ['RW', 'D', 'G'],
        ]);
        expect(
          ngMocks
            .findAll(fixture, '.day-room--open')
            .map((run) => ngMocks.findAll(run, '.room-chip').map((c) => ngMocks.formatText(c))),
        ).toEqual([
          ['RW', 'D', 'G'],
          ['RW', 'D', 'G'],
        ]);
        expect(ngMocks.formatText(ngMocks.find(fixture, '.range-legend--open'))).toBe(
          'Available in your roster',
        );
        expect(ngMocks.formatText(ngMocks.find(fixture, '.free-agents .fit-toggle'))).toBe(
          'Fit to my roster',
        );
      });

      it('counts a night in or out from anywhere in its cell, its open positions having no tip', async () => {
        const fixture = await render();
        const room = ngMocks.find(fixture, '.day-room--open');
        const cell = room.nativeElement.closest('.day') as HTMLElement;
        const tick = cell.querySelector('input') as HTMLInputElement;
        expect(ngMocks.findInstances(room, TooltipDirective)).toHaveLength(0);
        expect(tick.checked).toBe(true);

        // The green positions explain nothing, so a tap on them counts like the rest of the cell.
        (room.nativeElement as HTMLElement).click();
        fixture.detectChanges();
        expect(tick.checked).toBe(false);

        (cell.querySelector('.day-games') as HTMLElement).click();
        fixture.detectChanges();
        expect(tick.checked).toBe(true);

        // The tick box counts once, not once for itself and once for the cell around it.
        tick.click();
        fixture.detectChanges();
        expect(tick.checked).toBe(false);
        (cell.querySelector('.day-tick') as HTMLElement).click();
        fixture.detectChanges();
        expect(tick.checked).toBe(true);
      });

      it('leaves a dark night be, however it is tapped', async () => {
        const fixture = await render();
        const cell = ngMocks.find(fixture, '.day--dark').nativeElement as HTMLElement;
        const planner = fixture.point.componentInstance;
        const dark = planner.days().find((day) => day.games === 0)!;
        expect(planner.isCounted(dark)).toBe(true);
        cell.click();
        fixture.detectChanges();
        expect(planner.isCounted(dark)).toBe(true);
        expect(cell.classList.contains('day--out')).toBe(false);
      });

      it('scores a free agent only on the game days he would start, until that is unticked', async () => {
        const fixture = await render();
        const planner = fixture.point.componentInstance;

        // The free agents are an Oilers C and a C/LW, and every C and LW seat is taken.
        const skaters = planner.ranked().filter((row) => row.line.type === 'skater');
        expect(skaters.map((row) => row.games)).toEqual([0, 0]);
        expect(skaters.map((row) => row.score)).toEqual([0, 0]);
        // A G seat is open both nights, so the goalie keeps his starts.
        const waiver = planner.ranked().find((row) => row.player.name === 'Waiver Goalie');
        expect(waiver?.games).toBe(2);

        planner.toggleFitMyTeam();
        expect(planner.ranked()[0].player.name).toBe('Top Scorer');
        expect(planner.ranked()[0].games).toBe(2);
      });

      it('shows beside a free agent the games only a drop makes room for, and scores none of them', async () => {
        const fixture = await render();
        const planner = fixture.point.componentInstance;

        // Both nights a drop opens a C and a LW, so each Oilers forward would play both, though
        // in place of the player dropped: beside his games, not in them or in his score.
        const skaters = planner.ranked().filter((row) => row.line.type === 'skater');
        expect(skaters.map((row) => row.dropGames)).toEqual([2, 2]);
        expect(skaters.map((row) => row.score)).toEqual([0, 0]);
        // What the two games would give him: his line over them, scored, beside the bare one. Only
        // for a row on screen, since each is a ranking of the whole list of its own.
        expect(skaters.every((row) => row.lifted === undefined)).toBe(true);
        for (const row of planner.visible().filter((shown) => shown.line.type === 'skater')) {
          expect(row.lifted?.score).toBeGreaterThan(0);
          expect(row.lifted?.line.stats.utility.gp).toBeGreaterThan(row.line.stats.utility.gp ?? 0);
        }
        // The goalie's G seat is open as it stands: nothing for a drop to add.
        const goalie = planner.visible().find((row) => row.line.type === 'goalie');
        expect(goalie?.dropGames).toBe(0);
        expect(goalie?.lifted).toBeUndefined();

        // Ranked over every night counted, there is no room to tell apart.
        planner.toggleFitMyTeam();
        expect(planner.ranked().every((row) => row.dropGames === undefined)).toBe(true);
      });

      // Scored all together, every lifted line shifted the z-score pool for the others, and a
      // player given one game more read as losing a point while the rest were given two.
      it('scores what a drop would add to a z-score against the list as it stands', async () => {
        settings = {
          ...SETTINGS,
          scoringType: 'category',
          statWeights: {},
          activeScoringColumns: ['goals', 'assists'],
        };
        const fixture = await render();
        const skaters = fixture.point.componentInstance
          .visible()
          .filter((row) => row.line.type === 'skater');

        expect(skaters).toHaveLength(2);
        for (const row of skaters) {
          // Games added to a line never cost it against a pool the line does not move.
          expect(row.lifted!.score).toBeGreaterThan(row.score);
        }
      });

      // A z-score lift is a ranking of the whole list of its own; scored for everyone at once
      // they held up every tick on the page by a second.
      it('scores what a drop would add only for the rows on screen, and once each', async () => {
        settings = {
          ...SETTINGS,
          scoringType: 'category',
          statWeights: {},
          activeScoringColumns: ['goals', 'assists'],
        };
        const fixture = await render();
        const planner = fixture.point.componentInstance;
        const rankOverall = vi.spyOn(
          fixture.point.injector.get(ProjectionRankingService),
          'rankOverall',
        );
        planner.pageSize.set(1);
        // Ranked afresh, with nothing scored yet: the first render scored a page of 25.
        planner.toggleCountDrops();
        planner.toggleCountDrops();

        expect(planner.ranked().every((row) => row.lifted === undefined)).toBe(true);
        expect(rankOverall).toHaveBeenCalledTimes(1);
        rankOverall.mockClear();
        expect(planner.visible()).toHaveLength(1);
        expect(planner.visible()[0].lifted).toBeDefined();
        expect(rankOverall).toHaveBeenCalledTimes(1);

        planner.goToPage(1);
        planner.visible();
        planner.goToPage(0);
        expect(planner.visible()[0].lifted).toBeDefined();
        expect(rankOverall).toHaveBeenCalledTimes(2);
      });

      it('counts the games a drop makes room for, for everyone at once, from a second tick box', async () => {
        const fixture = await render();
        const planner = fixture.point.componentInstance;
        const toggles = () =>
          ngMocks.findAll(fixture, '.free-agents .fit-toggle').map((t) => ngMocks.formatText(t));
        expect(toggles()).toEqual(['Fit to my roster', 'Include games a drop would open']);
        expect(planner.dropsCounted()).toBe(false);

        (ngMocks.find(fixture, '.fit-toggle--drops input').nativeElement as HTMLElement).click();
        fixture.detectChanges();
        expect(planner.dropsCounted()).toBe(true);
        // The two games each Oilers forward would play with a drop are his games now, and his
        // score is the line over them, with nothing left for a drop to add; his figures are yellow.
        const skaters = planner.ranked().filter((row) => row.line.type === 'skater');
        expect(skaters.map((row) => row.games)).toEqual([2, 2]);
        expect(skaters.map((row) => row.dropGames)).toEqual([2, 2]);
        expect(skaters.every((row) => row.score > 0)).toBe(true);
        expect(planner.visible().every((row) => row.lifted === undefined)).toBe(true);
        // Ranked on them: the best Oiler leads the list again.
        expect(planner.ranked()[0].player.name).toBe('Top Scorer');

        // Without the room there is nothing to open, so the second box goes with the first.
        planner.toggleFitMyTeam();
        fixture.detectChanges();
        expect(toggles()).toEqual(['Fit to my roster']);
        expect(planner.dropsCounted()).toBe(false);
      });

      // A box that changes nothing in the list only confuses: with no counted night a drop opens
      // anything on, it is not offered, and a tick left in it counts nothing.
      it('offers the drop box only while a counted night has something a drop opens', async () => {
        const fixture = await render();
        const planner = fixture.point.componentInstance;
        const toggles = () =>
          ngMocks.findAll(fixture, '.free-agents .fit-toggle').map((t) => ngMocks.formatText(t));
        planner.toggleCountDrops();
        fixture.detectChanges();
        expect(planner.dropsCounted()).toBe(true);

        // Both game nights have yellow positions; with neither counted, nothing is left to open.
        const [first, second] = planner.days().filter((day) => day.games > 0);
        planner.toggleDay(first);
        planner.toggleDay(second);
        fixture.detectChanges();
        expect(planner.dropOpensCountedNight()).toBe(false);
        expect(toggles()).toEqual(['Fit to my roster']);
        expect(planner.dropsCounted()).toBe(false);

        // One of them counted again brings the box back, ticked as it was left.
        planner.toggleDay(second);
        fixture.detectChanges();
        expect(toggles()).toEqual(['Fit to my roster', 'Include games a drop would open']);
        expect(planner.dropsCounted()).toBe(true);
      });

      it('shows in yellow, in lineup order, the positions a drop would open, one rule a run', async () => {
        const fixture = await render();
        const planner = fixture.point.componentInstance;

        // Three Cs and two LWs fill both C seats, both LW seats and the Util. Dropping a C empties
        // a seat a C or a LW can take (the Util, or the C seat once the Util's C slides over);
        // dropping a LW empties a LW seat only, so C and LW are yellow runs of their own, each
        // with one rule in its tip. RW, D and G were open already.
        const chips = (run: MockedDebugElement) =>
          ngMocks.findAll(run, '.room-chip').map((c) => ngMocks.formatText(c));
        expect(
          ngMocks
            .findAll(fixture, '.day .day-rooms')
            .map((line) => ngMocks.findAll(line, '.day-room').map(chips)),
        ).toEqual([
          [['C'], ['LW'], ['RW', 'D', 'G']],
          [['C'], ['LW'], ['RW', 'D', 'G']],
        ]);
        expect(ngMocks.findAll(fixture, '.day-room--drop').map(chips)).toEqual([
          ['C'],
          ['LW'],
          ['C'],
          ['LW'],
        ]);
        expect(planner.roomRuns(planner.days()[1]).map((run) => run.tip)).toEqual([
          'Drop a C to free up this spot.',
          'Drop any forward to free up this spot.',
          null,
        ]);
        // The tip leaves the spot to the pill, so a screen reader hears both.
        expect(
          ngMocks.findAll(fixture, '.day-room--drop').map((cell) => cell.attributes['aria-label']),
        ).toEqual([
          'C: Drop a C to free up this spot.',
          'LW: Drop any forward to free up this spot.',
          'C: Drop a C to free up this spot.',
          'LW: Drop any forward to free up this spot.',
        ]);
        // The phone has no hover: a tap on a yellow pill is what opens its tip, and it leaves the
        // night counted, though the cell around it would have unticked it.
        const drop = ngMocks.find(fixture, '.day-room--drop');
        const tip = ngMocks.findInstance(drop, TooltipDirective);
        const toggle = vi.spyOn(tip, 'toggle');
        expect(tip.appTooltip()).toBe('Drop a C to free up this spot.');
        const tick = (drop.nativeElement as HTMLElement).closest('.day')!.querySelector('input')!;
        expect(tick.checked).toBe(true);
        (drop.nativeElement as HTMLElement).click();
        fixture.detectChanges();
        expect(toggle).toHaveBeenCalledTimes(1);
        expect(tip.dismissOnClick()).toBe(false);
        expect(tick.checked).toBe(true);
        expect(
          ngMocks.findAll(fixture, '.range-legend').map((key) => ngMocks.formatText(key)),
        ).toEqual(['Available in your roster', 'Open if you drop a player']);
        // The legend does not say to hover: each yellow run carries the info glyph that does, and a
        // green run, which has no tip, carries none.
        expect(ngMocks.findAll(fixture, '.day-room--drop .room-hint')).toHaveLength(4);
        expect(ngMocks.findAll(fixture, '.day-room--open .room-hint')).toHaveLength(0);
        // Nothing asks who the user would drop, and the list has no swap to show.
        expect(ngMocks.formatText(fixture)).not.toContain('Droppable players');
        expect(ngMocks.findAll(fixture, '.swap-col')).toHaveLength(0);
      });

      describe('the roster, lowest first', () => {
        /** A line over the stretch's two games: so many goals, dressed for both. */
        const line = (playerId: string, goals: number) => ({
          playerId,
          clubGames: 2,
          expectedGames: 2,
          stats: { goals, assists: 0, toiPerGame: 1000 },
          nights: [],
        });

        beforeEach(() => {
          // Four Cs for two C spots and the Util: the least valuable C sits both nights,
          // however good his week looks on the schedule. The D is out.
          myTeam = {
            found: true,
            teamName: 'Howe Hard',
            players: [...myTeam.players, mine('16', ['C'])],
            lines: [
              line('10', 3),
              line('11', 2),
              line('12', 1),
              line('13', 1),
              line('14', 1.5),
              line('15', 2),
              line('16', 0.5),
            ],
          };
        });

        it('lists the player benched every night first, with his games and no start', async () => {
          const fixture = await render();
          const planner = fixture.point.componentInstance;
          const roster = planner.roster();

          expect(roster.map((row) => row.player.name)).toEqual([
            'Mine 16',
            'Mine 15',
            'Mine 12',
            'Mine 13',
            'Mine 14',
            'Mine 11',
            'Mine 10',
          ]);
          const [benched, out, lowestStarter] = roster;
          expect(benched).toMatchObject({ rank: 1, score: 0, games: 0, clubGames: 2 });
          expect(benched.nights.map((night) => night.status)).toEqual(['bench', 'bench']);
          // Out: no night to sit, and no start, but his games are still on the schedule.
          expect(out).toMatchObject({ score: 0, games: 0, clubGames: 2 });
          expect(out.nights.map((night) => night.status)).toEqual(['none', 'none']);
          // The third C starts both nights, in the Util spot: a goal at 3 apiece.
          expect(lowestStarter).toMatchObject({ score: 3, games: 2, clubGames: 2 });
          expect(lowestStarter.nights.map((night) => night.status)).toEqual(['start', 'start']);
          expect(planner.unprojected()).toBe(0);

          planner.setView('roster');
          fixture.detectChanges();
          expect(ngMocks.findAll(fixture, '.roster-note')).toHaveLength(0);
          const table = ngMocks.findInstance(RosterTableComponent);
          expect(table.rows().map((row) => row.player.name)[0]).toBe('Mine 16');
          expect(table.nights().map((day) => day.date)).toEqual(['2026-10-13', '2026-10-15']);
        });

        // Measured from the pool's average week, a player benched both nights scored below a
        // starter with one goal, and a starter with a thin week read as hurting the team.
        it('scores a category league from an empty week: nought on the bench, every start adding', async () => {
          settings = {
            ...SETTINGS,
            scoringType: 'category',
            statWeights: {},
            activeScoringColumns: ['goals', 'assists'],
          };
          const fixture = await render();
          const byName = new Map(
            fixture.point.componentInstance.roster().map((row) => [row.player.name, row]),
          );

          expect(byName.get('Mine 16')).toMatchObject({ score: 0, games: 0 });
          // The third C starts both nights with a goal over them, the first with three.
          const thin = byName.get('Mine 12')!;
          expect(thin.games).toBe(2);
          expect(thin.score).toBeGreaterThan(0);
          expect(byName.get('Mine 10')!.score).toBeCloseTo(3 * thin.score, 10);
        });

        it('follows the nights counted: with a night unticked, the bench shrinks to the other', async () => {
          const fixture = await render();
          const planner = fixture.point.componentInstance;
          planner.toggleDay(planner.days()[1]);

          const benched = planner.roster()[0];
          expect(benched.player.name).toBe('Mine 16');
          expect(benched.nights.map((night) => night.date)).toEqual(['2026-10-15']);
          expect(benched.clubGames).toBe(1);
        });

        it('sorts the roster by a column, and turns it round', async () => {
          const fixture = await render();
          const planner = fixture.point.componentInstance;

          planner.sortRosterBy('score');
          expect(planner.rosterSort()).toEqual({ key: 'score', descending: true });
          expect(planner.sortedRoster()[0].player.name).toBe('Mine 10');
          planner.sortRosterBy('clubGames');
          expect(planner.sortedRoster().map((row) => row.player.name)[0]).toBe('Mine 16');
        });

        it("says how many of the user's players the model has no line for", async () => {
          myTeam = { ...myTeam, lines: myTeam.lines.slice(1) };
          const fixture = await render();
          const planner = fixture.point.componentInstance;

          expect(planner.unprojected()).toBe(1);
          expect(planner.roster().map((row) => row.player.name)).not.toContain('Mine 10');
          planner.setView('roster');
          fixture.detectChanges();
          expect(ngMocks.formatText(fixture)).toContain(
            '1 of your players without a projection left out.',
          );
        });
      });

      describe('on a night with every seat taken', () => {
        const roster = (counts: Record<string, number>) =>
          Object.entries(counts).flatMap(([position, count]) =>
            Array.from({ length: count }, (_, index) => mine(`${position}${index}`, [position])),
          );
        /** Each game night's runs: "Full" as it reads, else whether the run is green or yellow. */
        const nights = async () => {
          const fixture = await render();
          return ngMocks.findAll(fixture, '.day .day-rooms').map((line) =>
            ngMocks.findAll(line, '.day-room').map((run) => {
              if (run.classes['day-room--full']) {
                return ngMocks.formatText(run);
              }
              return run.classes['day-room--drop'] ? 'drop' : 'open';
            }),
          );
        };

        // "Full" beside a yellow chip only confused: the chip already says there is no seat as
        // the lineup stands. The word is left for a night nothing opens.
        it('shows only the yellow positions when a drop opens one', async () => {
          // Each seat held by the only player who could take it: any drop opens his seat.
          myTeam = { found: true, players: roster({ C: 3, LW: 2, RW: 2, D: 4, G: 2 }), lines: [] };
          const runs = await nights();
          expect(runs).toHaveLength(2);
          for (const night of runs) {
            expect(night.length).toBeGreaterThan(0);
            expect(night.every((run) => run === 'drop')).toBe(true);
          }
        });

        it('says "Full" when no drop opens anything', async () => {
          // One more at every position: whoever goes, the bench fills his seat.
          myTeam = { found: true, players: roster({ C: 4, LW: 3, RW: 3, D: 5, G: 3 }), lines: [] };
          expect(await nights()).toEqual([['Full'], ['Full']]);
        });
      });

      it('says so when the league has no team of the user', async () => {
        myTeam = { found: false, players: [], lines: [] };
        const fixture = await render();
        const planner = fixture.point.componentInstance;

        expect(planner.myTeamStatus()).toBe('not-found');
        expect(planner.rooms()).toBeNull();
        expect(ngMocks.formatText(fixture)).toContain("Your team isn't in this league");
        expect(planner.ranked()[0].player.name).toBe('Top Scorer');
      });
    });

    it('surfaces a failed read instead of an empty table', async () => {
      freeAgents.mockReturnValue(throwError(() => new Error('offline')));
      const fixture = await render();

      const errorState = ngMocks
        .findAll(fixture, ErrorStateComponent)
        .find((element) => ngMocks.input(element, 'title') === "Couldn't load free agents");
      expect(errorState).toBeDefined();
      expect(fixture.point.componentInstance.ranked()).toHaveLength(0);
    });
  });
  /**
   * A league remembered on this device is not this account's until the account is connected:
   * reading it would only have Yahoo refuse, and the refusal would read as a failure where
   * nothing has gone wrong. The card says what to do instead.
   */
  describe('with an account not connected to Yahoo', () => {
    beforeEach(() => {
      chosen = LEAGUE;
      connected = false;
    });

    it('reads no league and asks the reader to connect, from the card itself', async () => {
      const fixture = await render();
      const planner = fixture.point.componentInstance;
      const card = ngMocks.find(fixture, 'section.free-agents');

      expect(planner.league()).toBeNull();
      expect(planner.leaguePrompt()).toBe('connect');
      expect(freeAgents).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalledWith(streamerPlannerMyTeam, expect.anything());
      expect(ngMocks.findAll(fixture, ErrorStateComponent)).toHaveLength(0);
      expect(ngMocks.formatText(fixture)).not.toContain("Couldn't load");
      expect(ngMocks.formatText(card)).toContain('Connect your Yahoo account');

      const connect = vi.spyOn(planner, 'connectYahoo').mockImplementation(() => undefined);
      ngMocks.click(ngMocks.find(card, '.league-prompt .btn'));
      expect(connect).toHaveBeenCalled();
    });

    it('says when a connected account lists no league at all', async () => {
      connected = true;
      leagues = [];
      const fixture = await render();

      expect(fixture.point.componentInstance.leaguePrompt()).toBe('no-leagues');
      expect(ngMocks.formatText(ngMocks.find(fixture, 'section.free-agents'))).toContain(
        'no NHL league this season',
      );
      expect(freeAgents).not.toHaveBeenCalled();
    });
  });

  describe('in a category league', () => {
    /** Goals, assists, power-play points and shots, with goalie wins. */
    const CATEGORY_SETTINGS: LeagueProjectionSettingsResponse = {
      ...SETTINGS,
      scoringType: 'category',
      statWeights: {},
      activeScoringColumns: ['goals', 'assists', 'ppp', 'sog', 'w'],
    };

    beforeEach(() => {
      chosen = LEAGUE;
      settings = CATEGORY_SETTINGS;
      freeAgents.mockReturnValue(
        of<FreeAgentWeek>({
          creases: [],
          players: [
            lineSkater('1', 'Sniper', { goals: 3, assists: 1, ppp: 0, sog: 12 }),
            lineSkater('2', 'Power Play', { goals: 0, assists: 1, ppp: 2, sog: 3 }),
            lineSkater('3', 'Middle', { goals: 1, assists: 1, ppp: 1, sog: 5 }),
            goalie('4', 'Waiver Goalie', 1),
          ],
        }),
      );
    });

    const names = (rows: readonly { player: { name: string } }[]) =>
      rows.map((row) => row.player.name);

    it("offers the league's every category to rank by, and ranks by all until one is picked", async () => {
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      expect(planner.focusOptions().map((option) => option.key)).toEqual([
        'goals',
        'assists',
        'ppp',
        'sog',
        'w',
      ]);
      expect(planner.focus().size).toBe(0);
      expect(names(planner.ranked())[0]).toBe('Sniper');
      expect(names(planner.ranked())).toContain('Waiver Goalie');
      expect(ngMocks.formatText(fixture)).toContain('All categories');
    });

    it('ranks skaters alone by the categories picked, and goes back to all of them', async () => {
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      planner.toggleFocus('ppp');
      expect(names(planner.ranked())).toEqual(['Power Play', 'Middle', 'Sniper']);
      expect([...planner.focus()]).toEqual(['ppp']);

      planner.toggleFocus('sog');
      expect(names(planner.ranked())[0]).not.toBe('Waiver Goalie');
      expect(names(planner.ranked())).not.toContain('Waiver Goalie');

      planner.clearFocus();
      expect(names(planner.ranked())).toContain('Waiver Goalie');
      expect(names(planner.ranked())[0]).toBe('Sniper');
    });

    it('draws the columns for the whole list, not the page: sorted by assists, the goalie stays', async () => {
      freeAgents.mockReturnValue(
        of<FreeAgentWeek>({
          creases: [],
          players: [
            ...Array.from({ length: 30 }, (_, index) =>
              lineSkater(`${index + 1}`, `Skater ${index + 1}`, { goals: 1, assists: 1, sog: 3 }),
            ),
            goalie('99', 'Waiver Goalie', 1),
          ],
        }),
      );
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      planner.sortBy('assists');
      fixture.detectChanges();
      const table = ngMocks.findInstance(FreeAgentsTableComponent);
      // The goalie, with no assists, is on no page but the last; the columns are drawn for him all
      // the same, so the table does not change shape as it is sorted or paged.
      expect(names(table.rows())).not.toContain('Waiver Goalie');
      expect(names(table.listed() ?? [])).toContain('Waiver Goalie');

      // Narrowed to the skaters' positions, the list has no goalie, and so neither do the columns.
      planner.togglePosition('C');
      fixture.detectChanges();
      expect(names(ngMocks.findInstance(FreeAgentsTableComponent).listed() ?? [])).not.toContain(
        'Waiver Goalie',
      );
    });

    it('ranks the goalies alone by a goalie category, and both kinds by one of each', async () => {
      freeAgents.mockReturnValue(
        of<FreeAgentWeek>({
          creases: [],
          players: [
            lineSkater('1', 'Sniper', { goals: 3, assists: 1, ppp: 0, sog: 12 }),
            goalie('4', 'Waiver Goalie', 1),
            goalie('5', 'Winning Goalie', 3),
          ],
        }),
      );
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      planner.toggleFocus('w');
      expect(names(planner.visible())).toEqual(['Winning Goalie', 'Waiver Goalie']);
      expect([...planner.focus()]).toEqual(['w']);

      planner.toggleFocus('goals');
      expect(names(planner.visible())).toHaveLength(3);
      expect(planner.focus()).toEqual(new Set(['goals', 'w']));

      planner.clearFocus();
      expect(planner.focus().size).toBe(0);
      expect(names(planner.visible())).toHaveLength(3);
    });

    it("offers only the categories the positions shown score in, and keeps a hidden pick for when they're back", async () => {
      const fixture = await render();
      const planner = fixture.point.componentInstance;
      const offered = () => planner.focusOptions().map((option) => option.key);

      planner.toggleFocus('sog');
      planner.toggleFocus('w');

      // Wingers alone: no goalie on the list, so no goalie category to rank it by.
      planner.togglePosition('LW');
      planner.togglePosition('RW');
      expect(offered()).toEqual(['goals', 'assists', 'ppp', 'sog']);
      expect([...planner.focus()]).toEqual(['sog']);
      fixture.detectChanges();
      expect(ngMocks.findAll('.focus .pill').map((pill) => ngMocks.formatText(pill))).toEqual([
        'All categories',
        'G',
        'A',
        'PPP',
        'SOG',
      ]);

      // Goalies alone: their categories only.
      planner.clearPositions();
      planner.togglePosition('G');
      expect(offered()).toEqual(['w']);
      expect([...planner.focus()]).toEqual(['w']);

      // A skater beside the goalies, or every position again: both kinds, and both picks.
      planner.togglePosition('C');
      expect(offered()).toEqual(['goals', 'assists', 'ppp', 'sog', 'w']);
      planner.clearPositions();
      expect([...planner.focus()]).toEqual(['sog', 'w']);
    });

    it('says so when nobody scores in the categories picked', async () => {
      freeAgents.mockReturnValue(
        of<FreeAgentWeek>({
          creases: [],
          players: [lineSkater('1', 'Sniper', { goals: 3, assists: 1, ppp: 0, sog: 12 })],
        }),
      );
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      planner.toggleFocus('w');
      fixture.detectChanges();

      expect(planner.noFreeAgents()).toBe(false);
      expect(ngMocks.formatText(fixture)).toContain(
        'No available player has a projection in these categories.',
      );
    });

    it('remembers the categories for the league until the week is over', async () => {
      const first = await render();
      first.point.componentInstance.toggleFocus('ppp');
      first.destroy();

      // Later the same week: still chasing power-play points.
      today = '2026-10-17';
      const later = await render();
      expect([...later.point.componentInstance.focus()]).toEqual(['ppp']);
      expect(names(later.point.componentInstance.ranked())[0]).toBe('Power Play');
      later.destroy();

      // The Monday after: a new matchup, so every category again.
      today = '2026-10-19';
      const nextWeek = await render();
      expect(nextWeek.point.componentInstance.focus().size).toBe(0);
    });

    it('offers nothing to pick in a points league', async () => {
      settings = SETTINGS;
      const fixture = await render();

      expect(fixture.point.componentInstance.focusOptions()).toEqual([]);
      expect(ngMocks.formatText(fixture)).not.toContain('All categories');
    });
  });

  describe('with an ESPN league last chosen', () => {
    const originalEspnLeagues = environment.espnLeaguesEnabled;
    const OFFICE: ChosenLeague = { platform: 'ESPN', leagueId: '12345', name: 'Office League' };

    beforeEach(() => {
      chosen = OFFICE;
      environment.espnLeaguesEnabled = true;
    });

    afterEach(() => {
      environment.espnLeaguesEnabled = originalEspnLeagues;
    });

    it('opens on the ESPN tab and reads its free agents', async () => {
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      expect(planner.platform()).toBe('espn');
      expect(planner.league()).toEqual(OFFICE);
      expect(freeAgents).toHaveBeenCalledWith('ESPN', '12345', '2026-10-12', '2026-10-18');
    });

    /** Each tab is its own league, as on Team Power Rankings: Yahoo's is picked on Yahoo's. */
    it("reads nothing on the Yahoo tab until a Yahoo league is picked, and keeps ESPN's", async () => {
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      planner.platform.set('yahoo');
      expect(planner.league()).toBeNull();

      planner.platform.set('espn');
      expect(planner.league()).toEqual(OFFICE);
    });

    /** ESPN's league is a tall form: the nights sit beside it, not under its whole height. */
    it("sets the nights beside ESPN's form, and under Yahoo's one-line picker", async () => {
      const fixture = await render();
      const card = ngMocks.find(fixture, '.nights').nativeElement as HTMLElement;

      expect(card.classList).toContain('nights--beside');

      fixture.point.componentInstance.platform.set('yahoo');
      fixture.detectChanges();
      expect(card.classList).not.toContain('nights--beside');
    });

    it('stays on Yahoo where ESPN leagues are not offered', async () => {
      environment.espnLeaguesEnabled = false;
      const fixture = await render();
      const planner = fixture.point.componentInstance;

      expect(planner.platform()).toBe('yahoo');
      expect(planner.league()).toBeNull();
      expect(freeAgents).not.toHaveBeenCalled();
    });
  });
  describe('demo mode', () => {
    beforeEach(() => {
      poolFreeAgents.mockReturnValue(
        of<FreeAgentWeek>({
          creases: [],
          players: [
            { ...skater('7', 'Deep Sleeper', 2, 2), availability: 'UNKNOWN', percentRostered: 12 },
            { ...skater('8', 'Bench Body', 0, 1), availability: 'UNKNOWN', percentRostered: 3 },
          ],
        }),
      );
    });

    it('is not offered to someone who is not an admin, Premium or not', async () => {
      const fixture = await render();

      expect(ngMocks.findAll(fixture, '.demo-toggle')).toHaveLength(0);
      expect(fixture.point.componentInstance.demo()).toBe(false);
    });

    it('reads no league and lists the Yahoo pool under 50% rostered', async () => {
      admin.set(true);
      chosen = LEAGUE;
      const fixture = await render();
      const planner = fixture.point.componentInstance;
      freeAgents.mockClear();
      invoke.mockClear();

      planner.toggleDemo();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(planner.league()).toBeNull();
      expect(poolFreeAgents).toHaveBeenCalledWith('2026-10-12', '2026-10-18', 50);
      expect(freeAgents).not.toHaveBeenCalled();
      expect(invoke.mock.calls.filter(([fn]) => fn === streamerPlannerMyTeam)).toHaveLength(0);
      expect(planner.ranked().map((row) => row.player.name)).toEqual([
        'Deep Sleeper',
        'Bench Body',
      ]);
      expect(ngMocks.findAll(fixture, 'app-league-field')).toHaveLength(0);
      expect(ngMocks.find(fixture, '.demo-slider').nativeElement.value).toBe('50');
      expect(ngMocks.formatText(ngMocks.find(fixture, '.demo-threshold-value'))).toBe('50%');
      expect(ngMocks.findAll(fixture, 'app-league-settings-controls')).toHaveLength(1);
      expect(ngMocks.findAll(fixture, 'app-stat-weights-editor')).toHaveLength(1);
    });

    it('follows the thumb in the label and asks again only once the slider is let go', async () => {
      admin.set(true);
      const fixture = await render();
      const planner = fixture.point.componentInstance;
      planner.toggleDemo();
      await fixture.whenStable();
      poolFreeAgents.mockClear();

      planner.dragMaxRostered({ target: { value: '30' } } as unknown as Event);
      await fixture.whenStable();
      expect(planner.rosteredShown()).toBe(30);
      expect(planner.maxRostered()).toBe(50);
      expect(poolFreeAgents).not.toHaveBeenCalled();

      planner.setMaxRostered({ target: { value: '30' } } as unknown as Event);
      await fixture.whenStable();
      expect(planner.maxRostered()).toBe(30);
      expect(poolFreeAgents).toHaveBeenLastCalledWith('2026-10-12', '2026-10-18', 30);

      planner.setMaxRostered({ target: { value: '' } } as unknown as Event);
      expect(planner.maxRostered()).toBe(30);
    });

    it('ranks by the league an admin sets, categories included', async () => {
      admin.set(true);
      const fixture = await render();
      const planner = fixture.point.componentInstance;
      planner.toggleDemo();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(planner.scoringType()).toBe('points');
      expect(planner.focusOptions()).toEqual([]);

      planner.setDemoLeague({
        ...planner.demoLeague(),
        scoringType: 'category',
        activeScoringColumns: new Set(['goals', 'assists']),
      });
      fixture.detectChanges();

      expect(planner.scoringType()).toBe('category');
      expect(planner.categories()).toEqual(['goals', 'assists']);
      expect(planner.focusOptions().map((option) => option.key)).toEqual(['goals', 'assists']);
      expect(ngMocks.findAll(fixture, 'app-stat-weights-editor')).toHaveLength(0);
      // Bench Body has the one assist and no goal: last on goals, level on nothing.
      expect(planner.ranked().map((row) => row.player.name)).toEqual([
        'Deep Sleeper',
        'Bench Body',
      ]);
    });

    it('weighs the points as the admin sets them', async () => {
      admin.set(true);
      const fixture = await render();
      const planner = fixture.point.componentInstance;
      planner.toggleDemo();
      await fixture.whenStable();

      // Only assists count: Bench Body's one assist against Deep Sleeper's two is not enough.
      planner.setDemoLeague({
        ...planner.demoLeague(),
        activeScoringColumns: new Set(['assists']),
      });
      planner.setDemoWeights({ ...planner.demoLeague().statWeights, assists: 10 });

      expect(planner.ranked().map((row) => [row.player.name, row.score])).toEqual([
        ['Deep Sleeper', 20],
        ['Bench Body', 10],
      ]);
    });

    it('goes back to the league when switched off', async () => {
      admin.set(true);
      chosen = LEAGUE;
      const fixture = await render();
      const planner = fixture.point.componentInstance;
      planner.toggleDemo();
      await fixture.whenStable();
      planner.toggleDemo();
      await fixture.whenStable();

      expect(planner.league()?.leagueId).toBe(LEAGUE.leagueId);
      expect(freeAgents).toHaveBeenLastCalledWith(
        'YAHOO',
        LEAGUE.leagueId,
        '2026-10-12',
        '2026-10-18',
      );
    });
  });
});
