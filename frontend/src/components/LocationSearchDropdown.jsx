import React, { useEffect, useRef, useState } from "react";
import { LocationsApi } from "../lib/api";
import LocationCreateInlineModal from "./LocationCreateInlineModal";

// ═══════════════════════════════════════════════════════════════════
// REQ-29 — search-enabled Location Name input.
//
// Drop-in replacement for the plain <input> used inside
// LocationFieldsEditor when `enableSearch=true`. Controlled: the parent
// still owns the {name, city, state, zip} value; this component calls
// onSelect({name, city, state, zip}) when the user picks an existing
// location OR creates a new one. Clearing the input clears the whole
// object so sibling city/state/zip fields auto-clear per REQ-29.
//
// The caller passes `source` ('oms' or 'tms') to route the search
// against the right master table. Creates ALWAYS go to oms_locations
// (DB trigger propagates to TMS).
// ═══════════════════════════════════════════════════════════════════

const DEBOUNCE_MS = 200;

const INPUT_STYLE = {
  width: "100%",
  padding: "8px 10px",
  border: "1.5px solid var(--border)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const LIST_STYLE = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  zIndex: 40,
  margin: 0,
  padding: "4px 0",
  listStyle: "none",
  background: "#fff",
  border: "1px solid var(--border)",
  borderRadius: 8,
  boxShadow: "0 10px 24px rgba(16,24,40,.12)",
  maxHeight: 280,
  overflowY: "auto",
  fontSize: 13,
};

const ITEM_BTN_STYLE = {
  width: "100%",
  textAlign: "left",
  padding: "7px 12px",
  background: "transparent",
  border: 0,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
  color: "var(--text)",
};

const CREATE_BTN_STYLE = {
  ...ITEM_BTN_STYLE,
  color: "var(--accent, #2563eb)",
  fontWeight: 600,
  borderBottom: "1px solid var(--border)",
};

const MUTED_STYLE = {
  padding: "8px 12px",
  color: "var(--text3)",
  fontSize: 12,
};

/**
 * @param {Object} props
 * @param {"oms"|"tms"} [props.source="oms"]
 * @param {{name:string,city:string,state:string,zip:string}} props.value
 * @param {(next:{name:string,city:string,state:string,zip:string}) => void} props.onSelect
 * @param {string} [props.placeholder]
 */
export default function LocationSearchDropdown({
  source = "oms",
  value,
  onSelect,
  placeholder = "Location Name (e.g. Dallas DC)",
}) {
  const [term, setTerm] = useState(value?.name || "");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [modalOpen, setModalOpen] = useState(false);
  const boxRef = useRef(null);
  const abortRef = useRef(null);

  // Keep the input in sync if the parent reassigns `value`.
  useEffect(() => {
    if (value?.name !== undefined && value.name !== term) setTerm(value.name || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.name]);

  // Close on outside click.
  useEffect(() => {
    const onDown = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    if (abortRef.current) abortRef.current = false;
    const localAbort = { cancelled: false };
    abortRef.current = localAbort;

    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { locations = [] } = await LocationsApi.search(term, source, 20);
        if (!localAbort.cancelled) setResults(locations);
      } catch {
        if (!localAbort.cancelled) setResults([]);
      } finally {
        if (!localAbort.cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      localAbort.cancelled = true;
      clearTimeout(t);
    };
  }, [term, source, open]);

  const select = (loc) => {
    onSelect({
      name: loc.name || "",
      city: loc.city || "",
      state: loc.state || "",
      zip: loc.zip || "",
    });
    setTerm(loc.name || "");
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && open) {
      if (highlight >= 0 && results[highlight]) {
        e.preventDefault();
        select(results[highlight]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 10,
            top: "50%",
            transform: "translateY(-50%)",
            opacity: 0.55,
            fontSize: 13,
            pointerEvents: "none",
          }}
        >
          🔍
        </span>
        <input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          placeholder={placeholder}
          value={term}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
            setHighlight(-1);
            if (value?.name) {
              // user is editing away from a selected location — clear the
              // auto-populated city/state/zip so REQ-29 stays truthful.
              onSelect({ name: e.target.value, city: "", state: "", zip: "" });
            } else {
              onSelect({ ...(value || {}), name: e.target.value });
            }
          }}
          style={{ ...INPUT_STYLE, paddingLeft: 30 }}
          aria-label={placeholder}
        />
      </div>

      {open && (
        <ul role="listbox" style={LIST_STYLE}>
          <li>
            <button
              type="button"
              style={CREATE_BTN_STYLE}
              onClick={() => setModalOpen(true)}
              onMouseEnter={() => setHighlight(-1)}
            >
              + Create new location{term ? ` “${term}”` : ""}
            </button>
          </li>

          {loading && <li style={MUTED_STYLE}>Searching…</li>}

          {!loading && results.length === 0 && term.trim().length > 0 && (
            <li style={MUTED_STYLE}>No matches for “{term}”.</li>
          )}

          {results.map((loc, i) => (
            <li key={loc.id}>
              <button
                type="button"
                style={{
                  ...ITEM_BTN_STYLE,
                  background: highlight === i ? "#eef4ff" : "transparent",
                }}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => select(loc)}
                title={[loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(", ")}
              >
                <strong>{loc.name}</strong>
                <span style={{ color: "var(--text3)", fontWeight: 400 }}>
                  {" — "}
                  {[loc.city, loc.state, loc.zip].filter(Boolean).join(", ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <LocationCreateInlineModal
        show={modalOpen}
        initialName={term}
        onClose={() => setModalOpen(false)}
        onCreated={(loc) => {
          setModalOpen(false);
          select(loc);
        }}
      />
    </div>
  );
}
