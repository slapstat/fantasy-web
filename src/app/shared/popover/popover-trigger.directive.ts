import {
  DestroyRef,
  Directive,
  ElementRef,
  TemplateRef,
  ViewContainerRef,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  ConnectedPosition,
  Overlay,
  OverlayPositionBuilder,
  OverlayRef,
} from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { OpenPopovers } from './open-popovers';

/**
 * Opens a template as a popover anchored to the host element.
 *
 * The table's settings all hang off small triggers — a column's menu button, the toolbar's
 * league button — so this keeps the overlay wiring (positioning, outside-click, Escape, Enter) in one
 * place. Content is a plain `<ng-template>` in the declaring component, which means the
 * component's own styles and bindings still apply inside the overlay.
 */
const FOCUSABLE_SELECTOR =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

const INITIAL_FOCUS_SELECTOR = '[data-popover-initial-focus]:not([disabled])';

// A field that holds a value, as opposed to one that filters a list: a search box keeps its menu
// open on Enter, because the list under it is what the user came for.
const VALUE_FIELD_SELECTOR = 'input[type="number"], input[type="text"], input:not([type])';

const POPOVER_POSITIONS: Record<'start' | 'end', ConnectedPosition[]> = {
  start: [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
  ],
  end: [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
  ],
};

@Directive({
  selector: '[appPopover]',
  exportAs: 'appPopover',
  host: {
    '(click)': 'toggle()',
    '[attr.aria-expanded]': 'isOpen()',
    '[attr.aria-haspopup]': '"dialog"',
  },
})
export class PopoverTriggerDirective {
  private readonly overlay = inject(Overlay);
  private readonly positionBuilder = inject(OverlayPositionBuilder);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly openPopovers = inject(OpenPopovers);

  readonly appPopover = input.required<TemplateRef<unknown>>();
  readonly popoverAlign = input<'start' | 'end'>('end');
  /** Lets one declared template serve every column, parameterised by the column it opened for. */
  readonly popoverContext = input<Record<string, unknown> | undefined>(undefined);
  /**
   * What a screen reader calls the panel, where the trigger's own words do not say it: a trigger
   * whose text is the value picked ("15 Oct") names nothing. Unset, the trigger names the panel.
   */
  readonly popoverLabel = input<string | undefined>(undefined);

  readonly isOpen = signal(false);
  private overlayRef: OverlayRef | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close());
  }

  toggle(): void {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  open(): void {
    if (this.overlayRef) {
      return;
    }
    this.overlayRef = this.overlay.create({
      positionStrategy: this.positionBuilder
        .flexibleConnectedTo(this.host.nativeElement)
        .withPositions(POPOVER_POSITIONS[this.popoverAlign()])
        .withPush(true),
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      panelClass: 'app-popover-panel',
    });
    this.overlayRef.attach(
      new TemplatePortal(this.appPopover(), this.viewContainerRef, this.popoverContext()),
    );

    // The overlay is appended at the end of the document, so a keyboard user tabbing off the
    // trigger would otherwise walk past the menu they just opened into the rest of the page.
    // Moving focus in on open — and back to the trigger on close — is what makes it reachable.
    const panel = this.overlayRef.overlayElement;
    panel.setAttribute('role', 'dialog');
    // The toolbar's triggers carry their own label as text; a column's is an icon-only button whose
    // aria-label is the only thing saying which column it belongs to.
    panel.setAttribute(
      'aria-label',
      this.popoverLabel() ||
        this.host.nativeElement.textContent?.trim() ||
        this.host.nativeElement.getAttribute('aria-label') ||
        'Menu',
    );
    panel.setAttribute('tabindex', '-1');
    // A menu of one choice among several opens on the choice already made, as a native radio
    // group does: it marks that control itself, and the first control is the fallback.
    (
      panel.querySelector<HTMLElement>(INITIAL_FOCUS_SELECTOR) ??
      panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      panel
    ).focus();

    // Non-modal, so tabbing past the last control should leave rather than cycle — but a menu left
    // hanging open behind the focus is clutter, so it closes itself on the way out. A null
    // relatedTarget is focus leaving for the document (a click on empty space), which
    // outsidePointerEvents already handles.
    panel.addEventListener('focusout', (event) => {
      const next = event.relatedTarget as Node | null;
      if (next && !panel.contains(next) && !this.host.nativeElement.contains(next)) {
        // Focus is already on its way somewhere else, so this close must not restore it — during
        // focusout the element losing focus is still the active one, and putting it back on the
        // trigger would undo the very Tab that closed the menu.
        this.close(false);
      }
    });

    this.overlayRef.keydownEvents().subscribe((event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.close();
      } else if (
        event.key === 'Enter' &&
        !event.isComposing &&
        (event.target as Element).matches(VALUE_FIELD_SELECTOR)
      ) {
        // Every field in a popover saves as it is typed, so nothing on screen says the value is in.
        // Enter is how a user says "done" — without it the only way out of a menu they just typed
        // into is to reach for the mouse and click somewhere else.
        this.close();
      }
    });
    // The host's own click would otherwise re-open the popover we just dismissed.
    this.overlayRef.outsidePointerEvents().subscribe((event) => {
      if (!this.host.nativeElement.contains(event.target as Node)) {
        this.close();
      }
    });

    this.openPopovers.add(this);
    this.isOpen.set(true);
  }

  /** `restoreFocus` is for the caller that already knows where focus is going — see the focusout
   * handler in {@link open}. */
  close(restoreFocus = true): void {
    // Only pull focus back when it is inside the popover; closing on an outside click must leave
    // focus wherever the click put it.
    const panel = this.overlayRef?.overlayElement;
    const heldFocus = restoreFocus && !!panel && panel.contains(document.activeElement);
    this.openPopovers.remove(this);
    this.overlayRef?.dispose();
    this.overlayRef = null;
    this.isOpen.set(false);
    // isConnected guards the destroy path, where the trigger is on its way out of the document.
    if (heldFocus && this.host.nativeElement.isConnected) {
      this.host.nativeElement.focus();
    }
  }
}
