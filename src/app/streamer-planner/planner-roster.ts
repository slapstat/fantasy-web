import { PlannerMyTeamResponse } from '../api/models/planner-my-team-response';
import { PlannerRosterPlayer } from '../api/models/planner-roster-player';
import { RosterSlots } from '../api/models/roster-slots';
import { TeamSchedule } from '../api/models/team-schedule';
import { nhlTeamKey } from '../models/nhl-team';
import { Projection } from '../models/projection.model';
import {
  GOALIE_SCORING_STAT_KEYS,
  GOALIE_UTILITY_STAT_KEYS,
  SKATER_SCORING_STAT_KEYS,
  SKATER_UTILITY_STAT_KEYS,
} from '../models/stat-key.model';
import {
  FreeAgentSort,
  FreeAgentSortKey,
  LineRow,
  lineShare,
  NO_LINE,
  nextSort,
  scaledProjection,
  sortFreeAgents,
  startsProjection,
  wholeGamesShare,
} from './planner-free-agents';
import { lineupSeats, seating } from './planner-lineup';

/**
 * One of the user's own players the model has a line for, shaped as a free agent is so the same
 * helpers scale and draw his line.
 */
export interface RosterPlayer {
  readonly playerId: string;
  readonly name: string;
  readonly teamAbbrev?: string;
  readonly type: 'skater' | 'goalie';
  readonly positions: readonly string[];
  readonly injuryStatus?: string;
  /** Fills no lineup slot this stretch: on injured reserve, or out injured or suspended. */
  readonly out: boolean;
  /** Games his club plays in the stretch, and the ones he is expected to dress for. */
  readonly clubGames: number;
  readonly expectedGames: number;
  /** The stats the model gave a number for; a zero in any other is the engine's, not his. */
  readonly projected: ReadonlySet<string>;
  /** His line over the whole stretch. */
  readonly projection: Projection;
}

function statsFrom<K extends string>(
  keys: readonly K[],
  stats: Record<string, number>,
): Record<K, number> {
  return keys.reduce((line, key) => ({ ...line, [key]: stats[key] ?? 0 }), {} as Record<K, number>);
}

/**
 * The user's players with the model's line over the stretch, each joined to his line. A player
 * the model has no line for (or whose identity did not match) is left out: his worth over the
 * nights cannot be weighed, though he still takes a spot in the lineup ({@link lineupStarts}).
 */
export function rosterPlayers(team: PlannerMyTeamResponse): RosterPlayer[] {
  const lines = new Map(team.lines.map((line) => [line.playerId, line]));
  return team.players.flatMap((player) => {
    const line = lines.get(player.playerId);
    if (!line) {
      return [];
    }
    const skater = player.type !== 'goalie';
    // The ranking engine keys players by number, as the planner's free agents are keyed.
    const key = Number(player.playerId);
    return [
      {
        playerId: player.playerId,
        name: player.name,
        teamAbbrev: player.teamAbbrev,
        type: skater ? 'skater' : 'goalie',
        positions: player.positions,
        injuryStatus: player.injuryStatus,
        out: player.out,
        clubGames: line.clubGames,
        expectedGames: line.expectedGames,
        projected: new Set(Object.keys(line.stats)),
        projection: {
          type: skater ? 'skater' : 'goalie',
          playerId: Number.isFinite(key) ? key : -1,
          stats: {
            scoring: statsFrom(
              skater ? SKATER_SCORING_STAT_KEYS : GOALIE_SCORING_STAT_KEYS,
              line.stats,
            ),
            utility: {
              ...statsFrom(
                skater ? SKATER_UTILITY_STAT_KEYS : GOALIE_UTILITY_STAT_KEYS,
                line.stats,
              ),
              gp: line.expectedGames,
            },
          },
        } as Projection,
      } satisfies RosterPlayer,
    ];
  });
}

/**
 * The nights each of the user's players starts, with the best lineup set each night: on a night
 * more of his players have a game than the lineup has spots for them, the ones worth the most a
 * game are seated first ({@link seating}), and the rest sit on the bench with their game. A
 * player who is out, or whose club the schedule does not know, starts nowhere. Keyed by the
 * platform's player id; a player who starts nowhere is not in it.
 *
 * @param roster the whole roster, a player the model has no line for included: he takes a spot
 *   too, after everyone with a line
 * @param value what a game of each player is worth, by player id
 */
export function lineupStarts(
  roster: readonly PlannerRosterPlayer[],
  slots: RosterSlots,
  teams: ReadonlyMap<string, TeamSchedule>,
  dates: readonly string[],
  value: (playerId: string) => number,
): ReadonlyMap<string, ReadonlySet<string>> {
  const seats = lineupSeats(slots);
  const active = roster
    .filter((player) => !player.out && player.positions.length > 0)
    .map((player, index) => ({
      playerId: player.playerId,
      positions: player.positions,
      value: value(player.playerId),
      index,
      nights: new Set(
        teams.get(nhlTeamKey(player.teamAbbrev) ?? '')?.schedule.map((game) => game.date) ?? [],
      ),
    }))
    .sort((a, b) => b.value - a.value || a.index - b.index);
  const starts = new Map<string, Set<string>>();
  for (const date of dates) {
    const playing = active.filter((player) => player.nights.has(date));
    seating(
      playing.map((player) => player.positions),
      seats,
    ).forEach((seated, index) => {
      if (seated) {
        const { playerId } = playing[index];
        starts.set(playerId, (starts.get(playerId) ?? new Set()).add(date));
      }
    });
  }
  return starts;
}

