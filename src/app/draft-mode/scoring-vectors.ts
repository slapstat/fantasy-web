import { RosterSlots } from '../api/models/roster-slots';
import { Projection, ScoringType, StatWeights } from '../models/projection.model';
import { ScoringStatKey } from '../models/stat-key.model';
import { ProjectionRankingService } from '../services/projection-ranking.service';
import { DEFAULT_DECIMAL_SETTINGS } from '../draft-projection/projection-settings-section/model';
import { readableDecimalSettings } from '../draft-projection/projection-settings-section/model-decimals';
import {
  buildLeagueProjection,
  LeagueProjectionPlayer,
  LeagueProjectionTeamInput,
} from './league-projection';

/**
 * The fixtures behind `scoring-vectors.json`: a league of drafted rosters, scored here and
 * scored again by the BFF, which totals the same leagues for accounts that may not be handed
 * the lines behind the totals.
 *
 * <p>Two implementations of one ranking is a thing that drifts, so neither side is trusted to
 * stay in step on its own: this file computes the numbers, `scoring-vectors.spec.ts` holds the
 * committed JSON to them, and the BFF's `LeagueSummaryGoldenVectorTest` holds its own engine to
 * the same file. Change how a board is scored here and both sides fail until the vectors are
 * regenerated and re-pinned.
 */

/** One league to score, its players, and who drafted whom. */
export interface ScoringVectorCase {
  readonly name: string;
  readonly league: {
    readonly scoringType: ScoringType;
    readonly statWeights: Record<string, number>;
    readonly activeScoringColumns: string[];
    readonly rosterSlots: RosterSlots;
    readonly leagueSize: number;
    readonly minGoalieGames: number;
  };
  readonly pool: ScoringVectorPlayer[];
  readonly teams: { teamId: string; name: string; mine: boolean; playerIds: number[] }[];
}

export interface ScoringVectorPlayer {
  readonly playerId: number;
  readonly type: 'skater' | 'goalie';
  readonly name: string;
  readonly positions: string[];
  readonly stats: {
    readonly scoring: Record<string, number>;
    readonly utility: Record<string, number>;
  };
}

/** What both engines must produce for a case, to the last decimal. */
export interface ScoringVectorExpectation {
  readonly categoryKeys: string[];
  readonly positionKeys: string[];
  readonly teams: {
    teamId: string;
    total: number;
    values: Record<string, number>;
    roster: {
      name: string;
      total: number;
      values: Record<string, number | null>;
      contributions: Record<string, number | null>;
    }[];
    positionPlayers: Record<string, { name: string; value: number }[]>;
  }[];
}

export interface ScoringVectors {
  readonly cases: { case: ScoringVectorCase; expected: ScoringVectorExpectation }[];
}

/**
 * A deterministic pseudo-random source. The fixtures have to be the same numbers on every
 * machine and in every language, so nothing here reaches for `Math.random`.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKATER_POSITIONS = [['C'], ['LW'], ['RW'], ['D'], ['C', 'LW'], ['LW', 'RW'], ['C', 'RW']];

/**
 * A pool with the awkward shapes in it on purpose: fractional lines like the model's, a couple of
 * whole-number lines like last season's, goalies with and without the minutes their ratios are
 * weighed by, and a skater with no shots behind his shooting percentage.
 */
function buildPool(): ScoringVectorPlayer[] {
  const random = seeded(20262027);
  const players: ScoringVectorPlayer[] = [];

  for (let index = 0; index < 60; index++) {
    const id = index + 1;
    const games = Math.round(60 + random() * 22);
    const goals = +(random() * 45 + 2).toFixed(2);
    const shots = index % 17 === 0 ? 0 : Math.round(goals * (6 + random() * 6));
    players.push({
      playerId: id,
      type: 'skater',
      name: `Skater ${id}`,
      positions: SKATER_POSITIONS[index % SKATER_POSITIONS.length],
      stats: {
        scoring: {
          goals,
          assists: +(random() * 55 + 3).toFixed(2),
          points: 0,
          plusMinus: +(random() * 40 - 20).toFixed(1),
          pim: Math.round(random() * 70),
          ppg: +(random() * 12).toFixed(2),
          ppa: +(random() * 20).toFixed(2),
          ppp: 0,
          shg: 0,
          sha: 0,
          shp: 0,
          stpg: 0,
          stpa: 0,
          stp: 0,
          gwg: Math.round(random() * 8),
          hatTricks: +(random() * 2).toFixed(2),
          sog: shots,
          shPct: shots > 0 ? +((goals / shots) * 100).toFixed(2) : +(random() * 14).toFixed(2),
          fw: Math.round(random() * 500),
          fl: Math.round(random() * 500),
          hits: Math.round(random() * 200),
          blocks: Math.round(random() * 150),
          defPoints: 0,
          shifts: Math.round(random() * 1800),
          toi: Math.round(random() * 90000),
        },
        utility: { gp: games, toiPerGame: +(random() * 1200).toFixed(1) },
      },
    });
  }

  for (let index = 0; index < 12; index++) {
    const id = 100 + index;
    // Two goalies are given no minutes at all, so the ratio volumes have to be derived from what
    // the line does say — which is the path an imported or hand-written board takes.
    const games = index < 2 ? Math.round(8 + random() * 8) : Math.round(25 + random() * 35);
    const shotsAgainst = Math.round(games * (26 + random() * 6));
    const savePct = +(0.885 + random() * 0.04).toFixed(3);
    const goalsAgainst = +(shotsAgainst * (1 - savePct)).toFixed(2);
    const wins = Math.round(games * (0.3 + random() * 0.4));
    const losses = Math.max(0, games - wins - Math.round(random() * 4));
    players.push({
      playerId: id,
      type: 'goalie',
      name: `Goalie ${id}`,
      positions: ['G'],
      stats: {
        scoring: {
          gs: games,
          w: wins,
          l: losses,
          otl: Math.max(0, games - wins - losses),
          sho: Math.round(random() * 5),
          sa: index % 5 === 0 ? 0 : shotsAgainst,
          sv: Math.round(shotsAgainst * savePct),
          ga: goalsAgainst,
          gaa: +(goalsAgainst / Math.max(1, games)).toFixed(3),
          svPct: savePct,
          winPct: +(wins / Math.max(1, games)).toFixed(3),
          toi: index % 3 === 0 ? 0 : Math.round(games * 3600),
        },
        utility: { gp: games },
      },
    });
  }

  return players;
}

