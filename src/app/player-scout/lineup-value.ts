import { RosterSlots } from '../api/models/roster-slots';
import { nhlTeamKey } from '../models/nhl-team';
import { Projection } from '../models/projection.model';
import { ScoreUnits } from '../services/projection-ranking.service';
import { NightWorth, TeamPlayer } from '../services/player-scout.service';
import { lineupSeats, Seat, seating } from '../streamer-planner/planner-lineup';

/**
 * What one of the user's players is worth to the lineup over the rest of the season.
 *
 * <p>A player scores only on the nights he starts, and he starts only when a seat he fits is not
 * better filled: a third centre on a roster with two centre seats plays the nights the two ahead
 * of him are off, however many points he would score on the bench. So a player's worth to the
 * team is not his projection but the share of it the lineup lets through, and the player to drop
 * is the one whose going costs the lineup least, which is seldom the lowest projection.
 *
 * <p>Nor is every night of his worth the same. A game against a club that concedes goals, or at
 * home, is worth more of a scorer's line than one in a stingy rink on the road, and the model says
 * by how much, stat by stat ({@link NightWeights}). So the lineup is set on each night's own worth:
 * of two near-equal defencemen the one facing the softer opponent starts, and the better of the
 * two no longer takes every night they share.
 */
export interface LineupValue {
  readonly playerId: string;
  /** Nights he starts in the lineup over the rest of the season, with the best lineup set each night. */
  readonly starts: number;
  /** Nights his club plays that he could play: those after his return when out, and the club's
   * schedule known. */
  readonly games: number;
  /** His value over the nights he starts: what a game of his is worth on each, summed. */
  readonly value: number;
  /** What the lineup loses without him: the team's value with him less without, which is less
   * than his own value where another player would start in his place. */
  readonly marginal: number;
}

/** The whole roster weighed night by night. */
export interface LineupValuation {
  /** The team's value over the rest of the season: every night's starters' value a game, summed. */
  readonly total: number;
  readonly byPlayer: ReadonlyMap<string, LineupValue>;
}

/**
 * How much of a player's score each stat holds, so a night that moves the stat moves that much of
 * him: in a points league the stat's points, in a category league its z-score counted from nothing
 * (his count over the pool's spread). From nothing, because a night moves what he puts up, and the
 * pool's average, which the z-score he is ranked by is counted from, is no part of that.
 */
export interface StatShares {
  /** Per stat key, the part of his score over the rest of the season that stat holds. */
  readonly byStat: Readonly<Record<string, number>>;
  /**
   * What a plus-minus a minute of his ice adds to his score over the rest of the season:
   * plus-minus moves by an amount, so this is his score per unit of it times his games and minutes.
   */
  readonly plusMinus: number;
}

/**
 * The worth of each club's nights, and how much of each player they move. A player whose shares
 * are not known, or whose club's nights are not, counts every night alike.
 */
export interface NightWeights {
  /** Every club's nights, by club in the NHL's spelling ({@link nhlTeamKey}), then by date. */
  readonly worth: ReadonlyMap<string, ReadonlyMap<string, NightWorth>>;
  readonly shares: (playerId: string) => StatShares | null;
}

/**
 * How much of a line's score each stat holds, from what one more of each adds to a score: his count
 * times its unit, and for plus-minus, which moves by an amount a minute of his ice, its unit times
 * his games and minutes a game.
 */
export function statShares(line: Projection, units: ScoreUnits): StatShares {
  const unitOf: Readonly<Record<string, number>> =
    line.type === 'skater' ? units.skater : units.goalie;
  const scoring = line.stats.scoring as Record<string, number>;
  const utility = line.stats.utility as Record<string, number>;
  const byStat: Record<string, number> = {};
  for (const [key, unit] of Object.entries(unitOf)) {
    if (key !== 'plusMinus') {
      byStat[key] = (scoring[key] ?? 0) * unit;
    }
  }
  const minutes = (utility['toiPerGame'] ?? 0) / 60;
  return { byStat, plusMinus: (unitOf['plusMinus'] ?? 0) * (utility['gp'] ?? 0) * minutes };
}

/** Every night alike, as the lineup was set before a night had a worth. */
export const EVEN_NIGHTS: NightWeights = { worth: new Map(), shares: () => null };

/** A player as a night seats him: where he may sit, what a game of his is worth, when he plays. */
interface Seatable {
  readonly playerId: string;
  readonly positions: readonly string[];
  /** What a game of his is worth on each of his nights. */
  readonly worth: ReadonlyMap<string, number>;
  readonly nights: ReadonlySet<string>;
}

