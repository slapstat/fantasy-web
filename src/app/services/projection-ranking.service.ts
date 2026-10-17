import { inject, Injectable } from '@angular/core';
import {
  ProjectionCalculationService,
  ZScoreOrigin,
  ZScoreScales,
} from './projection-calculation.service';
import { Projection, ScoredProjection, ScoringType, StatWeights } from '../models/projection.model';
import {
  GOALIE_SCORING_STAT_KEYS,
  ScoringStatKey,
  SKATER_SCORING_STAT_KEYS,
} from '../models/stat-key.model';
import { RosterSlots } from '../api/models/roster-slots';
import { skaterSlotCount } from '../models/roster-slots';
import { applyManualRanking, ManualRanking, PROJECTED_RANKING } from '../models/manual-ranking';

const SKATER_SCORING_STAT_KEY_SET: ReadonlySet<string> = new Set(SKATER_SCORING_STAT_KEYS);
const GOALIE_SCORING_STAT_KEY_SET: ReadonlySet<string> = new Set(GOALIE_SCORING_STAT_KEYS);

/** Per scored stat, what one more of it adds to a score: skaters' and goalies' apart. */
export type ScoreUnits = ZScoreScales;

export interface RankingInput {
  projections: Projection[];
  scoringType: ScoringType;
  statWeights: StatWeights;
  activeScoringColumns: Set<ScoringStatKey>;
  leagueSize: number;
  rosterSlots: RosterSlots;
  minGoalieGames: number;
  decimalSettings: Record<string, number>;
  /**
   * The owner's own order, where they have one. Left out, the board is ranked by its projections,
   * which is what every caller wanted before a projection could carry a hand ranking.
   */
  manualRanking?: ManualRanking;
  /**
   * Where a category league's nought sits (see {@link ZScoreOrigin}). Left out, at the
   * replacement player, which is what a season board ranks by.
   */
  zScoreOrigin?: ZScoreOrigin;
}

/**
 * Ranks player projections by overall projected value, matching the editor table's default
 * order (rounded stats → fantasy points / z-score → qualified-first). Kept here so draft mode
 * and any other consumer rank identically without depending on the table component.
 */
@Injectable({ providedIn: 'root' })
export class ProjectionRankingService {
  private readonly calculation = inject(ProjectionCalculationService);

  rankOverall(input: RankingInput): ScoredProjection[] {
    const scored = applyManualRanking(
      this.score(input),
      input.manualRanking ?? PROJECTED_RANKING,
      input.scoringType,
    );
    const valueOf =
      input.scoringType === 'points'
        ? (scoredProjection: ScoredProjection) => scoredProjection.score.fantasyPoints
        : (scoredProjection: ScoredProjection) => scoredProjection.score.zScore;
    return [...scored].sort((first, second) => {
      if (first.qualified !== second.qualified) {
        return first.qualified ? -1 : 1;
      }
      return valueOf(second) - valueOf(first);
    });
  }

  /**
   * Per-player, per-category breakdown of the overall score, keyed by playerId. Each map's values
   * sum to that player's {@link ScoredProjection} score (fantasy points or z-score), so a league
   * table can attribute a team's total to individual categories. Points mode weights each category
   * by its stat weight; category mode uses the z-score contribution. Rounding mirrors {@link score}
   * so the per-category figures reconcile exactly with the ranked totals.
   */
  contributionsByPlayerId(input: RankingInput): Map<number, Record<string, number>> {
    const rounded = input.projections.map((projection) =>
      this.round(projection, input.decimalSettings),
    );
    const byPlayerId = new Map<number, Record<string, number>>();

    if (input.scoringType === 'points') {
      for (const projection of rounded) {
        const scoring = projection.stats.scoring as Record<string, number>;
        const typeKeys =
          projection.type === 'skater' ? SKATER_SCORING_STAT_KEY_SET : GOALIE_SCORING_STAT_KEY_SET;
        const contributions: Record<string, number> = {};
        for (const [key, weight] of Object.entries(input.statWeights)) {
          if (!input.activeScoringColumns.has(key as ScoringStatKey) || !typeKeys.has(key)) {
            continue;
          }
          contributions[key] = (scoring[key] ?? 0) * weight;
        }
        byPlayerId.set(projection.playerId, contributions);
      }
      return byPlayerId;
    }

    const roster = input.rosterSlots;
    const skaterPoolSize = input.leagueSize * skaterSlotCount(roster);
    const goaliePoolSize = input.leagueSize * roster.g;
    const zContributions = this.calculation.computeZScoreContributions(
      rounded,
      input.activeScoringColumns,
      skaterPoolSize,
      goaliePoolSize,
      input.zScoreOrigin,
    );
    rounded.forEach((projection, index) => {
      byPlayerId.set(projection.playerId, zContributions[index]);
    });
    return byPlayerId;
  }

