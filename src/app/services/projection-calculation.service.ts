import { Injectable } from '@angular/core';
import {
  GOALIE_SCORING_STAT_KEYS,
  GoalieScoringStatKey,
  LOWER_IS_BETTER_SCORING_STAT_KEYS,
  ScoringStatKey,
  SKATER_SCORING_STAT_KEYS,
  SkaterScoringStatKey,
} from '../models/stat-key.model';
import {
  GoalieProjection,
  GoalieScoringStats,
  Projection,
  SkaterProjection,
  SkaterScoringStats,
  StatWeights,
} from '../models/projection.model';
import { ratioVolume } from '../models/ratio-volume';

const DEFAULT_SKATER_POOL_SIZE = 180;
const DEFAULT_GOALIE_POOL_SIZE = 32;
const MAX_POOL_ITERATIONS = 10;

/**
 * Where a z-score's nought sits. `'replacement'`: at the replacement player, the last one a
 * league of that size would roster, so every rostered player adds and only one worse than what a
 * team could pick up instead scores less than nothing — right for a season board, where the
 * question is how much better he is than the wire. `'empty'`: at a line
 * with nothing in it, so every game played adds and only what hurts a team takes away (a loss,
 * goals against, a ratio dragged down) — right for a week, where a player with one start still
 * helps the team he starts for, and a score a game has to be that game's own. Each category is
 * still divided by the pool's spread, so within skaters, or within goalies, the order is the same
 * either way: the two differ by one constant per pool.
 */
export type ZScoreOrigin = 'replacement' | 'empty';

interface PoolEntry<P extends Projection> {
  projection: P;
  index: number;
}

/**
 * One pass of z-scores over a pool: per active category, every entry's contribution, plus the
 * running total per entry. The totals are kept alongside rather than summed from the per-category
 * arrays because the pool is re-derived by sorting on them — recomputing a sum inside that
 * comparator is what made this the slowest thing on the page.
 *
 * A category whose pool has no spread is `null` rather than an array of zeroes, so it stays out
 * of the per-category breakdown entirely.
 */
interface PoolZScores {
  totals: Float64Array;
  byCategory: (Float64Array | null)[];
  /**
   * Per category, what one more of a counting stat adds to a player's z-score: its direction over
   * the pool's spread. Null for a ratio, whose z-score is not a multiple of any one count, and for a
   * category with no spread.
   */
  scales: (number | null)[];
}

/** Per counting category, what one more of the stat adds to a z-score, for skaters and goalies apart. */
export interface ZScoreScales {
  readonly skater: Readonly<Record<string, number>>;
  readonly goalie: Readonly<Record<string, number>>;
}

/**
 * One active category's numbers, read off the projections once per ranking. A counting stat is
 * scored as it stands. A ratio (GAA, save, win and shooting percentage) is scored by what it does
 * to a team's own ratio, which needs the pool's rate as well, so its value is only settled per
 * pool (see `ratioValues`).
 */
interface CategoryValues {
  /** The stat as it stands; for a ratio, the rate. */
  values: Float64Array;
  /** For a ratio, the volume behind each rate (hours in net, shots, decisions); null for a count. */
  volumes: Float64Array | null;
  /** -1 where the lower number is the better one. */
  direction: 1 | -1;
}

@Injectable({
  providedIn: 'root',
})
export class ProjectionCalculationService {
  /**
   * The weights that are actually scored, in the order they sit in `statWeights`. Callers run this
   * over the whole player pool with the same two arguments every time, so the list is derived once
   * per pass rather than once per player — building it per player allocated a pair of arrays for
   * every stat of every player.
   */
  private scoredWeights: {
    statWeights: StatWeights;
    activeScoringColumns: Set<ScoringStatKey>;
    entries: [ScoringStatKey, number][];
  } | null = null;

