import { describe, expect, it } from 'vitest';
import { holdsRole, isLineupRole, listingLabel, PageListing } from './lineup-role';

const forward: PageListing = { line: 'f2', powerPlayUnit: 1, penaltyKillUnit: null };
const specialist: PageListing = { line: null, powerPlayUnit: null, penaltyKillUnit: 2 };

describe('lineup roles', () => {
  it('holds his line and his units, and nothing else', () => {
    expect(holdsRole(forward, 'f2')).toBe(true);
    expect(holdsRole(forward, 'f1')).toBe(false);
    expect(holdsRole(forward, 'pp1')).toBe(true);
    expect(holdsRole(forward, 'pp2')).toBe(false);
    expect(holdsRole(forward, 'pk1')).toBe(false);
    expect(holdsRole(specialist, 'pk2')).toBe(true);
    expect(holdsRole(specialist, 'd1')).toBe(false);
  });

  it('gives a player no page names no role', () => {
    expect(holdsRole(null, 'f1')).toBe(false);
    expect(listingLabel(null)).toBeNull();
    expect(listingLabel({ line: null, powerPlayUnit: null, penaltyKillUnit: null })).toBeNull();
  });

  it('writes the listing short, line first', () => {
    expect(listingLabel(forward)).toBe('F2 · PP1');
    expect(listingLabel(specialist)).toBe('PK2');
    expect(listingLabel({ line: 'd1', powerPlayUnit: 2, penaltyKillUnit: 1 })).toBe(
      'D1 · PP2 · PK1',
    );
  });

  it('knows its own roles from anything else a select might send', () => {
    expect(isLineupRole('pk1')).toBe(true);
    expect(isLineupRole('')).toBe(false);
    expect(isLineupRole('f5')).toBe(false);
  });
});
