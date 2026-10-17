import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { environment } from '../../environments/environment';
import { RosterSlots } from '../api/models/roster-slots';
import {
  DEFAULT_LEAGUE_SIZE,
  DEFAULT_ROSTER_SLOTS,
  DEFAULT_SCORING_COLUMNS,
  DEFAULT_STAT_WEIGHTS,
} from '../draft-projection/projection-defaults';
import { DEFAULT_DECIMAL_SETTINGS } from '../draft-projection/projection-settings-section/model';
import { nhlTeamKey } from '../models/nhl-team';
import { Projection, ScoredProjection } from '../models/projection.model';
import { isAllSkaters } from '../models/position.model';
import { ScoringStatKey } from '../models/stat-key.model';
import { EspnService } from '../services/espn.service';
import { ChosenLeague, LeagueChoiceService } from '../services/league-choice.service';
import { PlayerScoutService, ScoutSince, TeamPlayer } from '../services/player-scout.service';
import { ProjectionRankingService, ScoreUnits } from '../services/projection-ranking.service';
import { YahooService } from '../services/yahoo.service';
import { ErrorStateComponent } from '../shared/error-state/error-state';
import { IconComponent } from '../shared/icon/icon';
import { LoadingIndicatorComponent } from '../shared/loading-indicator/loading-indicator';
import { Platform } from '../shared/platform-tabs/platform-tabs';
import { PositionChipsComponent } from '../shared/position-chips/position-chips';
import { TeamLogoComponent } from '../shared/team-logo/team-logo';
import { TooltipDirective } from '../shared/tooltip/tooltip.directive';
import { YahooLeaguePicker } from '../shared/yahoo-league-picker';
import { LeagueFieldComponent } from '../streamer-planner/league-field/league-field';
import {
  FREE_AGENT_POSITIONS,
  FreeAgentPosition,
  filterByPositions,
  PLANNER_POSITIONS,
} from '../streamer-planner/planner-free-agents';
import { TeamRoom, teamRoom } from './drop-candidates';
import {
  EVEN_NIGHTS,
  LineupValue,
  NightWeights,
  priceDrop,
  statShares,
  valueLineup,
} from './lineup-value';
import {
  nextScoutSort,
  rankScout,
  SCOUT_RANKED_ORDER,
  ScoutRow,
  ScoutSort,
  ScoutSortKey,
  sortScout,
} from './scout-ranking';
import { ScoutTableComponent, ScoutView } from './scout-table/scout-table';
import {
  formatDay,
  localToday,
  sinceCaption,
  SincePickerComponent,
} from './since-picker/since-picker';

/** Players to a page: enough to reach well past a league's bench without a second page. */
export const SCOUT_PAGE_SIZE = 25;

/** Drops offered on the room line: the few a manager would actually consider, the cheapest first. */
export const DROP_CHIPS = 4;

/** "Hughes" for "T.J. Hughes": the name a heading has room for. */
export function surname(name: string): string {
  return name.trim().split(/\s+/).at(-1) ?? name;
}

/** The stretches of games the ice can be read over: a week, a fortnight, a month of hockey. */
export const RECENT_GAME_OPTIONS = [3, 5, 10] as const;
export const DEFAULT_RECENT_GAMES = 5;

/**
 * Whose players the list shows, as Yahoo's player list offers it: by status, or one league team.
 * `team:<name>` is that team's roster.
 */
export type ScoutPool = 'available' | 'fa' | 'waivers' | 'taken' | 'all' | `team:${string}`;

/** Which way the model has moved on the players shown, once a comparison is on. */
export type ScoutMovers = 'all' | 'risers' | 'fallers';

/** The stretch the ice is read over: each club's last N games, or since the comparison's day. */
export type IceWindow = 'last' | 'since';

/** One of the user's own players as the roster fold-out lists him. */
export interface RosterEntry {
  readonly player: TeamPlayer;
  /** His rest of the season scored by the league's settings; null when the model has no line. */
  readonly score: number | null;
  readonly value: LineupValue | null;
  /** The change in his score since the day; null without a then-line. */
  readonly delta: number | null;
  /**
   * Whether his place in the lineup could be weighed: the league's slots known, and his club's
   * nights too. A healthy player on a club the schedule does not know starts nowhere by our
   * reckoning, which is not the same as being worth nothing, so he is never the cheapest.
   */
  readonly weighed: boolean;
}

/** A league team as the pool offers it. */
export interface LeagueTeamOption {
  readonly pool: ScoutPool;
  readonly name: string;
  readonly mine: boolean;
}