/** A pickup to weigh against the roster: the same, read off a row of the list. */
export interface Pickup {
  readonly playerId: string;
  readonly positions: readonly string[];
  readonly teamAbbrev?: string;
  /** His projection over the rest of the season, scored as the roster is. */
  readonly score: number;
  /** How much of that score each stat holds; left out, his nights count alike. */
  readonly shares?: StatShares;
}

function clubNights(
  teamAbbrev: string | undefined,
  schedule: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
  return new Set(schedule.get(nhlTeamKey(teamAbbrev) ?? '') ?? []);
}

/**
 * The nights a player who is out plays once he is back: the last of his club's nights, as many as
 * the model gives him games. The projection run takes the games he is expected to miss off his
 * season, so its games are the ones after his return; none when the model has no line for him.
 */
function nightsBack(player: TeamPlayer, nights: ReadonlySet<string>): ReadonlySet<string> {
  const games = Math.round(player.projection?.stats.utility.gp ?? 0);
  if (games <= 0) {
    return new Set();
  }
  return new Set([...nights].sort((a, b) => a.localeCompare(b)).slice(-games));
}

/**
 * What a game of a player's is worth on each of his nights: his score spread over them, with each
 * stat's part of it moved by the night's worth to the stat over his nights' average worth to it,
 * and plus-minus by the night's amount less his nights' average. So the nights still add up to his
 * score: the opponents the model already saw in his line are not counted twice, only placed on
 * the nights they fall on. Nothing a night for a player with no line, and every night alike for
 * one whose shares or club's nights are not known.
 */
function nightly(
  total: number | null,
  nights: ReadonlySet<string>,
  clubWorth: ReadonlyMap<string, NightWorth> | undefined,
  shares: StatShares | null,
): ReadonlyMap<string, number> {
  const dates = [...nights];
  const games = dates.length;
  const perGame = total === null || games === 0 ? 0 : total / games;
  const worth = dates.map(() => perGame);
  if (total !== null && games > 0 && clubWorth && shares) {
    const on = dates.map((date) => clubWorth.get(date));
    for (const [key, share] of Object.entries(shares.byStat)) {
      const of = on.map((night) => night?.stat[key] ?? 1);
      const average = of.reduce((sum, value) => sum + value, 0) / games;
      if (share !== 0 && average > 0) {
        of.forEach((value, index) => (worth[index] += (share / games) * (value / average - 1)));
      }
    }
    if (shares.plusMinus !== 0) {
      const amounts = on.map((night) => night?.plusMinusPerMinute ?? 0);
      const average = amounts.reduce((sum, value) => sum + value, 0) / games;
      amounts.forEach(
        (value, index) => (worth[index] += (shares.plusMinus / games) * (value - average)),
      );
    }
  }
  return new Map(dates.map((date, index) => [date, worth[index]]));
}

/** What a game of his is worth on the night; nothing on a night he does not play. */
function worthOn(player: Seatable, date: string): number {
  return player.worth.get(date) ?? 0;
}

/**
 * The user's players as the nights seat them. A player who is out, on injured reserve or not,
 * plays the nights after his return and takes a seat from the healthy then; one whose club the
 * schedule does not know plays nowhere; one the model has no line for plays for nothing, and
 * takes a seat only after everyone with a line, as a manager would seat him.
 */
function seatables(
  team: readonly TeamPlayer[],
  schedule: ReadonlyMap<string, readonly string[]>,
  score: (playerId: string) => number | null,
  weights: NightWeights,
): Seatable[] {
  return team
    .filter((player) => player.positions.length > 0)
    .map((player) => {
      const club = clubNights(player.teamAbbrev, schedule);
      const nights = player.out ? nightsBack(player, club) : club;
      return {
        playerId: player.playerId,
        positions: player.positions,
        worth: nightly(
          score(player.playerId),
          nights,
          weights.worth.get(nhlTeamKey(player.teamAbbrev) ?? ''),
          weights.shares(player.playerId),
        ),
        nights,
      };
    });
}

/** The nights any club plays, each once, in order. */
function allNights(schedule: ReadonlyMap<string, readonly string[]>): string[] {
  const nights = new Set<string>();
  for (const dates of schedule.values()) {
    dates.forEach((date) => nights.add(date));
  }
  return [...nights].sort((a, b) => a.localeCompare(b));
}

/**
 * One night's starters: the players with a game, seated best first on what a game of each is
 * worth that night, so when more of a kind play than the lineup seats the best of them that night
 * start. Returns who starts and what they are worth.
 */
function night(
  players: readonly Seatable[],
  date: string,
  seats: readonly Seat[],
): { readonly starters: readonly Seatable[]; readonly value: number } {
  const playing = players
    .filter((player) => player.nights.has(date))
    .sort((a, b) => worthOn(b, date) - worthOn(a, date));
  const starters: Seatable[] = [];
  seating(
    playing.map((player) => player.positions),
    seats,
  ).forEach((seatedTonight, index) => {
    if (seatedTonight) {
      starters.push(playing[index]);
    }
  });
  return { starters, value: starters.reduce((sum, player) => sum + worthOn(player, date), 0) };
}

