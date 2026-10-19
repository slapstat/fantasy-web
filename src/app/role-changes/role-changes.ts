import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { from } from 'rxjs';
import { Api } from '../api/api';
import { roleChanges } from '../api/fn/role-changes/role-changes';
import { HelpTipComponent } from '../shared/help-tip/help-tip';
import { IconComponent } from '../shared/icon/icon';
import { LoadingIndicatorComponent } from '../shared/loading-indicator/loading-indicator';
import { ErrorStateComponent } from '../shared/error-state/error-state';
import { TeamLogoComponent } from '../shared/team-logo/team-logo';
import {
  formatIce,
  formatIceChange,
  formatShare,
  formatShareChange,
  lineLabel,
  rankRoleChanges,
  RoleDirection,
  RoleMeasure,
  RolePosition,
} from './role-changes.model';

/** The recent stretches offered: a week, a fortnight, a month of hockey. */
export const RECENT_GAME_OPTIONS = [3, 5, 10] as const;

/**
 * Role Changes: skaters whose job at their club just changed, read off their ice. Each skater's
 * club's last few games beside his baseline (his earlier games this season, or last season while
 * this one is young), for ice a night and his share of the club's power play, with where the
 * lineup page lists him now and before. Rising is the default, since a promotion is what a manager
 * hunts for; falling is one switch away, since a demotion is when to let a player go.
 */
@Component({
  selector: 'app-role-changes',
  imports: [
    IconComponent,
    HelpTipComponent,
    LoadingIndicatorComponent,
    ErrorStateComponent,
    TeamLogoComponent,
  ],
  templateUrl: './role-changes.html',
  styleUrl: './role-changes.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoleChangesComponent {
  private readonly api = inject(Api);

  protected readonly recentGameOptions = RECENT_GAME_OPTIONS;
  protected readonly recentGames = signal<number>(5);
  protected readonly direction = signal<RoleDirection>('rising');
  protected readonly measure = signal<RoleMeasure>('ice');
  protected readonly position = signal<RolePosition>('all');
  protected readonly search = signal('');
  protected readonly minGameOptions = [1, 2, 3] as const;
  protected readonly minGames = signal<number>(2);

  protected readonly measured = rxResource({
    params: () => ({ recentGames: this.recentGames() }),
    stream: ({ params }) => from(this.api.invoke(roleChanges, params)),
  });

  protected readonly rows = computed(() =>
    rankRoleChanges(this.measured.hasValue() ? this.measured.value().players : [], {
      direction: this.direction(),
      measure: this.measure(),
      position: this.position(),
      search: this.search(),
      minGames: this.minGames(),
    }),
  );

  protected readonly formatIce = formatIce;
  protected readonly formatIceChange = formatIceChange;
  protected readonly formatShare = formatShare;
  protected readonly formatShareChange = formatShareChange;
  protected readonly lineLabel = lineLabel;

  protected onRecentGames(event: Event): void {
    this.recentGames.set(Number((event.target as HTMLSelectElement).value));
  }

  protected onMinGames(event: Event): void {
    this.minGames.set(Number((event.target as HTMLSelectElement).value));
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected reload(): void {
    this.measured.reload();
  }
}