/**
 * Player Scout: every player in a league on the AI projection for the rest of the season, with,
 * on a switch, how the projection has moved since a chosen day, and, in a view of its own, what
 * the ice has shown lately. The FA scout's question (who is worth keeping) and Role Changes'
 * (whose job at his club just changed) on one list.
 *
 * <p>The list opens on the available players, best first on today's projection, and nothing
 * else: a reader who wants the top of the projection gets it with no figure wearing a change. A
 * comparison is one switch away: against the projection made before the season, or the one of
 * any day (the model is re-run nightly, so each day is a projection of its own), re-spread over
 * the games left so the two compare stat by stat; every figure then wears its change, the rank
 * its places gained. The ice view keeps the rank, the player and the score to sort by, and shows
 * the measured ice a game, power-play ice and share of the club's power play over each club's
 * last few games against his games before, with where the lineup page lists him.
 *
 * <p>Whose players, as Yahoo's player list offers it: the available ones, free agents or waivers
 * alone, everyone taken, everyone, or one league team, an NHL club, and a tick to show the user's
 * own players beside whatever is shown, so a pickup reads against the player he would replace.
 * The user's own team is weighed night by night over the rest of the season ({@link valueLineup}):
 * the player to drop is the one whose going costs the lineup least.
 */
@Component({
  selector: 'app-player-scout',
  imports: [
    ErrorStateComponent,
    IconComponent,
    LeagueFieldComponent,
    LoadingIndicatorComponent,
    NgTemplateOutlet,
    PositionChipsComponent,
    ScoutTableComponent,
    SincePickerComponent,
    TeamLogoComponent,
    TooltipDirective,
  ],
  templateUrl: './player-scout.html',
  styleUrl: './player-scout.css',
  providers: [YahooLeaguePicker],
})
export class PlayerScoutComponent {
  private readonly scoutService = inject(PlayerScoutService);
  private readonly picker = inject(YahooLeaguePicker);
  private readonly ranking = inject(ProjectionRankingService);
  private readonly yahoo = inject(YahooService);
  private readonly espn = inject(EspnService);

  constructor() {
    this.picker.start();
  }

  // --- The league, picked as the planner picks it ---------------------------------------------

  /** Whether ESPN leagues are offered at all: where the planner and Team Power Rankings offer them. */
  private readonly espnOffered = environment.espnLeaguesEnabled;
  private readonly remembered = inject(LeagueChoiceService).league();

  /** Which platform's league the players come from: last time's, else Yahoo. */
  readonly platform = signal<Platform>(
    this.espnOffered && this.remembered?.platform === 'ESPN' ? 'espn' : 'yahoo',
  );

  /** The ESPN league ESPN last accepted, kept while the reader looks at Yahoo's. */
  readonly espnLeague = signal<ChosenLeague | null>(
    this.espnOffered && this.remembered?.platform === 'ESPN' ? this.remembered : null,
  );

  /** The league the players are read from: the tab's, equal by platform and id alone. */
  readonly league = computed<ChosenLeague | null>(
    () => {
      if (this.platform() === 'espn') {
        return this.espnLeague();
      }
      const key = this.picker.selectedKey();
      return key
        ? { platform: 'YAHOO', leagueId: key, name: this.picker.selectedLeague()?.name ?? key }
        : null;
    },
    { equal: (a, b) => a?.platform === b?.platform && a?.leagueId === b?.leagueId },
  );

  // --- The view, the comparison and the ice's window ------------------------------------------

  readonly view = signal<ScoutView>('projection');

  /** Whether the projection view compares with an earlier projection. Off: today's alone. */
  readonly compare = signal(false);

  readonly today = localToday();

  /** The day compared with, as an ISO date, or null for the model's preseason projection. */
  readonly since = signal<string | null>(null);

  /** The stretch the ice is read over, and how many games when it is each club's last few. */
  readonly iceWindowPicked = signal<IceWindow>('last');
  readonly recentGames = signal<number>(DEFAULT_RECENT_GAMES);
  readonly recentGameOptions = RECENT_GAME_OPTIONS;

  /** "Since the day" needs a day: without a comparison on a day, the ice is read over last games. */
  readonly iceWindow = computed<IceWindow>(() =>
    this.iceWindowPicked() === 'since' && this.compare() && this.since() !== null
      ? 'since'
      : 'last',
  );

  toggleCompare(): void {
    this.compare.update((on) => !on);
  }

  /** The preseason (null) or a day picked: the comparison on, against that. */
  pickSince(day: string | null): void {
    this.since.set(day);
    this.compare.set(true);
  }

