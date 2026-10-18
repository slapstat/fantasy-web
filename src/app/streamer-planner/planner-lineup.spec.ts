import { describe, expect, it } from 'vitest';
import { PlannerRosterPlayer } from '../api/models/planner-roster-player';
import { RosterSlots } from '../api/models/roster-slots';
import { TeamSchedule } from '../api/models/team-schedule';
import {
  dropRooms,
  seating,
  dropRoomTip,
  fitsDrop,
  fitsRoom,
  lineupSeats,
  nightRooms,
  roomLabel,
  roomRuns,
  seated,
} from './planner-lineup';

const NONE: RosterSlots = { c: 0, lw: 0, rw: 0, w: 0, f: 0, d: 0, util: 0, bn: 0, g: 0 };

function slots(partial: Partial<RosterSlots>): RosterSlots {
  return { ...NONE, ...partial };
}

function club(team: string, dates: readonly string[]): TeamSchedule {
  return {
    team,
    games: dates.length,
    offNightGames: 0,
    backToBacks: 0,
    homeGames: 0,
    skaterScore: 0,
    skaterRank: 1,
    goalieScore: 0,
    goalieRank: 1,
    schedule: dates.map((date) => ({
      date,
      opponent: 'BOS',
      home: true,
      offNight: false,
      backToBack: false,
      opponentGoalsAgainst: 1,
      opponentGoalsFor: 1,
      skaterWorth: 1,
      goalieWorth: 1,
      statWorth: {},
      plusMinusPerMinute: 0,
    })),
  };
}

function rostered(
  playerId: string,
  team: string,
  positions: string[],
  out = false,
): PlannerRosterPlayer {
  return {
    playerId,
    name: playerId,
    teamAbbrev: team,
    type: positions.includes('G') ? 'goalie' : 'skater',
    positions,
    out,
  };
}

const MON = '2026-10-12';
const TUE = '2026-10-13';

describe('lineupSeats', () => {
  it('gives each slot its own seat and leaves the bench out', () => {
    const seats = lineupSeats(slots({ c: 2, d: 1, util: 1, bn: 4, g: 1 }));
    expect(seats).toHaveLength(5);
    expect([...seats[4]]).toEqual(['G']);
    expect([...seats[3]]).toEqual(['C', 'LW', 'RW', 'D']);
  });
});

describe('seated', () => {
  it('moves a dual-position player to the seat that leaves room for another', () => {
    // A C/LW listed first must not take the C seat from a pure C behind him.
    const seats = lineupSeats(slots({ c: 1, lw: 1 }));
    expect(seated([['C', 'LW'], ['C']], seats)).toBe(2);
  });

  it('fills the flex seats only with the positions they take', () => {
    const seats = lineupSeats(slots({ w: 1, f: 1 }));
    expect(seated([['D'], ['C'], ['RW']], seats)).toBe(2);
  });
});

describe('seating', () => {
  it('seats the players listed first, and leaves the later ones of a kind standing', () => {
    // Three Cs for two C seats: the third listed is the one without a seat.
    const seats = lineupSeats(slots({ c: 2 }));
    expect(seating([['C'], ['C'], ['C']], seats)).toEqual([true, true, false]);
  });

  it('never unseats a player to seat a later one, but moves him over where he may sit', () => {
    // The C/LW listed first takes the C seat, and is moved to LW for the pure C behind him.
    const seats = lineupSeats(slots({ c: 1, lw: 1 }));
    expect(seating([['C', 'LW'], ['C'], ['C']], seats)).toEqual([true, true, false]);
  });

  it('seats no more of the players a limit counts than it allows, and passes over the rest', () => {
    // Three seats, the second and third listed counted, one of them allowed: the third waits.
    const seats = lineupSeats(slots({ c: 3 }));
    const limit = { counted: [false, true, true, false], most: 1 };
    expect(seating([['C'], ['C'], ['C'], ['C']], seats, limit)).toEqual([true, true, false, true]);
  });
});

