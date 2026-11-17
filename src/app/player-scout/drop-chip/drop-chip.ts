import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../../shared/icon/icon';
import { TooltipDirective } from '../../shared/tooltip/tooltip.directive';

/**
 * The drop picked, as one pill on the list's toolbar: whom the lineup column is set against. It
 * is a setting of the list, like the comparison beside it, so it is drawn as one rather than as
 * a band over the list; what his going costs is already in every gain under it and on his chip
 * in the room line. The words take the reader back to the roster to pick another; the cross lets
 * him go.
 */
@Component({
  selector: 'app-drop-chip',
  imports: [IconComponent, TooltipDirective],
  templateUrl: './drop-chip.html',
  styleUrl: './drop-chip.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DropChipComponent {
  /** The drop's name. */
  readonly name = input.required<string>();

  /** The words: the roster, to pick another drop. */
  readonly pickAnother = output<void>();
  /** The cross: nobody is the drop. */
  readonly cleared = output<void>();
}
