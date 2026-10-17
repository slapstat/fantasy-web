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
  lineColumns,
  LineColumn,
  LineStat,
  lineStats,
  NO_RATE,
} from '../planner-free-agents';
import { NOT_HIS } from '../free-agents-table/free-agents-table';
import { LOWEST_FIRST, RosterNight, RosterRow, RosterSort, RosterSortKey } from '../planner-roster';
import { dayName, formatDay, PlannerDay, weekdayName } from '../planner-schedule';

const SKATER_KEYS: ReadonlySet<string> = new Set(SKATER_SCORING_STAT_KEYS);
const GOALIE_KEYS: ReadonlySet<string> = new Set(GOALIE_SCORING_STAT_KEYS);

/** One of the user's players with his line in the league's categories, ready to draw. */
export interface RosterEntry {
  readonly row: RosterRow;
  /** His line under the table's columns, a cell a column, null where the model gave him no number. */
  readonly cells: readonly (LineStat | null)[];
  /** Per column, whether the category is the other kind's. */
  readonly notHis: readonly boolean[];
}

/**
 * The user's own players over the nights counted, the one who gives the least first, drawn as
 * the free agents are: the same score, the same categories, so a player here reads against a
 * pickup there. What sets the table apart is the two counts beside the score: the games he is
 * expected to play on the nights, and the ones he would start in the user's lineup with the
 * best lineup set each night. A player with games but no starts sits behind better players at
 * his positions, and gives nothing however good his week looks on the schedule. Each night is
 * marked, so the reader sees which ones he sits.
 */
@Component({
  selector: 'app-roster-table',
  imports: [IconComponent, PositionChipsComponent, TeamLogoComponent, TooltipDirective],
  templateUrl: './roster-table.html',
  styleUrl: './roster-table.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RosterTableComponent {
  readonly rows = input.required<readonly RosterRow[]>();
  /** The counted game days, in order: a column of marks each. */
  readonly nights = input.required<readonly PlannerDay[]>();
  readonly scoringType = input.required<ScoringType>();
  /** The categories the league scores, in the league's order. */
  readonly categories = input.required<readonly ScoringStatKey[]>();
  /** The order the list is in, which the headings show. */
  readonly sort = input<RosterSort>(LOWEST_FIRST);
  /** A heading pressed: the page sorts by that column, or turns it round. */
  readonly sortBy = output<RosterSortKey>();

  readonly notHis = NOT_HIS;

  /** Ice time a game is a skater's number: no column of blanks over goalies alone. */
  readonly hasSkaters = computed(() => this.rows().some((row) => row.line.type === 'skater'));

  readonly columns = computed<readonly LineColumn[]>(() => {
    const categories = this.categories();
    return lineColumns(
      this.rows().map((row) => lineStats(row, categories)),
      categories,
    );
  });

  /** As on the free agents: a rule before the first category, and before the goalies'. */
  readonly groupStarts = computed<readonly boolean[]>(() => {
    const goalieOnly = this.columns().map((column) => !SKATER_KEYS.has(column.key));
    return goalieOnly.map((goalie, index) => index === 0 || (goalie && !goalieOnly[index - 1]));
  });

  readonly entries = computed<readonly RosterEntry[]>(() => {
    const columns = this.columns();
    const categories = this.categories();
    return this.rows().map((row) => {
      const byKey = new Map(lineStats(row, categories).map((stat) => [stat.key, stat]));
      const own = row.line.type === 'skater' ? SKATER_KEYS : GOALIE_KEYS;
      return {
        row,
        cells: columns.map((column) => byKey.get(column.key) ?? null),
        notHis: columns.map((column) => !own.has(column.key)),
      };
    });
  });

  readonly scoreHeading = computed(() => (this.scoringType() === 'points' ? 'Points' : 'Z-Score'));

  readonly scoreTip = computed(() =>
    this.scoringType() === 'points'
      ? 'Points over his starts, and per start under it'
      : 'Z-Score over his starts, and per start under it',
  );

  ariaSort(key: RosterSortKey): 'ascending' | 'descending' | null {
    const sort = this.sort();
    if (sort.key !== key) {
      return null;
    }
    return sort.descending ? 'descending' : 'ascending';
  }

  /**
   * A player who is out (on injured reserve, hurt or suspended) has no week to score: a dash in
   * every figure, not the nought of an empty line, which would read as a player who starts but
   * adds nothing. The nights keep their no-game dots, which already say he plays none of them.
   */
  score(row: RosterRow): string {
    if (row.player.out) {
      return NOT_HIS;
    }
    return row.score.toFixed(this.scoreDecimals());
  }

  private scoreDecimals(): number {
    return this.scoringType() === 'points' ? 1 : 2;
  }

  /** "0.93/G", the score a start; empty for a player who starts none, or is out. */
  perGame(row: RosterRow): string {
    if (row.player.out || row.games <= 0) {
      return '';
    }
    return `${(row.score / row.games).toFixed(this.scoreDecimals())}/G`;
  }

  starts(row: RosterRow): string {
    return formatGames(row.games);
  }

  games(row: RosterRow): string {
    if (row.player.out) {
      return NOT_HIS;
    }
    return formatGames(row.clubGames);
  }

  /** Games on the nights but no start among them: the whole week on the bench. Not a player who
   * is out: he sits nowhere, he is missing. */
  benchedAll(row: RosterRow): boolean {
    return !row.player.out && row.games === 0 && row.clubGames > 0;
  }

  /** Some of his games started, the rest on the bench. */
  benchedSome(row: RosterRow): boolean {
    return row.games > 0 && row.games < row.clubGames;
  }

  /** "Tue Oct 13": the night in full, for the heading's tip. */
  nightHeading(day: PlannerDay): string {
    return `${weekdayName(day.date)} ${formatDay(day.date)}`;
  }

  dayName(day: PlannerDay): string {
    return dayName(day);
  }

  /** The day of the month alone: the heading is a column of marks wide. */
  dayOfMonth(day: PlannerDay): string {
    return formatDay(day.date).split(' ')[1];
  }

  /** What a night's mark says: "Tue Oct 13: starts", ": on the bench", ": no game". */
  nightTip(night: RosterNight): string {
    const day = `${weekdayName(night.date)} ${formatDay(night.date)}`;
    switch (night.status) {
      case 'start':
        return `${day}: starts`;
      case 'bench':
        return `${day}: on the bench`;
      default:
        return `${day}: no game`;
    }
  }

  /** Ice time a game, for a skater; a goalie's is the whole game or none of it. */
  toi(row: RosterRow): string {
    if (row.player.out || row.player.projection.type !== 'skater') {
      return NOT_HIS;
    }
    return formatToi(row.player.projection.stats.utility.toiPerGame);
  }

  /** No rate to show (a benched player's), so a dash rather than a figure. A 0.0 is a figure. */
  isNil(stat: LineStat): boolean {
    return stat.value === NO_RATE;
  }
}