/**
 * The roster weighed over the rest of the season: each player's starts and value, and what the
 * lineup would lose without him. The marginal is counted only over the nights he plays, since the
 * other nights seat the same lineup with or without him.
 */
export function valueLineup(
  team: readonly TeamPlayer[],
  slots: RosterSlots,
  schedule: ReadonlyMap<string, readonly string[]>,
  score: (playerId: string) => number | null,
  weights: NightWeights = EVEN_NIGHTS,
): LineupValuation {
  const seats = lineupSeats(slots);
  const players = seatables(team, schedule, score, weights);
  const nights = allNights(schedule);
  const starts = new Map<string, number>();
  const values = new Map<string, number>();
  const nightValues = new Map<string, number>();
  let total = 0;
  for (const date of nights) {
    const tonight = night(players, date, seats);
    total += tonight.value;
    nightValues.set(date, tonight.value);
    for (const starter of tonight.starters) {
      starts.set(starter.playerId, (starts.get(starter.playerId) ?? 0) + 1);
      values.set(starter.playerId, (values.get(starter.playerId) ?? 0) + worthOn(starter, date));
    }
  }
  const byPlayer = new Map<string, LineupValue>();
  for (const player of players) {
    const others = players.filter((other) => other !== player);
    let lost = 0;
    for (const date of player.nights) {
      if (nightValues.has(date)) {
        lost += (nightValues.get(date) ?? 0) - night(others, date, seats).value;
      }
    }
    byPlayer.set(player.playerId, {
      playerId: player.playerId,
      starts: starts.get(player.playerId) ?? 0,
      games: player.nights.size,
      value: values.get(player.playerId) ?? 0,
      marginal: lost,
    });
  }
  for (const player of team) {
    if (!byPlayer.has(player.playerId)) {
      byPlayer.set(player.playerId, {
        playerId: player.playerId,
        starts: 0,
        games: 0,
        value: 0,
        marginal: 0,
      });
    }
  }
  return { total, byPlayer };
}

/** A pickup's worth against one drop, priced over the nights either of them plays. */
export interface DropPricing {
  /**
   * What the lineup gains over the rest of the season by picking him up with the drop gone: the
   * nights he plays with him seated and the drop out, plus the nights only the drop plays with
   * the drop out, each less the lineup as it stands. Null when his club has no night in the
   * schedule, since a player who plays nowhere by our reckoning is not worth nought.
   */
  gainFor(pickup: Pickup): number | null;
}

/**
 * The lineup with one of the user's players dropped, ready to price every pickup against. The
 * drop is the page's choice, not the model's: the lineup without him is set once for every
 * night he plays, and each pickup then costs only the nights he plays himself. A drop who is out
 * costs only the nights he plays once back.
 */
export function priceDrop(
  drop: TeamPlayer,
  team: readonly TeamPlayer[],
  slots: RosterSlots,
  schedule: ReadonlyMap<string, readonly string[]>,
  score: (playerId: string) => number | null,
  weights: NightWeights = EVEN_NIGHTS,
): DropPricing {
  const seats = lineupSeats(slots);
  const players = seatables(team, schedule, score, weights);
  const without = players.filter((player) => player.playerId !== drop.playerId);
  const dropped = players.find((player) => player.playerId === drop.playerId);
  const base = new Map<string, number>();
  const asItStands = (date: string): number => {
    let value = base.get(date);
    if (value === undefined) {
      value = night(players, date, seats).value;
      base.set(date, value);
    }
    return value;
  };
  // The nights only the drop plays lose what his seat was worth, the same for every pickup.
  const dropNights = dropped?.nights ?? new Set<string>();
  const lostWithout = new Map<string, number>();
  for (const date of dropNights) {
    lostWithout.set(date, night(without, date, seats).value - asItStands(date));
  }
  return {
    gainFor(pickup: Pickup): number | null {
      const nights = clubNights(pickup.teamAbbrev, schedule);
      if (nights.size === 0) {
        return null;
      }
      const added: Seatable = {
        playerId: pickup.playerId,
        positions: pickup.positions,
        worth: nightly(
          pickup.score,
          nights,
          weights.worth.get(nhlTeamKey(pickup.teamAbbrev) ?? ''),
          pickup.shares ?? null,
        ),
        nights,
      };
      let gain = 0;
      for (const date of nights) {
        gain += night([...without, added], date, seats).value - asItStands(date);
      }
      for (const [date, lost] of lostWithout) {
        if (!nights.has(date)) {
          gain += lost;
        }
      }
      return gain;
    },
  };
}
