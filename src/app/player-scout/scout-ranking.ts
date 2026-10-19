import { Projection, ScoredProjection } from '../models/projection.model';
import { compareStatValues } from '../models/sorting';
import { LOWER_IS_BETTER_SCORING_STAT_KEYS, ScoringStatKey } from '../models/stat-key.model';
import { ScoutPlayer } from '../services/player-scout.service';
import {
  FreeAgentSort,
  FreeAgentSortKey,
  nextSort,
  RANKED_ORDER,
  RankedFreeAgent,
  sortFreeAgents,
} from '../streamer-planner/planner-free-agents';

/**
 * A player in the league ranked on today's rest of the season, beside his place and score on the
 * model's line as it stood on the chosen day. The planner's row, so
 * its table helpers draw it.
 */
export interface ScoutRow extends RankedFreeAgent {
  readonly scout: ScoutPlayer;
  /** His line as it stood on the chosen day, over today's games left; null without one. */
  readonly then: Projection | null;
  /** The chosen day's line scored the same way; null without one. */
  readonly thenScore: number | null;
  /** His place among the same players on the chosen day's line; null without one. */
  readonly thenRank: number | null;
  /** Score now less score then: how much more (or less) the model makes of him. Null without a then. */
  readonly delta: number | null;
  /** Places gained since the chosen day: positive is a rise. Null without one. */
  readonly rise: number | null;
  /** Risen far enough that a draft would have taken him had it known: see {@link isRising}. */
  readonly rising: boolean;
}

/** Fewer places than this is the noise of a ranking, not a change of role. */
export const RISE_MIN_PLACES = 5;

/**
 * Whether a player has risen enough to be worth a look as a keeper: his place at least halved
 * since the chosen day, and by at least {@link RISE_MIN_PLACES} places. Halved rather than a fixed
 * number of places, because the top of a league has little room to climb: first from eighth is
 * the climb of the season, while a hundredth from a hundred and fifteenth is nobody's.
 */
export function isRising(rank: number, thenRank: number | null): boolean {
  if (thenRank === null) {
    return false;
  }
  return thenRank >= 2 * rank && thenRank - rank >= RISE_MIN_PLACES;
}

/**
 * Every player in the league, skaters and goalies in one list, on both lines, best first on the
 * rest of the season today. One list as the planner's is, so a filter narrows it without moving
 * anyone's place: the engine scores a skater against skaters and a goalie against goalies, so the
 * two are on one scale, and a player's place is his place in the whole league, whoever holds him.
 *
 * <p>Both lines are ranked among the same players, each on its own: a place is a comparison with
 * the rest of the league, and the league is the same players either way. The chosen day's line
 * comes re-spread over today's games left, so the scores compare stat for stat as well.
 *
 * @param rank ranks lines by the league's scoring, best first, as the ranking engine does
 */
export function rankScout(
  players: readonly ScoutPlayer[],
  rank: (projections: Projection[]) => ScoredProjection[],
  scoreOf: (entry: ScoredProjection) => number,
): ScoutRow[] {
  const byPlayerId = new Map(
    players.map((player) => [player.freeAgent.projection.playerId, player]),
  );

  const thenRanks = new Map<number, number>();
  const thenScores = new Map<number, number>();
  rank(players.flatMap((player) => (player.then ? [player.then] : []))).forEach((entry, index) => {
    thenRanks.set(entry.projection.playerId, index + 1);
    thenScores.set(entry.projection.playerId, scoreOf(entry));
  });

  const rows: ScoutRow[] = [];
  for (const entry of rank(players.map((player) => player.freeAgent.projection))) {
    const player = byPlayerId.get(entry.projection.playerId);
    if (!player) {
      continue;
    }
    const place = rows.length + 1;
    const score = scoreOf(entry);
    const thenRank = player.then ? (thenRanks.get(entry.projection.playerId) ?? null) : null;
    const thenScore = player.then ? (thenScores.get(entry.projection.playerId) ?? null) : null;
    rows.push({
      scout: player,
      player: player.freeAgent,
      line: player.freeAgent.projection,
      score,
      rank: place,
      games: player.freeAgent.expectedGames,
      then: player.then,
      thenScore,
      thenRank,
      delta: thenScore === null ? null : score - thenScore,
      rise: thenRank === null ? null : thenRank - place,
      rising: isRising(place, thenRank),
    });
  }
  return rows;
}

/** Ice time a game on a line, in seconds; undefined for a goalie or a line without it. */
export function toiPerGame(line: Projection | null): number | undefined {
  if (!line || line.type !== 'skater') {
    return undefined;
  }
  const toi = line.stats.utility.toiPerGame;
  return toi > 0 ? toi : undefined;
}

/** A stat of a line as a number, or null where the line has no such stat. */
export function statOf(line: Projection | null, key: string): number | null {
  if (!line) {
    return null;
  }
  const value = (line.stats.scoring as Record<string, number>)[key];
  return typeof value === 'number' ? value : null;
}

// --- Sorting the list ----------------------------------------------------------------------------

