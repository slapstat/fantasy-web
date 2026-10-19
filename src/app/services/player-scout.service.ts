import { inject, Injectable } from '@angular/core';
import { from, map, Observable } from 'rxjs';
import { Api } from '../api/api';
import { playerScoutMyTeam } from '../api/fn/player-scout/player-scout-my-team';
import { playerScoutPlayers } from '../api/fn/player-scout/player-scout-players';
import { PlayerScoutRow } from '../api/models/player-scout-row';
import { PlayerScoutTeamResponse } from '../api/models/player-scout-team-response';
import { ScoutLine } from '../api/models/scout-line';
import { ScoutMyTeamResponse } from '../api/models/scout-my-team-response';
import { ScoutRosterPlayer } from '../api/models/scout-roster-player';
import { ScoutSince } from '../api/models/scout-since';
import { nhlTeamKey } from '../models/nhl-team';
import { Projection } from '../models/projection.model';
import {
  GOALIE_SCORING_STAT_KEYS,
  GOALIE_UTILITY_STAT_KEYS,
  SKATER_SCORING_STAT_KEYS,
  SKATER_UTILITY_STAT_KEYS,
} from '../models/stat-key.model';
import { wholeGamesLine } from '../streamer-planner/planner-free-agents';
import { FreeAgent } from './streamer-planner-free-agents.service';
import { LeaguePlatform } from './league-choice.service';

export type { ScoutSince };

/** The league team holding a player; null for one the league has available. */
export interface ScoutOwner {
  readonly teamName: string;
  readonly mine: boolean;
}

/**
 * One player in the league as Player Scout reads him: his rest of the season today, shaped as the
 * planner's {@link FreeAgent} so the same table helpers draw it, the model's line for him as it
 * stood on the chosen day (already re-spread over the games his club has left, so the two compare
 * stat by stat), and who holds him.
 */
export interface ScoutPlayer {
  /** Today's rest of the season: `projection` is its line, `expectedGames` its games. */
  readonly freeAgent: FreeAgent;
  readonly nhlId: number;
  readonly type: 'skater' | 'goalie';
  readonly owner: ScoutOwner | null;
  /** The slot he sits in on his team, in the platform's spelling; absent for an available player. */
  readonly slot?: string;
  readonly injuryStatus?: string;
  /** His line as it stood on the chosen day, over today's games left; null where the model had none. */
  readonly then: Projection | null;
  /** The stats the chosen day's line gave a number for. */
  readonly thenProjected: ReadonlySet<string>;
}

export interface ScoutList {
  /** False before the season's first game and after its last: there is no rest of it to show. */
  readonly inSeason: boolean;
  /** Which earlier line the then-lines are, and what answered the day asked for. */
  readonly since: ScoutSince;
  readonly players: readonly ScoutPlayer[];
}

/** How the page asks for a league's players: the day to compare with. */
export interface ScoutQuery {
  /** The day to compare the projection with, as an ISO date, or null for the preseason line. */
  readonly since: string | null;
}

/**
 * A player on the user's own team, with the model's rest of the season on the line the league's
 * players carry, so a pickup can be weighed against him.
 */
export interface TeamPlayer {
  readonly playerId: string;
  readonly name: string;
  readonly teamAbbrev?: string;
  readonly type: 'skater' | 'goalie';
  readonly positions: readonly string[];
  readonly injuryStatus?: string;
  /** The slot he sits in today, in the platform's spelling (C, BN, IR, IR+, NA, ...). */
  readonly slot?: string;
  /** On injured reserve or not-active: a slot that takes no roster spot, so dropping him makes none. */
  readonly reserve: boolean;
  /** The injured-reserve slots the platform lets him be moved into today; empty when healthy. */
  readonly reserveEligible: readonly string[];
  /** Fills no lineup slot now: on reserve, or out injured or suspended. Day-to-day is not out. */
  readonly out: boolean;
  /** His rest of the season; null when the model has no line for him. */
  readonly projection: Projection | null;
}

export interface ScoutTeam {
  /** False when no team in the league is the user's: one they only follow, say. */
  readonly found: boolean;
  readonly teamName: string | null;
  readonly players: readonly TeamPlayer[];
}

/** What one of a club's nights is worth to a player's line, against an average night. */
export interface NightWorth {
  /** Per stat key, the night's worth to the stat: 1.1 is 10% more. A stat not listed is average. */
  readonly stat: Readonly<Record<string, number>>;
  /** What the night adds to his plus-minus per minute of his ice, an amount rather than a share. */
  readonly plusMinusPerMinute: number;
}

/** The user's team and every club's remaining nights, keyed by the NHL's spelling of the club. */
export interface ScoutTeamAnswer {
  readonly team: ScoutTeam;
  readonly schedule: ReadonlyMap<string, readonly string[]>;
  /** What each of those nights is worth to a player's line, by club then date. */
  readonly worth: ReadonlyMap<string, ReadonlyMap<string, NightWorth>>;
}

@Injectable({ providedIn: 'root' })
export class PlayerScoutService {
  private readonly api = inject(Api);

  /**
   * Every player in the league the model projects, with its view of him now and on the query's
   * day.
   */
  players(platform: LeaguePlatform, leagueId: string, query: ScoutQuery): Observable<ScoutList> {
    return from(
      this.api.invoke(playerScoutPlayers, {
        platform,
        leagueId,
        since: query.since ?? undefined,
      }),
    ).pipe(
      map((answer) => ({
        inSeason: answer.inSeason,
        since: answer.since,
        players: answer.players.map(toScoutPlayer),
      })),
    );
  }

