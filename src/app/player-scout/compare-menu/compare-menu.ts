import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ScoutSince } from '../../api/models/scout-since';
import { IconComponent } from '../../shared/icon/icon';
import { PopoverTriggerDirective } from '../../shared/popover/popover-trigger.directive';
import { PLANNER_LAYOUT } from '../../streamer-planner/planner-page-size';

/** Today as an ISO date in the reader's own clock, the way a date input writes one. */
export function localToday(): string {
  const now = new Date();
  return isoDate(now.getFullYear(), now.getMonth(), now.getDate());
}

/** `days` before an ISO date, as an ISO date. */
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

/**
 * The first of October of the season a day falls in: the floor of the day picker while no day is
 * kept yet. The regular season opens in the first week of October, so no earlier day is one of
 * the season's; the kept days, once there are any, set the real floor
 * ({@link CompareMenuComponent.earliest}).
 */
export function seasonFloor(day: string): string {
  const [year, month] = day.split('-').map(Number);
  return `${month >= 9 ? year : year - 1}-10-01`;
}

function isoDate(year: number, monthIndex: number, date: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** An ISO date as the page writes one: "7 Oct". */
export function formatDay(day: string | null | undefined): string {
  if (!day) {
    return '';
  }
  const [year, month, date] = day.split('-').map(Number);
  return DAY.format(new Date(year, month - 1, date));
}

/** How long ago a day was, as the menu says it beside the date: "yesterday", "5 days ago". */
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

/**
 * The line under the control when the day on the button is not the day in the columns: nothing
 * to compare with at all, or a nearer day answered than the one asked for. The menu offers no
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

/** One line of the menu: what the comparison can be with. */
export interface CompareChoice {
  /** `off`, `preseason`, or the ISO day. */
  readonly key: string;
  readonly label: string;
  /** The grey note on the right: the date a day's words stand for. */
  readonly note: string;
  /** The day the choice stands for, null for the preseason; absent for off. */
  readonly day?: string | null;
  readonly picked: boolean;
}

/**
 * The comparison, as one menu button: "Projection Change" in rest (Alexander, 2026-11-13), the
 * sentence "Compare with · 15 Oct · 5 days ago" with a comparison on. The menu under it finishes
 * the sentence: nothing, yesterday, a week ago, the day last picked, the preseason, or a day of
 * the reader's own from the platform's date picker.
 *
 * <p>One button rather than the three segments it replaces (Alexander, 2026-10-20): "Off |
 * Preseason | 15 Oct" read as three values of one kind, where one was a switch and one a hidden
 * date field, and none of them said what the comparison does. The words do that here, and the
 * menu is the app's own (the editor's Stats and Ranking menus), not a control of its own.
 *
 * <p>Nothing is picked for the reader. Opening the date picker changes nothing until a day is
 * picked in it: the day segment used to switch the comparison on against a week back on the
 * press that opened the picker, so dismissing the picker left a comparison with a day the reader
 * never chose.
 *
 * <p>Only a day that can be compared with is a line (Alexander, 2026-11-15): a day before the
 * first one on record used to be listed greyed out with "not kept" beside it and a footer saying
 * from when days are kept, which asked the reader to think about what is stored. The picker's
 * own limits say the same thing without the words.
 */
@Component({
  selector: 'app-compare-menu',
  imports: [IconComponent, PopoverTriggerDirective],
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
   * has not said (or none is kept). No earlier day is offered: the preseason line stands for
   * everything before it, and has a line of its own.
   */
  readonly earliestKept = input<string | null>(null);
  /** The preseason (null) or a day picked, which also switches the comparison on. */
  readonly sinceChange = output<string | null>();
  /** Nothing picked: the comparison switched off, the day kept for next time. */
  readonly cleared = output<void>();

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private readonly typed = viewChild<ElementRef<HTMLInputElement>>('typed');
  private readonly trigger = viewChild.required(PopoverTriggerDirective);
  private readonly layout = inject(PLANNER_LAYOUT);
  private readonly injector = inject(Injector);

  /**
   * Whether "Pick a day" is a field in the menu instead of the platform's picker: set once the
   * browser has shown it will not open one, and kept, since asking again would only fail again.
   */
  readonly typing = signal(false);
  /** Whether the day last entered fell outside the days on record. */
  readonly outside = signal(false);

  /**
   * The earliest day the picker offers: the first day kept, or, until one is, the season's first
   * of October. Never before the season's start either way.
   */
  readonly earliest = computed(() => this.earliestKept() ?? seasonFloor(this.today()));

  /** The latest: yesterday, since today's projection is the one everything is compared with. */
  readonly latest = computed(() => daysBefore(this.today(), 1));

  /** No day to pick: the season has only just opened, or nothing is kept yet. */
  readonly noDayYet = computed(() => {
    const earliest = this.earliestKept();
    return earliest === null || earliest > this.latest();
  });

  /** Whether a projection is kept for a day: on or after the first kept, and before today. */
  private kept(day: string): boolean {
    const earliest = this.earliestKept();
    return earliest !== null && day >= earliest && day <= this.latest();
  }

  /** The lines of the menu, the days latest first. */
  readonly choices = computed<readonly CompareChoice[]>(() => {
    const on = this.on();
    const since = this.since();
    const today = this.today();
    const yesterday = daysBefore(today, 1);
    const weekAgo = daysBefore(today, 7);
    const days = new Map<string, CompareChoice>();
    // A day is a line only if it can be compared with. The one picked stays whatever the record
    // says, so the menu never opens with no line marked.
    const day = (iso: string, label: string) => {
      const picked = on && since === iso;
      if (picked || this.kept(iso)) {
        days.set(iso, { key: iso, label, note: formatDay(iso), day: iso, picked });
      }
    };
    day(yesterday, 'Yesterday');
    day(weekAgo, 'A week ago');
    // The day picked once stays a line of its own, so the reader can go between it and a week
    // ago. Its words first and its date beside them, as on the two lines above.
    if (since !== null && !days.has(since)) {
      const ago = relativeDay(since, today);
      day(since, ago.charAt(0).toUpperCase() + ago.slice(1));
    }
    return [
      { key: 'off', label: 'Nothing', note: 'today only', picked: !on },
      ...[...days.values()].sort((a, b) => b.key.localeCompare(a.key)),
      {
        key: 'preseason',
        label: 'Preseason',
        note: 'before game 1',
        day: null,
        picked: on && since === null,
      },
    ];
  });

  /** Under the typed field: the days there are, which is also what to do about one outside them. */
  readonly range = computed(
    () => `Pick a day from ${formatDay(this.earliest())} to ${formatDay(this.latest())}.`,
  );

  /** What the button says after "Compare with" while a comparison is on: the day and how long ago. */
  readonly value = computed(() => {
    const since = this.since();
    return since === null
      ? 'Preseason · before game 1'
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

  pick(choice: CompareChoice, menu: PopoverTriggerDirective): void {
    this.outside.set(false);
    menu.close();
    if (choice.key === 'off') {
      this.cleared.emit();
    } else {
      this.sinceChange.emit(choice.day ?? null);
    }
  }

  /**
   * The arrows walk the lines, round the ends, and Home and End reach them, as in any radio
   * group. They only move: a line is picked with Enter or Space, since picking closes the menu
   * and reloads the list, which is no thing to do on the way past.
   */
  onArrow(event: KeyboardEvent): void {
    const lines = [
      ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="radio"]'),
    ];
    const at = lines.indexOf(event.target as HTMLElement);
    const last = lines.length - 1;
    const to = new Map<string, number>([
      ['ArrowDown', at === last ? 0 : at + 1],
      ['ArrowRight', at === last ? 0 : at + 1],
      ['ArrowUp', at <= 0 ? last : at - 1],
      ['ArrowLeft', at <= 0 ? last : at - 1],
      ['Home', 0],
      ['End', last],
    ]).get(event.key);
    if (to === undefined) {
      return;
    }
    event.preventDefault();
    lines[to]?.focus();
  }

  /**
   * "Pick a day": the platform's date picker opens on the button, where the field hides, and the
   * menu closes behind it. Nothing changes until a day is picked in it ({@link onDate}). A
   * browser that will not open one (none to show, or no user activation) leaves the menu open
   * and turns the line into a field to type the day into.
   */
  pickDay(menu: PopoverTriggerDirective): void {
    this.outside.set(false);
    const field = this.field().nativeElement;
    try {
      if (typeof field.showPicker === 'function') {
        field.showPicker();
        menu.close();
        return;
      }
    } catch {
      // Fall through to the typed field.
    }
    this.typeTheDay();
  }

  /**
   * A day picked in the platform's picker. Its limits keep it to the days on record; a browser
   * that lets one through anyway gets the menu back with the typed field and the days there are,
   * rather than a pick that did nothing.
   */
  onDate(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (!value) {
      return;
    }
    if (this.onRecord(value)) {
      this.sinceChange.emit(value);
      return;
    }
    this.outside.set(true);
    this.trigger().open();
    this.typeTheDay();
  }

  /** A day typed into the menu's own field. */
  onTyped(event: Event, menu: PopoverTriggerDirective): void {
    const value = (event.target as HTMLInputElement).value;
    if (!value) {
      this.outside.set(false);
      return;
    }
    if (!this.onRecord(value)) {
      this.outside.set(true);
      return;
    }
    this.outside.set(false);
    menu.close();
    this.sinceChange.emit(value);
  }

  private onRecord(day: string): boolean {
    return day >= this.earliest() && day <= this.latest();
  }

  private typeTheDay(): void {
    this.typing.set(true);
    afterNextRender(() => this.typed()?.nativeElement.focus(), { injector: this.injector });
  }
}
