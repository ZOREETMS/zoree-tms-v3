import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * RowActionsMenu — primary button + kebab dropdown for table rows.
 *
 * The dropdown is rendered through a React portal into <body> using fixed
 * positioning so it cannot be clipped by ancestor `overflow: auto/hidden`
 * containers (e.g. the `.card` wrapping the orders table). Without the
 * portal, filtering the table down to a small number of rows shrinks the
 * card and the menu falls outside the clip rect — making it look like the
 * kebab "doesn't open" when in fact only the visual is being cut off.
 */
export default function RowActionsMenu({ primary, items = [], busy = false }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);
  const kebabRef = useRef(null);
  const menuRef = useRef(null);

  const visibleItems = items.filter((it) => it && !it.hidden);

  // Position the portal-rendered menu relative to the kebab button.
  // Right-aligns the menu's right edge with the kebab's right edge,
  // matching the previous `right: 0` absolute behavior.
  //
  // QA #153: also flip the menu ABOVE the kebab when there's not enough
  // vertical space below, and re-measure the menu's own height so the
  // anchor accounts for the actual content. Without this, rows near the
  // bottom of a small viewport showed the menu clipped by the viewport
  // edge — exactly the "options are partially visible" symptom users hit.
  useLayoutEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const btn = kebabRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const menuEl = menuRef.current;
      const menuH = menuEl ? menuEl.getBoundingClientRect().height : 0;
      const gap = 6;
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      // Flip up only when below is too tight AND above has more room —
      // otherwise stay below and let the menu's own max-height/scroll
      // handle the overflow.
      const flipUp = menuH > spaceBelow - gap && spaceAbove > spaceBelow;
      setPos({
        top: flipUp ? Math.max(8, r.top - menuH - gap) : r.bottom + gap,
        right: Math.max(8, window.innerWidth - r.right),
      });
    };
    updatePos();
    // Run a second time on the next frame so we know the menu's measured
    // height once it has rendered (first pass uses 0 → flipUp false).
    const raf = requestAnimationFrame(updatePos);
    // capture-phase scroll so we react to scrolls in any ancestor (e.g. the
    // page body or the table-wrap horizontal scroller).
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open]);

  // Click-outside: must consider both the wrapper (kebab + primary button)
  // AND the portaled menu as "inside" — otherwise mousedown on a menu item
  // would close the menu before the click handler can fire.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open]);

  return (
    <div className="row-actions" ref={wrapRef}>
      {primary && (
        <button
          className={`btn ${primary.variant || "btn-primary"} btn-sm`}
          disabled={busy || primary.disabled}
          onClick={(e) => { e.stopPropagation(); primary.onClick?.(); }}
          title={primary.title || primary.label}
        >
          {primary.icon ? <span className="row-actions-icon">{primary.icon}</span> : null}
          {primary.label}
        </button>
      )}

      {visibleItems.length > 0 && (
        <button
          ref={kebabRef}
          type="button"
          className={`kebab-btn ${open ? "open" : ""}`}
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        >
          <span aria-hidden="true">⋮</span>
        </button>
      )}

      {open && visibleItems.length > 0 && pos && createPortal(
        <div
          ref={menuRef}
          className="row-actions-menu"
          role="menu"
          style={{
            position: "fixed",
            top: pos.top,
            right: pos.right,
            zIndex: 1000,
          }}
        >
          {visibleItems.map((it, i) => {
            if (it.divider) return <div key={`d-${i}`} className="row-actions-divider" />;
            const tone = it.tone ? `tone-${it.tone}` : "";
            return (
              <button
                key={it.key || it.label || i}
                role="menuitem"
                className={`row-actions-item ${tone}`}
                disabled={it.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  it.onClick?.();
                }}
              >
                {it.icon ? <span className="row-actions-icon">{it.icon}</span> : null}
                <span className="row-actions-label">{it.label}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
