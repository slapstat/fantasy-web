import { Component, computed, input, model, output } from '@angular/core';
import { IconComponent } from '../icon/icon';

/**
 * Says how many players a projection gained when it was squared with the player pool. The pool
 * moves under a saved projection — a new season brings a new roster, and trades and call-ups
 * follow — and the server adds the newcomers on the read that notices. Rows appearing without a
 * word would read as something having happened to the projection, so it is said out loud.
 *
 * Players who have *left* the pool are a different matter and not this notice's job: their rows
 * are kept and merely hidden, which the table says for itself since it is the one hiding them.
 *
 * The server keeps the added players on the projection until the owner acknowledges them, so the
 * notice stays through a reload and on another device until "Got it" is pressed. It only asks: the
 * page clears the list, and the save that follows is what makes it stick.
 *
 * Forty new rows in a table of sixteen hundred are not findable by eye, so the notice carries the
 * filter to them. The table does the narrowing; the page binds the two to the same signal.
 */
@Component({
  selector: 'app-player-pool-notice',
  imports: [IconComponent],
  templateUrl: './player-pool-notice.html',
  styleUrl: './player-pool-notice.css',
})
export class PlayerPoolNoticeComponent {
  /** How many added players the owner has not acknowledged yet. */
  readonly newPlayerCount = input(0);

  /** Whether the table is narrowed to those players. */
  readonly newPlayersOnly = model(false);

  readonly acknowledged = output<void>();

  protected readonly show = computed(() => this.newPlayerCount() > 0);
}
