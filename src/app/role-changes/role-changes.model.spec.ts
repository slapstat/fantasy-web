import { describe, expect, it } from 'vitest';
import { PlayerRoleChangeResponse } from '../api/models/player-role-change-response';
import {
  formatIce,
  formatIceChange,
  formatShareChange,
  rankRoleChanges,
  RoleChangeFilter,
  toRoleChangeRow,
} from './role-changes.model';

function skater(
  id: number,
  recent: { toi: number; share?: number },
  baseline: { toi: number; share?: number } | null,
  extra: Partial<PlayerRoleChangeResponse> = {},
): PlayerRoleChangeResponse {
  return {
    playerId: id,
    name: `Player ${id}`,
    teamAbbrev: 'EDM',
    defence: false,
    recent: { games: 5, toiPerGame: recent.toi, ppShare: recent.share },
    baseline: baseline
      ? { games: 70, toiPerGame: baseline.toi, ppShare: baseline.share }
      : undefined,
    baselineSource: baseline ? 'LAST_SEASON' : undefined,
    firstRecentGameDate: '2026-09-29',
    lastRecentGameDate: '2026-10-04',
    ...extra,
  };
}

const RISING_ICE: RoleChangeFilter = {
  direction: 'rising',
  measure: 'ice',
  position: 'all',
  search: '',
  minGames: 2,
};

describe('rankRoleChanges', () => {
  it('lists the biggest gain in ice first and leaves out who barely moved', () => {
    const players = [
      skater(1, { toi: 1000 }, { toi: 900 }),
      skater(2, { toi: 1080 }, { toi: 720 }),
      skater(3, { toi: 930 }, { toi: 900 }),
    ];

    expect(rankRoleChanges(players, RISING_ICE).map((row) => row.player.playerId)).toEqual([2, 1]);
  });

  it('turns the order over for falling and keeps only the losses', () => {
    const players = [
      skater(1, { toi: 1000 }, { toi: 900 }),
      skater(2, { toi: 700 }, { toi: 1100 }),
      skater(3, { toi: 800 }, { toi: 900 }),
    ];

    const falling = rankRoleChanges(players, { ...RISING_ICE, direction: 'falling' });

    expect(falling.map((row) => row.player.playerId)).toEqual([2, 3]);
  });

  it('reads the power play on the share of the club, not the minutes', () => {
    const players = [
      skater(1, { toi: 900, share: 0.7 }, { toi: 900, share: 0.2 }),
      skater(2, { toi: 900, share: 0.3 }, { toi: 900, share: 0.25 }),
    ];

    const rows = rankRoleChanges(players, { ...RISING_ICE, measure: 'powerPlay' });

    expect(rows.map((row) => row.player.playerId)).toEqual([1]);
    expect(rows[0].powerPlayShareChange).toBeCloseTo(0.5);
  });

  it('leaves out a call-up, who has nothing to have moved from', () => {
    expect(rankRoleChanges([skater(1, { toi: 1200 }, null)], RISING_ICE)).toEqual([]);
  });

  it('leaves out a skater with fewer recent games than asked for', () => {
    const oneGame = skater(1, { toi: 1200 }, { toi: 900 });
    oneGame.recent.games = 1;

    expect(rankRoleChanges([oneGame], RISING_ICE)).toEqual([]);
    expect(rankRoleChanges([oneGame], { ...RISING_ICE, minGames: 1 })).toHaveLength(1);
  });

  it('filters by position and by name', () => {
    const players = [
      skater(1, { toi: 1200 }, { toi: 900 }, { defence: true, name: 'Evan Bouchard' }),
      skater(2, { toi: 1200 }, { toi: 900 }, { name: 'Vasily Podkolzin' }),
    ];

    expect(rankRoleChanges(players, { ...RISING_ICE, position: 'D' })).toHaveLength(1);
    expect(rankRoleChanges(players, { ...RISING_ICE, search: 'podk' })[0].player.playerId).toBe(2);
  });
});

describe('toRoleChangeRow', () => {
  it('names a move up the lineup page', () => {
    const row = toRoleChangeRow(
      skater(
        1,
        { toi: 1080 },
        { toi: 720 },
        {
          listedBefore: { seenOn: '2026-09-28', line: 'f4', outOfLineup: false },
          listedNow: { seenOn: '2026-10-04', line: 'f2', powerPlayUnit: 1, outOfLineup: false },
        },
      ),
    );

    expect(row.lineMove).toEqual({ from: 'L4', to: 'L2' });
    expect(row.powerPlayMove).toEqual({ from: 'No PP', to: 'PP1' });
    expect(row.listedHigher).toBe(true);
  });

  it('says nothing where the page did not move him', () => {
    const listing = { seenOn: '2026-10-04', line: 'd1', powerPlayUnit: 1, outOfLineup: false };
    const row = toRoleChangeRow(
      skater(1, { toi: 1080 }, { toi: 720 }, { listedBefore: listing, listedNow: listing }),
    );

    expect(row.lineMove).toBeNull();
    expect(row.powerPlayMove).toBeNull();
    expect(row.listedHigher).toBeNull();
  });
});

describe('formatting', () => {
  it('prints ice the way a game sheet does', () => {
    expect(formatIce(1085)).toBe('18:05');
    expect(formatIce(undefined)).toBe('–');
    expect(formatIceChange(360)).toBe('+6:00');
    expect(formatIceChange(-90)).toBe('-1:30');
  });

  it('prints a share change in percentage points', () => {
    expect(formatShareChange(0.45)).toBe('+45 pts');
    expect(formatShareChange(-0.2)).toBe('-20 pts');
  });
});