  private activeWeights(
    statWeights: StatWeights,
    activeScoringColumns: Set<ScoringStatKey>,
  ): [ScoringStatKey, number][] {
    const cached = this.scoredWeights;
    if (
      cached &&
      cached.statWeights === statWeights &&
      cached.activeScoringColumns === activeScoringColumns
    ) {
      return cached.entries;
    }
    const entries = (Object.entries(statWeights) as [ScoringStatKey, number][]).filter(([key]) =>
      activeScoringColumns.has(key),
    );
    this.scoredWeights = { statWeights, activeScoringColumns, entries };
    return entries;
  }

  computeSkaterTotalPoints(
    stats: SkaterScoringStats,
    statWeights: StatWeights,
    activeScoringColumns: Set<ScoringStatKey>,
  ): number {
    let total = 0;
    for (const [key, weight] of this.activeWeights(statWeights, activeScoringColumns)) {
      total += (stats[key as SkaterScoringStatKey] ?? 0) * weight;
    }
    return total;
  }

  computeGoalieTotalPoints(
    stats: GoalieScoringStats,
    statWeights: StatWeights,
    activeScoringColumns: Set<ScoringStatKey>,
  ): number {
    let total = 0;
    for (const [key, weight] of this.activeWeights(statWeights, activeScoringColumns)) {
      total += (stats[key as GoalieScoringStatKey] ?? 0) * weight;
    }
    return total;
  }

  /**
   * Category-league value: per active category, how far a player sits from the pool in standard
   * deviations, summed. A counting stat is standardized as it stands. A ratio is standardized by
   * its volume-weighted contribution against the pool's own rate — goals prevented for GAA, saves
   * above average for save percentage, wins above average for win percentage, goals above average
   * for shooting percentage — because that, and not the bare rate, is what a player does to his
   * team's ratio: a 60-game starter moves it twice as far as a 30-game backup with the same numbers.
   */
  computeZScores(
    projections: Projection[],
    activeScoringColumns: Set<ScoringStatKey>,
    skaterPoolSize: number = DEFAULT_SKATER_POOL_SIZE,
    goaliePoolSize: number = DEFAULT_GOALIE_POOL_SIZE,
    origin: ZScoreOrigin = 'replacement',
  ): number[] {
    const totalsByIndex: number[] = projections.map(() => 0);
    this.scorePools(
      projections,
      activeScoringColumns,
      skaterPoolSize,
      goaliePoolSize,
      origin,
      totalsByIndex,
      null,
    );
    return totalsByIndex;
  }

  /**
   * Per-category z-score breakdown: for each projection, a map of active category → its z-score
   * contribution (already sign-adjusted for lower-is-better stats). Summing a projection's map
   * yields the same total {@link computeZScores} returns, so callers can attribute a player's
   * z-score to individual categories without recomputing.
   */
  computeZScoreContributions(
    projections: Projection[],
    activeScoringColumns: Set<ScoringStatKey>,
    skaterPoolSize: number = DEFAULT_SKATER_POOL_SIZE,
    goaliePoolSize: number = DEFAULT_GOALIE_POOL_SIZE,
    origin: ZScoreOrigin = 'replacement',
  ): Record<string, number>[] {
    const contributionsByIndex: Record<string, number>[] = projections.map(() => ({}));
    this.scorePools(
      projections,
      activeScoringColumns,
      skaterPoolSize,
      goaliePoolSize,
      origin,
      projections.map(() => 0),
      contributionsByIndex,
    );
    return contributionsByIndex;
  }

  /**
   * Per active counting category, what one more of the stat adds to a player's z-score over the
   * same pool {@link computeZScores} settles on: its direction over the pool's spread. A z-score is
   * linear in a player's own counts, so this is what lets a caller price a night that moves his
   * counts without ranking the pool again. A ratio has none: its z-score turns on a rate and the
   * volume behind it together, and a night's worth moves neither.
   */
  computeZScoreScales(
    projections: Projection[],
    activeScoringColumns: Set<ScoringStatKey>,
    skaterPoolSize: number = DEFAULT_SKATER_POOL_SIZE,
    goaliePoolSize: number = DEFAULT_GOALIE_POOL_SIZE,
  ): ZScoreScales {
    const scales = { skater: {}, goalie: {} };
    this.scorePools(
      projections,
      activeScoringColumns,
      skaterPoolSize,
      goaliePoolSize,
      'replacement',
      projections.map(() => 0),
      null,
      scales,
    );
    return scales;
  }

