import { TestBed } from '@angular/core/testing';
import { MockBuilder } from 'ng-mocks';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from '../api/api';
import { playerScoutMyTeam } from '../api/fn/player-scout/player-scout-my-team';
import { playerScoutPlayers } from '../api/fn/player-scout/player-scout-players';
import { PlayerScoutListResponse } from '../api/models/player-scout-list-response';
import { Projection } from '../models/projection.model';
import { PlayerScoutService } from './player-scout.service';

/** A line's stats by key, whichever kind of player it is. */
const scoring = (line: Projection | null | undefined) =>
  line?.stats.scoring as Record<string, number> | undefined;

const ANSWER: PlayerScoutListResponse = {
  season: 2026,
  modelVersion: 'marcel-v118',
  inSeason: true,
  since: {
    requested: '2026-10-07',
    kind: 'SNAPSHOT',
    resolved: '2026-10-07',
    earliestSnapshot: '2026-10-01',
  },
  players: [
    {
      playerId: '1001',
      nhlId: 8476875,
      name: 'Brandon Montour',
      teamAbbrev: 'Sea',
      type: 'skater',
      positions: ['D'],
      availability: 'WAIVERS',
      gamesRemaining: 78,
      now: { games: 70, stats: { points: 48.5, ppp: 19, toiPerGame: 1380 } },
      then: { games: 74.3, stats: { points: 27.9, toiPerGame: 1050 } },
      usage: {
        recent: { games: 4, toiPerGame: 1380, ppShare: 0.85 },
        baseline: { games: 6, toiPerGame: 1050, ppShare: 0.2 },
        baselineSource: 'SEASON',
      },
    },
    {
      playerId: '6743',
      nhlId: 8480069,
      name: 'Cale Makar',
      teamAbbrev: 'Col',
      type: 'skater',
      positions: ['D'],
      owner: { teamName: 'Slapshots', mine: true },
      slot: 'D',
      injuryStatus: 'DTD',
      gamesRemaining: 76,
      now: { games: 74, stats: { points: 90 } },
    },
    {
      playerId: '1003',
      nhlId: 8477970,
      name: 'Spencer Knight',
      type: 'goalie',
      positions: ['G'],
      availability: 'FREE_AGENT',
      gamesRemaining: 78,
      now: { games: 50, stats: { gs: 50, w: 24, svPct: 0.905 } },
    },
  ],
};