describe('nightRooms', () => {
  const teams = new Map([
    ['EDM', club('EDM', [MON, TUE])],
    ['TBL', club('TBL', [MON])],
  ]);

  it('finds the night a D seat is open, even with most of the roster playing', () => {
    const roster = [
      rostered('1', 'EDM', ['C']),
      rostered('2', 'EDM', ['LW', 'RW']),
      rostered('3', 'TB', ['D']),
      rostered('4', 'TB', ['C']),
    ];
    const rooms = nightRooms(roster, slots({ c: 1, lw: 1, d: 2 }), teams, [MON, TUE]);

    const monday = rooms.get(MON)!;
    // Two Cs for one C seat: one sits, and the second D seat stays open.
    expect(monday.playing).toBe(4);
    expect(monday.benched).toBe(1);
    expect(monday.open).toBe(1);
    expect([...monday.fits]).toEqual(['D']);

    const tuesday = rooms.get(TUE)!;
    expect(tuesday.playing).toBe(2);
    expect([...tuesday.fits]).toEqual(['D']);
    expect(tuesday.open).toBe(2);
  });

  it('leaves a player who is out, or on a club without a schedule, off every night', () => {
    const roster = [rostered('1', 'EDM', ['D'], true), rostered('2', 'XYZ', ['D'])];
    const rooms = nightRooms(roster, slots({ d: 1 }), teams, [MON]);
    expect(rooms.get(MON)!.playing).toBe(0);
    expect(rooms.get(MON)!.open).toBe(1);
  });

  it('says a Util seat takes any skater, and a G seat a goalie', () => {
    const rooms = nightRooms([], slots({ util: 1, g: 1 }), teams, [MON]);
    // Every position named outright, rather than "Any skater" for the reader to unpack.
    expect(roomLabel(rooms.get(MON)!)).toBe('C, LW, RW, D, G');
    expect(fitsRoom(['D'], rooms.get(MON))).toBe(true);
    expect(fitsRoom(['G'], rooms.get(MON))).toBe(true);
  });

  it('calls a night with every seat taken full, and a player fits it nowhere', () => {
    const roster = [rostered('1', 'EDM', ['C']), rostered('2', 'EDM', ['C'])];
    const room = nightRooms(roster, slots({ c: 1 }), teams, [MON]).get(MON)!;
    expect(roomLabel(room)).toBe('Full');
    expect(fitsRoom(['C', 'LW'], room)).toBe(false);
    expect(fitsRoom(['C'], undefined)).toBe(false);
  });

  it('names the open seats in lineup order', () => {
    const roster = [rostered('1', 'EDM', ['C'])];
    const room = nightRooms(roster, slots({ c: 2, lw: 1 }), teams, [MON]).get(MON)!;
    expect(roomLabel(room)).toBe('C, LW');
  });
});