  /**
   * Skaters and goalies are ranked against their own pool, so each is scored separately and the
   * results written back at the projection's own index. `contributionsByIndex` is filled in only
   * when a caller asked for the per-category breakdown — the ranking itself needs the totals, and
   * building a record per player is the more expensive half of the job. `scales`, likewise, only
   * when asked for.
   */
  private scorePools(
    projections: Projection[],
    activeScoringColumns: Set<ScoringStatKey>,
    skaterPoolSize: number,
    goaliePoolSize: number,
    origin: ZScoreOrigin,
    totalsByIndex: number[],
    contributionsByIndex: Record<string, number>[] | null,
    scales: { skater: Record<string, number>; goalie: Record<string, number> } | null = null,
  ): void {
    const skaters: PoolEntry<SkaterProjection>[] = [];
    const goalies: PoolEntry<GoalieProjection>[] = [];
    projections.forEach((projection, index) => {
      if (projection.type === 'skater') {
        skaters.push({ projection, index });
      } else {
        goalies.push({ projection, index });
      }
    });

    this.applyPoolZScores(
      skaters,
      SKATER_SCORING_STAT_KEYS,
      (projection, key) => projection.stats.scoring[key],
      activeScoringColumns,
      skaterPoolSize,
      origin,
      totalsByIndex,
      contributionsByIndex,
      scales?.skater ?? null,
      0,
    );
    // A goalie's GAA, save and win percentage are measured against the wire, the half
    // a pool's worth of goalies ranked straight after it: the minutes he plays are minutes his team
    // would otherwise fill from there, so a goalie better than the wire is worth more the more he
    // plays. Measured against the pool's own rate, a goalie who never played scored exactly
    // average on both ratios, outscored every busy starter under that average, and a
    // rest-of-season board's pool filled up with goalies who do not play. A week (`'empty'`) is
    // measured against the same wire, so its order stays the season's, one constant apart.
    this.applyPoolZScores(
      goalies,
      GOALIE_SCORING_STAT_KEYS,
      (projection, key) => projection.stats.scoring[key],
      activeScoringColumns,
      goaliePoolSize,
      origin,
      totalsByIndex,
      contributionsByIndex,
      scales?.goalie ?? null,
      Math.ceil(goaliePoolSize / 2),
    );
  }

