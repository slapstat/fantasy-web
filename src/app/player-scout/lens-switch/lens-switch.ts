import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';
import { ScoutLens } from '../scout-ranking';

/**
 * What every heading of the list sorts by, with a comparison on: each figure, or its change since
 * the chosen day. One switch for the table, where a second control under each heading had been;
 * the table draws the line it sorts by as the figure to read.
 */
@Component({
  selector: 'app-lens-switch',
  imports: [TooltipDirective],
  templateUrl: './lens-switch.html',
  styleUrl: './lens-switch.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'group', 'aria-label': 'Sort the columns by' },
})
export class LensSwitchComponent {
  readonly lens = input.required<ScoutLens>();
  /** The day compared with, for the Change side's tooltip: "vs 7 Oct". */
  readonly sinceLabel = input<string>('');
  readonly picked = output<ScoutLens>();
}