describe('PlayerScoutService', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(ANSWER);
    return MockBuilder(PlayerScoutService).mock(Api, { invoke });
  });

  const read = (since: string | null = '2026-10-07') =>
    firstValueFrom(TestBed.inject(PlayerScoutService).players('YAHOO', '465.l.9', { since }));

  it("asks the BFF for the league's players since a day, or the preseason for none", async () => {
    await read();
    await read(null);

    expect(invoke).toHaveBeenNthCalledWith(1, playerScoutPlayers, {
      platform: 'YAHOO',
      leagueId: '465.l.9',
      since: '2026-10-07',
    });
    expect(invoke).toHaveBeenNthCalledWith(2, playerScoutPlayers, {
      platform: 'YAHOO',
      leagueId: '465.l.9',
      since: undefined,
    });
  });

  it('shapes the rest of the season as a complete line the ranking engine can score', async () => {
    const montour = (await read()).players[0];

    expect(montour.freeAgent.projection.type).toBe('skater');
    expect(montour.freeAgent.projection.playerId).toBe(1001);
    expect(montour.nhlId).toBe(8476875);
    expect(scoring(montour.freeAgent.projection)?.['points']).toBe(48.5);
    // A stat the line does not carry is a zero for the engine, and not a projected one.
    expect(scoring(montour.freeAgent.projection)?.['goals']).toBe(0);
    expect(montour.freeAgent.projected.has('goals')).toBe(false);
    expect(montour.freeAgent.projection.stats.utility).toEqual({ gp: 70, toiPerGame: 1380 });
    expect(montour.freeAgent.expectedGames).toBe(70);
    expect(montour.freeAgent.clubGames).toBe(78);
    expect(montour.freeAgent.availability).toBe('WAIVERS');
    expect(montour.owner).toBeNull();
  });

  it("keeps the day's line over the whole games its own round to, and what it projected", async () => {
    const montour = (await read()).players[0];

    expect(montour.then?.stats.utility.gp).toBe(74);
    expect(scoring(montour.then)?.['points']).toBeCloseTo((27.9 * 74) / 74.3);
    expect((montour.then?.stats.utility as { toiPerGame: number }).toiPerGame).toBe(1050);
    expect(montour.thenProjected.has('points')).toBe(true);
    expect(montour.thenProjected.has('ppp')).toBe(false);
  });

  it('reads who holds a rostered player, and gives him no availability', async () => {
    const makar = (await read()).players[1];

    expect(makar.owner).toEqual({ teamName: 'Slapshots', mine: true });
    expect(makar.slot).toBe('D');
    expect(makar.injuryStatus).toBe('DTD');
    expect(makar.freeAgent.availability).toBe('UNKNOWN');
    expect(makar.then).toBeNull();
  });

  it('shapes a goalie over his starts', async () => {
    const knight = (await read()).players[2];

    expect(knight.type).toBe('goalie');
    expect(knight.freeAgent.projection.type).toBe('goalie');
    expect(scoring(knight.freeAgent.projection)?.['w']).toBe(24);
  });

  it('passes on whether the season is under way and what answered the day', async () => {
    const list = await read();

    expect(list.inSeason).toBe(true);
    expect(list.since.kind).toBe('SNAPSHOT');
    expect(list.since.resolved).toBe('2026-10-07');
  });

  it("reads the user's team with each player's line, and every club's nights by the NHL's spelling", async () => {
    invoke.mockResolvedValue({
      found: true,
      teamName: 'Slapshots',
      players: [
        {
          playerId: '6743',
          name: 'Cale Makar',
          type: 'skater',
          positions: ['D'],
          slot: 'D',
          reserve: false,
          out: false,
          reserveEligible: [],
          restOfSeason: { games: 73.6, stats: { points: 92 } },
        },
        {
          playerId: '6744',
          name: 'Unknown Prospect',
          type: 'skater',
          positions: ['LW'],
          slot: 'NA',
          reserve: true,
          out: true,
          reserveEligible: ['IR'],
        },
      ],
      schedule: [
        {
          team: 'COL',
          dates: ['2026-10-15', '2026-10-17'],
          games: [
            { date: '2026-10-15', opponent: 'TBL', home: true },
            { date: '2026-10-17', opponent: 'SEA', home: false },
          ],
        },
        {
          team: 'TB',
          dates: ['2026-10-16'],
          games: [{ date: '2026-10-16', opponent: 'COL', home: false }],
        },
      ],
      opponentWorth: [
        { opponent: 'TBL', home: true, statWorth: { points: 1.08 }, plusMinusPerMinute: 0.002 },
        { opponent: 'COL', home: true, statWorth: { points: 0.9 }, plusMinusPerMinute: -0.003 },
      ],
    });

    const answer = await firstValueFrom(
      TestBed.inject(PlayerScoutService).myTeam('YAHOO', '465.l.9'),
    );

    expect(invoke).toHaveBeenCalledWith(playerScoutMyTeam, {
      platform: 'YAHOO',
      leagueId: '465.l.9',
    });
    expect(answer.team.teamName).toBe('Slapshots');
    expect(answer.team.players[0].projection?.playerId).toBe(6743);
    // His own line is on whole games too, so a pickup is weighed against him on one footing.
    expect(answer.team.players[0].projection?.stats.utility.gp).toBe(74);
    expect(scoring(answer.team.players[0].projection)?.['points']).toBeCloseTo((92 * 74) / 73.6);
    expect(answer.team.players[1]).toMatchObject({
      slot: 'NA',
      reserve: true,
      out: true,
      reserveEligible: ['IR'],
      projection: null,
    });
    expect(answer.schedule.get('COL')).toEqual(['2026-10-15', '2026-10-17']);
    // A platform's spelling of a club is folded to the NHL's.
    expect(answer.schedule.get('TBL')).toEqual(['2026-10-16']);
    // Each night's worth is its opponent's at its venue: at home to Tampa Bay, and nothing known
    // of a night in Seattle or of Tampa Bay's road game, which the lineup reads as average.
    expect(answer.worth.get('COL')?.get('2026-10-15')).toEqual({
      stat: { points: 1.08 },
      plusMinusPerMinute: 0.002,
    });
    expect(answer.worth.get('COL')?.has('2026-10-17')).toBe(false);
    expect(answer.worth.get('TBL')?.size).toBe(0);
  });
});