  /**
   * One kind of player's z-scores. The pool is the best `poolSize` of them, which cannot be known
   * before they are scored, so it is guessed as all of them and re-derived from the scores until it
   * stops moving. The `wireSize` players ranked straight after the pool are the wire; where there
   * is one, a ratio is measured against its rate rather than the pool's (see {@link ratioValues}),
   * and it is re-derived alongside the pool.
   */
  private applyPoolZScores<P extends Projection, K extends ScoringStatKey>(
    entries: PoolEntry<P>[],
    categoryKeys: readonly K[],
    valueOf: (projection: P, key: K) => number,
    activeScoringColumns: Set<ScoringStatKey>,
    poolSize: number,
    origin: ZScoreOrigin,
    totalsByIndex: number[],
    contributionsByIndex: Record<string, number>[] | null,
    scales: Record<string, number> | null,
    wireSize: number,
  ): void {
    if (entries.length === 0) {
      return;
    }
    const activeKeys = categoryKeys.filter((key) => activeScoringColumns.has(key));
    // Each category's values are read out once. The pool is re-derived up to MAX_POOL_ITERATIONS
    // times and every pass would otherwise walk the same projections again for the same numbers.
    const categories = activeKeys.map((key): CategoryValues => {
      const values = new Float64Array(entries.length);
      // A pool holds one kind of player, so its first entry says whether `key` is a ratio for all.
      const isRatio = ratioVolume(entries[0].projection, key) !== null;
      const volumes = isRatio ? new Float64Array(entries.length) : null;
      entries.forEach((entry, position) => {
        values[position] = valueOf(entry.projection, key);
        if (volumes) {
          volumes[position] = ratioVolume(entry.projection, key) ?? 0;
        }
      });
      const direction = LOWER_IS_BETTER_SCORING_STAT_KEYS.has(key) ? -1 : 1;
      return { values, volumes, direction };
    });

    let poolPositions = entries.map((_entry, position) => position);
    let wirePositions: number[] = [];
    let zScores = this.zScoresForPool(
      categories,
      poolPositions,
      wirePositions,
      entries.length,
      origin,
    );

    for (let iteration = 0; iteration < MAX_POOL_ITERATIONS; iteration++) {
      const { totals } = zScores;
      const ranked = entries
        .map((_entry, position) => position)
        .sort((first, second) => totals[second] - totals[first]);
      const nextPositions = ranked.slice(0, poolSize);
      const nextWire = ranked.slice(poolSize, poolSize + wireSize);
      if (
        this.samePositions(nextPositions, poolPositions) &&
        this.samePositions(nextWire, wirePositions)
      ) {
        break;
      }
      poolPositions = nextPositions;
      wirePositions = nextWire;
      zScores = this.zScoresForPool(
        categories,
        poolPositions,
        wirePositions,
        entries.length,
        origin,
      );
    }
    if (origin === 'replacement') {
      this.shiftToReplacement(zScores, poolSize);
    }

    entries.forEach((entry, position) => {
      totalsByIndex[entry.index] = zScores.totals[position];
    });
    if (scales) {
      activeKeys.forEach((key, category) => {
        const scale = zScores.scales[category];
        if (scale !== null) {
          scales[key] = scale;
        }
      });
    }
    if (!contributionsByIndex) {
      return;
    }
    entries.forEach((entry, position) => {
      const contributions: Record<string, number> = {};
      activeKeys.forEach((key, category) => {
        const categoryZScores = zScores.byCategory[category];
        if (categoryZScores) {
          contributions[key] = categoryZScores[position];
        }
      });
      contributionsByIndex[entry.index] = contributions;
    });
  }

  /**
   * Moves nought from the pool's average to the replacement player, the `poolSize`-th best (the
   * last a league of that size would roster), category by category, so the breakdown still sums
   * to the total. The spread is measured from the mean, but half the pool sits under it, and a
   * rostered player reading as less than nothing says his team would be better off without him.
   * One constant per pool, so no order and no difference moves. He is read off the totals rather
   * than the pool, so a pool that has not settled by the last pass still puts nought at the
   * `poolSize`-th best.
   */
  private shiftToReplacement(zScores: PoolZScores, poolSize: number): void {
    const { totals, byCategory } = zScores;
    if (poolSize <= 0 || totals.length === 0) {
      return;
    }
    const ranked = Array.from({ length: totals.length }, (_unused, position) => position).sort(
      (first, second) => totals[second] - totals[first] || first - second,
    );
    const replacement = ranked[Math.min(poolSize, ranked.length) - 1];
    const offset = totals[replacement];
    for (let position = 0; position < totals.length; position++) {
      totals[position] -= offset;
    }
    for (const categoryZScores of byCategory) {
      if (!categoryZScores) {
        continue;
      }
      const categoryOffset = categoryZScores[replacement];
      for (let position = 0; position < categoryZScores.length; position++) {
        categoryZScores[position] -= categoryOffset;
      }
    }
  }

