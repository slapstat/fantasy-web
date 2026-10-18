import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DEFAULT_DECIMAL_SETTINGS } from '../../draft-projection/projection-settings-section/model';
import { ScoringType } from '../../models/projection.model';
import {
  LOWER_IS_BETTER_SCORING_STAT_KEYS,
  RATE_STAT_KEYS,
  ScoringStatKey,
} from '../../models/stat-key.model';
import { IconComponent } from '../../shared/icon/icon';
import { PositionChipsComponent } from '../../shared/position-chips/position-chips';
import { TeamLogoComponent } from '../../shared/team-logo/team-logo';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import {
  formatGames,
  formatToi,
  LineColumn,
  lineColumns,
  LineStat,
  lineStats,
  NO_RATE,
} from '../../streamer-planner/planner-free-agents';
import {
  SCOUT_RANKED_ORDER,
  ScoutRow,
  ScoutSort,
  ScoutSortKey,
  statOf,
  toiPerGame,
} from '../scout-ranking';
import {
  formatIce,
  formatIceChange,
  formatShare,
  formatShareChange,
  lineLabel,
  MIN_ICE_CHANGE_SECONDS,
  MIN_POWER_PLAY_SHARE_CHANGE,
  powerPlayLabel,
} from '../scout-usage';

/** Which of the two things the table shows: what the model thinks, or what the ice has shown. */
export type ScoutView = 'projection' | 'ice';

/** A change since the chosen day, as a cell writes it under the figure: "+2.4", and which way. */
export interface Delta {
  readonly text: string;
  readonly dir: 'up' | 'down' | 'flat';
}

/** A player's line in the league's categories, each with its change, ready to draw. */
interface ScoutEntry {
  readonly row: ScoutRow;
  readonly cells: readonly { readonly stat: LineStat | null; readonly delta: Delta | null }[];
}

/** A minute a game more ice than the chosen day's line gave him: a role, not a rounding. */
const MORE_ICE_SECONDS = 60;

/** The gains that wear the wash: the medal on the best pickups, as the planner's list gives three. */
export const TOP_GAINS = 3;

/**
 * Every player on the page in one list, skaters and goalies, in one of two views. The
 * projection view is the planner's free-agent table: the score, games, ice time and each
 * category the league scores, and, with a comparison switched on, each figure wearing its change
 * since the chosen day underneath, the place gained or lost under the rank; with a full roster, what
 * the lineup gains by each pickup against the drop the page has chosen, one figure a row. The ice view keeps
 * the rank, the player and the score to sort by, and shows what the ice has measured instead:
 * ice a game, power-play ice and share of the club's power play over the recent games against
 * before them, and where Daily Faceoff lists him now and listed him then. The order is the
 * page's to say: a heading asks for it, and the page sorts the whole list before cutting it into
 * pages.
 */
