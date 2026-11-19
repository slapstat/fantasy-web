import { RosterSlots } from '../api/models/roster-slots';

/**
 * Every skater slot a team fills, flex and bench included: the size of the skater pool a category
 * z-score is measured against, per team.
 */
export function skaterSlotCount(roster: RosterSlots): number {
  return (
    roster.c + roster.lw + roster.rw + roster.w + roster.f + roster.d + roster.util + roster.bn
  );
}

/**
 * Every player a team holds at once, goalies and bench included. Times the teams in a league,
 * this is how deep a league of this shape rosters, and so the place where a player stops being
 * somebody else's bench and starts being a find.
 *
 * <p>Injured reserve is left out: a spot that can only hold a player who cannot play is not
 * depth the league is choosing players for.
 */
export function rosteredSlotCount(roster: RosterSlots): number {
  return skaterSlotCount(roster) + roster.g;
}

/**
 * Roster slots written before the wing (W) and forward (F) flex slots existed have no such keys,
 * which would make every sum over them NaN. They read as none, as they do on the server.
 */
export function withFlexSlots(
  roster: Omit<RosterSlots, 'w' | 'f'> & Partial<RosterSlots>,
): RosterSlots {
  return { ...roster, w: roster.w ?? 0, f: roster.f ?? 0 };
}
