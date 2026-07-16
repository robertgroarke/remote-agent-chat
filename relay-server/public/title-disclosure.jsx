const { useEffect, useLayoutEffect, useRef, useState } = React;

const VIEWPORT_MARGIN = 12;
const SIDEBAR_GAP = 10;
const MAX_WIDTH = 360;
const MIN_DESKTOP_WIDTH = 210;
const TOUCH_HOLD_MS = 450;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function safeDisclosureId(value) {
  return `title-disclosure-${String(value || 'title').replace(/[^a-z0-9_-]+/gi, '-')}`;
}

function FullTitleDisclosure({
  title,
  disclosureKey,
  kind = 'title',
  wrapperClassName,
  triggerClassName,
  disclosureClassName,
  triggerLabel,
  triggerTag = 'button',
}) {
  const triggerRef = useRef(null);
  const disclosureRef = useRef(null);
  const touchTimerRef = useRef(null);
  const stateRef = useRef({ focused: false, hovered: false, latched: false });
  const [open, setOpen] = useState(false);
  const [latched, setLatched] = useState(false);
  const [placement, setPlacement] = useState(null);
  const disclosureId = safeDisclosureId(`${kind}-${disclosureKey}`);
  const Trigger = triggerTag;

  function syncOpen() {
    const state = stateRef.current;
    setOpen(state.focused || state.hovered || state.latched);
  }

  function closeDisclosure({ restoreFocus = false } = {}) {
    stateRef.current = { focused: false, hovered: false, latched: false };
    setLatched(false);
    setPlacement(null);
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }

  function latchDisclosure() {
    stateRef.current.latched = true;
    setLatched(true);
    setOpen(true);
  }

  function clearTouchTimer() {
    if (!touchTimerRef.current) return;
    clearTimeout(touchTimerRef.current);
    touchTimerRef.current = null;
  }

  useEffect(() => () => clearTouchTimer(), []);

  useEffect(() => {
    if (!open || !latched) return undefined;
    const dismiss = event => {
      if (triggerRef.current?.contains(event.target) || disclosureRef.current?.contains(event.target)) return;
      closeDisclosure();
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open, latched]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    let frame = null;
    const updatePlacement = () => {
      frame = null;
      const trigger = triggerRef.current;
      const disclosure = disclosureRef.current;
      if (!trigger || !disclosure) return;
      const anchor = trigger.getBoundingClientRect();
      if (anchor.bottom <= 0 || anchor.top >= window.innerHeight || anchor.right <= 0 || anchor.left >= window.innerWidth) {
        closeDisclosure();
        return;
      }
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
      const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches === true || viewportWidth <= 640;
      const rightEdge = Math.max(anchor.right, sidebar?.right || anchor.right);
      const availableRight = viewportWidth - rightEdge - SIDEBAR_GAP - VIEWPORT_MARGIN;
      const measuredHeight = disclosure.getBoundingClientRect().height;

      if (!coarsePointer && availableRight >= MIN_DESKTOP_WIDTH) {
        const width = Math.min(MAX_WIDTH, availableRight);
        const top = clamp(anchor.top, VIEWPORT_MARGIN, viewportHeight - measuredHeight - VIEWPORT_MARGIN);
        setPlacement({
          mode: 'right',
          left: rightEdge + SIDEBAR_GAP,
          top,
          width,
        });
        return;
      }

      setPlacement({
        mode: 'sheet',
        bottom: VIEWPORT_MARGIN,
        left: VIEWPORT_MARGIN,
        width: Math.min(MAX_WIDTH, viewportWidth - (VIEWPORT_MARGIN * 2)),
      });
    };
    const schedulePlacement = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(updatePlacement);
    };
    schedulePlacement();
    window.addEventListener('resize', schedulePlacement);
    document.addEventListener('scroll', schedulePlacement, true);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedulePlacement);
      document.removeEventListener('scroll', schedulePlacement, true);
    };
  }, [open, title]);

  const triggerProps = {
    ref: triggerRef,
    className: triggerClassName,
    role: triggerTag === 'button' ? undefined : 'button',
    type: triggerTag === 'button' ? 'button' : undefined,
    tabIndex: triggerTag === 'button' ? undefined : 0,
    'aria-label': triggerLabel,
    'aria-describedby': open ? disclosureId : undefined,
    'aria-expanded': open,
    onPointerEnter: event => {
      if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      stateRef.current.hovered = true;
      syncOpen();
    },
    onPointerLeave: event => {
      if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      stateRef.current.hovered = false;
      syncOpen();
    },
    onPointerDown: event => {
      if (event.pointerType !== 'touch') return;
      clearTouchTimer();
      touchTimerRef.current = setTimeout(() => {
        touchTimerRef.current = null;
        latchDisclosure();
      }, TOUCH_HOLD_MS);
    },
    onPointerUp: clearTouchTimer,
    onPointerCancel: clearTouchTimer,
    onFocus: () => {
      stateRef.current.focused = true;
      syncOpen();
    },
    onBlur: () => {
      stateRef.current.focused = false;
      syncOpen();
    },
    onClick: event => {
      event.stopPropagation();
      latchDisclosure();
    },
    onContextMenu: event => {
      event.preventDefault();
      event.stopPropagation();
      latchDisclosure();
    },
    onKeyDown: event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDisclosure({ restoreFocus: true });
        return;
      }
      if (triggerTag !== 'button' && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        latchDisclosure();
      }
    },
  };

  const resolvedPlacement = placement || {
    mode: 'measuring', left: -10000, top: VIEWPORT_MARGIN, width: MAX_WIDTH,
  };
  const portal = open && ReactDOM.createPortal(
    <div
      ref={disclosureRef}
      id={disclosureId}
      className={`title-disclosure-portal ${disclosureClassName || ''}`.trim()}
      role="tooltip"
      data-title-disclosure-for={disclosureKey}
      data-title-disclosure-kind={kind}
      data-placement={resolvedPlacement.mode}
      style={{
        left: `${resolvedPlacement.left}px`,
        top: resolvedPlacement.top == null ? 'auto' : `${resolvedPlacement.top}px`,
        bottom: resolvedPlacement.bottom == null ? 'auto' : `${resolvedPlacement.bottom}px`,
        width: resolvedPlacement.mode === 'sheet' ? `${resolvedPlacement.width}px` : 'max-content',
        maxWidth: `${resolvedPlacement.width}px`,
        minWidth: `${Math.min(MIN_DESKTOP_WIDTH, resolvedPlacement.width)}px`,
      }}
    >
      {title}
    </div>,
    document.body,
  );

  return (
    <div className={wrapperClassName}>
      <Trigger {...triggerProps}>{title}</Trigger>
      {portal}
    </div>
  );
}

export { FullTitleDisclosure };
