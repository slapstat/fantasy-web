import { RosterSlots } from '../api/models/roster-slots';

/**
 * What a player is worth to a league that has to start a lineup, rather than in points alone: his
 * value over the best player at his position that nobody in the league would start. The web's
 * copy of fantasy-bff's `scoring.ReplacementLevel`, which Draft Analysis ranks by, so a player
 * reads the same on both pages; a change to one is a change to the other.
 *
 * <p>A league that starts four defencemen a team cannot roster only the forwards who score the
 * most: it has to fill those spots, and the tenth-best defenceman is a starter whose replacement
 * off the wire is far weaker than a forward's. Ranked on value over replacement, the defenceman
 * who scores as much as a winger comes first.
 *
 * <p>The replacement level is read off the league itself. Every starting spot in the league (the
 * spots a team starts, times the teams) is filled from the pool best value first: a player takes
 * a spot at one of his own positions while there is one, the one with the most room left, and
 * otherwise a flex spot he fits, the wing flex before the forward flex before Util. Once every
 * spot is taken, a position's replacement level is the value of the best player eligible there
 * who did not get one. A player who plays several positions is measured at the one whose
 * replacement is weakest, which is where he is worth the most. The bench is left out: it is
 * filled from the same leftovers, and the replacement level is what the lineup is measured
 * against.
 */
const POSITIONS = ['C', 'LW', 'RW', 'D', 'G'] as const;

export type ReplacementPosition = (typeof POSITIONS)[number];

/** One player, valued for a league. */
export interface Valued {
  /** The value he was given, under the league's scoring. */
  readonly value: number;
  /** That value less his position's replacement level. */
  readonly overReplacement: number;
  /** The position he is measured at: of his own, the one whose replacement is weakest. */
  readonly position: ReplacementPosition;
  /** Where he ranks by value among the players at that position, as the position and the number: `D1`. */
  readonly positionRank: string;
}

type Room = Record<ReplacementPosition | 'W' | 'F' | 'UTIL', number>;

/**
 * Values a pool for a league.
 *
 * @param values each player's value under the league's scoring, by player id
 * @param positions each player's eligible positions, C/LW/RW/D for a skater and G for a goalie; a
 *     player with none is left out
 * @param slots what one team starts
 * @param teams how many teams the league has
 * @returns each player's value over his replacement, by player id
 */
export function valueOverReplacement(
  values: ReadonlyMap<number, number>,
  positions: ReadonlyMap<number, readonly string[]>,
  slots: RosterSlots,
  teams: number,
): Map<number, Valued> {
  const ranked = [...values]
    .filter(([id, value]) => Number.isFinite(value) && eligible(positions.get(id)).length > 0)
    .sort(([firstId, first], [secondId, second]) => second - first || firstId - secondId)
    .map(([id]) => id);

  const replacement = replacementLevels(ranked, values, positions, slots, Math.max(1, teams));

  const seenAt = new Map<ReplacementPosition, number>();
  const valued = new Map<number, Valued>();
  for (const id of ranked) {
    const own = eligible(positions.get(id));
    // Ranked holds only players with a position, so own[0] is there; a tie keeps the earlier.
    const position = own.reduce(
      (weakest, candidate) => (replacement[candidate] < replacement[weakest] ? candidate : weakest),
      own[0],
    );
    let rank = 0;
    for (const at of own) {
      const seen = (seenAt.get(at) ?? 0) + 1;
      seenAt.set(at, seen);
      if (at === position) {
        rank = seen;
      }
    }
    const value = values.get(id) as number;
    valued.set(id, {
      value,
      overReplacement: value - replacement[position],
      position,
      positionRank: `${position}${rank}`,
    });
  }
  return valued;
}

/**
 * Each position's replacement level: the value of the best player eligible there who gets no
 * starting spot once the league's spots are filled. Where every player eligible at a position
 * starts, the weakest of them is the level, and nought where the pool has none at all.
 */
function replacementLevels(
  ranked: readonly number[],
  values: ReadonlyMap<number, number>,
  positions: ReadonlyMap<number, readonly string[]>,
  slots: RosterSlots,
  teams: number,
): Record<ReplacementPosition, number> {
  const room: Room = {
    C: slots.c * teams,
    LW: slots.lw * teams,
    RW: slots.rw * teams,
    D: slots.d * teams,
    G: slots.g * teams,
    W: (slots.w ?? 0) * teams,
    F: (slots.f ?? 0) * teams,
    UTIL: slots.util * teams,
  };
  const best = new Map<ReplacementPosition, number>();
  const weakest = new Map<ReplacementPosition, number>();
  for (const id of ranked) {
    const own = eligible(positions.get(id));
    const value = values.get(id) as number;
    for (const at of own) {
      weakest.set(at, value);
    }
    if (!start(own, room)) {
      for (const at of own) {
        if (!best.has(at)) {
          best.set(at, value);
        }
      }
    }
  }
  return Object.fromEntries(
    POSITIONS.map((position) => [position, best.get(position) ?? weakest.get(position) ?? 0]),
  ) as Record<ReplacementPosition, number>;
}

/** Puts a player in a starting spot if one is left for him; false where none is. */
function start(own: readonly ReplacementPosition[], room: Room): boolean {
  // His own position with the most room left; level on room, the one first in C, LW, RW, D, G.
  let pick: ReplacementPosition | null = null;
  for (const position of own) {
    if (room[position] > 0 && (pick === null || room[position] > room[pick])) {
      pick = position;
    }
  }
  if (pick !== null) {
    room[pick] -= 1;
    return true;
  }
  const goalie = own.includes('G');
  const wing = own.includes('LW') || own.includes('RW');
  const forward = wing || own.includes('C');
  const fits = { W: wing, F: forward, UTIL: !goalie };
  for (const flex of ['W', 'F', 'UTIL'] as const) {
    if (fits[flex] && room[flex] > 0) {
      room[flex] -= 1;
      return true;
    }
  }
  return false;
}

/** His positions among C, LW, RW, D and G, in that order; anything else is not one. */
function eligible(positions: readonly string[] | undefined): ReplacementPosition[] {
  return positions ? POSITIONS.filter((position) => positions.includes(position)) : [];
}
