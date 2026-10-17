import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import { ScoutSince } from '../../api/models/scout-since';
import { IconComponent } from '../../shared/icon/icon';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';

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

/**
 * The first of October of the season a day falls in: the floor of the day picker while no day is
 * kept yet. The regular season opens in the first week of October, so no earlier day is one of
 * the season's; the kept days, once there are any, set the real floor
 * ({@link SincePickerComponent.earliest}).
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

/**
 * The caption under the picker: which earlier projection the comparison is with, since the day
 * asked for is not always the day answered (nothing is kept from before the history began, and
 * the preseason projection stands in).
 */
export function sinceCaption(answer: ScoutSince | null): string {
  if (!answer) {
    return '';
  }
  switch (answer.kind) {
    case 'SNAPSHOT': {
      return answer.resolved && answer.requested && answer.resolved !== answer.requested
        ? `Compared with ${formatDay(answer.resolved)}, the nearest day kept.`
        : '';
    }
    case 'PRESEASON':
      if (answer.requested) {
        return answer.earliestSnapshot
          ? `Days are kept from ${formatDay(answer.earliestSnapshot)}. Compared with preseason.`
          : 'No day is kept yet. Compared with preseason.';
      }
      return '';
    case 'NONE':
      return 'No earlier projection to compare with yet.';
  }
  return '';
}

/**
 * The comparison, as one choice of three: off, the projection from before the season, or the one
 * of any day of the reader's own. The model is re-run every night, so each day is a projection
 * of its own; the page's caption says which day actually answered ({@link sinceCaption}).
 *
 * <p>Off and a day are the one control rather than a tick and a picker under it (Alexander,
 * 2026-10-15): the tick said "compare", the picker said "with what", and the two took three lines
 * to say one thing.
 *
 * <p>The day is a segment like the other two, wearing the day as the page writes it ("10 Oct")
 * rather than a date field wearing an ISO date (Alexander, 2026-10-17). The field is still there,
 * since the platform's picker is the right way to pick a day, but hidden under the segment: the
 * segment opens it (`showPicker`), and the field only reports what was picked. Pressing the
 * segment switches the comparison on at once, against the day it kept or a week back, so the
 * table answers even if the picker is dismissed.
 */
@Component({
  selector: 'app-since-picker',
  imports: [IconComponent, TooltipDirective],
  templateUrl: './since-picker.html',
  styleUrl: './since-picker.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SincePickerComponent {
  /** Whether a comparison is on at all. Off, the day below is kept but not asked. */
  readonly on = input.required<boolean>();
  /** The day picked, as an ISO date, or null for the preseason projection. */
  readonly since = input.required<string | null>();
  readonly today = input<string>(localToday());
  /**
   * The first day a projection is kept for this season, as the BFF reports it, or null while it
   * has not said (or none is kept). Any day before it is answered by the preseason line, which
   * has a segment of its own, so the picker offers nothing earlier.
   */
  readonly earliestKept = input<string | null>(null);
  /** The preseason (null) or a day picked, which also switches the comparison on. */
  readonly sinceChange = output<string | null>();
  /** Off pressed: the comparison switched off, the day kept for next time. */
  readonly cleared = output<void>();

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  /**
   * The earliest day the picker offers: the first day kept, or, until one is, the season's first
   * of October. Never before the season's start either way.
   */
  readonly earliest = computed(() => this.earliestKept() ?? seasonFloor(this.today()));

  /** The latest: yesterday, since today's projection is the one everything is compared with. */
  readonly latest = computed(() => daysBefore(this.today(), 1));

  /** No day the picker could offer: the season has only just opened, or nothing is kept yet. */
  readonly noDayYet = computed(() => this.earliest() > this.latest());

  /** The day the segment opens on when no day is picked: a week back, a usual look, or the floor. */
  readonly suggested = computed(() => {
    const weekBack = daysBefore(this.today(), 7);
    return weekBack < this.earliest() ? this.earliest() : weekBack;
  });

  /** Whether the day segment is the pick. */
  readonly dayPicked = computed(() => this.on() && this.since() !== null);

  /** The day segment's face: the day it holds, as the page writes one, or an invitation. */
  readonly dayLabel = computed(() => formatDay(this.since()) || 'Pick a day');

  readonly dayTip = computed(() =>
    this.noDayYet()
      ? 'No day of this season is kept yet'
      : `The projection as it stood on a day of your own, from ${formatDay(this.earliest())} on`,
  );

  pickOff(): void {
    this.cleared.emit();
  }

  pickPreseason(): void {
    this.sinceChange.emit(null);
  }

  /**
   * The day segment pressed: the comparison on against the day it holds, or a week back when it
   * holds none, and the platform's picker opened on that day to change it.
   */
  pickDay(): void {
    if (this.noDayYet()) {
      return;
    }
    if (!this.dayPicked()) {
      this.sinceChange.emit(this.since() ?? this.suggested());
    }
    this.openPicker();
  }

  onDate(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value) {
      this.sinceChange.emit(value);
    }
  }

  /**
   * The platform's date picker, anchored on the segment the field hides under. A browser that
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
