import { PlannerCrease } from '../api/models/planner-crease';
import { ScheduledGame } from '../api/models/scheduled-game';
import { TeamSchedule } from '../api/models/team-schedule';
import { DEFAULT_DECIMAL_SETTINGS } from '../draft-projection/projection-settings-section/model';
import { nhlTeamKey } from '../models/nhl-team';
import { Projection } from '../models/projection.model';
import { compareStatValues, defaultSortDirection } from '../models/sorting';
import {
  GOALIE_SCORING_STAT_KEYS,
  RATE_STAT_KEYS,
  SCORING_STAT_KEYS,
  ScoringStatKey,
  SKATER_SCORING_STAT_KEYS,
} from '../models/stat-key.model';
import { STAT_LABELS } from '../pipes/stat-label.pipe';
import { STAT_FULL_NAMES } from '../pipes/stat-tooltip.pipe';
import { FreeAgent } from '../services/streamer-planner-free-agents.service';
import { DropRoom, fitsDrop, fitsRoom, NightRoom } from './planner-lineup';

/** The skater position groups, in the order a lineup lists them. */
export const PLANNER_POSITIONS = ['C', 'LW', 'RW', 'D'] as const;
export type PlannerPositionGroup = (typeof PLANNER_POSITIONS)[number];

/** The positions the free agents can be narrowed to: the skaters', and the goalies' one. */
export const FREE_AGENT_POSITIONS = [...PLANNER_POSITIONS, 'G'] as const;
export type FreeAgentPosition = (typeof FREE_AGENT_POSITIONS)[number];

/** How many places among everyone available are set off as the best picks. */
export const TOP_OPTIONS = 3;

/**
 * The decimals the ranking engine keeps on a stat before scoring it. The engine rounds to what a
 * season table shows, a whole number by default, which is coarse for a week: 0.4 goals scored as
 * none, 1.4 wins as one. Two decimals leave the line as the model projected it.
 */
export const WEEK_DECIMALS: Readonly<Record<string, number>> = Object.fromEntries(
  SCORING_STAT_KEYS.map((key) => [key, 2]),
);

/**
 * A player with a line over some games and its score: what the list's columns are drawn from,
 * whether he is a free agent or one of the user's own.
 */
export interface LineRow {
  readonly player: {
    readonly name: string;
    /** His line over the whole stretch, which the ice time a game is read from. */
    readonly projection: Projection;
    /** The stats the model gave a number for; a zero in any other is the engine's, not his. */
    readonly projected: ReadonlySet<string>;
    /** Share of all Yahoo leagues that roster him: the demo list's own column. */
    readonly percentRostered?: number;
  };
  /** His projection over the games counted: the one the score was reached from. */
  readonly line: Projection;
  /** Fantasy points or a z-score, whichever the league scores by, over the games counted. */
  readonly score: number;
  /** His place in the list as it came, which players level on a column keep. */
  readonly rank: number;
  /** Games he is expected to play among those counted; for a goalie, the starts he is given. */
  readonly games: number;
}

export interface RankedFreeAgent extends LineRow {
  readonly player: FreeAgent;
  /**
   * Games more he would play on the nights counted where the user's lineup has room for him only
   * once one of the user's players is dropped. Each would replace the dropped player's game, so
   * they are neither in {@link games} nor scored. Absent while the list is not ranked by room.
   */
  readonly dropGames?: number;
  /**
   * His line and score with the {@link dropGames} played too: what he would give, not what the
   * swap nets, since the dropped player's games go with him. Absent where a drop adds nothing.
   */
  readonly lifted?: LiftedLine;
}

/** A player's line over his own games and the ones a drop would add, and its score. */
export interface LiftedLine {
  readonly line: Projection;
  readonly score: number;
}

/**
 * The ranked players eligible at any of the positions picked, in the order they were ranked. No
 * position picked is every player: the filter narrows the one list, it never empties it. A player
 * eligible at two positions is listed once, under either.
 */