/**
 * The same pool a month into the season: five more goalies out or in the minors with no games
 * left, and three called up for a game or three. Picked by value, goalies like these took the
 * goalie pool and ran the z-scores to minus thirty.
 */
function withIdleGoalies(pool: ScoringVectorPlayer[]): ScoringVectorPlayer[] {
  const idle = Array.from({ length: 8 }, (_unused, index): ScoringVectorPlayer => {
    const games = Math.max(0, index - 4);
    const shotsAgainst = games * 28;
    const goalsAgainst = +(shotsAgainst * 0.105).toFixed(2);
    const wins = Math.round(games / 2);
    return {
      playerId: 200 + index,
      type: 'goalie',
      name: `Idle goalie ${200 + index}`,
      positions: ['G'],
      stats: {
        scoring: {
          gs: games,
          w: wins,
          l: games - wins,
          otl: 0,
          sho: 0,
          sa: shotsAgainst,
          sv: shotsAgainst - goalsAgainst,
          ga: goalsAgainst,
          gaa: games > 0 ? +(goalsAgainst / games).toFixed(3) : 0,
          svPct: games > 0 ? 0.895 : 0,
          winPct: games > 0 ? +(wins / games).toFixed(3) : 0,
          toi: games * 3600,
        },
        utility: { gp: games },
      },
    };
  });
  return [...pool, ...idle];
}

function picksFor(pool: ScoringVectorPlayer[], teamCount: number, rounds: number) {
  const skaters = pool.filter((player) => player.type === 'skater');
  const goalies = pool.filter((player) => player.type === 'goalie');
  const teams = Array.from({ length: teamCount }, (_team, index) => ({
    teamId: `team-${index + 1}`,
    name: `Team ${index + 1}`,
    mine: index === 0,
    playerIds: [] as number[],
  }));
  // A snake, so the teams are not all handed the same shape of roster.
  let overall = 0;
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 === 0 ? teams : [...teams].reverse();
    for (const team of order) {
      // Every team takes a goalie in the last round, which is what makes the goalie pool matter.
      const player = round === rounds - 1 ? goalies[overall % goalies.length] : skaters[overall];
      team.playerIds.push(player.playerId);
      overall++;
    }
  }
  return teams;
}

const ROSTER_SLOTS: RosterSlots = { c: 1, lw: 1, rw: 1, w: 0, f: 0, d: 1, util: 1, bn: 1, g: 1 };

/** A Yahoo-style lineup with both forward flex slots, where a wing has to take W before F. */
const FLEX_ROSTER_SLOTS: RosterSlots = {
  c: 1,
  lw: 1,
  rw: 0,
  w: 1,
  f: 1,
  d: 1,
  util: 0,
  bn: 1,
  g: 1,
};

/**
 * An ESPN-style lineup with no centre or wing slots at all: forwards start in F, and a defenceman
 * who misses the D slot may start in Util but never in F.
 */
const FORWARDS_ONLY_ROSTER_SLOTS: RosterSlots = {
  c: 0,
  lw: 0,
  rw: 0,
  w: 0,
  f: 2,
  d: 1,
  util: 1,
  bn: 1,
  g: 1,
};

