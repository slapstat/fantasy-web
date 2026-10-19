import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
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
  /** The grey note on the right: the date behind a relative day, how long ago a date was. */
  readonly note: string;
  /** The day the choice stands for, null for the preseason; absent for off. */
  readonly day?: string | null;
  /** Whether a projection is kept for it. A day that is not is shown, but cannot be picked. */
  readonly kept: boolean;
  readonly picked: boolean;
}

/**
 * The comparison, as one menu button that reads as a sentence: "Compare with · an earlier day"
 * in rest, "Compare with · 15 Oct · 5 days ago" with a comparison on. The menu under it finishes
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
  private readonly layout = inject(PLANNER_LAYOUT);

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
    const day = (iso: string, label: string, note: string) => {
      const kept = this.kept(iso);
      days.set(iso, {
        key: iso,
        label,
        note: kept ? note : `${note}, not kept`,
        day: iso,
        kept,
        picked: on && since === iso,
      });
    };
    day(yesterday, 'Yesterday', formatDay(yesterday));
    day(weekAgo, 'A week ago', formatDay(weekAgo));
    // The day picked once stays a line of its own, so the reader can go between it and a week ago.
    if (since !== null && !days.has(since)) {
      day(since, formatDay(since), relativeDay(since, today));
    }
    return [
      { key: 'off', label: 'Nothing', note: 'today only', kept: true, picked: !on },
      ...[...days.values()].sort((a, b) => b.key.localeCompare(a.key)),
      {
        key: 'preseason',
        label: 'Preseason',
        note: 'before game 1',
        day: null,
        kept: true,
        picked: on && since === null,
      },
    ];
  });

  /** The menu's last line: from when days are kept, so a disabled day has its reason. */
  readonly footer = computed(() => {
    const earliest = this.earliestKept();
    return earliest === null ? 'No day is kept yet.' : `Days are kept from ${formatDay(earliest)}.`;
  });

  /** What the button says after "Compare with": the day and how long ago, or an invitation. */
  readonly value = computed(() => {
    if (!this.on()) {
      return 'an earlier day';
    }
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
    menu.close();
    if (choice.key === 'off') {
      this.cleared.emit();
    } else {
      this.sinceChange.emit(choice.day ?? null);
    }
  }

  /**
   * "Pick a day": the menu closes and the platform's date picker opens on the button, where the
   * field hides. Nothing changes until a day is picked in it ({@link onDate}).
   */
  pickDay(menu: PopoverTriggerDirective): void {
    menu.close();
    this.openPicker();
  }

  /** A day picked in the field. One outside the kept days is not a day the menu offers. */
  onDate(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value && value >= this.earliest() && value <= this.latest()) {
      this.sinceChange.emit(value);
    }
  }

  /**
   * The platform's date picker, anchored on the button the field hides under. A browser that
   * refuses (no user activation, or none to show) gets the field focused instead, where a day
   * can still be typed.
   */
  private openPicker(): void {
    const field = this.field().nativeElement;
    try {
      if (typeof field.showPicker === 'function') {
        field.showPicker();
        return;
      }
    } catch {
      // Fall through to the field itself.
    }
    field.focus();
  }
}