  myTeam(platform: LeaguePlatform, leagueId: string): Observable<ScoutTeamAnswer> {
    return from(this.api.invoke(playerScoutMyTeam, { platform, leagueId })).pipe(
      map((answer) => ({
        team: toScoutTeam(answer),
        schedule: new Map(
          answer.schedule.flatMap((club) => {
            const key = nhlTeamKey(club.team);
            return key ? [[key, club.dates] as const] : [];
          }),
        ),
        worth: nightWorths(answer),
      })),
    );
  }
}

/**
 * Every club's nights' worth: each game's opponent and venue looked up in what the server rates a
 * game against that opponent at that venue. A game the table has no row for is left out, which
 * the lineup reads as an average night.
 */
export function nightWorths(
  answer: PlayerScoutTeamResponse,
): ReadonlyMap<string, ReadonlyMap<string, NightWorth>> {
  const pairings = new Map(
    answer.opponentWorth.map((row) => [
      pairing(row.opponent, row.home),
      { stat: row.statWorth, plusMinusPerMinute: row.plusMinusPerMinute },
    ]),
  );
  const byClub = new Map<string, ReadonlyMap<string, NightWorth>>();
  for (const club of answer.schedule) {
    const key = nhlTeamKey(club.team);
    if (!key) {
      continue;
    }
    const nights = new Map<string, NightWorth>();
    for (const game of club.games) {
      const worth = game.opponent ? pairings.get(pairing(game.opponent, game.home)) : undefined;
      if (worth) {
        nights.set(game.date, worth);
      }
    }
    byClub.set(key, nights);
  }
  return byClub;
}

function pairing(opponent: string, home: boolean): string {
  return `${opponent}|${home ? 'home' : 'away'}`;
}

/**
 * The user's team as the BFF sends it with the rest of the season, shaped as the scout reads it:
 * Player Scout's own-team answer, and Start/Bench's, which is the same read under its own switch.
 */
export function toScoutTeam(answer: ScoutMyTeamResponse): ScoutTeam {
  return {
    found: answer.found,
    teamName: answer.teamName ?? null,
    players: answer.players.map(toTeamPlayer),
  };
}

/**
 * A stat the line does not carry is zero here rather than absent, because the ranking engine works
 * on complete stat lines. `gp` is the games the line covers.
 */
function statsFrom<K extends string>(
  keys: readonly K[],
  stats: Record<string, number>,
): Record<K, number> {
  return keys.reduce((line, key) => ({ ...line, [key]: stats[key] ?? 0 }), {} as Record<K, number>);
}

/**
 * The line over the whole games its own round to: a player plays a game or does not, so the GP
 * column's 58 is given 58 games' worth, not the 57.6 it rounds from.
 */
function projectionOf(type: 'skater' | 'goalie', playerId: number, line: ScoutLine): Projection {
  const skater = type === 'skater';
  const projection: Projection = {
    type,
    playerId,
    stats: {
      scoring: statsFrom(skater ? SKATER_SCORING_STAT_KEYS : GOALIE_SCORING_STAT_KEYS, line.stats),
      utility: {
        ...statsFrom(skater ? SKATER_UTILITY_STAT_KEYS : GOALIE_UTILITY_STAT_KEYS, line.stats),
        gp: line.games,
      },
    },
  };
  return wholeGamesLine(projection, line.games);
}

/**
 * The ranking engine keys players by number, and the platforms number theirs. A player whose id is
 * not a number is given a key that collides with nothing, as in the planner.
 */
function rankingKey(playerId: string): number {
  const numeric = Number(playerId);
  return Number.isFinite(numeric) ? numeric : -1;
}

function toTeamPlayer(player: ScoutRosterPlayer): TeamPlayer {
  const type = player.type === 'goalie' ? 'goalie' : 'skater';
  return {
    playerId: player.playerId,
    name: player.name,
    teamAbbrev: player.teamAbbrev,
    type,
    positions: player.positions,
    injuryStatus: player.injuryStatus,
    slot: player.slot,
    reserve: player.reserve,
    reserveEligible: player.reserveEligible,
    out: player.out,
    projection: player.restOfSeason
      ? projectionOf(type, rankingKey(player.playerId), player.restOfSeason)
      : null,
  };
}

function toScoutPlayer(row: PlayerScoutRow): ScoutPlayer {
  const type = row.type === 'goalie' ? 'goalie' : 'skater';
  const playerId = rankingKey(row.playerId);
  const games = Math.round(row.now.games);
  return {
    freeAgent: {
      playerId: row.playerId,
      name: row.name,
      teamAbbrev: row.teamAbbrev,
      positions: row.positions,
      availability: row.availability ?? 'UNKNOWN',
      clubGames: row.gamesRemaining,
      expectedGames: games,
      projected: new Set(Object.keys(row.now.stats)),
      projection: projectionOf(type, playerId, row.now),
    },
    nhlId: row.nhlId,
    type,
    owner: row.owner ? { teamName: row.owner.teamName, mine: row.owner.mine } : null,
    slot: row.slot,
    injuryStatus: row.injuryStatus,
    then: row.then ? projectionOf(type, playerId, row.then) : null,
    thenProjected: new Set(row.then ? Object.keys(row.then.stats) : []),
  };
}
