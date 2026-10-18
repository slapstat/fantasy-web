import { ChosenLeague } from '../services/league-choice.service';

/**
 * The players a manager holds as streamers, remembered per league until he changes them. Nobody is
 * one until he marks him: a player held for a few nights of good schedule looks like any other
 * on the roster, so the page never guesses which of his players those are.
 */
const STORAGE_KEY = 'slapstat.playerScout.streamers';

type StoredStreamers = Record<string, readonly string[]>;

/** A league as the store keys it: the same id on two platforms is two leagues. */
function leagueKey(league: ChosenLeague): string {
  return `${league.platform}:${league.leagueId}`;
}

/** The players marked as streamers in a league, by platform id; none until he marks one. */
export function readStreamers(league: ChosenLeague): ReadonlySet<string> {
  return new Set(readAll()[leagueKey(league)] ?? []);
}

/** The players marked as streamers in a league. None marked forgets the league. */
export function writeStreamers(league: ChosenLeague, streamers: ReadonlySet<string>): void {
  const all = { ...readAll() };
  const key = leagueKey(league);
  if (streamers.size > 0) {
    all[key] = [...streamers];
  } else {
    delete all[key];
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // A private window, or storage the browser refuses: the marks still hold for this visit.
  }
}

function readAll(): StoredStreamers {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(stored as Record<string, unknown>).filter(
        ([, ids]) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'),
      ),
    ) as StoredStreamers;
  } catch {
    return {};
  }
}
