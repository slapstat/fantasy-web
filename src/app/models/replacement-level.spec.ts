import { beforeEach, describe, expect, it } from 'vitest';
import { RosterSlots } from '../api/models/roster-slots';
import { valueOverReplacement } from './replacement-level';

// The cases of fantasy-bff's ReplacementLevelTest, so the two copies are held to one answer.
describe('valueOverReplacement', () => {
  let values: Map<number, number>;
  let positions: Map<number, string[]>;

  beforeEach(() => {
    values = new Map();
    positions = new Map();
  });

  function player(id: number, value: number, ...at: string[]): void {
    values.set(id, value);
    positions.set(id, at);
  }

  function slots(
    c: number,
    lw: number,
    rw: number,
    d: number,
    util: number,
    g: number,
  ): RosterSlots {
    return { c, lw, rw, w: 0, f: 0, d, util, bn: 0, g };
  }

  it('ranks the best defenceman with the best forwards in a league that starts more defencemen', () => {
    player(1, 100, 'C');
    player(2, 90, 'C');
    player(3, 80, 'C');
    player(11, 50, 'D');
    player(12, 45, 'D');
    player(13, 40, 'D');
    player(14, 35, 'D');
    player(15, 30, 'D');

    const valued = valueOverReplacement(values, positions, slots(1, 0, 0, 2, 0, 0), 2);

    expect(valued.get(1)?.overReplacement).toBeCloseTo(20, 9);
    expect(valued.get(2)?.overReplacement).toBeCloseTo(10, 9);
    // Half the points, but twice the second centre over his replacement.
    expect(valued.get(11)?.overReplacement).toBeCloseTo(20, 9);
    expect(valued.get(12)!.overReplacement).toBeGreaterThan(valued.get(2)!.overReplacement);
    expect(valued.get(11)?.value).toBe(50);
    expect(valued.get(11)?.positionRank).toBe('D1');
    expect(valued.get(13)?.positionRank).toBe('D3');
  });

  it('fills Util from the best leftovers, so it deepens the forwards', () => {
    player(1, 100, 'C');
    player(2, 90, 'C');
    player(3, 30, 'C');
    player(11, 50, 'D');
    player(12, 40, 'D');

    const valued = valueOverReplacement(values, positions, slots(1, 0, 0, 1, 1, 0), 1);

    // The second centre starts at Util, so the third replaces.
    expect(valued.get(2)?.overReplacement).toBeCloseTo(60, 9);
    expect(valued.get(11)?.overReplacement).toBeCloseTo(10, 9);
  });

  it('measures a player of two positions where his replacement is weakest', () => {
    player(1, 100, 'C');
    player(2, 95, 'C');
    player(3, 90, 'C');
    player(21, 80, 'LW');
    player(22, 40, 'LW');
    player(30, 85, 'C', 'LW');

    const valued = valueOverReplacement(values, positions, slots(1, 1, 0, 0, 0, 0), 2);

    expect(valued.get(30)?.positionRank).toBe('LW1');
    expect(valued.get(30)?.position).toBe('LW');
    expect(valued.get(30)?.overReplacement).toBeCloseTo(85 - 40, 9);
  });

  it('measures goalies against goalies only', () => {
    player(1, 100, 'C');
    player(2, 10, 'C');
    player(41, 60, 'G');
    player(42, 55, 'G');
    player(43, 20, 'G');

    const valued = valueOverReplacement(values, positions, slots(1, 0, 0, 0, 1, 1), 2);

    // Util takes no goalie.
    expect(valued.get(41)?.overReplacement).toBeCloseTo(40, 9);
    expect(valued.get(41)?.positionRank).toBe('G1');
  });

  it('puts the level at the weakest of them where everyone at a position starts', () => {
    player(1, 100, 'C');
    player(2, 70, 'C');

    const valued = valueOverReplacement(values, positions, slots(1, 0, 0, 0, 0, 0), 4);

    expect(valued.get(1)?.overReplacement).toBeCloseTo(30, 9);
    expect(valued.get(2)?.overReplacement).toBe(0);
  });

  it('fills the wing flex before the forward flex, and both before Util', () => {
    player(1, 100, 'C');
    player(2, 90, 'C');
    player(21, 80, 'LW');
    player(22, 70, 'LW');
    player(23, 60, 'LW');
    player(11, 50, 'D');
    player(12, 40, 'D');

    // One C, one LW, one W, one F, one D a team: the second winger takes W, the second centre F.
    const valued = valueOverReplacement(
      values,
      positions,
      { c: 1, lw: 1, rw: 0, w: 1, f: 1, d: 1, util: 0, bn: 0, g: 0 },
      1,
    );

    // The third winger is the one left over.
    expect(valued.get(21)?.overReplacement).toBeCloseTo(80 - 60, 9);
    expect(valued.get(22)?.overReplacement).toBeCloseTo(70 - 60, 9);
    // Both centres start, so the weaker of them is the level.
    expect(valued.get(1)?.overReplacement).toBeCloseTo(100 - 90, 9);
    expect(valued.get(11)?.overReplacement).toBeCloseTo(10, 9);
  });

  it('leaves out a player with no position', () => {
    player(1, 100, 'C');
    values.set(99, 500);

    expect(valueOverReplacement(values, positions, slots(1, 0, 0, 0, 0, 0), 2).has(99)).toBe(false);
  });
});