/** How a night goes for one of the user's players. */
export type NightStatus = 'start' | 'bench' | 'none';

export interface RosterNight {
  readonly date: string;
  /** Starts in the lineup, sits on the bench with a game, or has no game to play. */
  readonly status: NightStatus;
}

/** One of the user's players over the nights counted, lowest first. */
export interface RosterRow extends LineRow {
  readonly player: RosterPlayer;
  /** His line over the nights he starts. */
  readonly line: Projection;
  /** Its score; nought for a player who starts nowhere. */
  readonly score: number;
  /** His place from the bottom: 1 is the player who gives the least. */
  readonly rank: number;
  /** The games he starts in the user's lineup; for a goalie, the starts he is given on them. */
  readonly games: number;
  /** The games he is expected to play on the nights counted, started or not. */
  readonly clubGames: number;
  /** Each night marked, in order: the counted game days and the nights without a game. */
  readonly nights: readonly RosterNight[];
}

/**
 * The user's players over the nights counted, the one who gives the least first: each with his
 * line over the nights he starts, scaled as a free agent's is to the share of his club's games
 * those nights hold, and scored. A player with games but no start gives nothing, however good
 * his week would have been: he is the one to drop for a streamer.
 *
 * @param starts the nights each player starts ({@link lineupStarts})
 * @param dates the nights to mark, in order: the counted game days and the nights without a game
 * @param score each line's score, in the order the lines are given
 * @param value what a game of each player is worth, which parts players level on the score
 */
export function rosterRows(
  players: readonly RosterPlayer[],
  starts: ReadonlyMap<string, ReadonlySet<string>>,
  teams: ReadonlyMap<string, TeamSchedule>,
  counted: ReadonlySet<string>,
  dates: readonly string[],
  score: (lines: readonly Projection[]) => readonly number[],
  value: (playerId: string) => number,
): RosterRow[] {
  const built = players.map((player) => {
    const club = teams.get(nhlTeamKey(player.teamAbbrev) ?? '');
    const started = starts.get(player.playerId) ?? new Set<string>();
    const dresses = player.clubGames > 0 ? player.expectedGames / player.clubGames : 0;
    const share =
      club && club.schedule.length > 0
        ? lineShare(club, (game) => started.has(game.date), dresses)
        : NO_LINE;
    const countedShare =
      club && club.schedule.length > 0
        ? lineShare(club, (game) => counted.has(game.date), dresses)
        : NO_LINE;
    const games = Math.round(player.expectedGames * share.games);
    const line =
      player.type === 'goalie'
        ? startsProjection(player.projection, player.expectedGames, games, share)
        : scaledProjection(player.projection, wholeGamesShare(share, player.expectedGames));
    const plays = new Set(club?.schedule.map((game) => game.date) ?? []);
    const nights = dates.map((date) => ({
      date,
      status: nightStatus(plays.has(date) && !player.out, started.has(date)),
    }));
    return {
      player,
      line,
      games,
      clubGames: Math.round(player.expectedGames * countedShare.games),
      nights,
    };
  });
  const scores = score(built.map((row) => row.line));
  return built
    .map((row, index) => ({ ...row, score: scores[index] ?? 0 }))
    .sort(
      (a, b) =>
        a.score - b.score ||
        value(a.player.playerId) - value(b.player.playerId) ||
        a.player.name.localeCompare(b.player.name),
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

/** How a night goes: no game, or a game started or sat out. */
function nightStatus(plays: boolean, starts: boolean): NightStatus {
  if (!plays) {
    return 'none';
  }
  return starts ? 'start' : 'bench';
}

// --- The order of the list ----------------------------------------------------------------------

/** A column the roster can be sorted by: the free agents' columns, and the games on the nights. */
export type RosterSortKey = FreeAgentSortKey | 'clubGames';

export interface RosterSort {
  readonly key: RosterSortKey;
  readonly descending: boolean;
}

/** The roster as it comes: the player who gives the least first. */
export const LOWEST_FIRST: RosterSort = { key: 'score', descending: false };

/** As {@link nextSort}: a column sorts best first, and the same column again turns it round. */
export function nextRosterSort(current: RosterSort, key: RosterSortKey): RosterSort {
  if (current.key === key) {
    return { key, descending: !current.descending };
  }
  if (key === 'clubGames') {
    return { key, descending: true };
  }
  return nextSort(current as FreeAgentSort, key);
}

/**
 * The roster in the order asked for; players level on a column keep their lowest-first order.
 * The score is sorted here rather than by the free agents' sort, whose ranked order (the score,
 * best first) is the list as it came: here the list comes lowest first.
 */
export function sortRoster(rows: readonly RosterRow[], sort: RosterSort): readonly RosterRow[] {
  const sign = sort.descending ? -1 : 1;
  switch (sort.key) {
    case 'clubGames':
      return [...rows].sort((a, b) => sign * (a.clubGames - b.clubGames) || a.rank - b.rank);
    case 'score':
      return [...rows].sort((a, b) => sign * (a.score - b.score) || a.rank - b.rank);
    default:
      return sortFreeAgents(rows, sort as FreeAgentSort);
  }
}