  /** Off: today's projection alone. The day is kept, so Off and back lands on the same one. */
  clearCompare(): void {
    this.compare.set(false);
  }

  onRecentGames(event: Event): void {
    this.recentGames.set(Number((event.target as HTMLSelectElement).value));
  }

  /**
   * What the league is asked for, equal by value: switching the comparison on against the
   * preseason, or the view, changes nothing the BFF is asked, so the list is not read again.
   */
  private readonly query = computed(
    () => {
      const league = this.league();
      if (!league) {
        return undefined;
      }
      return {
        league,
        since: this.compare() ? this.since() : null,
        recentGames: this.iceWindow() === 'last' ? this.recentGames() : null,
      };
    },
    {
      equal: (a, b) =>
        a?.league.platform === b?.league.platform &&
        a?.league.leagueId === b?.league.leagueId &&
        a?.since === b?.since &&
        a?.recentGames === b?.recentGames,
    },
  );

  private readonly scoutResource = rxResource({
    params: () => this.query(),
    stream: ({ params }) =>
      this.scoutService.players(params.league.platform, params.league.leagueId, {
        since: params.since,
        recentGames: params.recentGames,
      }),
  });

  private readonly settingsResource = rxResource({
    params: () => this.league() ?? undefined,
    stream: ({ params }) =>
      params.platform === 'YAHOO'
        ? this.yahoo.leagueProjectionSettings(params.leagueId)
        : this.espn.leagueProjectionSettings(params.leagueId),
  });

  /** The user's own team, read beside the league; its failure costs the drops, never the list. */
  private readonly teamResource = rxResource({
    params: () => this.league() ?? undefined,
    stream: ({ params }) => this.scoutService.myTeam(params.platform, params.leagueId),
  });

  readonly loading = computed(
    () => this.scoutResource.isLoading() || this.settingsResource.isLoading(),
  );
  readonly failure = computed(() => this.scoutResource.error() ?? this.settingsResource.error());

  retryTeam(): void {
    this.teamResource.reload();
  }

  retry(): void {
    if (this.settingsResource.error()) {
      this.settingsResource.reload();
    }
    if (this.scoutResource.error()) {
      this.scoutResource.reload();
    }
  }

  private readonly list = computed(() =>
    this.scoutResource.hasValue() ? this.scoutResource.value() : null,
  );

  /** The season has not started, or is over: there is no rest of it to scout. */
  readonly outOfSeason = computed(() => this.list()?.inSeason === false);

  /** What the BFF answered the day with; null until it has, or while no comparison is on. */
  readonly sinceAnswer = computed<ScoutSince | null>(() =>
    this.compare() ? (this.list()?.since ?? null) : null,
  );

  /** Which earlier projection actually answered, under the picker; empty until it has. */
  readonly sinceCaption = computed(() => sinceCaption(this.sinceAnswer()));

  /**
   * The first day a projection is kept for this season, the floor of the day picker: the BFF
   * reports it with every answer, comparison on or off, so the picker knows it before the first
   * day is picked. Null until the list has answered, or while nothing is kept.
   */
  readonly earliestKept = computed(() => this.list()?.since.earliestSnapshot ?? null);

  /** Whether the list is on the page: the room for a pickup is only worth a line above one. */
  readonly listReady = computed(
    () => !this.failure() && !this.loading() && !this.outOfSeason() && !this.noPlayers(),
  );

  readonly sinceLabel = computed(() => {
    const answer = this.sinceAnswer();
    if (!answer || answer.kind === 'NONE') {
      return 'no earlier projection';
    }
    return answer.kind === 'SNAPSHOT' ? `vs ${formatDay(answer.resolved)}` : 'vs preseason';
  });

  /** What the ice is measured over, for the table's heading: "last 5 games", "since 7 Oct". */
  readonly iceLabel = computed(() => {
    if (this.iceWindow() === 'since') {
      return `since ${formatDay(this.since())}`;
    }
    const games = this.list()?.recentGames ?? this.recentGames();
    return `each club's last ${games} games`;
  });

  /** The league's own scoring, or the app's defaults until its settings land. */
  private readonly scoring = computed(() => {
    const settings = this.settingsResource.hasValue() ? this.settingsResource.value() : null;
    return {
      scoringType: settings?.scoringType ?? 'points',
      statWeights: {
        ...DEFAULT_STAT_WEIGHTS,
        ...((settings?.statWeights ?? {}) as Record<ScoringStatKey, number>),
      },
      activeScoringColumns: new Set(
        (settings?.activeScoringColumns as ScoringStatKey[] | undefined) ?? DEFAULT_SCORING_COLUMNS,
      ),
    };
  });

