/**
 * Where today's Daily Faceoff lineup page lists a player, and the roles Player Scout filters on.
 * The page is an editor's call read through the model's own gate: the list shows it, never scores
 * it.
 */
export interface PageListing {
  /** `f1`-`f4` for the forward lines, `d1`-`d3` for the pairs; null for special teams only. */
  readonly line: string | null;
  readonly powerPlayUnit: number | null;
  readonly penaltyKillUnit: number | null;
}

export type LineupRole =
  'f1' | 'f2' | 'f3' | 'f4' | 'd1' | 'd2' | 'd3' | 'pp1' | 'pp2' | 'pk1' | 'pk2';

export interface LineupRoleGroup {
  readonly label: string;
  readonly roles: readonly { readonly role: LineupRole; readonly label: string }[];
}

/** The filter's options, grouped as the page groups them. */
export const LINEUP_ROLE_GROUPS: readonly LineupRoleGroup[] = [
  {
    label: 'Forward lines',
    roles: [
      { role: 'f1', label: 'Line 1 (F1)' },
      { role: 'f2', label: 'Line 2 (F2)' },
      { role: 'f3', label: 'Line 3 (F3)' },
      { role: 'f4', label: 'Line 4 (F4)' },
    ],
  },
  {
    label: 'Defence pairs',
    roles: [
      { role: 'd1', label: 'Pair 1 (D1)' },
      { role: 'd2', label: 'Pair 2 (D2)' },
      { role: 'd3', label: 'Pair 3 (D3)' },
    ],
  },
  {
    label: 'Power play',
    roles: [
      { role: 'pp1', label: 'PP1' },
      { role: 'pp2', label: 'PP2' },
    ],
  },
  {
    label: 'Penalty kill',
    roles: [
      { role: 'pk1', label: 'PK1' },
      { role: 'pk2', label: 'PK2' },
    ],
  },
];

const ROLES = new Set<string>(
  LINEUP_ROLE_GROUPS.flatMap((group) => group.roles.map((r) => r.role)),
);

export function isLineupRole(value: string): value is LineupRole {
  return ROLES.has(value);
}

/** Whether the page lists him in the role. A player the page does not name holds none. */
export function holdsRole(listing: PageListing | null, role: LineupRole): boolean {
  if (!listing) {
    return false;
  }
  const unit = Number(role.slice(-1));
  if (role.startsWith('pp')) {
    return listing.powerPlayUnit === unit;
  }
  if (role.startsWith('pk')) {
    return listing.penaltyKillUnit === unit;
  }
  return listing.line === role;
}

/** The listing in a few characters, `F2 · PP1 · PK2`; null when the page gives him no role. */
export function listingLabel(listing: PageListing | null): string | null {
  if (!listing) {
    return null;
  }
  const parts = [
    listing.line?.toUpperCase(),
    listing.powerPlayUnit ? `PP${listing.powerPlayUnit}` : undefined,
    listing.penaltyKillUnit ? `PK${listing.penaltyKillUnit}` : undefined,
  ].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(' · ') : null;
}