/** The cases both engines are held to. */
export function scoringVectorCases(): ScoringVectorCase[] {
  const pool = buildPool();
  const teams = picksFor(pool, 4, 6);
  const inSeasonPool = withIdleGoalies(pool);
  return [
    {
      name: 'points league',
      league: {
        scoringType: 'points',
        statWeights: {
          goals: 3,
          assists: 2,
          sog: 0.4,
          hits: 0.5,
          blocks: 0.5,
          w: 4,
          sho: 3,
          ga: -1,
        },
        activeScoringColumns: ['goals', 'assists', 'sog', 'hits', 'blocks', 'w', 'sho', 'ga'],
        rosterSlots: ROSTER_SLOTS,
        leagueSize: 4,
        minGoalieGames: 25,
      },
      pool,
      teams,
    },
    {
      name: 'category league',
      league: {
        scoringType: 'category',
        statWeights: {
          goals: 1,
          assists: 1,
          ppp: 1,
          sog: 1,
          hits: 1,
          blocks: 1,
          w: 1,
          gaa: 1,
          svPct: 1,
        },
        activeScoringColumns: [
          'goals',
          'assists',
          'ppp',
          'sog',
          'hits',
          'blocks',
          'w',
          'gaa',
          'svPct',
        ],
        rosterSlots: ROSTER_SLOTS,
        leagueSize: 4,
        minGoalieGames: 25,
      },
      pool,
      teams,
    },
    {
      name: 'wing and forward flex league',
      league: {
        scoringType: 'points',
        statWeights: { goals: 3, assists: 2, sog: 0.4, hits: 0.5, w: 4, ga: -1 },
        activeScoringColumns: ['goals', 'assists', 'sog', 'hits', 'w', 'ga'],
        rosterSlots: FLEX_ROSTER_SLOTS,
        leagueSize: 4,
        minGoalieGames: 25,
      },
      pool,
      teams,
    },
    {
      name: 'forwards-only category league',
      league: {
        scoringType: 'category',
        statWeights: { goals: 1, assists: 1, hits: 1, blocks: 1, w: 1, svPct: 1 },
        activeScoringColumns: ['goals', 'assists', 'hits', 'blocks', 'w', 'svPct'],
        rosterSlots: FORWARDS_ONLY_ROSTER_SLOTS,
        leagueSize: 4,
        minGoalieGames: 25,
      },
      pool,
      teams,
    },
    {
      name: 'category league with idle goalies',
      league: {
        scoringType: 'category',
        statWeights: { goals: 1, assists: 1, sog: 1, hits: 1, w: 1, gaa: 1, svPct: 1 },
        activeScoringColumns: ['goals', 'assists', 'sog', 'hits', 'w', 'gaa', 'svPct'],
        rosterSlots: ROSTER_SLOTS,
        leagueSize: 4,
        minGoalieGames: 0,
      },
      pool: inSeasonPool,
      teams: picksFor(inSeasonPool, 4, 6),
    },
  ];
}

function toProjection(player: ScoringVectorPlayer): Projection {
  return {
    playerId: player.playerId,
    type: player.type,
    stats: player.stats,
  } as Projection;
}

/** Scores a case exactly as the app scores a draft board. */
export function runScoringVectorCase(
  testCase: ScoringVectorCase,
  ranking: ProjectionRankingService,
): ScoringVectorExpectation {
  const projections = testCase.pool.map(toProjection);
  const input = {
    projections,
    scoringType: testCase.league.scoringType,
    statWeights: testCase.league.statWeights as StatWeights,
    activeScoringColumns: new Set(testCase.league.activeScoringColumns as ScoringStatKey[]),
    leagueSize: testCase.league.leagueSize,
    rosterSlots: testCase.league.rosterSlots,
    minGoalieGames: testCase.league.minGoalieGames,
    decimalSettings: readableDecimalSettings(projections, DEFAULT_DECIMAL_SETTINGS, true),
  };
  const ranked = ranking.rankOverall(input);
  const contributions = ranking.contributionsByPlayerId(input);
  const isPoints = testCase.league.scoringType === 'points';

  const byId = new Map(testCase.pool.map((player) => [player.playerId, player]));
  const players = new Map<number, LeagueProjectionPlayer>();
  for (const scored of ranked) {
    const player = byId.get(scored.projection.playerId);
    if (!player) {
      continue;
    }
    players.set(player.playerId, {
      name: player.name,
      score: isPoints ? scored.score.fantasyPoints : scored.score.zScore,
      projection: scored.projection,
      positions: player.positions,
      contributions: contributions.get(player.playerId) ?? {},
    });
  }

  const teamInputs: LeagueProjectionTeamInput[] = testCase.teams.map((team) => ({
    id: team.teamId,
    name: team.name,
    mine: team.mine,
    playerIds: team.playerIds,
  }));
  const data = buildLeagueProjection(
    teamInputs,
    players,
    testCase.league.activeScoringColumns as ScoringStatKey[],
    testCase.league.rosterSlots,
    testCase.league.scoringType,
    testCase.league.statWeights,
  );

  return {
    categoryKeys: data.categoryColumns.map((column) => column.key),
    positionKeys: data.positionColumns.map((column) => column.key),
    teams: data.teams.map((team) => ({
      teamId: team.teamId,
      total: team.total,
      values: team.values,
      roster: team.roster.map((row) => ({
        name: row.name,
        total: row.total,
        values: row.values,
        contributions: row.contributions,
      })),
      positionPlayers: team.positionPlayers,
    })),
  };
}