  readonly scoringType = computed(() => this.scoring().scoringType);

  readonly scoreHeading = computed(() => (this.scoringType() === 'points' ? 'Points' : 'Z-Score'));

  readonly scoreTip = computed(() =>
    this.scoringType() === 'points'
      ? 'Projected points for the rest of the season.'
      : 'Projected Z-Score for the rest of the season. Zero is the last player a league this size would roster.',
  );

  readonly dropCostTip = computed(() =>
    this.scoringType() === 'points'
      ? 'The total points your team would lose if you dropped this player.'
      : 'The total Z-Score your team would lose if you dropped this player.',
  );

  readonly categories = computed<readonly ScoringStatKey[]>(() => [
    ...this.scoring().activeScoringColumns,
  ]);

  // --- Whose players ----------------------------------------------------------------------------

  readonly pool = signal<ScoutPool>('available');
  /** The user's own players beside whatever the pool shows. */
  readonly showMine = signal(false);
  /** An NHL club, by the NHL's spelling, or null for every club. */
  readonly nhlTeam = signal<string | null>(null);
  readonly movers = signal<ScoutMovers>('all');
  readonly search = signal('');

  onPool(event: Event): void {
    this.pool.set((event.target as HTMLSelectElement).value as ScoutPool);
  }

  onNhlTeam(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.nhlTeam.set(value || null);
  }

  toggleShowMine(): void {
    this.showMine.update((on) => !on);
  }

  onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  readonly positionOptions = FREE_AGENT_POSITIONS;

  /** The positions the list is narrowed to, G among them. None is every player. */
  readonly positions = signal<ReadonlySet<FreeAgentPosition>>(new Set());

  togglePosition(position: FreeAgentPosition): void {
    this.positions.update((positions) => {
      const next = new Set(positions);
      if (!next.delete(position)) {
        next.add(position);
      }
      return next;
    });
  }

  clearPositions(): void {
    this.positions.set(new Set());
  }

  /** Every skater position picked, and nothing else: what the "All skaters" shortcut shows. */
  readonly allSkaters = computed(() => isAllSkaters([...this.positions()]));

  /** Picks the four skater positions at once; pressed again, goes back to everyone. */
  toggleAllSkaters(): void {
    this.positions.set(this.allSkaters() ? new Set() : new Set(PLANNER_POSITIONS));
  }

  /** Who the positions picked are: skaters, goalies, or both, as none picked is. */
  readonly shown = computed<'skaters' | 'goalies' | 'players'>(() => {
    const positions = this.positions();
    const goalies = positions.has('G');
    if (positions.size === 0 || (goalies && positions.size > 1)) {
      return 'players';
    }
    return goalies ? 'goalies' : 'skaters';
  });

  /** Ranks lines by the league's scoring, best first, and the score each is ranked by. */
  private readonly ranker = computed(() => {
    const scoring = this.scoring();
    const input = (projections: Projection[]) => ({
      projections,
      scoringType: scoring.scoringType,
      statWeights: scoring.statWeights,
      activeScoringColumns: scoring.activeScoringColumns,
      leagueSize: DEFAULT_LEAGUE_SIZE,
      rosterSlots: DEFAULT_ROSTER_SLOTS,
      // A goalie on the wire is rarely anyone's starter, and the season minimum is there to keep
      // a backup off a season table. Applied here it would rank most of them out of the list.
      minGoalieGames: 0,
      decimalSettings: DEFAULT_DECIMAL_SETTINGS,
    });
    const rank = (projections: Projection[]): ScoredProjection[] =>
      this.ranking.rankOverall(input(projections));
    const units = (projections: Projection[]): ScoreUnits =>
      this.ranking.scoreUnits(input(projections));
    const scoreOf = (entry: ScoredProjection) =>
      scoring.scoringType === 'points' ? entry.score.fantasyPoints : entry.score.zScore;
    return { rank, units, scoreOf };
  });

  /**
   * What one more of each scored stat adds to a score over today's lines, so a night that moves a
   * player's goals or hits can be priced in the same score he is ranked by.
   */
  private readonly units = computed<ScoreUnits | null>(() => {
    const list = this.list();
    return list
      ? this.ranker().units(list.players.map((player) => player.freeAgent.projection))
      : null;
  });

  /** Every player in the league, skaters and goalies, best first on the rest of the season. */
  readonly ranked = computed<readonly ScoutRow[]>(() => {
    const list = this.list();
    if (!list) {
      return [];
    }
    const { rank, scoreOf } = this.ranker();
    return rankScout(list.players, rank, scoreOf);
  });