  /**
   * What one more of each scored stat adds to a player's score, skaters' and goalies' apart: its
   * weight in a points league, its direction over the pool's spread in a category league (see
   * {@link ProjectionCalculationService.computeZScoreScales}). A ratio category has none. Scores are
   * linear in a player's counts, so a caller can price a change to his line, a night that moves
   * his goals by a tenth say, without ranking the pool again.
   */
  scoreUnits(input: RankingInput): ScoreUnits {
    if (input.scoringType === 'points') {
      const units = (keys: ReadonlySet<string>) =>
        Object.fromEntries(
          Object.entries(input.statWeights).filter(
            ([key]) => keys.has(key) && input.activeScoringColumns.has(key as ScoringStatKey),
          ),
        );
      return {
        skater: units(SKATER_SCORING_STAT_KEY_SET),
        goalie: units(GOALIE_SCORING_STAT_KEY_SET),
      };
    }
    const roster = input.rosterSlots;
    return this.calculation.computeZScoreScales(
      input.projections.map((projection) => this.round(projection, input.decimalSettings)),
      input.activeScoringColumns,
      input.leagueSize * skaterSlotCount(roster),
      input.leagueSize * roster.g,
    );
  }

  private score(input: RankingInput): ScoredProjection[] {
    const rounded = input.projections.map((projection) =>
      this.round(projection, input.decimalSettings),
    );
    const fantasyPoints = rounded.map((projection) =>
      projection.type === 'skater'
        ? this.calculation.computeSkaterTotalPoints(
            projection.stats.scoring,
            input.statWeights,
            input.activeScoringColumns,
          )
        : this.calculation.computeGoalieTotalPoints(
            projection.stats.scoring,
            input.statWeights,
            input.activeScoringColumns,
          ),
    );
    const roster = input.rosterSlots;
    const skaterPoolSize = input.leagueSize * skaterSlotCount(roster);
    const goaliePoolSize = input.leagueSize * roster.g;
    const zScores = this.calculation.computeZScores(
      rounded,
      input.activeScoringColumns,
      skaterPoolSize,
      goaliePoolSize,
      input.zScoreOrigin,
    );

    const isCategory = input.scoringType === 'category';
    return input.projections.map((projection, index) => ({
      projection,
      score: { fantasyPoints: fantasyPoints[index], zScore: zScores[index] },
      qualified: this.isQualified(projection, isCategory, input.minGoalieGames),
    }));
  }

  private round(projection: Projection, decimals: Record<string, number>): Projection {
    if (projection.type === 'skater') {
      const scoring = { ...projection.stats.scoring };
      for (const key of SKATER_SCORING_STAT_KEYS) {
        scoring[key] = parseFloat((scoring[key] ?? 0).toFixed(decimals[key] ?? 0));
      }
      return { ...projection, stats: { ...projection.stats, scoring } };
    }
    const scoring = { ...projection.stats.scoring };
    for (const key of GOALIE_SCORING_STAT_KEYS) {
      scoring[key] = parseFloat(scoring[key].toFixed(decimals[key] ?? 0));
    }
    return { ...projection, stats: { ...projection.stats, scoring } };
  }

  /**
   * Whether a category league's goalie ranks among the goalies who count: his games at least the
   * league's minimum, and above none whatever the minimum. A goalie with no games has no minutes to
   * move a team's GAA or save percentage, so his ratios score the pool's average, while one who
   * plays at a rate below the pool's scores under it: ranked on score alone, a goalie out for the
   * season would rank above every goalie who plays below average.
   */
  private isQualified(projection: Projection, isCategory: boolean, minGames: number): boolean {
    if (!isCategory || projection.type !== 'goalie') {
      return true;
    }
    const games = projection.stats.utility.gp;
    return games > 0 && games >= minGames;
  }
}
