import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { YahooMarkComponent } from '../yahoo-mark/yahoo-mark';

/** A fantasy platform a league can be read from. */
export type Platform = 'yahoo' | 'espn';

/**
 * The Yahoo / ESPN switch every screen that reads a league from a platform puts above it, so the
 * choice looks and behaves the same wherever it is made: the league settings' import, and Team
 * Power Rankings. Which platforms are on offer, and what choosing one opens, stay the screen's.
 */
@Component({
  selector: 'app-platform-tabs',
  imports: [YahooMarkComponent],
  templateUrl: './platform-tabs.html',
  styleUrl: './platform-tabs.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.platform-tabs--compact]': 'compact()' },
})
export class PlatformTabsComponent {
  /** The platforms to offer, in order. */
  readonly platforms = input.required<readonly Platform[]>();
  /** What the tabs are a choice of, for a screen reader. */
  readonly label = input.required<string>();
  /** The platform chosen, or `none` while nothing is. */
  readonly selected = input<Platform | 'none'>('none');
  /**
   * On a phone, the marks alone: the names leave the layout but stay each tab's accessible name.
   * For a line that must also hold the league beside the tabs.
   */
  readonly compact = input(false);
  /** A tab clicked; `[(selected)]` opens it at once. */
  readonly selectedChange = output<Platform>();
}
