import { LineupListing } from '../api/models/lineup-listing';
import { PlayerRoleChangeResponse } from '../api/models/player-role-change-response';

/** Which way a role moved: up the lineup, or down it. */
export type RoleDirection = 'rising' | 'falling';

/** What the change is read on: ice a night, or the share of the club's power play. */
export type RoleMeasure = 'ice' | 'powerPlay';

export type RolePosition = 'all' | 'F' | 'D';

/**
 * The smallest change worth a row. Below these a skater's ice swings with one blowout or one
 * penalty-filled night, and a list of everyone who moved by ten seconds hides the few who moved.
 */
export const MIN_ICE_CHANGE_SECONDS = 60;
export const MIN_POWER_PLAY_SHARE_CHANGE = 0.1;

/** A listing before and now, for the page to draw with an arrow between. */
export interface ListingMove {
  from: string;
  to: string;
}

export interface RoleChangeRow {
  player: PlayerRoleChangeResponse;
  /** Seconds a game, recent less baseline. Null without a baseline. */
  iceChange: number | null;
  /** Power-play seconds a game, recent less baseline. Null where either side has no reading. */
  powerPlayIceChange: number | null;
  /** Share of the club's power play, recent less baseline, -1 to 1. */
  powerPlayShareChange: number | null;
  /** The lineup page's even-strength listing before and now, when it moved: L4 to L2. */
  lineMove: ListingMove | null;
  /** The lineup page's power-play listing before and now, when it moved: PP2 to PP1. */
  powerPlayMove: ListingMove | null;
  /** Whether the lineup page moved him up (true), down (false), or neither (null). */
  listedHigher: boolean | null;
}

function difference(recent: number | null | undefined, baseline: number | null | undefined) {
  return recent == null || baseline == null ? null : recent - baseline;
}

/** "L2" for the second forward line, "D1" for the top pair; null for no listing. */
export function lineLabel(listing: LineupListing | undefined | null): string | null {
  const line = listing?.line;
  if (!line) {
    return null;
  }
  return `${line.startsWith('d') ? 'D' : 'L'}${line.slice(1)}`;
}

function powerPlayLabel(listing: LineupListing | undefined | null): string {
  return listing?.powerPlayUnit ? `PP${listing.powerPlayUnit}` : 'No PP';
}

/** Lower is higher in the lineup: line 1 above line 4, PP1 above PP2 above no power play. */
function lineRank(listing: LineupListing): number | null {
  return listing.line ? Number(listing.line.slice(1)) : null;
}

function powerPlayRank(listing: LineupListing): number {
  return listing.powerPlayUnit ?? 3;
}

export function toRoleChangeRow(player: PlayerRoleChangeResponse): RoleChangeRow {
  const { recent, baseline, listedBefore, listedNow } = player;
  let lineMove: ListingMove | null = null;
  let powerPlayMove: ListingMove | null = null;
  let listedHigher: boolean | null = null;
  if (listedBefore && listedNow) {
    const before = lineRank(listedBefore);
    const now = lineRank(listedNow);
    if (before != null && now != null && before !== now) {
      lineMove = { from: lineLabel(listedBefore)!, to: lineLabel(listedNow)! };
      listedHigher = now < before;
    }
    const ppBefore = powerPlayRank(listedBefore);
    const ppNow = powerPlayRank(listedNow);
    if (ppBefore !== ppNow) {
      powerPlayMove = { from: powerPlayLabel(listedBefore), to: powerPlayLabel(listedNow) };
      listedHigher = listedHigher ?? ppNow < ppBefore;
    }
  }
  return {
    player,
    iceChange: difference(recent.toiPerGame, baseline?.toiPerGame),
    powerPlayIceChange: difference(recent.ppToiPerGame, baseline?.ppToiPerGame),
    powerPlayShareChange: difference(recent.ppShare, baseline?.ppShare),
    lineMove,
    powerPlayMove,
    listedHigher,
  };
}

function measured(row: RoleChangeRow, measure: RoleMeasure): number | null {
  return measure === 'ice' ? row.iceChange : row.powerPlayShareChange;
}

function threshold(measure: RoleMeasure): number {
  return measure === 'ice' ? MIN_ICE_CHANGE_SECONDS : MIN_POWER_PLAY_SHARE_CHANGE;
}

export interface RoleChangeFilter {
  direction: RoleDirection;
  measure: RoleMeasure;
  position: RolePosition;
  search: string;
  /** Recent games a skater must have dressed for: one game is one coach's night. */
  minGames: number;
}

/**
 * The skaters whose role moved the chosen way by at least the measure's threshold, biggest move
 * first. A skater with no baseline (a call-up) has nothing to move from, so he is left out.
 */
export function rankRoleChanges(
  players: readonly PlayerRoleChangeResponse[],
  filter: RoleChangeFilter,
): RoleChangeRow[] {
  const sign = filter.direction === 'rising' ? 1 : -1;
  const needle = filter.search.trim().toLowerCase();
  return players
    .filter((player) => filter.position === 'all' || (filter.position === 'D') === player.defence)
    .filter((player) => !needle || player.name.toLowerCase().includes(needle))
    .filter((player) => player.recent.games >= filter.minGames)
    .map(toRoleChangeRow)
    .filter((row) => {
      const change = measured(row, filter.measure);
      return change != null && sign * change >= threshold(filter.measure);
    })
    .sort((a, b) => sign * (measured(b, filter.measure)! - measured(a, filter.measure)!));
}

/** Seconds as m:ss, the way ice time is printed on a game sheet. */
export function formatIce(seconds: number | null | undefined): string {
  if (seconds == null) {
    return '–';
  }
  const whole = Math.round(Math.abs(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return `${seconds < 0 ? '-' : ''}${minutes}:${rest}`;
}

/** A change in ice, signed: "+6:00", "-1:30". */
export function formatIceChange(seconds: number | null): string {
  if (seconds == null) {
    return '–';
  }
  return seconds > 0 ? `+${formatIce(seconds)}` : formatIce(seconds);
}

export function formatShare(share: number | null | undefined): string {
  return share == null ? '–' : `${Math.round(share * 100)}%`;
}

/** A change in share, in percentage points: "+45 pts". */
export function formatShareChange(change: number | null): string {
  if (change == null) {
    return '–';
  }
  const points = Math.round(change * 100);
  return `${points > 0 ? '+' : ''}${points} pts`;
}
