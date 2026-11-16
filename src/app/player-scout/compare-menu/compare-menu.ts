import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ScoutSince } from '../../api/models/scout-since';
import { IconComponent } from '../../shared/icon/icon';
import { PopoverTriggerDirective } from '../../shared/popover/popover-trigger.directive';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { PLANNER_LAYOUT } from '../../streamer-planner/planner-page-size';

/** Today as an ISO date in the reader's own clock, the way a date input writes one. */
export function localToday(): string {
  const now = new Date();
  return isoDate(now.getFullYear(), now.getMonth(), now.getDate());
}

/** `days` before an ISO date, as an ISO date. A negative count is that many days after. */
export function daysBefore(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const then = new Date(year, month - 1, date - days);
  return isoDate(then.getFullYear(), then.getMonth(), then.getDate());
}

/** Whole days from one ISO date to a later one. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

function isoDate(year: number, monthIndex: number, date: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const LONG_DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

/** The calendar's columns, Monday first: the week a fantasy matchup runs. */
export const WEEKDAYS = [
  { short: 'Mo', name: 'Monday' },
  { short: 'Tu', name: 'Tuesday' },
  { short: 'We', name: 'Wednesday' },
  { short: 'Th', name: 'Thursday' },
  { short: 'Fr', name: 'Friday' },
  { short: 'Sa', name: 'Saturday' },
  { short: 'Su', name: 'Sunday' },
] as const;

/** An ISO date as the page writes one: "7 Oct". */
export function formatDay(day: string | null | undefined): string {
  if (!day) {
    return '';
  }
  const [year, month, date] = day.split('-').map(Number);
  return DAY.format(new Date(year, month - 1, date));
}

/** How long ago a day was, as the button says it beside the date: "yesterday", "5 days ago". */
export function relativeDay(day: string, today: string): string {
  const days = daysBetween(day, today);
  if (days === 1) {
    return 'yesterday';
  }
  if (days === 7) {
    return 'a week ago';
  }
  return `${days} days ago`;
}

/** The month an ISO date falls in, as `YYYY-MM`. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** A `YYYY-MM` month `by` months on (or back), as `YYYY-MM`. */
export function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split('-').map(Number);
  const then = new Date(year, index - 1 + by, 1);
  return monthOf(isoDate(then.getFullYear(), then.getMonth(), 1));
}

/** A `YYYY-MM` month as the calendar heads it: "November 2026". */
export function formatMonth(month: string): string {
  const [year, index] = month.split('-').map(Number);
  return MONTH.format(new Date(year, index - 1, 1));
}

/**
 * A month as the calendar lays it out: six weeks of seven, Monday first, each place the ISO day
 * that falls there or null outside the month. Always six, so the menu keeps its height from one
 * month to the next.
 */
export function monthWeeks(month: string): (string | null)[][] {
  const [year, index] = month.split('-').map(Number);
  const lead = (new Date(year, index - 1, 1).getDay() + 6) % 7;
  const length = new Date(year, index, 0).getDate();
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const date = week * 7 + weekday - lead + 1;
      return date >= 1 && date <= length ? isoDate(year, index - 1, date) : null;
    }),
  );
}

/** The day of `month` with the same date as `day`, or the month's last where it has no such day. */
function sameDayOf(month: string, day: string): string {
  const [year, index] = month.split('-').map(Number);
  const length = new Date(year, index, 0).getDate();
  return isoDate(year, index - 1, Math.min(Number(day.slice(8)), length));
}

/**
 * The line under the control when the day on the button is not the day in the columns: nothing
 * to compare with at all, or a nearer day answered than the one asked for. The calendar offers no
 * day before the first kept, so the second is only a gap in the kept days (a night the snapshot
 * never ran), but it is a gap the reader cannot see, so the line stays.
 */
export function sinceCaption(answer: ScoutSince | null): string {
  if (!answer) {
    return '';
  }
  if (answer.kind === 'NONE') {
    return 'No earlier projection to compare with yet.';
  }
  if (
    answer.kind === 'SNAPSHOT' &&
    answer.resolved &&
    answer.requested &&
    answer.resolved !== answer.requested
  ) {
    return `Compared with ${formatDay(answer.resolved)}, the nearest day kept.`;
  }
  return '';
}

/** One day of the calendar. */
export interface CalendarDay {
  readonly iso: string;
  /** The day of the month, as the cell shows it. */
  readonly date: number;
  /** What a screen reader calls the cell: "15 October", with "today" on today's. */
  readonly label: string;
  /** Whether there is a projection to compare with for the day. */
  readonly offered: boolean;
  readonly picked: boolean;
  readonly today: boolean;
}

