import { useCallback, useEffect, useRef, useState } from 'react';

export type Placement = 'top' | 'bottom';

export interface PopoverPosition {
  left: number;
  top: number;
}

export interface UsePopoverPositionOptions {
  /** Whether the popover is currently open */
  isOpen: boolean;
  /** Ref to the trigger button/element */
  triggerRef: React.RefObject<HTMLElement | null>;
  /** Preferred placement — defaults to 'top' (like Slack) */
  preferredPlacement?: Placement;
  /** Estimated/fixed popover width for initial placement decision */
  width: number;
  /** Estimated/fixed popover height for initial placement decision */
  height: number;
  /** Gap between trigger and popover in px */
  gap?: number;
}

export interface UsePopoverPositionReturn {
  /** The style object to apply to the portaled popover */
  style: React.CSSProperties | undefined;
  /** The actual resolved placement ('top' or 'bottom') */
  placement: Placement;
  /** Ref to attach to the popover element — used for measuring actual height after mount */
  popoverRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * A hook that computes fixed-position styles for floating popovers.
 *
 * Features:
 * - Defaults to showing **above** the trigger (like Slack), flips below if needed
 * - Re-positions on scroll and resize so the popover stays anchored
 * - Measures actual popover height after render for accurate placement
 * - Clamps within viewport bounds (8px margin)
 * - Returns both position and resolved placement for connector/arrow styling
 */
export function usePopoverPosition({
  isOpen,
  triggerRef,
  preferredPlacement = 'top',
  width,
  height: estimatedHeight,
  gap = 8
}: UsePopoverPositionOptions): UsePopoverPositionReturn {
  const [style, setStyle] = useState<React.CSSProperties | undefined>();
  const [placement, setPlacement] = useState<Placement>(preferredPlacement);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const actualHeightRef = useRef(estimatedHeight);

  const compute = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();

    // Use the actual rendered height if available, otherwise fall back to estimate
    const popoverEl = popoverRef.current;
    let height = estimatedHeight;
    if (popoverEl) {
      const measured = popoverEl.offsetHeight;
      if (measured > 0) {
        height = measured;
        actualHeightRef.current = measured;
      } else {
        height = actualHeightRef.current;
      }
    } else {
      height = actualHeightRef.current;
    }

    const spaceAbove = triggerRect.top - gap;
    const spaceBelow = window.innerHeight - triggerRect.bottom - gap;
    const viewportMargin = gap;

    let top: number;
    let resolvedPlacement: Placement;

    const tryTop = preferredPlacement === 'top';
    const tryBottom = preferredPlacement === 'bottom';

    // Try preferred placement first, flip if insufficient space
    if (tryTop) {
      if (spaceAbove >= height) {
        // Enough space above
        resolvedPlacement = 'top';
        top = triggerRect.top - gap - height;
      } else if (spaceBelow >= height) {
        // Not enough above but enough below — flip
        resolvedPlacement = 'bottom';
        top = triggerRect.bottom + gap;
      } else if (spaceAbove >= spaceBelow) {
        // Neither fits — choose the side with more space
        resolvedPlacement = 'top';
        top = Math.max(viewportMargin, triggerRect.top - gap - height);
      } else {
        resolvedPlacement = 'bottom';
        top = Math.min(
          window.innerHeight - height - viewportMargin,
          Math.max(viewportMargin, triggerRect.bottom + gap)
        );
      }
    } else {
      // Preferred placement is bottom
      if (spaceBelow >= height) {
        resolvedPlacement = 'bottom';
        top = triggerRect.bottom + gap;
      } else if (spaceAbove >= height) {
        resolvedPlacement = 'top';
        top = triggerRect.top - gap - height;
      } else if (spaceBelow >= spaceAbove) {
        resolvedPlacement = 'bottom';
        top = Math.min(
          window.innerHeight - height - viewportMargin,
          Math.max(viewportMargin, triggerRect.bottom + gap)
        );
      } else {
        resolvedPlacement = 'top';
        top = Math.max(viewportMargin, triggerRect.top - gap - height);
      }
    }

    // Center horizontally on the trigger, clamped to viewport
    let left = Math.round(triggerRect.left + (triggerRect.width - width) / 2);
    left = Math.max(viewportMargin, Math.min(left, window.innerWidth - width - viewportMargin));

    setPlacement(resolvedPlacement);
    setStyle({
      position: 'fixed',
      left,
      top: Math.round(top),
      zIndex: 100
    });
  }, [triggerRef, preferredPlacement, width, estimatedHeight, gap]);

  // Recompute whenever open state changes
  useEffect(() => {
    if (isOpen) {
      compute();
    } else {
      setStyle(undefined);
      // Reset the height ref so next open uses the initial estimate
      actualHeightRef.current = estimatedHeight;
    }
  }, [isOpen, compute, estimatedHeight]);

  // After the popover element is in the DOM, re-measure for accurate height
  useEffect(() => {
    if (!isOpen) return;

    const popoverEl = popoverRef.current;
    if (!popoverEl) return;

    const measured = popoverEl.offsetHeight;
    if (measured > 0 && measured !== actualHeightRef.current) {
      actualHeightRef.current = measured;
      compute();
    }
  }, [isOpen, compute]);

  // Recompute on scroll and resize while open, so the popover tracks the trigger
  useEffect(() => {
    if (!isOpen) return;

    const handleChange = () => compute();
    // Use capture phase to catch scroll events from any scrollable ancestor
    window.addEventListener('scroll', handleChange, { passive: true, capture: true });
    window.addEventListener('resize', handleChange, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleChange, { capture: true });
      window.removeEventListener('resize', handleChange);
    };
  }, [isOpen, compute]);

  return { style, placement, popoverRef };
}