export function filterByPositions(
  ranked: readonly RankedFreeAgent[],
  positions: ReadonlySet<FreeAgentPosition>,
): readonly RankedFreeAgent[] {
  if (positions.size === 0) {
    return ranked;
  }
  return ranked.filter((row) =>
    row.player.positions.some((position) => positions.has(position as FreeAgentPosition)),
  );
}

/** A name or a search as it is compared: lower case, without its accents, so "slafkovsky" finds Slafkovský. */
function foldName(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * The ranked players whose name holds the text searched for, in the order they were ranked. No
 * text is every player; each keeps his rank, so a player searched for still says where he stands.
 */
export function filterByName(
  ranked: readonly RankedFreeAgent[],
  search: string,
): readonly RankedFreeAgent[] {
  const term = foldName(search.trim());
  if (!term) {
    return ranked;
  }
  return ranked.filter((row) => foldName(row.player.name).includes(term));
}

/** The teams the server rated, findable by a club abbreviation in any platform's spelling. */
export function teamsByKey(teams: readonly TeamSchedule[]): Map<string, TeamSchedule> {
  return new Map(teams.map((team) => [nhlTeamKey(team.team) ?? team.team, team]));
}

/**
 * How much of a player's line over the stretch a set of his club's games holds, stat by stat.
 *
 * The server allocated the line over every game of the stretch, each weighed by what it is worth
 * to the stat (the opponent's allowance of it and the venue, `statWorth`). The games kept hold
 * their own worth's share of it, so leaving out the night in Carolina takes Carolina's night out
 * of his goals, not an average night's. Plus-minus moves by an amount, not a share, so what the
 * kept games add to it is carried apart.
 */
export interface LineShare {
  /** The share of the club's games kept: what his games scale by. */
  readonly games: number;
  /** The share of his line in one stat the kept games hold. */
  readonly of: (key: string) => number;
  /**
   * What the kept games add to his plus-minus per minute of his ice, beyond their count's share
   * of the whole stretch's, at the share of his club's games he is expected to dress for.
   */
  readonly plusMinusPerMinute: number;
}

/** Every game of the stretch: the line as the server sent it. */
export const WHOLE_LINE: LineShare = { games: 1, of: () => 1, plusMinusPerMinute: 0 };
/** No game at all. */
export const NO_LINE: LineShare = { games: 0, of: () => 0, plusMinusPerMinute: 0 };

/**
 * The share of a player's line the games of his club's stretch that `keep` picks hold. `dresses`
 * is the share of the club's games he is expected to dress for, which his plus-minus amount is
 * taken at; a game whose worth to a stat is not given is an average night for it.
 */
export function lineShare(
  club: TeamSchedule,
  keep: (game: ScheduledGame) => boolean,
  dresses: number,
): LineShare {
  const all = club.schedule;
  const kept = all.filter(keep);
  if (kept.length === all.length) {
    return WHOLE_LINE;
  }
  if (kept.length === 0) {
    return NO_LINE;
  }
  const games = kept.length / all.length;
  const worth = (of: readonly ScheduledGame[], key: string) =>
    of.reduce((sum, game) => sum + (game.statWorth?.[key] ?? 1), 0);
  const amount = (of: readonly ScheduledGame[]) =>
    of.reduce((sum, game) => sum + (game.plusMinusPerMinute ?? 0), 0);
  const shares = new Map<string, number>();
  return {
    games,
    of: (key) => {
      let share = shares.get(key);
      if (share === undefined) {
        const whole = worth(all, key);
        share = whole > 0 ? worth(kept, key) / whole : games;
        shares.set(key, share);
      }
      return share;
    },
    plusMinusPerMinute: dresses * (amount(kept) - games * amount(all)),
  };
}

/** Two shares of one stretch over games that do not overlap, taken together. */
export function addShares(a: LineShare, b: LineShare): LineShare {
  if (b === NO_LINE) {
    return a;
  }
  if (a === NO_LINE) {
    return b;
  }
  return {
    games: a.games + b.games,
    of: (key) => a.of(key) + b.of(key),
    plusMinusPerMinute: a.plusMinusPerMinute + b.plusMinusPerMinute,
  };
}

/**
 * A share over whole games: the games it holds of a player's `expectedGames`, rounded the way a
 * schedule counts them, with every stat moved by the same factor. A player is either in a game or
 * not, so a skater shown on 3 games is given the line of 3, not of the 2.85 they round from.
 */
export function wholeGamesShare(share: LineShare, expectedGames: number): LineShare {
  const games = expectedGames * share.games;
  const whole = Math.round(games);
  if (whole === games || games <= 0) {
    return share;
  }
  const scale = whole / games;
  return {
    games: share.games * scale,
    of: (key) => share.of(key) * scale,
    plusMinusPerMinute: share.plusMinusPerMinute * scale,
  };
}

/**
 * A line over the whole games its fractional `expectedGames` round to, each counting stat moved
 * with them: a skater's by {@link wholeGamesShare}, a goalie's as whole starts by
 * {@link startsProjection}, so one rounded to none has no rates either.
 */
export function wholeGamesLine(projection: Projection, expectedGames: number): Projection {
  return projection.type === 'goalie'
    ? startsProjection(projection, expectedGames, Math.round(expectedGames))
    : scaledProjection(projection, wholeGamesShare(WHOLE_LINE, expectedGames));
}

function clubOf(
  player: FreeAgent,
  teams: ReadonlyMap<string, TeamSchedule>,
): TeamSchedule | undefined {
  const club = teams.get(nhlTeamKey(player.teamAbbrev) ?? '');
  return club && club.schedule.length > 0 ? club : undefined;
}

function dressShare(player: FreeAgent): number {
  return player.clubGames > 0 ? player.expectedGames / player.clubGames : 0;
}

/**
 * The share of a player's line his club's games on the nights counted hold. The whole line while
 * every night is counted, and for a club the page cannot find a schedule for, so an unmatched
 * spelling costs nothing but the weighing.
 */
export function nightsShare(
  player: FreeAgent,
  teams: ReadonlyMap<string, TeamSchedule>,
  counted: ReadonlySet<string>,
  everyNightCounted: boolean,
): LineShare {
  const club = everyNightCounted ? undefined : clubOf(player, teams);
  if (!club) {
    return WHOLE_LINE;
  }
  return lineShare(club, (game) => counted.has(game.date), dressShare(player));
}

/**
 * The share of a player's line his club's games hold on nights counted with room for him in the
 * user's own lineup: the games he would actually start if picked up. A night his club plays with
 * every seat he could take already filled scores him nothing, however few games are on it. The
 * whole line for a club the page cannot find a schedule for, as in {@link nightsShare}.
 */
export function roomShare(
  player: FreeAgent,
  teams: ReadonlyMap<string, TeamSchedule>,
  counted: ReadonlySet<string>,
  rooms: ReadonlyMap<string, NightRoom>,
): LineShare {
  const club = clubOf(player, teams);
  if (!club) {
    return WHOLE_LINE;
  }
  return lineShare(
    club,
    (game) => counted.has(game.date) && fitsRoom(player.positions, rooms.get(game.date)),
    dressShare(player),
  );
}

/**
 * The share of a player's line his club's games hold on nights counted where only a drop makes
 * room for him ({@link fitsDrop}): the games he would start if he came in for one of the user's
 * players. None for a club the page cannot find a schedule for, since nothing says when it plays.
 */
export function dropShare(
  player: FreeAgent,
  teams: ReadonlyMap<string, TeamSchedule>,
  counted: ReadonlySet<string>,
  rooms: ReadonlyMap<string, NightRoom>,
  dropRooms: ReadonlyMap<string, DropRoom>,
): LineShare {
  const club = clubOf(player, teams);
  if (!club) {
    return NO_LINE;
  }
  return lineShare(
    club,
    (game) =>
      counted.has(game.date) &&
      fitsDrop(player.positions, rooms.get(game.date), dropRooms.get(game.date)),
    dressShare(player),
  );
}

/**
 * The projection over the games a share holds: each counting stat at the share of it those games
 * hold, plus-minus at their count's share and what their opponents add to it, and the games at
 * their count's share. A rate (shooting or save percentage, goals-against average) and the ice
 * time per game are the season's own and stay.
 */
export function scaledProjection(projection: Projection, share: LineShare): Projection {
  if (share === WHOLE_LINE) {
    return projection;
  }
  const rates: ReadonlySet<string> = new Set(RATE_STAT_KEYS);
  const utility = projection.stats.utility as Record<string, number>;
  const minutes = (utility['toiPerGame'] ?? 0) / 60;
  const scoring = Object.fromEntries(
    Object.entries(projection.stats.scoring).map(([key, value]) => {
      if (rates.has(key)) {
        return [key, value];
      }
      if (key === 'plusMinus') {
        return [key, value * share.games + minutes * share.plusMinusPerMinute];
      }
      return [key, value * share.of(key)];
    }),
  );
  const scaledUtility = Object.fromEntries(
    Object.entries(utility).map(([key, value]) => [
      key,
      key === 'toiPerGame' ? value : value * share.games,
    ]),
  );
  return { ...projection, stats: { scoring, utility: scaledUtility } } as Projection;
}

/**
 * The starts each listed goalie is given on the nights counted: whole games, each of a club's
 * counted games handed to one goalie of its crease.
 *
 * The model's crease is a chance a night (a starter at 0.7, his backup at 0.3), and a game is
 * started by one man, not a share of it by each. Scaled player by player, New Jersey's one game
 * of a weekend left both its free agents at about half a start: each read "0" games and still
 * carried a line. So a club's counted games are given out together, its expected starts rounded
 * to whole games that add up to them: one game goes to the likeliest starter, and four at
 * seventy-thirty go three and one. The single likeliest split of the nights was used before, and
 * it favoured the starter wherever the rest of a night was spread over several backups: Edmonton's
 * 0.57 starter took both of two nights beside a 0.24 and a 0.19, two starts against an expected
 * 1.14. The goalies a league has rostered are in the crease as well, so a free agent behind one of
 * them is given none.
 *
 * Keyed by the platform's player id; a goalie in no crease is not in it.
 */
export function projectedStarts(
  creases: readonly PlannerCrease[],
  counted: ReadonlySet<string>,
  everyNightCounted: boolean,
): ReadonlyMap<string, number> {
  const starts = new Map<string, number>();
  for (const crease of creases) {
    const split = roundedSplit(crease, (date) => everyNightCounted || counted.has(date));
    crease.goalies.forEach((goalie, index) => {
      if (goalie.playerId !== undefined) {
        starts.set(goalie.playerId, split[index]);
      }
    });
  }
  return starts;
}

/**
 * Two expectations or remainders that differ by less than this are equal: what parts them is the
 * arithmetic's rounding (three nights at a third come to 0.9999…), not one being larger.
 */
const TIED = 1e-9;

/**
 * Each goalie of a crease's expected starts on the nights kept, rounded to whole games by largest
 * remainder, with one more count, last, for a goalie the model does not name: a night whose shares
 * come to less than one start leaves the rest to him. Each goalie keeps the whole games of his
 * expectation, and the games still unclaimed go one each to the largest fractions left, so the
 * counts add up to the nights and none is more than a game from what he is expected to start. A tie
 * goes to the goalie listed first, who has the most starts over the stretch.
 */
function roundedSplit(crease: PlannerCrease, kept: (date: string) => boolean): readonly number[] {
  const nights = [
    ...new Set(crease.goalies.flatMap((goalie) => goalie.nights.map((night) => night.date))),
  ].filter(kept);
  const expected = new Array<number>(crease.goalies.length + 1).fill(0);
  for (const date of nights) {
    nightChances(crease, date).forEach((chance, index) => (expected[index] += chance));
  }
  const counts = expected.map((games) => Math.floor(games + TIED));
  const unclaimed = nights.length - counts.reduce((sum, count) => sum + count, 0);
  expected
    .map((games, index) => ({ index, remainder: games - counts[index] }))
    .sort((a, b) =>
      Math.abs(a.remainder - b.remainder) > TIED ? b.remainder - a.remainder : a.index - b.index,
    )
    .slice(0, unclaimed)
    .forEach(({ index }) => counts[index]++);
  return counts;
}

/** Each goalie's chance of starting the night, and last the unnamed goalie's: one in all. */
function nightChances(crease: PlannerCrease, date: string): number[] {
  const shares = crease.goalies.map((goalie) =>
    Math.max(0, goalie.nights.find((night) => night.date === date)?.share ?? 0),
  );
  const total = shares.reduce((sum, share) => sum + share, 0);
  // A crease whose starts run past the schedule (a goalie traded in with his own) is held to the
  // one start a night has.
  return total > 1 ? [...shares.map((share) => share / total), 0] : [...shares, 1 - total];
}

/**
 * A goalie's projection over the starts he is given: his line over the stretch, which was
 * projected over `expectedStarts`, a start at a time, times them, each start worth what the nights
 * `share` keeps make it against the stretch's average. Given none, every number is nought, his
 * rates too: a goalie who does not play has no save percentage or goals-against average to help
 * or hurt a team's, and left in, the ranking would weigh them at an average goalie's minutes.
 */
export function startsProjection(
  projection: Projection,
  expectedStarts: number,
  starts: number,
  share: LineShare = WHOLE_LINE,
): Projection {
  if (starts > 0 && expectedStarts > 0) {
    const scale = starts / expectedStarts;
    if (scale === 1 && share === WHOLE_LINE) {
      return projection;
    }
    // A start on the nights kept is worth what their opponents and venues make it, against the
    // whole stretch's average start.
    const tilt = (key: string) => (share.games > 0 ? share.of(key) / share.games : 1);
    return scaledProjection(projection, {
      games: scale,
      of: (key) => scale * tilt(key),
      plusMinusPerMinute: 0,
    });
  }
  const nought = (stats: Record<string, number>) =>
    Object.fromEntries(Object.keys(stats).map((key) => [key, 0]));
  return {
    ...projection,
    stats: { scoring: nought(projection.stats.scoring), utility: nought(projection.stats.utility) },
  } as Projection;
}

/** Seconds as minutes and seconds, the way ice time is written: 1052 is 17:32. */
export function formatToi(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return '';
  }
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

/**
 * Games as a whole number, the way a schedule counts them. The expectation is fractional, and to
 * one decimal it read as two kinds of number: 2.97 came out "3.0" beside a "3" the arithmetic
 * happened to land on. The planner's and FA Scout's games are whole already, their lines with them
 * ({@link wholeGamesShare}, {@link wholeGamesLine}); this rounds whatever else passes a fraction.
 */
export function formatGames(games: number): string {
  return Math.round(games).toString();
}

/** One stat of a player's line, as the list writes it. */
export interface LineStat {
  readonly key: ScoringStatKey;
  /** "G", "SOG": short enough for a league's whole set of categories to share a line. */
  readonly label: string;
  /** "Goals", "Shots on Goal": what the label stands for. */
  readonly name: string;
  readonly value: string;
}

/** Where the app's own label is a word, the abbreviation a box score uses for it. */
const SHORT_LABELS: Partial<Record<ScoringStatKey, string>> = {
  goals: 'G',
  assists: 'A',
  hits: 'HIT',
  blocks: 'BLK',
  w: 'W',
  l: 'L',
  sho: 'SHO',
};

/** A category as the list names it: the short label of a column, and what it stands for. */
export function categoryColumn(key: ScoringStatKey): LineColumn {
  return { key, label: SHORT_LABELS[key] ?? STAT_LABELS[key], name: STAT_FULL_NAMES[key] };
}

/** Counts that run to dozens within a week, where the model's fraction says nothing. */
const WHOLE_COUNTS: ReadonlySet<ScoringStatKey> = new Set(['sv', 'sa', 'shifts']);

function formatLineStat(key: ScoringStatKey, value: number): string {
  if ((RATE_STAT_KEYS as readonly string[]).includes(key)) {
    return value.toFixed(DEFAULT_DECIMAL_SETTINGS[key]);
  }
  if (key === 'toi') {
    return formatToi(value) || '0:00';
  }
  // A week's counts are small enough for a decimal to carry the difference between two players;
  // past a hundred it is noise, and it would not fit the cell.
  const text = value.toFixed(WHOLE_COUNTS.has(key) || Math.abs(value) >= 100 ? 0 : 1);
  return key === 'plusMinus' && Number(text) > 0 ? `+${text}` : text;
}

/**
 * A player's line in the categories his league scores, in the league's own order: a skater's in
 * its skater categories, a goalie's in its goalie ones. A category the model gave no number for
 * is left out rather than written as the zero the ranking engine was handed in its place.
 */
export function lineStats(
  row: LineRow,
  categories: readonly ScoringStatKey[],
): readonly LineStat[] {
  const own: readonly string[] =
    row.line.type === 'skater' ? SKATER_SCORING_STAT_KEYS : GOALIE_SCORING_STAT_KEYS;
  const scoring = row.line.stats.scoring as Record<string, number>;
  // A goalie given no start has no rate to write: nought would read as a save percentage of none.
  const benched = row.line.type === 'goalie' && row.games === 0;
  const rates: readonly string[] = RATE_STAT_KEYS;
  return categories
    .filter((key) => own.includes(key) && row.player.projected.has(key))
    .map((key) => ({
      ...categoryColumn(key),
      value: benched && rates.includes(key) ? NO_RATE : formatLineStat(key, scoring[key] ?? 0),
    }));
}

/** What a rate over no games is written as. */
export const NO_RATE = '—';

/**
 * What the games a drop would add put on his line, a category a stat, in the table's columns: the
 * counts that grow by them, written as "+0.4". A rate is the season's own and stays, a count the
 * games leave unmoved says nothing, and neither is listed. Empty where a drop adds nothing.
 */
export function liftStats(
  row: RankedFreeAgent,
  categories: readonly ScoringStatKey[],
): readonly LineStat[] {
  const lifted = row.lifted;
  if (!lifted) {
    return [];
  }
  const own: readonly string[] =
    row.line.type === 'skater' ? SKATER_SCORING_STAT_KEYS : GOALIE_SCORING_STAT_KEYS;
  const rates: readonly string[] = RATE_STAT_KEYS;
  const before = row.line.stats.scoring as Record<string, number>;
  const after = lifted.line.stats.scoring as Record<string, number>;
  return categories
    .filter((key) => own.includes(key) && row.player.projected.has(key) && !rates.includes(key))
    .map((key) => ({ key, more: (after[key] ?? 0) - (before[key] ?? 0) }))
    .filter(({ key, more }) => formatLineStat(key, more) !== formatLineStat(key, 0))
    .map(({ key, more }) => {
      const text = formatLineStat(key, more);
      // Plus-minus signs itself; a count that fell is a sign of a line the model cut.
      const signed = text.startsWith('+') || text.startsWith('-') ? text : `+${text}`;
      return { ...categoryColumn(key), value: signed };
    });
}

/** A category as the list heads a column with it. */
export type LineColumn = Pick<LineStat, 'key' | 'label' | 'name'>;

/**
 * The columns the lines are read in: every category any of them has a number for, in the league's
 * order. A category none of them has is no column, rather than an empty one. Skaters and goalies
 * share the list, so a skater's row is blank under a goalie's category and a goalie's under a
 * skater's: a column still means one category on every row that has it.
 */
export function lineColumns(
  lines: readonly (readonly LineStat[])[],
  categories: readonly ScoringStatKey[],
): readonly LineColumn[] {
  const found = new Map<ScoringStatKey, LineColumn>();
  for (const stat of lines.flat()) {
    if (!found.has(stat.key)) {
      found.set(stat.key, { key: stat.key, label: stat.label, name: stat.name });
    }
  }
  return categories.flatMap((key) => found.get(key) ?? []);
}

// --- Sorting the list ----------------------------------------------------------------------------

/** A column the free agents can be sorted by: one about the player, or a category of his line. */
export type FreeAgentSortKey = 'name' | 'score' | 'games' | 'toi' | 'rostered' | ScoringStatKey;

export interface FreeAgentSort {
  readonly key: FreeAgentSortKey;
  readonly descending: boolean;
}

/** The list as ranked: best first by the score, which is what the # column counts. */
export const RANKED_ORDER: FreeAgentSort = { key: 'score', descending: true };

export function isRankedOrder(sort: FreeAgentSort): boolean {
  return sort.key === RANKED_ORDER.key && sort.descending === RANKED_ORDER.descending;
}

/**
 * Sorts by a column, best first, whichever end of the scale that is (`defaultSortDirection`: a
 * name from A, GAA from the lowest, everything else from the highest); the same column again turns
 * the order round.
 */
export function nextSort(current: FreeAgentSort, key: FreeAgentSortKey): FreeAgentSort {
  if (current.key === key) {
    return { key, descending: !current.descending };
  }
  const firstWay = key === 'score' || key === 'games' || key === 'toi' || key === 'rostered';
  return { key, descending: firstWay || defaultSortDirection(key) === 'desc' };
}

/**
 * The number a player sorts by in a column, or null where the column says nothing about him: a
 * category of the other kind, one the model gave him no number in, a rate stat over no games,
 * a goalie's ice time. Null is what the table leaves blank or writes as a dash.
 */
export function sortValue(row: LineRow, key: Exclude<FreeAgentSortKey, 'name'>): number | null {
  switch (key) {
    case 'score':
      return row.score;
    case 'games':
      return row.games;
    case 'toi':
      return row.player.projection.type === 'skater'
        ? (row.player.projection.stats.utility.toiPerGame ?? null)
        : null;
    case 'rostered':
      return row.player.percentRostered ?? null;
    default: {
      const own: readonly string[] =
        row.line.type === 'skater' ? SKATER_SCORING_STAT_KEYS : GOALIE_SCORING_STAT_KEYS;
      if (!own.includes(key) || !row.player.projected.has(key)) {
        return null;
      }
      const rates: readonly string[] = RATE_STAT_KEYS;
      if (row.games === 0 && rates.includes(key)) {
        return null;
      }
      const value = (row.line.stats.scoring as Record<string, number>)[key];
      return typeof value === 'number' ? value : null;
    }
  }
}

/**
 * The list in the order asked for. A player the column says nothing about goes last whichever way
 * it points, and players level on it keep their ranked order, so a sort is the ranking re-cut
 * rather than reshuffled. The ranked order itself is the list as it came.
 */
export function sortFreeAgents<T extends LineRow>(
  rows: readonly T[],
  sort: FreeAgentSort,
): readonly T[] {
  if (isRankedOrder(sort)) {
    return rows;
  }
  const sign = sort.descending ? -1 : 1;
  const { key } = sort;
  if (key === 'name') {
    return [...rows].sort(
      (a, b) => sign * a.player.name.localeCompare(b.player.name) || a.rank - b.rank,
    );
  }
  return [...rows].sort(
    (a, b) => compareStatValues(sortValue(a, key), sortValue(b, key), sign) || a.rank - b.rank,
  );
}