/**
 * The comparison, as one menu button: "Projection Change" in rest (Alexander, 2026-11-13), the
 * sentence "Compare with · 15 Oct · 5 days ago" with a comparison on. The menu under it finishes
 * the sentence with the two answers there are: the preseason, or a day of the reader's own, picked
 * in a calendar that is the menu itself. A cross on the button switches the comparison off.
 *
 * <p>A calendar rather than the lines it replaces (Alexander, 2026-11-15): the menu listed
 * Nothing, Yesterday, A week ago and the day last picked, with the reader's own day behind a
 * "Pick a day" link that closed the menu and opened the browser's picker. The own day is what the
 * comparison is for, and it was the farthest away: three presses over two surfaces. Now every
 * day is one press in the menu, yesterday and a week ago among them, and "Nothing" is the cross,
 * one press instead of two.
 *
 * <p>One button rather than the three segments before that (Alexander, 2026-10-20): "Off |
 * Preseason | 15 Oct" read as three values of one kind, where one was a switch and one a hidden
 * date field, and none of them said what the comparison does.
 *
 * <p>Nothing is picked for the reader: opening the menu, or turning its months, changes nothing
 * until a day is pressed.
 *
 * <p>Only a day that can be compared with can be pressed: the days before the first on record,
 * and today itself, are drawn pale. Nothing says why in words, which asked the reader to think
 * about what is stored; the months stop where the days do.
 */
