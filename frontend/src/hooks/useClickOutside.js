import { useEffect } from "react";

export default function useClickOutside(ref, onOutside, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    function handler(e) {
      if (!ref.current) return;
      if (ref.current.contains(e.target)) return;
      onOutside(e);
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [ref, onOutside, enabled]);
}