@Component({
  selector: 'app-scout-table',
  imports: [IconComponent, PositionChipsComponent, TeamLogoComponent, TooltipDirective],
  templateUrl: './scout-table.html',
  styleUrls: [
    '../../streamer-planner/free-agents-table/free-agents-table.css',
    './scout-table.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScoutTableComponent {
  readonly rows = input.required<readonly ScoutRow[]>();
  readonly scoringType = input.required<ScoringType>();
  /** The categories the league scores, in the league's order. */
  readonly categories = input.required<readonly ScoringStatKey[]>();
  readonly view = input<ScoutView>('projection');
  /** Whether the projection view writes each figure's change since the chosen day. */
  readonly compare = input<boolean>(false);

  /** The comparison belongs to the projection view: the ice view has its own before-and-after. */
  readonly comparing = computed(() => this.compare() && this.view() === 'projection');

  /** The gain column belongs to the projection view too. */
  readonly gaining = computed(() => this.view() === 'projection' && this.gains() !== null);

  /**
   * The three pickups the lineup gains the most by, among every one the page priced: the wash
   * goes with the figure, not the row, so a page of the list whose best gain is fourth shows none.
   * A gain of nothing or less decides nothing, and wears none.
   */
  readonly topGains = computed<ReadonlySet<string>>(() => {
    const gains = this.gains();
    if (!gains) {
      return new Set();
    }
    return new Set(
      [...gains]
        .filter((entry): entry is [string, number] => entry[1] !== null && entry[1] > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_GAINS)
        .map(([playerId]) => playerId),
    );
  });
  /** What the then-lines are, for the group heading: "vs 7 Oct", "vs preseason". */
  readonly sinceLabel = input<string>('vs preseason');
  /** What the ice is measured over, for its group heading: "last 5 games", "since 7 Oct". */
  readonly iceLabel = input<string>('last 5 games');
  /** Whether each row says who holds the player: only a list of more than the wire needs it. */
  readonly showOwner = input<boolean>(false);
  /**
   * What the lineup gains by each available player against the chosen drop, by platform id (null
   * for one the page could not price), or null for no gain column: nobody to drop, or no team
   * of the user's.
   */
  readonly gains = input<ReadonlyMap<string, number | null> | null>(null);
  /** The chosen drop's surname, for the gain columns' heading. */
  readonly dropName = input<string>('');
  /**
   * The chosen drop's own projection for the rest of the season, scored as the rows are, so each
   * pickup's can be set against it; null when he has none.
   */
  readonly dropScore = input<number | null>(null);
  /**
   * Whether the user holds streaming spots, so the lineup's gain counts an open lineup spot at
   * what a streamer would score in it that night rather than at nothing.
   */
  readonly streaming = input<boolean>(false);
  /** The order the list is in, which the headings show. */
  readonly sort = input<ScoutSort>(SCOUT_RANKED_ORDER);
  /** A heading pressed: the page sorts the whole list by that column, or turns it round. */
  readonly sortBy = output<ScoutSortKey>();

  private readonly lines = computed(() => {
    const categories = this.categories();
    return this.rows().map((row) => ({ row, stats: lineStats(row, categories) }));
  });

  /** Whether any skater is listed: only a skater has ice time and a role on the ice to show. */
  readonly anySkater = computed(() => this.rows().some((row) => row.line.type === 'skater'));

  readonly columns = computed<readonly LineColumn[]>(() =>
    lineColumns(
      this.lines().map((entry) => entry.stats),
      this.categories(),
    ),
  );

  readonly entries = computed<readonly ScoutEntry[]>(() => {
    const columns = this.columns();
    const compare = this.comparing();
    return this.lines().map(({ row, stats }) => {
      const byKey = new Map(stats.map((stat) => [stat.key, stat]));
      return {
        row,
        cells: columns.map((column) => {
          const stat = byKey.get(column.key) ?? null;
          return { stat, delta: stat && compare ? this.deltaStat(row, column.key) : null };
        }),
      };
    });
  });

  /** How many columns the projection group spans: score, games, ice time and the categories. */
  readonly projectionSpan = computed(() => 2 + (this.anySkater() ? 1 : 0) + this.columns().length);

  readonly rankTip = computed(() =>
    this.comparing()
      ? 'League rank, and places moved since the chosen day'
      : 'Rank among every player in the league',
  );

  readonly scoreHeading = computed(() => (this.scoringType() === 'points' ? 'Points' : 'Z-Score'));

  readonly scoreTip = computed(() =>
    this.scoringType() === 'points'
      ? 'Projected points for the rest of the season.'
      : 'Projected Z-Score for the rest of the season. Zero is the last player a league this size would roster.',
  );

  ariaSort(key: ScoutSortKey): 'ascending' | 'descending' | null {
    const sort = this.sort();
    if (sort.key !== key) {
      return null;
    }
    return sort.descending ? 'descending' : 'ascending';
  }

  private scoreDigits(): number {
    return this.scoringType() === 'points' ? 1 : 2;
  }

  score(row: ScoutRow): string {
    return row.score.toFixed(this.scoreDigits());
  }

  /** The change in score since the day; null without a then-line or a comparison. */
  deltaScore(row: ScoutRow): Delta | null {
    return !this.comparing() || row.delta === null ? null : signed(row.delta, this.scoreDigits());
  }

  games(row: ScoutRow): string {
    return formatGames(row.games);
  }

  deltaGames(row: ScoutRow): Delta | null {
    if (!this.comparing() || !row.then) {
      return null;
    }
    return signed(row.games - Math.round(row.then.stats.utility.gp), 0);
  }

  /** "+19" for places gained, "-4" for places lost, under the rank; null without a then-line. */
  rise(row: ScoutRow): Delta | null {
    if (!this.comparing() || row.rise === null) {
      return null;
    }
    return signed(row.rise, 0);
  }

  riseTip(row: ScoutRow): string {
    if (!this.comparing()) {
      return '';
    }
    if (row.thenRank === null) {
      return 'No projection on the chosen day';
    }
    return `Ranked ${row.thenRank} of these players on the chosen day, ${row.rank} today`;
  }

  toiNow(row: ScoutRow): string {
    return formatToi(toiPerGame(row.line));
  }

  deltaToi(row: ScoutRow): Delta | null {
    const now = toiPerGame(row.line);
    const then = toiPerGame(row.then);
    if (!this.comparing() || now === undefined || then === undefined) {
      return null;
    }
    const change = now - then;
    return { text: formatIceChange(change), dir: direction(change, MORE_ICE_SECONDS) };
  }

  /** The change in a category since the day, in the category's own precision and sense. */
  deltaStat(row: ScoutRow, key: ScoringStatKey): Delta | null {
    if (!row.then || !row.scout.thenProjected.has(key)) {
      return null;
    }
    const now = statOf(row.line, key);
    const then = statOf(row.then, key);
    if (now === null || then === null) {
      return null;
    }
    const change = now - then;
    if (key === 'toi') {
      return { text: formatIceChange(change), dir: direction(change, MORE_ICE_SECONDS) };
    }
    const delta = signed(change, statDigits(key, now));
    // Fewer goals against is the better way; the colour follows the sense of the stat.
    return LOWER_IS_BETTER_SCORING_STAT_KEYS.has(key) ? flipped(delta) : delta;
  }

  // --- The ice --------------------------------------------------------------------------------

  /** Games in the recent window, for the ice view's games column. */
  iceGames(row: ScoutRow): string {
    return row.usage ? String(row.usage.recent.games) : '';
  }

  iceNow(row: ScoutRow): string {
    return row.usage ? formatIce(row.usage.recent.toiPerGame) : '';
  }

  deltaIce(row: ScoutRow): Delta | null {
    const change = row.usage?.iceChange ?? null;
    if (change === null) {
      return null;
    }
    return { text: formatIceChange(change), dir: direction(change, MIN_ICE_CHANGE_SECONDS) };
  }

  ppIceNow(row: ScoutRow): string {
    const seconds = row.usage?.recent.ppToiPerGame;
    return seconds == null ? '' : formatIce(seconds);
  }

  deltaPpIce(row: ScoutRow): Delta | null {
    const change = row.usage?.powerPlayIceChange ?? null;
    if (change === null) {
      return null;
    }
    return { text: formatIceChange(change), dir: direction(change, MIN_ICE_CHANGE_SECONDS / 2) };
  }

  shareNow(row: ScoutRow): string {
    const share = row.usage?.recent.ppShare;
    return share == null ? '' : formatShare(share);
  }

  deltaShare(row: ScoutRow): Delta | null {
    const change = row.usage?.powerPlayShareChange ?? null;
    if (change === null) {
      return null;
    }
    return {
      text: formatShareChange(change),
      dir: direction(change, MIN_POWER_PLAY_SHARE_CHANGE),
    };
  }

  /** What the ice figures stand on: the games in each window, for every ice cell's tip. */
  iceTip(row: ScoutRow): string {
    const usage = row.usage;
    if (!usage) {
      return row.line.type === 'goalie' ? 'A goalie has no ice role to measure' : 'No recent games';
    }
    const games = `${usage.recent.games} recent ${usage.recent.games === 1 ? 'game' : 'games'}`;
    if (!usage.baseline) {
      return `${games}; nothing earlier to compare with`;
    }
    const before =
      usage.baselineSource === 'LAST_SEASON'
        ? `his ${usage.baseline.games} games last season`
        : `his ${usage.baseline.games} earlier games this season`;
    return `${games} against ${before}`;
  }

  /** "L2 · PP1", or "Out", or nothing: where the lineup page lists him now. */
  listedNow(row: ScoutRow): string {
    const now = row.usage?.listedNow;
    if (!now) {
      return '';
    }
    const line = lineLabel(now) ?? (now.outOfLineup ? 'Out' : '');
    const unit = now.powerPlayUnit ? `PP${now.powerPlayUnit}` : '';
    return [line, unit].filter(Boolean).join(' · ');
  }

  /** "was L4 · No PP" when the page listed him elsewhere before the recent games. */
  listedThen(row: ScoutRow): string {
    const usage = row.usage;
    if (!usage || (!usage.lineMove && !usage.powerPlayMove)) {
      return '';
    }
    const before = usage.listedBefore;
    const line = lineLabel(before) ?? (before?.outOfLineup ? 'Out' : '');
    const unit = before ? powerPlayLabel(before) : '';
    return `was ${[line, unit].filter(Boolean).join(' · ')}`;
  }

  listedDir(row: ScoutRow): 'up' | 'down' | 'flat' {
    const higher = row.usage?.listedHigher ?? null;
    if (higher === null) {
      return 'flat';
    }
    return higher ? 'up' : 'down';
  }

  listedTip(row: ScoutRow): string {
    const usage = row.usage;
    if (!usage?.listedNow) {
      return "Not on Daily Faceoff's lineup page";
    }
    const moved = [usage.lineMove, usage.powerPlayMove]
      .filter((move): move is NonNullable<typeof move> => move !== null)
      .map((move) => `${move.from} to ${move.to}`);
    return moved.length > 0
      ? `Moved ${moved.join(' and ')} on Daily Faceoff`
      : 'Unchanged on Daily Faceoff';
  }

  // --- The gain ---------------------------------------------------------------------------------

  /** Whether the row is a player the user could pick up: one the league has available. */
  pickable(row: ScoutRow): boolean {
    return row.scout.owner === null;
  }

  /**
   * "+12.4" for an upgrade, "-3.1" for none, "0.0" for neither, each with the way it points so the
   * figure wears green or red like the changes beside it; null where the page could not price him.
   */
  gain(row: ScoutRow): Delta | null {
    return this.gainFigure(this.gains()?.get(row.player.playerId) ?? null);
  }

  /**
   * His projection less the drop's, the same "+138.7" a gain is written as: what he would score
   * that the drop would not, before the lineup decides how much of it gets to play. Null without
   * a projection for the drop.
   */
  scoreGain(row: ScoutRow): Delta | null {
    const drop = this.dropScore();
    return this.gainFigure(drop === null ? null : row.score - drop);
  }

  private gainFigure(gain: number | null): Delta | null {
    if (gain === null) {
      return null;
    }
    const text = gain.toFixed(this.scoreDigits());
    if (Number(text) === 0) {
      return { text: (0).toFixed(this.scoreDigits()), dir: 'flat' };
    }
    return { text: gain > 0 ? `+${text}` : text, dir: gain > 0 ? 'up' : 'down' };
  }

  /** What the lineup column stands for, in its heading's tooltip. */
  gainTip(): string {
    const tip = `What your lineup gains over the rest of the season by picking him up and dropping ${this.dropName()}: only the nights he would start count`;
    return this.streaming() ? `${tip}, an open lineup spot at what a streamer would score` : tip;
  }

  /** What the projection column stands for, in its heading's tooltip. */
  scoreGainTip(): string {
    const drop = this.dropScore();
    const what = this.scoringType() === 'points' ? 'projected points' : 'projected Z-Score';
    const his = drop === null ? '' : ` (${drop.toFixed(this.scoreDigits())})`;
    return `His ${what} for the rest of the season less ${this.dropName()}'s${his}, every game counted, whether or not your lineup has room for him`;
  }

  isTopGain(row: ScoutRow): boolean {
    return this.topGains().has(row.player.playerId);
  }

  // --- The player cell ---------------------------------------------------------------------------

  onWaivers(row: ScoutRow): boolean {
    return row.player.availability === 'WAIVERS';
  }

  /**
   * The pill a pickable row wears: "Waivers" always, since a claim changes what the reader does
   * next; "FA" only on a list that also holds taken players, where it is the mark to scan for.
   * A taken player wears none.
   */
  availabilityTag(row: ScoutRow): string | null {
    if (!this.pickable(row)) {
      return null;
    }
    if (this.onWaivers(row)) {
      return 'Waivers';
    }
    return this.showOwner() ? 'FA' : null;
  }

  /**
   * Who holds him, for a list of more than the wire: the team's name, the user's own included.
   * It read "Mine" there once, and "Mine" beside a column of team names looked like one more
   * team; the template marks the user's own by look instead.
   */
  ownerTag(row: ScoutRow): string {
    return row.scout.owner?.teamName ?? 'FA';
  }

  /** Whether the list has anyone to pick up: only then is another team's player the one to recede. */
  private readonly anyPickable = computed(() => this.rows().some((row) => this.pickable(row)));

  /**
   * Whether the row steps back in tone: another team's player on a list that also has players to
   * pick up. He stays as context, but the rows the reader can act on are the ones that keep full
   * ink. A list of taken players only, or of the user's own, dims nothing.
   */
  dimmed(row: ScoutRow): boolean {
    const owner = row.scout.owner;
    return owner !== null && !owner.mine && this.anyPickable();
  }

  isNil(stat: LineStat): boolean {
    return stat.value === NO_RATE || Number(stat.value) === 0;
  }
}

/** A change written with its sign to so many decimals, flat when it rounds to nothing. */
function signed(change: number, digits: number): Delta {
  const text = change.toFixed(digits);
  if (Number(text) === 0) {
    return { text: `±${(0).toFixed(digits)}`, dir: 'flat' };
  }
  return { text: change > 0 ? `+${text}` : text, dir: change > 0 ? 'up' : 'down' };
}

/** Which way a change points once it is past the smallest worth colouring. */
function direction(change: number, least: number): Delta['dir'] {
  if (Math.abs(change) < least) {
    return 'flat';
  }
  return change > 0 ? 'up' : 'down';
}

function flipped(delta: Delta): Delta {
  const dir = { up: 'down', down: 'up', flat: 'flat' } as const;
  return { text: delta.text, dir: dir[delta.dir] };
}

/** The decimals a category's change is written to: a rate's own, else one, none past a hundred. */
function statDigits(key: ScoringStatKey, now: number): number {
  const rates: readonly string[] = RATE_STAT_KEYS;
  if (rates.includes(key)) {
    return DEFAULT_DECIMAL_SETTINGS[key];
  }
  return Math.abs(now) >= 100 ? 0 : 1;
}
