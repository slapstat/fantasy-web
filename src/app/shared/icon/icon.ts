import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import {
  lucideArrowDown,
  lucideArrowLeft,
  lucideArrowLeftRight,
  lucideArrowRight,
  lucideArrowUp,
  lucideArrowUpDown,
  lucideArrowUpToLine,
  lucideBell,
  lucideBellOff,
  lucideCalendarDays,
  lucideChartColumn,
  lucideChartNoAxesColumn,
  lucideCheck,
  lucideChevronDown,
  lucideChevronLeft,
  lucideChevronRight,
  lucideCircle,
  lucideCircleCheck,
  lucideClipboardList,
  lucideColumns3,
  lucideCopy,
  lucideDecimalsArrowRight,
  lucideEllipsisVertical,
  lucideFileSpreadsheet,
  lucideFlame,
  lucideGripVertical,
  lucideHourglass,
  lucideImport,
  lucideInfo,
  lucideLink,
  lucideListOrdered,
  lucideLock,
  lucideMail,
  lucideMenu,
  lucidePencil,
  lucidePlay,
  lucidePlus,
  lucideRedo2,
  lucideRefreshCw,
  lucideRotateCcw,
  lucideSearch,
  lucideShare,
  lucideSlidersVertical,
  lucideSparkles,
  lucideSquareDashed,
  lucideStar,
  lucideTable,
  lucideTrash,
  lucideTriangleAlert,
  lucideTrophy,
  lucideUndo2,
  lucideUser,
  lucideUserMinus,
  lucideUserPlus,
  lucideUsers,
  lucideX,
} from '@ng-icons/lucide';

/**
 * Every icon the app shows, under the name the app gives it, mapped to the Lucide drawing it is.
 *
 * The app's names say what the icon is for (`close`, `refresh`, `more-vertical`) and Lucide's say
 * what it looks like (`x`, `refresh-cw`, `ellipsis-vertical`), so a call site never changes when a
 * drawing does. Adding an icon is one import and one line here: `@ng-icons/lucide` exports every
 * Lucide icon, and only the ones imported reach the bundle.
 */
const ICONS = {
  'alert-triangle': lucideTriangleAlert,
  'arrow-down': lucideArrowDown,
  'arrow-left': lucideArrowLeft,
  'arrow-left-right': lucideArrowLeftRight,
  'arrow-right': lucideArrowRight,
  'arrow-up': lucideArrowUp,
  'arrow-up-down': lucideArrowUpDown,
  'arrow-up-to-line': lucideArrowUpToLine,
  'calendar-days': lucideCalendarDays,
  'chart-bar': lucideChartColumn,
  'chart-columns': lucideChartNoAxesColumn,
  check: lucideCheck,
  'check-circle': lucideCircleCheck,
  'chevron-down': lucideChevronDown,
  'chevron-left': lucideChevronLeft,
  'chevron-right': lucideChevronRight,
  circle: lucideCircle,
  'clipboard-list': lucideClipboardList,
  close: lucideX,
  columns: lucideColumns3,
  copy: lucideCopy,
  decimals: lucideDecimalsArrowRight,
  flame: lucideFlame,
  follow: lucideBell,
  'grip-vertical': lucideGripVertical,
  hourglass: lucideHourglass,
  import: lucideImport,
  info: lucideInfo,
  link: lucideLink,
  'list-ordered': lucideListOrdered,
  lock: lucideLock,
  mail: lucideMail,
  menu: lucideMenu,
  'more-vertical': lucideEllipsisVertical,
  pencil: lucidePencil,
  play: lucidePlay,
  plus: lucidePlus,
  redo: lucideRedo2,
  refresh: lucideRefreshCw,
  'rotate-ccw': lucideRotateCcw,
  search: lucideSearch,
  share: lucideShare,
  sliders: lucideSlidersVertical,
  sparkles: lucideSparkles,
  spreadsheet: lucideFileSpreadsheet,
  'square-dashed': lucideSquareDashed,
  star: lucideStar,
  table: lucideTable,
  trash: lucideTrash,
  trophy: lucideTrophy,
  undo: lucideUndo2,
  unfollow: lucideBellOff,
  user: lucideUser,
  'user-minus': lucideUserMinus,
  'user-plus': lucideUserPlus,
  users: lucideUsers,
} satisfies Record<string, string>;

export type IconName = keyof typeof ICONS;

/**
 * The scale, in pixels: 14 inline with text, 16 (the default) on buttons and in menus, 20 standalone,
 * 48 for an empty or error state. An `em` length is for an icon that scales with the text around it,
 * like the padlock in a Premium badge. Anything else is a compile error, which is the point: the app
 * drifted to seven pixel sizes while the scale was only written down.
 */
export type IconSize = 14 | 16 | 20 | 48 | `${number}em`;

/** Every name, so the spec can walk the whole set. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/**
 * An icon from the Lucide set, drawn by ng-icon: a 24x24 grid, `currentColor`, no fill, stroke
 * width 2, round caps and joins, the same for every icon.
 *
 * One set is the point. The app's icons were once drawn by hand in each template, 61 inline SVGs
 * with six stroke widths and three icon families mixed, refresh drawn three ways. Collecting them
 * into hand-copied drawings in one file fixed the drift but left every new icon to be copied by
 * hand as well; sourcing them from the package means the drawing is Lucide's own every time.
 *
 * Only the size is settable, and only to a step on the scale (`IconSize`): a number is pixels, and an
 * `em` length such as `0.85em` lets an icon scale with the text around it. Colour comes from the
 * surrounding text, so an icon follows hover, disabled and danger states without being told.
 * Icons are `aria-hidden`: the accessible name belongs on the button or link around them.
 *
 * Brand marks (Yahoo, Google, Facebook) are not icons and are not here. They are multi-colour
 * logos at their owners' own scales: Yahoo's is `<app-yahoo-mark>`, and the sign-in buttons draw
 * their own. `.github/scripts/check-inline-icons.sh` allows those three templates an inline
 * `<svg>`, and fails the build on any other, and on a character typed where an icon belongs.
 */
@Component({
  selector: 'app-icon',
  imports: [NgIcon],
  template: '<ng-icon [svg]="svg()" [size]="cssSize()" aria-hidden="true" />',
  styleUrl: './icon.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  /** A step on the scale in pixels, or an `em` length. See `IconSize`. */
  readonly size = input<IconSize>(16);

  /** Undefined for a name outside the set, which ng-icon draws as nothing and does not warn about. */
  protected readonly svg = computed<string | undefined>(
    () => (ICONS as Record<string, string>)[this.name()],
  );

  protected readonly cssSize = computed(() => {
    const size = this.size();
    return typeof size === 'number' ? `${size}px` : size;
  });
}
