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
 *
 * <p>A manager who streams holds a spot or two for players picked up for a few nights of good
 * schedule ({@link Streaming}). Such a player is not part of the season's lineup: he is a spot,
 * which seats a free agent who plays then, so an open seat is worth what a streamer would score in
 * it, and a player who plays on a quiet night leaves the busy night's seat to the spot. With no
 * weekly add limit a spot seats a new free agent every night; under one, each add holds its free
 * agent for his club's games until the spot's next add, and a week's adds go where they add most.
 */
export interface LineupValue {
  readonly playerId: string;
  /** Nights he starts in the lineup over the rest of the season, with the best lineup set each
   * night; none for a streamer, who is a spot rather than a seat. */
  readonly starts: number;
  /** Nights his club plays that he could play: those after his return when out, and the club's
   * schedule known. None for a streamer. */
  readonly games: number;
  /** His value over the nights he starts: what a game of his is worth on each, summed. */
  readonly value: number;
  /** What the lineup loses without him: the team's value with him less without, which is less
   * than his own value where another player would start in his place. For a streamer, what his
   * spot fills over the rest of the season. */
  readonly marginal: number;
  /** Held as a streamer: out of the season's lineup, and one streaming spot. */
  readonly streamer: boolean;
}

/** The whole roster weighed night by night. */
export interface LineupValuation {
  /** The team's value over the rest of the season: every night's starters' value a game, the
   * streaming spots' fills among them, summed. */
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

/**
 * Which free agent at a position a streaming spot is counted at on a night: the third best whose
 * club plays. Not the best, since the league's other managers stream too and nobody lands every
 * night's top add; the deeper the pool that night, the better its third best, so a busy night's
 * spot is worth more than a quiet night's.
 */
export const STREAM_RANK = 3;

/**
 * The spots a manager holds for streamers, and the free agents they are filled from. Each player
 * held as a streamer is one spot, and leaves the season's lineup: a spot seats a free agent who
 * plays, at his worth that night, in a seat no better player of the user's takes. A player on
 * injured reserve takes a spot back once he returns, since he needs a roster spot again, and the
 * streaming spot is the one a manager gives up.
 */
export interface Streaming {
  /** The user's players held as streamers, by platform id. */
  readonly streamers: ReadonlySet<string>;
  /** The free agents a spot is filled from, each read as a pickup is. */
  readonly freeAgents: readonly Pickup[];
  /**
   * How many players the league lets a team add in a fantasy week, Monday to Sunday, all its
   * spots together. Left out or null when there is no limit, and a spot then seats a new free
   * agent every night.
   */
  readonly weeklyAdds?: number | null;
}

/** No spot held for streamers: the season's lineup is the whole roster, an open seat worth nothing. */
export const NO_STREAMING: Streaming = { streamers: new Set(), freeAgents: [] };

/** A free agent a spot could seat on a night: where he may sit, and his worth that night. */
interface Fill {
  readonly positions: readonly string[];
  readonly worth: number;
}

/** The streaming spots as the nights seat them. */
interface Streams {
  /** The spots held: one per streamer. */
  readonly held: number;
  /** Each player on injured reserve's first night back, by platform id: he takes a spot then. */
  readonly returns: ReadonlyMap<string, string>;
  /** Each night's fills, best first: per position, the {@link STREAM_RANK}th best and on. */
  readonly fills: ReadonlyMap<string, readonly Fill[]>;
}

const NO_STREAMS: Streams = { held: 0, returns: new Map(), fills: new Map() };

/** The spots a night has: those held, less one for each player back from injured reserve by then. */
function spotsOn(streams: Streams, date: string): number {
  let back = 0;
  for (const night of streams.returns.values()) {
    if (night <= date) {
      back += 1;
    }
  }
  return Math.max(0, streams.held - back);
}

/** The same spots with one player gone, and the spot he would have taken back with him. */
function withoutReturn(streams: Streams, playerId: string): Streams {
  if (streams.held === 0 || !streams.returns.has(playerId)) {
    return streams;
  }
  const returns = new Map(streams.returns);
  returns.delete(playerId);
  return { ...streams, returns };
}

/** The players held as streamers: those marked who hold a roster spot. */
function streamersOf(team: readonly TeamPlayer[], streaming: Streaming): ReadonlySet<string> {
  return new Set(
    team
      .filter((player) => !player.reserve && streaming.streamers.has(player.playerId))
      .map((player) => player.playerId),
  );
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

/** A free agent's worth on one of his nights, as a position's pool ranks him. */
interface Ranked {
  readonly agent: Pickup;
  readonly worth: number;
}

/** A free agent as the nights weigh him: what a game of his is worth on each of his club's. */
interface Weighed {
  readonly agent: Pickup;
  readonly worth: ReadonlyMap<string, number>;
}

/** The last pool weighed, with what it was weighed from, as {@link weighedPools} keeps fills. */
const weighedAgents = new WeakMap<
  Streaming,
  {
    readonly schedule: ReadonlyMap<string, readonly string[]>;
    readonly weights: NightWeights;
    readonly agents: readonly Weighed[];
  }
>();

/** Every free agent in the pool weighed over his club's nights. */
function agentsOf(
  streaming: Streaming,
  schedule: ReadonlyMap<string, readonly string[]>,
  weights: NightWeights,
): readonly Weighed[] {
  const kept = weighedAgents.get(streaming);
  if (kept?.schedule === schedule && kept.weights === weights) {
    return kept.agents;
  }
  const agents = streaming.freeAgents.map((agent) => ({
    agent,
    worth: nightly(
      agent.score,
      clubNights(agent.teamAbbrev, schedule),
      weights.worth.get(nhlTeamKey(agent.teamAbbrev) ?? ''),
      agent.shares ?? null,
    ),
  }));
  weighedAgents.set(streaming, { schedule, weights, agents });
  return agents;
}

/**
 * The last fills worked out for each pool, with what they were worked out from: the roster's
 * valuation and every repricing of the list (a search, a filter) ask for the same ones, and the
 * pool, the schedule and the nights' worth keep their identity until one of them changes.
 */
const weighedPools = new WeakMap<
  Streaming,
  {
    readonly schedule: ReadonlyMap<string, readonly string[]>;
    readonly weights: NightWeights;
    readonly held: number;
    readonly fills: ReadonlyMap<string, readonly Fill[]>;
  }
>();

/**
 * Each night's free agents a spot could seat, best first: at each position the
 * {@link STREAM_RANK}th best whose club plays, the next spot at the one after him, and none worth
 * nothing that night. A free agent picked at two positions is one fill, able to sit at either.
 */
function fillsOf(
  streaming: Streaming,
  held: number,
  schedule: ReadonlyMap<string, readonly string[]>,
  weights: NightWeights,
): ReadonlyMap<string, readonly Fill[]> {
  const kept = weighedPools.get(streaming);
  if (kept?.schedule === schedule && kept.weights === weights && kept.held === held) {
    return kept.fills;
  }
  const byNight = new Map<string, Map<string, Ranked[]>>();
  for (const { agent, worth } of agentsOf(streaming, schedule, weights)) {
    for (const [date, value] of worth) {
      const positions = byNight.get(date) ?? new Map<string, Ranked[]>();
      byNight.set(date, positions);
      for (const position of agent.positions) {
        const pool = positions.get(position);
        if (pool) {
          pool.push({ agent, worth: value });
        } else {
          positions.set(position, [{ agent, worth: value }]);
        }
      }
    }
  }
  const fills = new Map<string, readonly Fill[]>();
  for (const [date, positions] of byNight) {
    const picked = new Map<string, Fill>();
    for (const pool of positions.values()) {
      pool.sort((a, b) => b.worth - a.worth);
      for (const { agent, worth } of pool.slice(STREAM_RANK - 1, STREAM_RANK - 1 + held)) {
        if (worth > 0) {
          picked.set(agent.playerId, { positions: agent.positions, worth });
        }
      }
    }
    const tonight = [...picked.values()];
    tonight.sort((a, b) => b.worth - a.worth);
    fills.set(date, tonight);
  }
  weighedPools.set(streaming, { schedule, weights, held, fills });
  return fills;
}

/**
 * The streaming spots over the rest of the season: as many as the streamers held, and when the
 * players on injured reserve take spots back: on the first of the nights the lineup seats each of
 * them, so a spot is never streamed on a night he plays. With no weekly add limit, each night's
 * fills too; under one, the fills wait for the lineup they are planned around ({@link filled}).
 */
function streams(
  team: readonly TeamPlayer[],
  held: number,
  streaming: Streaming,
  schedule: ReadonlyMap<string, readonly string[]>,
  weights: NightWeights,
): Streams {
  if (held === 0) {
    return NO_STREAMS;
  }
  const returns = new Map<string, string>();
  for (const player of team.filter((member) => member.reserve)) {
    const club = clubNights(player.teamAbbrev, schedule);
    const back = [...(player.out ? nightsBack(player, club) : club)];
    back.sort((a, b) => a.localeCompare(b));
    if (back.length > 0) {
      returns.set(player.playerId, back[0]);
    }
  }
  return {
    held,
    returns,
    fills: limited(streaming) ? new Map() : fillsOf(streaming, held, schedule, weights),
  };
}

/** The same spots, one fewer: the lineup once a streamer's spot holds somebody for the season. */
function oneFewer(streams: Streams): Streams {
  return { ...streams, held: Math.max(0, streams.held - 1) };
}

/** Whether the league caps a week's adds, so a spot cannot take a new free agent every night. */
function limited(streaming: Streaming): boolean {
  return streaming.weeklyAdds !== undefined && streaming.weeklyAdds !== null;
}

/** What a week's adds are planned from, besides the spots and the players they are planned around. */
interface Planning {
  readonly team: readonly TeamPlayer[];
  readonly slots: RosterSlots;
  readonly seats: readonly Seat[];
  readonly schedule: ReadonlyMap<string, readonly string[]>;
  readonly score: (playerId: string) => number | null;
  readonly weights: NightWeights;
  readonly streaming: Streaming;
}

/**
 * The plans made for each pool, with what they were made from, as {@link weighedPools} keeps
 * fills: the roster's valuation and every repricing of the list ask for the same plans, by the
 * spots and the players they are planned around, until the roster or the pool changes.
 */
const plannedPools = new WeakMap<
  Streaming,
  { readonly from: Planning; readonly plans: Map<string, ReadonlyMap<string, readonly Fill[]>> }
>();

/**
 * The spots with their fills for this lineup: as {@link streams} left them with no weekly add
 * limit, and under one, the week's adds planned around these players ({@link planned}).
 */
function filled(streams: Streams, core: readonly Seatable[], planning: Planning): Streams {
  const { streaming, schedule, weights } = planning;
  if (streams.held === 0 || !limited(streaming)) {
    return streams;
  }
  let kept = plannedPools.get(streaming);
  if (
    kept?.from.team !== planning.team ||
    kept.from.slots !== planning.slots ||
    kept.from.schedule !== schedule ||
    kept.from.score !== planning.score ||
    kept.from.weights !== weights
  ) {
    kept = { from: planning, plans: new Map() };
    plannedPools.set(streaming, kept);
  }
  const key = [
    streams.held,
    [...streams.returns].map(([playerId, date]) => `${playerId}@${date}`).join(','),
    core.map((player) => player.playerId).join(','),
  ].join('|');
  let fills = kept.plans.get(key);
  if (!fills) {
    fills = planned(
      streams,
      core,
      planning.seats,
      agentsOf(streaming, schedule, weights),
      Math.max(0, streaming.weeklyAdds ?? 0),
      allNights(schedule),
    );
    kept.plans.set(key, fills);
  }
  return { ...streams, fills };
}

/** The Monday a night's fantasy week starts on. */
function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

/** The nights, in order, split into fantasy weeks, Monday to Sunday. */
function weeksOf(nights: readonly string[]): readonly (readonly string[])[] {
  const weeks = new Map<string, string[]>();
  for (const date of nights) {
    const monday = mondayOf(date);
    const week = weeks.get(monday);
    if (week) {
      week.push(date);
    } else {
      weeks.set(monday, [date]);
    }
  }
  return [...weeks.values()];
}

/** A free agent a spot holds from a night on, until its next add. */
interface Hold {
  readonly from: string;
  /** Nobody, for a spot before its first add. */
  readonly agent: Weighed | null;
  /** Bought with one of the week's adds, rather than kept on from the week before. */
  readonly added: boolean;
}

/** Which of a spot's holds, in order, holds it on the night: the last to start by then. */
function holdOn(holds: readonly Hold[], date: string): number {
  let at = 0;
  while (at + 1 < holds.length && holds[at + 1].from <= date) {
    at += 1;
  }
  return at;
}

/** An add a spot could make: who, from which night, and for which of the week's nights. */
interface Add {
  readonly spot: number;
  /** The hold he would cut short, by its place in the spot's holds. */
  readonly at: number;
  readonly from: string;
  readonly span: readonly string[];
  readonly agent: Weighed;
  /** His own worth over the span: no add can gain the lineup more. */
  readonly bound: number;
}

/**
 * Each night's fills under a weekly add limit. A spot holds one free agent at a time, from the
 * night he is added on until the spot's next add, and he plays his club's games in between; the
 * one a spot holds at a week's end is kept into the next. Who an add brings is the free agent a
 * spot would land for those nights: at a position, of those whose club plays on the night of the
 * add, the {@link STREAM_RANK}th best over the nights he would be held, passing over those the
 * other spots hold, since the league's other managers take the best. The week's adds are spent one
 * at a time, each on the add that raises the lineup's value most, with these players seated best
 * first as every night is: a greedy pick, not the best plan of the week, and set for these players
 * alone, so a pickup or a drop is priced against it rather than a plan made anew.
 */
function planned(
  streams: Streams,
  core: readonly Seatable[],
  seats: readonly Seat[],
  agents: readonly Weighed[],
  adds: number,
  nights: readonly string[],
): ReadonlyMap<string, readonly Fill[]> {
  const positions = [...new Set(agents.flatMap(({ agent }) => agent.positions))];
  const fills = new Map<string, readonly Fill[]>();
  let carried: (Weighed | null)[] = Array.from({ length: streams.held }, () => null);
  for (const week of weeksOf(nights)) {
    const spots = carried.map((agent): Hold[] => [{ from: week[0], agent, added: false }]);
    const holderOn = (spot: number, date: string): Weighed | null =>
      spots[spot][holdOn(spots[spot], date)].agent;
    const tonight = (date: string, spot = -1, agent: Weighed | null = null): Fill[] => {
      const seated: Fill[] = [];
      for (let index = 0; index < Math.min(spots.length, spotsOn(streams, date)); index++) {
        const holder = index === spot ? agent : holderOn(index, date);
        const worth = holder?.worth.get(date) ?? 0;
        if (holder && worth > 0) {
          seated.push({ positions: holder.agent.positions, worth });
        }
      }
      return seated;
    };
    const lineup = (date: string, fill: readonly Fill[]): number =>
      lineupOn(core, date, seats, fill, spotsOn(streams, date)).value;
    const value = new Map(week.map((date) => [date, lineup(date, tonight(date))]));
    const playing = new Map(
      week.map((date) => [date, agents.filter((weighed) => (weighed.worth.get(date) ?? 0) > 0)]),
    );
    const worthOver = (weighed: Weighed, span: readonly string[]): number =>
      span.reduce((sum, date) => sum + (weighed.worth.get(date) ?? 0), 0);
    const ranked = new Map<string, readonly Weighed[]>();
    const landed = (
      position: string,
      span: readonly string[],
      held: ReadonlySet<Weighed>,
    ): Weighed | null => {
      const key = `${position}|${span[0]}|${span.length}`;
      let pool = ranked.get(key);
      if (!pool) {
        pool = (playing.get(span[0]) ?? [])
          .filter(({ agent }) => agent.positions.includes(position))
          .map((weighed) => ({ weighed, over: worthOver(weighed, span) }))
          .sort((a, b) => b.over - a.over)
          .map(({ weighed }) => weighed);
        ranked.set(key, pool);
      }
      let passed = 0;
      for (const weighed of pool) {
        if (held.has(weighed)) {
          continue;
        }
        if (passed < STREAM_RANK - 1) {
          passed += 1;
          continue;
        }
        return weighed;
      }
      return null;
    };
    for (let spent = 0; spent < adds; spent++) {
      const held = new Set<Weighed>();
      for (const holds of spots) {
        for (const { agent } of holds) {
          if (agent) {
            held.add(agent);
          }
        }
      }
      const options: Add[] = [];
      const seen = new Set<string>();
      for (const [spot, holds] of spots.entries()) {
        for (const [index, date] of week.entries()) {
          if (spot >= spotsOn(streams, date)) {
            continue;
          }
          const at = holdOn(holds, date);
          if (holds[at].from === date && holds[at].added) {
            continue;
          }
          const until = at + 1 < holds.length ? week.indexOf(holds[at + 1].from) : week.length;
          const span = week.slice(index, until);
          for (const position of positions) {
            const agent = landed(position, span, held);
            const key = `${spot}|${date}|${agent?.agent.playerId}`;
            if (agent && agent !== holds[at].agent && !seen.has(key)) {
              seen.add(key);
              options.push({ spot, at, from: date, span, agent, bound: worthOver(agent, span) });
            }
          }
        }
      }
      options.sort((a, b) => b.bound - a.bound);
      let best: Add | null = null;
      let most = 1e-9;
      for (const option of options) {
        if (option.bound <= most) {
          break;
        }
        const before = spots[option.spot][option.at].agent;
        let gain = 0;
        for (const date of option.span) {
          if (option.agent.worth.has(date) || before?.worth.has(date)) {
            gain += lineup(date, tonight(date, option.spot, option.agent)) - (value.get(date) ?? 0);
          }
        }
        if (gain > most) {
          best = option;
          most = gain;
        }
      }
      if (!best) {
        break;
      }
      const hold: Hold = { from: best.from, agent: best.agent, added: true };
      const holds = spots[best.spot];
      if (holds[best.at].from === best.from) {
        holds[best.at] = hold;
      } else {
        holds.splice(best.at + 1, 0, hold);
      }
      for (const date of best.span) {
        value.set(date, lineup(date, tonight(date)));
      }
    }
    for (const date of week) {
      fills.set(date, tonight(date));
    }
    carried = spots.map((holds) => holds[holds.length - 1].agent);
  }
  return fills;
}

/**
 * One night's starters: the players with a game, seated best first on what a game of each is
 * worth that night, so when more of a kind play than the lineup seats the best of them that night
 * start. The streaming spots the night has seat free agents among them, best first as well: into
 * a seat nobody of the user's takes, or one taken by a player of his worth less that night, who is
 * then benched. Returns who starts and what the lineup is worth, the spots' fills among it.
 */
function night(
  players: readonly Seatable[],
  date: string,
  seats: readonly Seat[],
  streams: Streams = NO_STREAMS,
): { readonly starters: readonly Seatable[]; readonly value: number } {
  return lineupOn(players, date, seats, streams.fills.get(date) ?? [], spotsOn(streams, date));
}

/** One night's starters as {@link night} sets them, from the night's fills and spots. */
function lineupOn(
  players: readonly Seatable[],
  date: string,
  seats: readonly Seat[],
  fills: readonly Fill[],
  spots: number,
): { readonly starters: readonly Seatable[]; readonly value: number } {
  // The user's own listed ahead of a fill worth the same, as the sort keeps them.
  const order = [
    ...players
      .filter((player) => player.nights.has(date))
      .map((player) => ({ player, positions: player.positions, worth: worthOn(player, date) })),
    ...(spots > 0 ? fills : []).map((fill) => ({
      player: null,
      ...fill,
    })),
  ].sort((a, b) => b.worth - a.worth);
  const starters: Seatable[] = [];
  let value = 0;
  seating(
    order.map((entry) => entry.positions),
    seats,
    { counted: order.map((entry) => entry.player === null), most: spots },
  ).forEach((seatedTonight, index) => {
    if (seatedTonight) {
      const { player, worth } = order[index];
      if (player) {
        starters.push(player);
      }
      value += worth;
    }
  });
  return { starters, value };
}

/**
 * The roster weighed over the rest of the season: each player's starts and value, and what the
 * lineup would lose without him. The marginal is counted only over the nights he plays, since the
 * other nights seat the same lineup with or without him; for a player on injured reserve who would
 * take a streaming spot back, over every night from then, which have the spot without him. A
 * streamer costs what his spot fills: every night with one spot fewer.
 */
export function valueLineup(
  team: readonly TeamPlayer[],
  slots: RosterSlots,
  schedule: ReadonlyMap<string, readonly string[]>,
  score: (playerId: string) => number | null,
  weights: NightWeights = EVEN_NIGHTS,
  streaming: Streaming = NO_STREAMING,
): LineupValuation {
  const seats = lineupSeats(slots);
  const held = streamersOf(team, streaming);
  const players = seatables(team, schedule, score, weights).filter(
    (player) => !held.has(player.playerId),
  );
  const planning: Planning = { team, slots, seats, schedule, score, weights, streaming };
  const pool = streams(team, held.size, streaming, schedule, weights);
  const spots = filled(pool, players, planning);
  const nights = allNights(schedule);
  const starts = new Map<string, number>();
  const values = new Map<string, number>();
  const nightValues = new Map<string, number>();
  let total = 0;
  for (const date of nights) {
    const tonight = night(players, date, seats, spots);
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
    const freed = withoutReturn(pool, player.playerId);
    const after = freed === pool ? spots : filled(freed, others, planning);
    let lost = 0;
    for (const date of after === spots ? player.nights : nights) {
      if (nightValues.has(date)) {
        lost += (nightValues.get(date) ?? 0) - night(others, date, seats, after).value;
      }
    }
    byPlayer.set(player.playerId, {
      playerId: player.playerId,
      starts: starts.get(player.playerId) ?? 0,
      games: player.nights.size,
      value: values.get(player.playerId) ?? 0,
      marginal: lost,
      streamer: false,
    });
  }
  if (held.size > 0) {
    const fewer = filled(oneFewer(pool), players, planning);
    let spot = 0;
    for (const date of nights) {
      spot += (nightValues.get(date) ?? 0) - night(players, date, seats, fewer).value;
    }
    for (const playerId of held) {
      byPlayer.set(playerId, {
        playerId,
        starts: 0,
        games: 0,
        value: 0,
        marginal: spot,
        streamer: true,
      });
    }
  }
  for (const player of team) {
    if (!byPlayer.has(player.playerId)) {
      byPlayer.set(player.playerId, {
        playerId: player.playerId,
        starts: 0,
        games: 0,
        value: 0,
        marginal: 0,
        streamer: false,
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
 *
 * <p>A streamer dropped for a pickup turns his spot into a hold: the lineup keeps its players,
 * gains the pickup and has one spot fewer on every night, so what the swap costs is the spot's
 * season, not the streamer's own projection.
 */
export function priceDrop(
  drop: TeamPlayer,
  team: readonly TeamPlayer[],
  slots: RosterSlots,
  schedule: ReadonlyMap<string, readonly string[]>,
  score: (playerId: string) => number | null,
  weights: NightWeights = EVEN_NIGHTS,
  streaming: Streaming = NO_STREAMING,
): DropPricing {
  const seats = lineupSeats(slots);
  const held = streamersOf(team, streaming);
  const players = seatables(team, schedule, score, weights).filter(
    (player) => !held.has(player.playerId),
  );
  const planning: Planning = { team, slots, seats, schedule, score, weights, streaming };
  const pool = streams(team, held.size, streaming, schedule, weights);
  const spots = filled(pool, players, planning);
  const streamerDropped = held.has(drop.playerId);
  const without = streamerDropped
    ? players
    : players.filter((player) => player.playerId !== drop.playerId);
  const freed = streamerDropped ? oneFewer(pool) : withoutReturn(pool, drop.playerId);
  const after = freed === pool ? spots : filled(freed, without, planning);
  const dropped = players.find((player) => player.playerId === drop.playerId);
  const base = new Map<string, number>();
  const asItStands = (date: string): number => {
    let value = base.get(date);
    if (value === undefined) {
      value = night(players, date, seats, spots).value;
      base.set(date, value);
    }
    return value;
  };
  // The nights only the drop plays lose what his seat was worth, the same for every pickup; with
  // his spot gone, or the spot he would take back from reserve left free, every night changes.
  const dropNights: Iterable<string> =
    after === spots ? (dropped?.nights ?? new Set<string>()) : allNights(schedule);
  const lostWithout = new Map<string, number>();
  for (const date of dropNights) {
    lostWithout.set(date, night(without, date, seats, after).value - asItStands(date));
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
        gain += night([...without, added], date, seats, after).value - asItStands(date);
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