@Component({
  selector: 'app-compare-menu',
  imports: [IconComponent, PopoverTriggerDirective, TooltipDirective],
  templateUrl: './compare-menu.html',
  styleUrl: './compare-menu.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompareMenuComponent {
  /** Whether a comparison is on at all. Off, the day below is kept but not asked. */
  readonly on = input.required<boolean>();
  /** The day picked, as an ISO date, or null for the preseason projection. */
  readonly since = input.required<string | null>();
  readonly today = input<string>(localToday());
  /**
   * The first day a projection is kept for this season, as the BFF reports it, or null while it
   * has not said (or none is kept). No earlier day can be pressed: the preseason line stands for
   * everything before it.
   */
  readonly earliestKept = input<string | null>(null);
  /** The preseason (null) or a day picked, which also switches the comparison on. */
  readonly sinceChange = output<string | null>();
  /** The cross: the comparison switched off, the day kept for next time. */
  readonly cleared = output<void>();

  private readonly opener = viewChild.required<ElementRef<HTMLButtonElement>>('opener');
  private readonly layout = inject(PLANNER_LAYOUT);
  private readonly injector = inject(Injector);

  readonly weekdays = WEEKDAYS;

  /** The latest day: yesterday, since today's projection is the one everything is compared with. */
  readonly latest = computed(() => daysBefore(this.today(), 1));

  /** No day to pick: the season has only just opened, or nothing is kept yet. */
  readonly noDayYet = computed(() => {
    const earliest = this.earliestKept();
    return earliest === null || earliest > this.latest();
  });

  /** Whether the preseason is what the comparison is with. */
  readonly preseasonPicked = computed(() => this.on() && this.since() === null);

  /** The day the comparison is with, or null: off, or the preseason. */
  private readonly pickedDay = computed(() => (this.on() ? this.since() : null));

  /** Whether a projection is kept for a day: on or after the first kept, and before today. */
  private offered(day: string): boolean {
    const earliest = this.earliestKept();
    return earliest !== null && day >= earliest && day <= this.latest();
  }

  /**
   * The month the menu opens on: the day picked, or the day kept from last time while it can
   * still be pressed, and otherwise the latest month with a day in it.
   */
  private readonly homeMonth = computed(() => {
    const since = this.since();
    return monthOf(since !== null && (this.on() || this.offered(since)) ? since : this.latest());
  });

  /** The month on show. Turned with the arrows, and back at {@link homeMonth} on each opening. */
  readonly month = linkedSignal(() => this.homeMonth());

  /** The first month to turn to: the first day on record, or the day picked if that is earlier. */
  private readonly firstMonth = computed(() =>
    [this.earliestKept(), this.pickedDay(), this.latest()]
      .filter((day): day is string => day !== null)
      .map(monthOf)
      .reduce((first, month) => (month < first ? month : first), monthOf(this.latest())),
  );

  readonly monthLabel = computed(() => formatMonth(this.month()));
  readonly hasEarlier = computed(() => this.month() > this.firstMonth());
  readonly hasLater = computed(() => this.month() < monthOf(this.latest()));

  /** The month on show, as six weeks of days. */
  readonly weeks = computed<readonly (CalendarDay | null)[][]>(() => {
    const today = this.today();
    const picked = this.pickedDay();
    return monthWeeks(this.month()).map((week) =>
      week.map((iso) => {
        if (iso === null) {
          return null;
        }
        const [year, month, date] = iso.split('-').map(Number);
        const label = LONG_DAY.format(new Date(year, month - 1, date));
        return {
          iso,
          date,
          label: iso === today ? `${label}, today` : label,
          offered: this.offered(iso),
          picked: iso === picked,
          today: iso === today,
        };
      }),
    );
  });

  /** The day the arrows last moved to, while the menu is open. */
  private readonly cursor = signal<string | null>(null);

  /**
   * The calendar's one tab stop: where the arrows last went, else the day picked, else the latest
   * day of the month that can be pressed. Null in a month with none.
   */
  readonly tabStop = computed(() => {
    const days = this.weeks()
      .flat()
      .filter((day): day is CalendarDay => day !== null && day.offered);
    const cursor = this.cursor();
    const stop =
      days.find((day) => day.iso === cursor) ?? days.find((day) => day.picked) ?? days.at(-1);
    return stop?.iso ?? null;
  });

  /** What the button says after "Compare with" while a comparison is on: the day and how long ago. */
  readonly value = computed(() => {
    const since = this.since();
    return since === null
      ? 'Preseason'
      : `${formatDay(since)} · ${relativeDay(since, this.today())}`;
  });

  /**
   * The button's whole face on a phone with a comparison on: only "vs 15 Oct", so the button and
   * the two chips beside it fit on one line. Null where the sentence fits.
   */
  readonly short = computed(() => {
    if (this.layout() !== 'phone' || !this.on()) {
      return null;
    }
    const since = this.since();
    return since === null ? 'vs preseason' : `vs ${formatDay(since)}`;
  });

  /** The button pressed, to open or to close: the calendar starts over from its home month. */
  startOver(): void {
    this.month.set(this.homeMonth());
    this.cursor.set(null);
  }

  /** A day pressed, or the preseason (null): the comparison is with it, and the menu closes. */
  pick(day: string | null, menu: PopoverTriggerDirective): void {
    menu.close();
    this.sinceChange.emit(day);
  }

  /**
   * The cross. It leaves the page with the comparison, so focus goes to the button it sat on
   * rather than nowhere.
   */
  clear(): void {
    this.cleared.emit();
    this.opener().nativeElement.focus();
  }

  /** A month back or on, no further than the days there are. */
  turn(by: -1 | 1): void {
    if (by < 0 ? this.hasEarlier() : this.hasLater()) {
      this.month.update((month) => shiftMonth(month, by));
      this.cursor.set(null);
    }
  }

  /**
   * The arrows walk the days, a day or a week at a time, Home and End reach the ends of the week
   * and Page Up and Page Down the same day a month away, as in any date grid. They stop at the
   * first and last day that can be pressed, turn the month when they cross its edge, and only
   * move: a day is picked with Enter or Space, since picking closes the menu and reloads the list.
   */
  onDayKey(event: KeyboardEvent): void {
    const from = (event.target as HTMLElement).dataset['day'];
    const earliest = this.earliestKept();
    if (!from || earliest === null) {
      return;
    }
    // 2024-01-01 was a Monday: the place in the week, Monday as 0.
    const weekday = daysBetween('2024-01-01', from) % 7;
    const moved = new Map<string, () => string>([
      ['ArrowLeft', () => daysBefore(from, 1)],
      ['ArrowRight', () => daysBefore(from, -1)],
      ['ArrowUp', () => daysBefore(from, 7)],
      ['ArrowDown', () => daysBefore(from, -7)],
      ['Home', () => daysBefore(from, weekday)],
      ['End', () => daysBefore(from, weekday - 6)],
      ['PageUp', () => sameDayOf(shiftMonth(monthOf(from), -1), from)],
      ['PageDown', () => sameDayOf(shiftMonth(monthOf(from), 1), from)],
    ]).get(event.key);
    if (!moved) {
      return;
    }
    event.preventDefault();
    const target = moved();
    const latest = this.latest();
    const held = target > latest ? latest : target;
    const to = held < earliest ? earliest : held;
    const grid = event.currentTarget as HTMLElement;
    this.month.set(monthOf(to));
    this.cursor.set(to);
    afterNextRender(() => grid.querySelector<HTMLElement>(`[data-day="${to}"]`)?.focus(), {
      injector: this.injector,
    });
  }
}
