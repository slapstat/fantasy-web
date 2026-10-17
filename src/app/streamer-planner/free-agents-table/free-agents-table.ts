import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ScoringType } from '../../models/projection.model';
import {
  GOALIE_SCORING_STAT_KEYS,
  ScoringStatKey,
  SKATER_SCORING_STAT_KEYS,
} from '../../models/stat-key.model';
import { IconComponent } from '../../shared/icon/icon';
import { PositionChipsComponent } from '../../shared/position-chips/position-chips';
import { TeamLogoComponent } from '../../shared/team-logo/team-logo';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import {
  formatGames,
  formatToi,
  FreeAgentSort,
  FreeAgentSortKey,
  lineColumns,
  lineStats,
  liftStats,
  LineColumn,
  LineStat,
  NO_RATE,
  RANKED_ORDER,
  RankedFreeAgent,
} from '../planner-free-agents';

const SKATER_KEYS: ReadonlySet<string> = new Set(SKATER_SCORING_STAT_KEYS);

/** The medals for the first places, best first. */
const MEDALS = ['gold', 'silver', 'bronze'] as const;
export type Medal = (typeof MEDALS)[number];
const GOALIE_KEYS: ReadonlySet<string> = new Set(GOALIE_SCORING_STAT_KEYS);

/**
 * What a cell under the other kind's category holds: a goalie's goals do not exist, so the cell
 * says so as the editor and the other tables do, rather than sit blank like a number the model
 * left out.
 */
export const NOT_HIS = '—';

/** A player with his line in the league's categories, ready to draw. */
export interface FreeAgentRow {
  readonly row: RankedFreeAgent;
  /** His line under the table's columns, a cell a column, null where the model gave him no number. */
  readonly cells: readonly (LineStat | null)[];
  /** Per column, whether the category is the other kind's: a skater's under a goalie's, and back. */
  readonly notHis: readonly boolean[];
  /**
   * Per column, what the games a drop would add put on the number, "+0.4"; null where they add
   * nothing to it, or nothing at all.
   */
  readonly lifts: readonly (string | null)[];
}

/**
 * The best available players, skaters and goalies together, best first, with the model's line for
 * the nights counted in every category the league scores, and scored by the league's own settings.
 * The skaters' categories come first and the goalies' after, set off by a rule: a column means one
 * category on every row, a faint dash on a player of the kind that does not score in it. The best few
 * of everyone available can be set off as the best picks, in the table's own columns rather than as
 * cards over it.
 * Which positions, how many rows and how many of them are set off is the page's to say, and so is
 * the order: a heading asks for it, and the page sorts the whole list before cutting it into pages.
 */