  /** The league's teams as the pool offers them, the user's own first. */
  readonly leagueTeams = computed<readonly LeagueTeamOption[]>(() => {
    const teams = new Map<string, boolean>();
    for (const row of this.ranked()) {
      if (row.scout.owner) {
        teams.set(row.scout.owner.teamName, row.scout.owner.mine);
      }
    }
    return [...teams]
      .map(([name, mine]) => ({ pool: `team:${name}` as ScoutPool, name, mine }))
      .sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name));
  });

  /** The NHL clubs the league's players are on, by the NHL's spelling. */
  readonly nhlTeams = computed<readonly string[]>(() => {
    const clubs = new Set<string>();
    for (const row of this.ranked()) {
      const key = nhlTeamKey(row.player.teamAbbrev);
      if (key) {
        clubs.add(key);
      }
    }
    return [...clubs].sort((a, b) => a.localeCompare(b));
  });

  /** Whether the pool already shows the user's own players, so the tick has nothing to add. */
  readonly poolShowsMine = computed(() => {
    const pool = this.pool();
    if (pool === 'all' || pool === 'taken') {
      return true;
    }
    const mine = this.leagueTeams().find((team) => team.mine);
    return mine !== undefined && pool === mine.pool;
  });

  /** The players whose owner the pool asks for, the user's own beside them on the tick. */
  private readonly inPool = computed<readonly ScoutRow[]>(() => {
    const pool = this.pool();
    const showMine = this.showMine();
    const nhlTeam = this.nhlTeam();
    const holds = (row: ScoutRow): boolean => {
      const owner = row.scout.owner;
      switch (pool) {
        case 'available':
          return owner === null;
        case 'fa':
          return owner === null && row.player.availability === 'FREE_AGENT';
        case 'waivers':
          return owner === null && row.player.availability === 'WAIVERS';
        case 'taken':
          return owner !== null;
        case 'all':
          return true;
        default:
          return owner?.teamName === pool.slice('team:'.length);
      }
    };
    return this.ranked().filter(
      (row) =>
        (holds(row) || (showMine && row.scout.owner?.mine === true)) &&
        (nhlTeam === null || nhlTeamKey(row.player.teamAbbrev) === nhlTeam),
    );
  });

  /** The players at the positions picked, movers or not. */
  private readonly atPositions = computed(
    () => filterByPositions(this.inPool(), this.positions()) as readonly ScoutRow[],
  );

  readonly risingCount = computed(() => this.atPositions().filter((row) => row.rising).length);

  readonly filtered = computed<readonly ScoutRow[]>(() => {
    const movers = this.compare() ? this.movers() : 'all';
    const needle = this.search().trim().toLowerCase();
    return this.atPositions().filter((row) => {
      const delta = row.delta ?? 0;
      if (movers === 'risers' && delta <= 0) {
        return false;
      }
      if (movers === 'fallers' && delta >= 0) {
        return false;
      }
      return !needle || row.player.name.toLowerCase().includes(needle);
    });
  });

  // --- The user's team --------------------------------------------------------------------------

  /** The user's team in this league, or null while it loads, fails or is not his. */
  private readonly team = computed<readonly TeamPlayer[] | null>(() => {
    const answer = this.teamResource.hasValue() ? this.teamResource.value() : null;
    return answer?.team.found ? answer.team.players : null;
  });

  /** Every club's remaining nights, by the NHL's spelling of the club. */
  private readonly schedule = computed<ReadonlyMap<string, readonly string[]>>(() => {
    const answer = this.teamResource.hasValue() ? this.teamResource.value() : null;
    return answer?.schedule ?? new Map();
  });

  readonly teamStatus = computed<'loading' | 'error' | 'not-found' | 'ready'>(() => {
    if (this.teamResource.error()) {
      return 'error';
    }
    if (this.teamResource.isLoading()) {
      return 'loading';
    }
    return this.team() ? 'ready' : 'not-found';
  });

  readonly teamFailure = computed(() => this.teamResource.error());

  private readonly slots = computed<RosterSlots | null>(
    () =>
      (this.settingsResource.hasValue() ? this.settingsResource.value() : null)?.rosterSlots ??
      null,
  );

  /** Whether the league's roster slots are known, so the lineup can be weighed at all. */
  readonly slotsKnown = computed(() => this.slots() !== null);

  /** Each of the user's players' score, from the league list, which scores everyone together. */
  private readonly ownScores = computed<ReadonlyMap<string, ScoutRow>>(() => {
    const rows = new Map<string, ScoutRow>();
    for (const row of this.ranked()) {
      if (row.scout.owner?.mine) {
        rows.set(row.player.playerId, row);
      }
    }
    return rows;
  });

  private readonly scoreOfOwn = computed(() => {
    const scores = this.ownScores();
    return (playerId: string) => scores.get(playerId)?.score ?? null;
  });

  /** Every club's nights' worth, and how much of each of the user's players they move. */
  private readonly nightWeights = computed<NightWeights>(() => {
    const answer = this.teamResource.hasValue() ? this.teamResource.value() : null;
    const units = this.units();
    if (!answer || !units) {
      return EVEN_NIGHTS;
    }
    const scores = this.ownScores();
    return {
      worth: answer.worth,
      shares: (playerId) => {
        const row = scores.get(playerId);
        return row ? statShares(row.line, units) : null;
      },
    };
  });

  /** The roster weighed night by night over the rest of the season; null while anything is missing. */
  readonly valuation = computed(() => {
    const team = this.team();
    const slots = this.slots();
    const schedule = this.schedule();
    if (!team || !slots || schedule.size === 0) {
      return null;
    }
    return valueLineup(team, slots, schedule, this.scoreOfOwn(), this.nightWeights());
  });

  /** Room for a pickup with nobody dropped: open roster spots, injured players to move to IR. */
  readonly room = computed<TeamRoom>(() => {
    const team = this.team();
    const settings = this.settingsResource.hasValue() ? this.settingsResource.value() : null;
    if (!team) {
      return { openSpots: 0, toReserve: [] };
    }
    return teamRoom(team, settings?.rosterSlots ?? null, settings?.reserveSlots ?? {});
  });

  /**
   * The user's players of the kind the positions pick, the one whose going costs the lineup
   * least first; those on injured reserve, whose spot a drop would not free, after the rest.
   */
  readonly roster = computed<readonly RosterEntry[]>(() => {
    const team = this.team();
    if (!team) {
      return [];
    }
    const shown = this.shown();
    const scores = this.ownScores();
    const valuation = this.valuation();
    return team
      .filter(
        (player) =>
          shown === 'players' || player.type === (shown === 'goalies' ? 'goalie' : 'skater'),
      )
      .map((player) => {
        const row = scores.get(player.playerId);
        const value = valuation?.byPlayer.get(player.playerId) ?? null;
        return {
          player,
          score: row?.score ?? null,
          value,
          delta: row?.delta ?? null,
          weighed: valuation === null || value === null || value.games > 0 || player.out,
        };
      })
      .sort(
        (a, b) =>
          Number(a.player.reserve) - Number(b.player.reserve) ||
          Number(a.score === null) - Number(b.score === null) ||
          Number(!a.weighed) - Number(!b.weighed) ||
          (a.value?.marginal ?? a.score ?? 0) - (b.value?.marginal ?? b.score ?? 0) ||
          (a.score ?? 0) - (b.score ?? 0),
      );
  });

  /**
   * Whether he can be the drop: he holds a roster spot, the model has a line for him, and his
   * place in the lineup could be weighed. A player who is out qualifies, priced at the nights he
   * plays once back; the chips leave him out, and the fold-out offers him.
   */
  canDrop(entry: RosterEntry): boolean {
    return !entry.player.reserve && entry.score !== null && entry.weighed;
  }

  /**
   * The players a drop would usually be: those holding a spot the model can weigh and who are
   * not out, the one whose going costs the lineup least first.
   */
  readonly dropCandidates = computed<readonly RosterEntry[]>(() =>
    this.roster().filter((entry) => this.canDrop(entry) && !entry.player.out),
  );

  /** The drop the reader picked, by platform id; none until he picks, and forgotten with the league. */
  private readonly dropPicked = linkedSignal<unknown, string | null>({
    source: () => this.league(),
    computation: () => null,
  });

  /**
   * The drop every pickup is priced against: the one picked while he can still be. Nobody is
   * chosen for the reader, so with none picked the list carries no gain column.
   */
  readonly drop = computed<RosterEntry | null>(() => {
    const picked = this.dropPicked();
    const entry =
      picked === null ? undefined : this.roster().find((row) => row.player.playerId === picked);
    return entry && this.canDrop(entry) ? entry : null;
  });

  /** Picks him as the drop, or lets him go again when he is the one picked. */
  pickDrop(playerId: string): void {
    this.dropPicked.update((picked) => (picked === playerId ? null : playerId));
  }

  /** The chips on the room line: the four cheapest candidates, and the drop picked if he is another. */
  readonly dropChips = computed<readonly RosterEntry[]>(() => {
    const chips = this.dropCandidates().slice(0, DROP_CHIPS);
    const drop = this.drop();
    return drop && !chips.includes(drop) ? [...chips, drop] : chips;
  });

  /** A full roster: a pickup costs a drop, so the drop is the question the room line asks. */
  readonly fullRoster = computed(
    () =>
      this.teamStatus() === 'ready' &&
      this.room().openSpots === 0 &&
      this.room().toReserve.length === 0,
  );

  /** The chosen drop's surname, for the gain column's heading: "vs Hughes". */
  readonly dropSurname = computed(() => surname(this.drop()?.player.name ?? ''));

  /** "143.1": what his going costs the lineup, as his chip and his row say it. */
  dropCost(entry: RosterEntry): string {
    return this.formatScore(entry.value?.marginal ?? null);
  }

  /** Whether the roster is unfolded under the room line: folded until asked for, and with each league. */
  readonly rosterOpen = linkedSignal<unknown, boolean>({
    source: () => this.league(),
    computation: () => false,
  });

  /** "Show all" on the room line: the whole roster unfolded, any row of it to be picked. */
  toggleRoster(): void {
    const open = !this.rosterOpen();
    this.rosterOpen.set(open);
    if (open) {
      this.rosterAll.set(true);
    }
  }

  /** Whether the fold-out lists the whole roster, or only the players a drop would usually be. */
  readonly rosterAll = linkedSignal<unknown, boolean>({
    source: () => this.league(),
    computation: () => false,
  });

  toggleRosterAll(): void {
    this.rosterAll.update((all) => !all);
  }

  /**
   * The rows the fold-out lists off injured reserve: the whole roster, or the four cheapest
   * candidates with the drop picked among them, since the rest are not what the question is about.
   */
  readonly rosterRows = computed<readonly RosterEntry[]>(() => {
    const held = this.roster().filter((entry) => !entry.player.reserve);
    if (this.rosterAll()) {
      return held;
    }
    const few = new Set(this.dropCandidates().slice(0, DROP_CHIPS));
    const drop = this.drop();
    if (drop) {
      few.add(drop);
    }
    return held.filter((entry) => few.has(entry));
  });

  /** Whether the fold-out has more to show than the few, or fewer than the whole roster. */
  readonly rosterFoldable = computed(() => {
    const few = new Set(this.dropCandidates().slice(0, DROP_CHIPS));
    const drop = this.drop();
    if (drop) {
      few.add(drop);
    }
    return this.roster().length > few.size;
  });

  /** The players on injured reserve, listed under their own line: dropping them frees no spot. */
  readonly rosterReserve = computed<readonly RosterEntry[]>(() =>
    this.roster().filter((entry) => entry.player.reserve),
  );

  /** Whether any row the fold-out shows has a "?" for its cost, so the caption says what it means. */
  readonly rosterUnweighed = computed(() =>
    this.rosterRows().some((entry) => entry.value && entry.score !== null && !entry.weighed),
  );

  /** "48 / 71": the nights he starts in the lineup, of the nights his club plays. */
  starts(entry: RosterEntry): string {
    if (!entry.value || !entry.weighed) {
      return '';
    }
    return `${entry.value.starts} / ${entry.value.games}`;
  }

  // --- The order of the list --------------------------------------------------------------------

  /** The column the list was last sorted by; it opens ranked, best first on today's projection. */
  private readonly sortPicked = signal<ScoutSort>(SCOUT_RANKED_ORDER);

  /**
   * The order on screen: the one picked, while its column is still in the table. A category the
   * league does not score, a change with no comparison on, or ice with no skater listed, falls
   * back to the ranked order rather than sorting by blanks.
   */
  readonly sort = computed<ScoutSort>(() => {
    const sort = this.sortPicked();
    const about: ScoutSortKey[] = ['name', 'score'];
    if (this.view() === 'projection') {
      about.push('games');
      if (this.shown() !== 'goalies') {
        about.push('toi');
      }
      if (this.compare()) {
        about.push('delta', 'rise');
      }
      if (this.gains() !== null) {
        about.push('gain');
      }
      return about.includes(sort.key) || this.categories().includes(sort.key as ScoringStatKey)
        ? sort
        : SCOUT_RANKED_ORDER;
    }
    if (this.shown() !== 'goalies') {
      about.push('ice', 'powerPlay');
    }
    return about.includes(sort.key) ? sort : SCOUT_RANKED_ORDER;
  });

  /** Sorts the whole list by a column, best first; the same column again turns it round. */
  sortBy(key: ScoutSortKey): void {
    this.sortPicked.set(nextScoutSort(this.sort(), key));
  }

  /** The list in the order asked for, before it is cut into pages. */
  readonly sorted = computed(() =>
    sortScout(this.filtered(), this.sort(), this.gains() ?? undefined),
  );

  readonly emptyText = computed(() => {
    const pool = this.pool();
    const who =
      {
        available: 'No available player',
        fa: 'No free agent',
        waivers: 'No player on waivers',
        taken: 'No rostered player',
        all: 'No player',
      }[pool as Exclude<ScoutPool, `team:${string}`>] ??
      `No player on ${pool.slice('team:'.length)}`;
    const where = this.positions().size === 0 ? '' : ' at these positions';
    switch (this.compare() ? this.movers() : 'all') {
      case 'risers':
        return `${who}${where} has risen in the projection since the chosen day.`;
      case 'fallers':
        return `${who}${where} has fallen in the projection since the chosen day.`;
      default:
        return this.search().trim()
          ? `${who}${where} matches the search.`
          : `${who}${where} has a projection.`;
    }
  });

  readonly noPlayers = computed(
    () =>
      !!this.league() &&
      !this.loading() &&
      !this.failure() &&
      !this.outOfSeason() &&
      (this.list()?.players.length ?? 0) === 0,
  );

  // --- The pages of the list --------------------------------------------------------------------

  /** Another pool, other positions, another day or order is another list: back to its first page. */
  private readonly page = linkedSignal<unknown, number>({
    source: () => [
      this.pool(),
      this.showMine(),
      this.nhlTeam(),
      this.positions(),
      this.movers(),
      this.search(),
      this.league(),
      this.since(),
      this.compare(),
      this.view(),
      this.sort(),
    ],
    computation: () => 0,
  });

  readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.filtered().length / SCOUT_PAGE_SIZE)),
  );

  readonly currentPage = computed(() => Math.min(this.page(), this.pageCount() - 1));

  readonly visible = computed(() =>
    this.sorted().slice(
      this.currentPage() * SCOUT_PAGE_SIZE,
      (this.currentPage() + 1) * SCOUT_PAGE_SIZE,
    ),
  );

  readonly rangeText = computed(() => {
    const total = this.filtered().length;
    const first = this.currentPage() * SCOUT_PAGE_SIZE + 1;
    const last = first + this.visible().length - 1;
    return first === last ? `${first} of ${total}` : `${first}–${last} of ${total}`;
  });

  goToPage(page: number): void {
    this.page.set(Math.max(0, Math.min(page, this.pageCount() - 1)));
  }

  // --- The gains ---------------------------------------------------------------------------------

  /**
   * What the lineup gains by each available player in the list against the chosen drop, in the
   * projection view of a full roster: the one drop is priced once and every pickup against him,
   * over the whole list rather than the page, so the column sorts. Null where there is no column:
   * an open spot or an injured player to move costs nobody, so the room line is the whole answer;
   * no team of the user's, no drop that can be weighed, or the ice view.
   */
  readonly gains = computed<ReadonlyMap<string, number | null> | null>(() => {
    const team = this.team();
    const slots = this.slots();
    const schedule = this.schedule();
    const drop = this.drop();
    if (
      this.view() !== 'projection' ||
      !this.fullRoster() ||
      !team ||
      !slots ||
      schedule.size === 0 ||
      !drop
    ) {
      return null;
    }
    const pickups = this.filtered().filter((row) => row.scout.owner === null);
    if (pickups.length === 0) {
      return null;
    }
    const weights = this.nightWeights();
    const units = this.units();
    const pricing = priceDrop(drop.player, team, slots, schedule, this.scoreOfOwn(), weights);
    const gains = new Map<string, number | null>();
    for (const row of pickups) {
      gains.set(
        row.player.playerId,
        pricing.gainFor({
          playerId: row.player.playerId,
          positions: row.player.positions,
          teamAbbrev: row.player.teamAbbrev,
          score: row.score,
          shares: units ? statShares(row.line, units) : undefined,
        }),
      );
    }
    return gains;
  });

  /** "1 open roster spot", "2 open roster spots". */
  openSpotsText(count: number): string {
    return count === 1 ? '1 open roster spot' : `${count} open roster spots`;
  }

  formatScore(score: number | null): string {
    if (score === null) {
      return '';
    }
    return score.toFixed(this.scoringType() === 'points' ? 1 : 2);
  }

  /** "+2.4" / "-1.1" for a change in score. */
  formatDelta(delta: number | null): string {
    if (delta === null) {
      return '';
    }
    const text = delta.toFixed(this.scoringType() === 'points' ? 1 : 2);
    return delta > 0 ? `+${text}` : text;
  }
}