  /**
   * Mean and standard deviation come from the pool; the z-scores are then handed out to every
   * entry, pool member or not, so a player outside the drafted pool still gets a comparable value.
   */
  private zScoresForPool(
    categories: CategoryValues[],
    poolPositions: number[],
    wirePositions: number[],
    size: number,
    origin: ZScoreOrigin,
  ): PoolZScores {
    const totals = new Float64Array(size);
    const byCategory: (Float64Array | null)[] = categories.map(() => null);
    const scales: (number | null)[] = categories.map(() => null);
    if (poolPositions.length === 0) {
      return { totals, byCategory, scales };
    }

    categories.forEach((category, index) => {
      // A ratio's contribution already carries its direction: goals prevented are good.
      const values = category.volumes
        ? this.ratioValues(category, poolPositions, wirePositions, size)
        : category.values;
      if (!values) {
        return;
      }
      const direction = category.volumes ? 1 : category.direction;
      let sum = 0;
      for (const position of poolPositions) {
        sum += values[position];
      }
      const mean = sum / poolPositions.length;
      let squaredDeviations = 0;
      for (const position of poolPositions) {
        squaredDeviations += (values[position] - mean) ** 2;
      }
      const stdDev = Math.sqrt(squaredDeviations / poolPositions.length);
      if (stdDev === 0) {
        return;
      }
      // The spread is the pool's whichever the origin. Measured from the mean here; nought moves to
      // the replacement player once the pool has settled.
      const centre = origin === 'replacement' ? mean : 0;
      const categoryZScores = new Float64Array(size);
      for (let position = 0; position < size; position++) {
        const zScore = (direction * (values[position] - centre)) / stdDev;
        categoryZScores[position] = zScore;
        totals[position] += zScore;
      }
      byCategory[index] = categoryZScores;
      if (!category.volumes) {
        scales[index] = direction / stdDev;
      }
    });

    return { totals, byCategory, scales };
  }

  /**
   * A ratio's value for every entry: `(rate − reference rate) × volume`, turned round where lower
   * is better, so GAA becomes goals prevented and save percentage saves above the reference. The
   * reference is the wire's rate where there is a wire with volume, so the minutes of a goalie
   * better than what a team could pick up count for him, and the pool's own rate otherwise. Either
   * is volume-weighted — summed goals against over summed hours, not the mean of the GAAs — and
   * moves with the pool and the wire from one iteration to the next.
   *
   * A line with a rate but nothing to derive a volume from (see `ratioVolume`) is weighed at the
   * pool's average volume, which ranks it on its bare rate, as every line was ranked before; a line
   * with neither has nothing to add to a team's ratio and scores exactly the reference. `null` when
   * the pool has no spread in the rate, or no volume at all.
   */
  private ratioValues(
    category: CategoryValues,
    poolPositions: number[],
    wirePositions: number[],
    size: number,
  ): Float64Array | null {
    const rates = category.values;
    const volumes = category.volumes as Float64Array;

    let knownVolume = 0;
    let knownCount = 0;
    for (const position of poolPositions) {
      if (volumes[position] > 0) {
        knownVolume += volumes[position];
        knownCount++;
      }
    }
    const standInVolume = knownCount > 0 ? knownVolume / knownCount : 1;
    const weights = new Float64Array(size);
    for (let position = 0; position < size; position++) {
      if (volumes[position] > 0) {
        weights[position] = volumes[position];
      } else if (rates[position] !== 0) {
        weights[position] = standInVolume;
      }
    }

    let weightedRate = 0;
    let totalWeight = 0;
    let lowest = Infinity;
    let highest = -Infinity;
    for (const position of poolPositions) {
      const weight = weights[position];
      if (weight > 0) {
        weightedRate += rates[position] * weight;
        totalWeight += weight;
        lowest = Math.min(lowest, rates[position]);
        highest = Math.max(highest, rates[position]);
      }
    }
    // Checked on the rates themselves: a pool sharing one rate would otherwise leave rounding
    // noise in `rate − pool rate` for the standard deviation to blow up into whole z-scores.
    if (totalWeight === 0 || lowest === highest) {
      return null;
    }
    let wireRate = 0;
    let wireWeight = 0;
    for (const position of wirePositions) {
      wireRate += rates[position] * weights[position];
      wireWeight += weights[position];
    }
    const referenceRate = wireWeight > 0 ? wireRate / wireWeight : weightedRate / totalWeight;

    const values = new Float64Array(size);
    for (let position = 0; position < size; position++) {
      values[position] = category.direction * (rates[position] - referenceRate) * weights[position];
    }
    return values;
  }

  private samePositions(first: number[], second: number[]): boolean {
    if (first.length !== second.length) {
      return false;
    }
    const inFirst = new Set(first);
    return second.every((position) => inFirst.has(position));
  }
}