/**
 * A figure whose change since the chosen day the list can be sorted by: the games left, the ice
 * time a game, or a category of the line. The score's change is {@link ScoutSortKey} `delta`.
 */
export type ChangeKey = 'games' | 'toi' | ScoringStatKey;

/** The sort key of a figure's change: `change:goals`. */
export type ChangeSortKey = `change:${ChangeKey}`;

/**
 * A column the list can be sorted by: the planner's; the change in score, the places gained and
 * the change in any other figure since the chosen day; and, against the chosen drop, his
 * projection less the drop's and what the lineup gains by him.
 */
export type ScoutSortKey =
  FreeAgentSortKey | 'delta' | 'rise' | 'gain' | 'scoreGain' | ChangeSortKey;

export interface ScoutSort {
  readonly key: ScoutSortKey;
  readonly descending: boolean;
}

/** The list as ranked: best first on the rest of the season, which is what the # column counts. */
export const SCOUT_RANKED_ORDER: ScoutSort = RANKED_ORDER;

/** The order the page opens in: the players the model makes the most more of since the day. */
export const SCOUT_MOVERS_ORDER: ScoutSort = { key: 'delta', descending: true };

export function changeSortKey(key: ChangeKey): ChangeSortKey {
  return `change:${key}`;
}

/** The figure a change key is the change of, or null for any other key. */
export function changeOf(key: ScoutSortKey): ChangeKey | null {
  return key.startsWith('change:') ? (key.slice('change:'.length) as ChangeKey) : null;
}

/** Whether the key is one of the scout's own, which the planner's sort knows nothing of. */
function isScoutKey(key: ScoutSortKey): key is Exclude<ScoutSortKey, FreeAgentSortKey> {
  return (
    key === 'delta' ||
    key === 'rise' ||
    key === 'gain' ||
    key === 'scoreGain' ||
    changeOf(key) !== null
  );
}

/**
 * Sorts by a column, best first, whichever end of the scale that is: the furthest risen first,
 * the biggest change for the better first, and every other column as the planner sorts it. The
 * same column again turns the order round.
 */
export function nextScoutSort(current: ScoutSort, key: ScoutSortKey): ScoutSort {
  if (current.key === key) {
    return { key, descending: !current.descending };
  }
  if (isScoutKey(key)) {
    return { key, descending: true };
  }
  // Another column than the current: the planner reads nothing of the current order but its key.
  return nextSort(current as FreeAgentSort, key);
}

/**
 * The change in a figure since the chosen day, as the cell under it writes it, with its sense:
 * positive is the better way, so fewer goals against sorts as a gain. Null without a then-line,
 * or where the day's line had no such figure.
 */
export function changeValue(row: ScoutRow, key: ChangeKey): number | null {
  if (!row.then) {
    return null;
  }
  switch (key) {
    case 'games':
      return row.games - Math.round(row.then.stats.utility.gp);
    case 'toi': {
      const now = toiPerGame(row.line);
      const then = toiPerGame(row.then);
      return now === undefined || then === undefined ? null : now - then;
    }
    default: {
      if (!row.scout.thenProjected.has(key)) {
        return null;
      }
      const now = statOf(row.line, key);
      const then = statOf(row.then, key);
      if (now === null || then === null) {
        return null;
      }
      return LOWER_IS_BETTER_SCORING_STAT_KEYS.has(key) ? then - now : now - then;
    }
  }
}

/** The number a row sorts by in one of the scout's own columns; null where it says nothing. */
function scoutSortValue(
  row: ScoutRow,
  key: Exclude<ScoutSortKey, FreeAgentSortKey>,
  gains: ReadonlyMap<string, number | null>,
): number | null {
  switch (key) {
    case 'delta':
      return row.delta;
    case 'rise':
      return row.rise;
    case 'gain':
      return gains.get(row.player.playerId) ?? null;
    // His projection less the drop's: the drop's is the same for every row, so the column orders
    // the list exactly as the score does. It sorts under its own key so that only its heading
    // wears the arrow.
    case 'scoreGain':
      return row.score;
    default:
      return changeValue(row, changeOf(key) as ChangeKey);
  }
}

/**
 * The list in the order asked for. A player the column says nothing about, as a rise without a
 * then-line or a gain the page could not price, goes last whichever way it points, and players
 * level on it keep their ranked order, as in the planner.
 *
 * @param gains what the lineup gains by each pickup, by platform id, for the gain column
 */
export function sortScout(
  rows: readonly ScoutRow[],
  sort: ScoutSort,
  gains: ReadonlyMap<string, number | null> = new Map(),
): readonly ScoutRow[] {
  const { key } = sort;
  if (!isScoutKey(key)) {
    return sortFreeAgents(rows, { key, descending: sort.descending });
  }
  const sign = sort.descending ? -1 : 1;
  return [...rows].sort(
    (a, b) =>
      compareStatValues(scoutSortValue(a, key, gains), scoutSortValue(b, key, gains), sign) ||
      a.rank - b.rank,
  );
}
