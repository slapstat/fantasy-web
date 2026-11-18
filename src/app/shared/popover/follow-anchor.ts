import { OverlayRef } from '@angular/cdk/overlay';

/**
 * Keeps a connected overlay on the element it hangs from for as long as it is open, and says
 * when that element is gone.
 *
 * <p>CDK's connected position is worked out when the overlay opens and again only when the window
 * scrolls or resizes. Everything else that moves the anchor left the overlay where it was: a list
 * that finishes loading above the button, a section that unfolds, a column that appears, the
 * panel's own content growing. The calendar under Player Scout's "Change since" was found well
 * away from its button that way, and the tooltips with it (Alexander, 2026-11-18). And with
 * `withPush`, which keeps a panel on screen where neither side of the anchor fits, a panel whose
 * button had scrolled out of the window was held on screen with nothing to point at.
 *
 * <p>So each frame while the overlay is open this reads where the anchor is and repositions the
 * overlay when it moved; one rectangle a frame, only while something is open. A resize of the
 * panel itself repositions it too. When the anchor leaves the document, is hidden, or is out of
 * the window altogether, `gone` is called: the overlay's owner closes it through its own path, so
 * its open state (an `aria-expanded`, a chevron) never disagrees with what is on screen.
 *
 * <p>Stops by itself when the overlay detaches; the returned function stops it sooner.
 */
export function followAnchor(
  overlayRef: OverlayRef,
  anchor: HTMLElement,
  gone: () => void,
): () => void {
  let frame: number | null = null;
  let last: DOMRect | null = null;
  let stopped = false;

  const resize =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => overlayRef.updatePosition())
      : null;
  resize?.observe(overlayRef.overlayElement);

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }
    resize?.disconnect();
    detached.unsubscribe();
  };
  const detached = overlayRef.detachments().subscribe(stop);

  const check = () => {
    frame = null;
    if (stopped) {
      return;
    }
    if (anchorGone(anchor)) {
      stop();
      gone();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    if (last && !sameBox(last, rect)) {
      overlayRef.updatePosition();
    }
    last = rect;
    frame = requestAnimationFrame(check);
  };

  if (typeof requestAnimationFrame === 'function') {
    frame = requestAnimationFrame(check);
  }
  return stop;
}

/** Out of the document, hidden, or scrolled wholly out of the window. */
function anchorGone(anchor: HTMLElement): boolean {
  if (!anchor.isConnected || anchor.checkVisibility?.() === false) {
    return true;
  }
  const rect = anchor.getBoundingClientRect();
  return (
    rect.bottom < 0 ||
    rect.right < 0 ||
    rect.top > window.innerHeight ||
    rect.left > window.innerWidth
  );
}

function sameBox(a: DOMRect, b: DOMRect): boolean {
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}