describe('dropRooms', () => {
  const teams = new Map([
    ['EDM', club('EDM', [MON, TUE])],
    ['TBL', club('TBL', [MON])],
  ]);
  /** A C, a LW and a RW seat, two D seats and a G seat. */
  const SLOTS = slots({ c: 1, lw: 1, rw: 1, d: 2, g: 1 });

  function named(playerId: string, name: string, team: string, positions: string[]) {
    return { ...rostered(playerId, team, positions), name };
  }

  // Monday the forwards are full and one D seat and the G seat are open.
  const roster = [
    named('1', 'Benson', 'EDM', ['LW']),
    named('2', 'Dual', 'EDM', ['C', 'LW']),
    named('3', 'Wing', 'EDM', ['RW', 'C']),
    named('4', 'Back', 'EDM', ['D']),
  ];

  /** What each kind of drop opens, as "kind: positions", the kinds that open nothing left out. */
  const opens = (room: ReturnType<typeof dropRooms>, date: string) =>
    room
      .get(date)!
      .filter((opening) => opening.opens.length > 0)
      .map((opening) => `${opening.kind}: ${opening.opens.join(', ')}`);

  it('works out what each kind of drop opens, dual-position teammates moved about', () => {
    const rooms = nightRooms(roster, SLOTS, teams, [MON, TUE]);
    expect(roomLabel(rooms.get(MON)!)).toBe('D, G');

    const opened = dropRooms(roster, SLOTS, teams, rooms);

    // Without Benson, Dual can slide to C and Wing to RW or C, so any forward fills his seat.
    // Without Dual, Benson cannot leave LW: only the C or the RW Wing leaves is open. Without
    // Wing, nobody else plays RW. D and G were open already and are nobody's to open, and
    // dropping Back opens nothing new. In lineup order: C/LW, C/RW, LW.
    expect(opens(opened, MON)).toEqual(['C/LW: C, RW', 'C/RW: RW', 'LW: C, LW, RW']);
    // The cell lists the forwards before the night's own D and G, in lineup order. Each forward
    // is opened by different drops, so each is a yellow run of its own, its tip one rule.
    const monday = opened.get(MON)!;
    expect(roomRuns(rooms.get(MON), monday)).toEqual([
      { drop: true, positions: ['C'] },
      { drop: true, positions: ['LW'] },
      { drop: true, positions: ['RW'] },
      { drop: false, positions: ['D', 'G'] },
    ]);
    // Every LW frees the C spot, but not every C: Wing (C/RW) does not, so it is "a LW". Only
    // Benson frees a LW spot, and Dual is a LW too: he is the one exception, named. Every forward
    // frees the RW spot (Back, a D, does not), so it is "any forward". The pill names the spot.
    expect(dropRoomTip(monday, ['C'])).toBe('Drop a LW to free up this spot.');
    expect(dropRoomTip(monday, ['LW'])).toBe('Drop a LW, except Dual, to free up this spot.');
    expect(dropRoomTip(monday, ['RW'])).toBe('Drop any forward to free up this spot.');
  });

  it("says a player fits a night through a drop only where the lineup's own room does not take him", () => {
    const rooms = nightRooms(roster, SLOTS, teams, [MON]);
    const monday = dropRooms(roster, SLOTS, teams, rooms).get(MON);

    // The forwards are full, and a drop opens each of them.
    expect(fitsDrop(['C'], rooms.get(MON), monday)).toBe(true);
    expect(fitsDrop(['RW'], rooms.get(MON), monday)).toBe(true);
    // A D seat is open as it stands: that is the night's own room, not a drop's.
    expect(fitsDrop(['C', 'D'], rooms.get(MON), monday)).toBe(false);
    expect(fitsDrop(['D'], rooms.get(MON), monday)).toBe(false);
    // A night no drop opens anything on gives nobody a game.
    expect(fitsDrop(['C'], rooms.get(MON), undefined)).toBe(false);
  });

  it("keeps lineup order however own room and a drop's alternate, and lists a full night's drop room alone", () => {
    const room = {
      date: MON,
      playing: 10,
      open: 2,
      benched: 0,
      fits: new Set(['C', 'RW'] as const),
    };
    const benson = [{ kind: 'LW', names: ['Benson'], opens: ['LW', 'G'] as const }];

    expect(roomRuns(room, benson)).toEqual([
      { drop: false, positions: ['C'] },
      { drop: true, positions: ['LW'] },
      { drop: false, positions: ['RW'] },
      { drop: true, positions: ['G'] },
    ]);
    const full = { ...room, open: 0, fits: new Set<never>() };
    expect(roomRuns(full, [{ kind: 'D', names: ['Back'], opens: ['D'] }])).toEqual([
      { drop: true, positions: ['D'] },
    ]);
    expect(roomRuns(full, undefined)).toEqual([]);
    // Positions the same drops open share a run and its one rule.
    const centre = [{ kind: 'C', names: ['Centre'], opens: ['C', 'LW'] as const }];
    expect(roomRuns(full, centre)).toEqual([{ drop: true, positions: ['C', 'LW'] }]);
    // Every forward is a C: "a C" says it in fewer words than "any forward".
    expect(dropRoomTip(centre, ['C', 'LW'])).toBe('Drop a C to free up this spot.');
  });

  it('says a drop as plainly as it holds, naming only the exceptions', () => {
    // The 2026-10-06 screenshot's night: every C, C/LW, LW and LW/RW frees the C spot and a
    // plain RW does not, so "a C or LW" says it whole. The wing spots take a LW, but not the
    // C/LW: "a LW", with him the one exception, beats a list of kinds.
    const night = [
      { kind: 'C', names: ['Joel Eriksson Ek'], opens: ['C'] as const },
      { kind: 'C/LW', names: ['Brady Tkachuk'], opens: ['C'] as const },
      { kind: 'LW', names: ['Zach Benson', 'Filip Forsberg'], opens: ['C', 'LW', 'RW'] as const },
      { kind: 'LW/RW', names: ['Will Cuylle'], opens: ['C', 'LW', 'RW'] as const },
      { kind: 'RW', names: ['Plain Wing'], opens: [] as const },
      { kind: 'D', names: ['Back'], opens: [] as const },
    ];
    expect(dropRoomTip(night, ['C'])).toBe('Drop a C or LW to free up this spot.');
    expect(dropRoomTip(night, ['LW', 'RW'])).toBe(
      'Drop a LW, except Brady Tkachuk, to free up this spot.',
    );
    // Every skater frees the Util: "any skater", a defenceman among them. Without one it is the
    // same players as "any forward", and said so.
    const util = [
      { kind: 'C', names: ['Centre'], opens: ['C'] as const },
      { kind: 'LW', names: ['Left'], opens: ['C'] as const },
      { kind: 'D', names: ['Back'], opens: ['C'] as const },
      { kind: 'G', names: ['Keeper'], opens: [] as const },
    ];
    expect(dropRoomTip(util, ['C'])).toBe('Drop any skater to free up this spot.');
    expect(dropRoomTip(util.slice(0, 2), ['C'])).toBe('Drop any forward to free up this spot.');
    // No wording leaves out the RW/D who would not do: the fewest words, and him named.
    const hybrid = [...util.slice(0, 3), { kind: 'RW/D', names: ['Hybrid'], opens: [] as const }];
    expect(dropRoomTip(hybrid, ['C'])).toBe(
      'Drop any skater, except Hybrid, to free up this spot.',
    );
    // More than one exception: all named, joined with "and".
    const two = [
      { kind: 'LW', names: ['Left'], opens: ['LW'] as const },
      { kind: 'C/LW', names: ['Dual', 'Other Dual'], opens: [] as const },
    ];
    expect(dropRoomTip(two, ['LW'])).toBe(
      'Drop a LW, except Dual and Other Dual, to free up this spot.',
    );
  });

  it('opens nothing when a teammate on the bench takes the seat', () => {
    const deeper = [...roster, named('5', 'Tampa C', 'TB', ['C'])];
    const rooms = nightRooms(deeper, SLOTS, teams, [MON]);

    // Tampa C sits Monday behind three forwards: Benson's seat or Dual's is his, and dropping
    // him frees none. Only Wing's RW is nobody else's.
    expect(opens(dropRooms(deeper, SLOTS, teams, rooms), MON)).toEqual(['C/RW: RW']);
  });

  it('names the players who do not play that night as exceptions, since their drop frees nothing', () => {
    // Tuesday the two EDM defencemen fill both D seats. Idle's club has no game, Hurt is out:
    // dropping either frees no seat that night, and "Drop a D" alone would say it does.
    const backs = [
      named('1', 'Back', 'EDM', ['D']),
      named('2', 'Other Back', 'EDM', ['D']),
      named('3', 'Idle', 'TBL', ['D']),
      { ...named('4', 'Hurt', 'EDM', ['D']), out: true },
    ];
    const two = slots({ d: 2 });
    const rooms = nightRooms(backs, two, teams, [MON, TUE]);
    const opened = dropRooms(backs, two, teams, rooms);

    expect(opens(opened, TUE)).toEqual(['D: D']);
    expect(opened.get(TUE)).toEqual([
      { kind: 'D', names: ['Back', 'Other Back'], opens: ['D'] },
      { kind: 'D', names: ['Idle', 'Hurt'], opens: [] },
    ]);
    expect(dropRoomTip(opened.get(TUE)!, ['D'])).toBe(
      'Drop a D, except Idle and Hurt, to free up this spot.',
    );
    // Monday Idle plays too, a third D for two seats: whoever goes, the other two fill them.
    expect(opened.get(MON)).toBeUndefined();
  });

  it('has nothing for a night no drop opens anything on', () => {
    // One LW seat, two LWs: whichever goes, the other takes the seat.
    const wings = [named('1', 'Benson', 'EDM', ['LW']), named('2', 'Kane', 'EDM', ['LW'])];
    const one = slots({ lw: 1 });
    const rooms = nightRooms(wings, one, teams, [MON]);
    expect(dropRooms(wings, one, teams, rooms).size).toBe(0);
  });
});
