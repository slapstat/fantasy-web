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
import { IconComponent } from '../../shared/icon/icon';
import { PopoverTriggerDirective } from '../../shared/popover/popover-trigger.directive';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { PLANNER_LAYOUT } from '../../streamer-planner/planner-page-size';

/**
 * The depths the menu offers as one press, shallow to deep. A wire is scouted deeper than a
 * league rosters: the players worth finding there sit below everything already held, so the
 * ladder runs past the rostered depth rather than stopping at it.
 */
export const RANK_FLOOR_STEPS = [100, 200, 300, 500] as const;

/**
 * How deep the list still counts, as one menu button: the pill carries the depth it holds the
 * list to, and a cross takes it off, as the comparison's pill does.
 *
 * <p>The control is on the comparison's line rather than in the toolbar above it, because it is
 * only there that it has work to do: the list opens ranked on today's projection, where the
 * shallow end is the top of the page and the tail is pages away, and it is sorting by the change
 * that brings a player up from nowhere to the first row. Who's Hot shows its minimum beside the
 * switch that gives it a job for the same reason.
 *
 * <p>The menu's first answer is the league's own: how many players a league of this size and
 * these roster slots holds at all, which is the depth at which a player stops being somebody
 * else's bench and starts being a find. The ladder under it is for a reader who wants a rounder
 * number, and the field at the foot for one who has his own.
 *
 * <p>A depth every ranked player already sits inside would cut nobody, so it is drawn pale and
 * does not answer, as a day with nothing to compare with is in the comparison's calendar.
 */
@Component({
  selector: 'app-rank-floor',
  imports: [IconComponent, PopoverTriggerDirective, TooltipDirective],
  templateUrl: './rank-floor.html',
  styleUrl: './rank-floor.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RankFloorComponent {
  /** The deepest place still shown, or null while the whole list is. */
  readonly floor = input.required<number | null>();
  /**
   * How many players a league this size rosters: its teams times the slots each fills. Null
   * while the league's settings have not landed, and the menu offers the ladder alone.
   */
  readonly depth = input<number | null>(null);
  /** How many players are ranked at all: a floor at or past it cuts nobody. */
  readonly ranked = input<number>(0);
  /** A depth pressed, or typed: the list held to it. */
  readonly picked = output<number>();
  /** The cross: the whole list again. */
  readonly cleared = output<void>();

  private readonly opener = viewChild.required<ElementRef<HTMLButtonElement>>('opener');
  private readonly layout = inject(PLANNER_LAYOUT);

  readonly steps = RANK_FLOOR_STEPS;

  readonly on = computed(() => this.floor() !== null);

  /** Whether a depth leaves anyone out: a floor past the last place ranked is no floor at all. */
  cuts(depth: number | null): boolean {
    const ranked = this.ranked();
    return depth !== null && depth >= 1 && (ranked === 0 || depth < ranked);
  }

  /** The rostered depth, while there is one worth offering. */
  readonly rostered = computed(() => (this.cuts(this.depth()) ? this.depth() : null));

  /** Whether the depth on the pill is the league's own, so the menu can mark it as the one on. */
  readonly rosteredPicked = computed(
    () => this.rostered() !== null && this.floor() === this.rostered(),
  );

  /** The highest an own number may go: past the last place ranked it would cut nobody. */
  readonly deepest = computed(() => Math.max(this.ranked() - 1, 1));

  /**
   * The pill's whole face on a phone, so it and the two movers beside it keep to one line. Null
   * where the sentence fits.
   */
  readonly short = computed(() =>
    this.layout() === 'phone' && this.on() ? `Top ${this.floor()}` : null,
  );

  /** A depth pressed: the list held to it, and the menu closes behind the answer. */
  pick(depth: number, menu: PopoverTriggerDirective): void {
    menu.close();
    this.picked.emit(depth);
  }

  /**
   * A depth typed. Fields in these menus save as they are typed, so this one does too; a field
   * emptied is the whole list again, which is the same answer the cross gives.
   */
  onOwn(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value) || value < 1) {
      this.cleared.emit();
      return;
    }
    this.picked.emit(Math.min(Math.floor(value), this.deepest()));
  }

  /** The cross. It takes the pill's other half off the line, so focus goes back to the pill. */
  clear(): void {
    this.cleared.emit();
    this.opener().nativeElement.focus();
  }
}