@Component({
  selector: 'app-free-agents-table',
  imports: [IconComponent, PositionChipsComponent, TeamLogoComponent, TooltipDirective],
  templateUrl: './free-agents-table.html',
  styleUrl: './free-agents-table.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FreeAgentsTableComponent {
  readonly rows = input.required<readonly RankedFreeAgent[]>();
  /**
   * The whole list the rows are a page of, which the columns are drawn for: sorted by assists or
   * paged on, the goalies' columns stay while no goalie is on the page. The rows alone if not given.
   */
  readonly listed = input<readonly RankedFreeAgent[]>();
  readonly scoringType = input.required<ScoringType>();
  /** The categories the league scores, in the league's order. */
  readonly categories = input.required<readonly ScoringStatKey[]>();
  /** The categories the list is ranked by, if narrowed to some: those columns are the ones read. */
  readonly focus = input<ReadonlySet<ScoringStatKey>>(new Set());
  /**
   * How many places are set off as the best picks; none unless the page says. A place is the rank
   * the row shows, among every available player, so a list narrowed to some positions sets off only
   * the ones the whole list would: its own head may be fourth and sixth, and wear nothing.
   */
  readonly top = input(0);
  /** The order the list is in, which the headings show. */
  readonly sort = input<FreeAgentSort>(RANKED_ORDER);
  /** A heading pressed: the page sorts by that column, or turns it round. */
  readonly sortBy = output<FreeAgentSortKey>();
  /**
   * Whether the games only a drop opens are in the games and the score already: his figures are
   * then drawn in the game days' yellow, since each holds games he plays only with a drop, and
   * nothing is left to add beside them.
   */
  readonly dropsCounted = input(false);

  private readonly lines = computed(() => {
    const categories = this.categories();
    return this.rows().map((row) => ({
      row,
      stats: lineStats(row, categories),
      lifts: liftStats(row, categories),
    }));
  });

  private readonly list = computed(() => this.listed() ?? this.rows());

  /**
   * Whether any row wears a mark beside a figure, games or a lift, or would once the games were
   * marked rather than counted: the number columns then keep room for the marks to hang in, all of
   * them at once, rather than widen one row's column. Counted, the room stays, so the tick box
   * that counts them never narrows the table under the reader's pointer.
   */
  readonly marked = computed(() =>
    this.rows().some((row) => Math.round(row.dropGames ?? 0) > 0 || row.lifted !== undefined),
  );

  /** Percent rostered comes only with the admins' demo list; a league's list has no such column. */
  readonly hasRostered = computed(() =>
    this.list().some((row) => row.player.percentRostered !== undefined),
  );

  rostered(row: RankedFreeAgent): string {
    const percent = row.player.percentRostered;
    return percent === undefined ? NOT_HIS : `${percent}%`;
  }

  /** Ice time a game is a skater's number: no column of blanks over a list of goalies alone. */
  readonly hasSkaters = computed(() => this.list().some((row) => row.line.type === 'skater'));

  /** A column a category, named once in the heading instead of beside every number. */
  readonly columns = computed<readonly LineColumn[]>(() => {
    const categories = this.categories();
    return lineColumns(
      this.list().map((row) => lineStats(row, categories)),
      categories,
    );
  });

  /**
   * The columns a rule is drawn before: the first category, setting the line off from the columns
   * about the player, and the first goalie category after a skater one, setting the two kinds apart.
   */
  readonly groupStarts = computed<readonly boolean[]>(() => {
    const goalieOnly = this.columns().map((column) => !SKATER_KEYS.has(column.key));
    return goalieOnly.map((goalie, index) => index === 0 || (goalie && !goalieOnly[index - 1]));
  });

  readonly entries = computed<readonly FreeAgentRow[]>(() => {
    const columns = this.columns();
    return this.lines().map(({ row, stats, lifts }) => {
      const byKey = new Map(stats.map((stat) => [stat.key, stat]));
      const liftByKey = new Map(lifts.map((stat) => [stat.key, stat.value]));
      const own = row.line.type === 'skater' ? SKATER_KEYS : GOALIE_KEYS;
      return {
        row,
        cells: columns.map((column) => byKey.get(column.key) ?? null),
        notHis: columns.map((column) => !own.has(column.key)),
        lifts: columns.map((column) => liftByKey.get(column.key) ?? null),
      };
    });
  });

  readonly notHis = NOT_HIS;

  readonly scoreHeading = computed(() => (this.scoringType() === 'points' ? 'Points' : 'Z-Score'));

  readonly scoreTip = computed(() =>
    this.scoringType() === 'points'
      ? 'Projected points, and per game under it'
      : 'Z-Score across your categories, and per game under it',
  );

  ariaSort(key: FreeAgentSortKey): 'ascending' | 'descending' | null {
    const sort = this.sort();
    if (sort.key !== key) {
      return null;
    }
    return sort.descending ? 'descending' : 'ascending';
  }

  /** Picked, while the list is ranked by some categories; null while it is ranked by all. */
  focused(key: ScoringStatKey): boolean | null {
    const focus = this.focus();
    return focus.size === 0 ? null : focus.has(key);
  }

  /** The medal his place wins, if it is one of the places set off. */
  medalOf(row: RankedFreeAgent): Medal | null {
    return row.rank <= this.top() ? (MEDALS[row.rank - 1] ?? null) : null;
  }

  score(row: RankedFreeAgent): string {
    return row.score.toFixed(this.scoreDecimals());
  }

  /**
   * "+3.8": what the games a drop would add put on his score, raised beside it as on each number;
   * null where they add nothing to it, or the score has them already.
   */
  scoreLift(row: RankedFreeAgent): string | null {
    if (!row.lifted) {
      return null;
    }
    const decimals = this.scoreDecimals();
    const more = row.lifted.score - row.score;
    if (Math.abs(more) < 0.5 / 10 ** decimals) {
      return null;
    }
    return `${more > 0 ? '+' : ''}${more.toFixed(decimals)}`;
  }

  private scoreDecimals(): number {
    return this.scoringType() === 'points' ? 1 : 2;
  }

  /** "3.0/G", the score a game he plays, the way a streamer compares a three-game week to a four. */
  perGame(row: RankedFreeAgent): string {
    if (row.games <= 0) {
      return '';
    }
    return `${(row.score / row.games).toFixed(this.scoreDecimals())}/G`;
  }

  games(row: RankedFreeAgent): string {
    return formatGames(row.games);
  }

  /** "+2", the games only a drop opens, beside his own in yellow as on the game days; null for none. */
  dropGames(row: RankedFreeAgent): string | null {
    const more = Math.round(row.dropGames ?? 0);
    return more > 0 ? `+${more}` : null;
  }

  /**
   * Whether his figures hold games only a drop opens: counted by the page, and at least one of
   * them his. The score, the games and each count are then yellow, as the game days are.
   */
  inDrop(row: RankedFreeAgent): boolean {
    return this.dropsCounted() && Math.round(row.dropGames ?? 0) > 0;
  }

  /** What a "+N" mark is: games beside his own, there only if a player at a position is dropped. */
  dropGamesTip(row: RankedFreeAgent): string {
    const more = Math.round(row.dropGames ?? 0);
    return `${more} additional ${gamesWord(more)} from a position drop.`;
  }

  /** Ice time a game, for a skater; a goalie's is the whole game or none of it. */
  toi(row: RankedFreeAgent): string {
    if (row.player.projection.type !== 'skater') {
      return NOT_HIS;
    }
    return formatToi(row.player.projection.stats.utility.toiPerGame);
  }

  /** A claim rather than an add: the one status a streamer has to know before acting. */
  onWaivers(row: RankedFreeAgent): boolean {
    return row.player.availability === 'WAIVERS';
  }

  /** No rate to show (a benched player's), so a dash rather than a figure. A 0.0 is a figure. */
  isNil(stat: LineStat): boolean {
    return stat.value === NO_RATE;
  }
}

/** "game" for one, "games" for any other count. */
function gamesWord(count: number): string {
  return count === 1 ? 'game' : 'games';
}
