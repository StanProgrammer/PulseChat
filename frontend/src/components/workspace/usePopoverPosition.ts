import { useCallback, useEffect, useRef, useState } from 'react';

export type Placement = 'top' | 'bottom';

export interface PopoverPosition {
  left: number;
  top: number;
}

export interface UsePopoverPositionOptions {
  isOpen: boolean;
  triggerRef: React.RefObject<HTMLElement | null>;
  preferredPlacement?: Placement;
  width: number;
  height: number;
  gap?: number;
}

export interface UsePopoverPositionReturn {
  style: React.CSSProperties | undefined;
  placement: Placement;
  popoverRef: React.RefObject<HTMLDivElement | null>;
}

/** Fixed-position popover style with scroll-aware repositioning and viewport clamping. */
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

    // Use rendered height if available, else fall back to estimate
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

    // Try preferred, flip if insufficient space
    if (tryTop) {
      if (spaceAbove >= height) {
        resolvedPlacement = 'top';
        top = triggerRect.top - gap - height;
      } else if (spaceBelow >= height) {
        resolvedPlacement = 'bottom';
        top = triggerRect.bottom + gap;
      } else if (spaceAbove >= spaceBelow) {
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

    // Center on trigger, clamped to viewport
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
        actualHeightRef.current = estimatedHeight;
    }
  }, [isOpen, compute, estimatedHeight]);

  // Re-measure after mount for accurate height
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

  // Recompute on scroll/resize to keep popover anchored
  useEffect(() => {
    if (!isOpen) return;

    const handleChange = () => compute();
    // Capture phase catches scroll from any ancestor
    window.addEventListener('scroll', handleChange, { passive: true, capture: true });
    window.addEventListener('resize', handleChange, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleChange, { capture: true });
      window.removeEventListener('resize', handleChange);
    };
  }, [isOpen, compute]);

  return { style, placement, popoverRef };
}
