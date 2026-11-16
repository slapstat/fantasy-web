import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../../shared/icon/icon';

/**
 * The drop picked, held over the list while it scrolls, since every gain in it is set against
 * him: who he is, what his going costs the lineup, a way back to the roster to pick another, and
 * a way out.
 */
@Component({
  selector: 'app-swap-bar',
  imports: [IconComponent],
  templateUrl: './swap-bar.html',
  styleUrl: './swap-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'region', 'aria-label': 'Your drop' },
})
export class SwapBarComponent {
  /** The drop's name. */
  readonly name = input.required<string>();
  /** What his going costs the lineup, formatted; null when his place could not be weighed. */
  readonly loss = input<string | null>(null);
  /** The unit the loss is in: points, or Z-Score in a category league. */
  readonly unit = input.required<string>();

  /** Change: the roster, to pick another drop. */
  readonly pickAnother = output<void>();
  /** The cross: nobody is the drop. */
  readonly cleared = output<void>();
}
