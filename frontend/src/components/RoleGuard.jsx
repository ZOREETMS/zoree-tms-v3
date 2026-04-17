// ═══════════════════════════════════════════════════════════════════
// RoleGuard — REQ-04 route-level access control.
//
// Wraps a page component. If the current user's role cannot access the
// route's path (per roleMatrix.canAccessPath), redirects the user to
// their role-appropriate landing page and shows a subtle toast-ish
// banner explaining the redirect.
//
// Usage in App.jsx:
//   <Route path="/freight-invoices" element={
//     <RoleGuard><FreightInvoicesPage /></RoleGuard>
//   } />
//
// The guard is intentionally permissive on unknown paths so we don't
// regress any pages not yet mapped in roleMatrix.
// ═══════════════════════════════════════════════════════════════════

import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../state/AuthContext";
import { canAccessPath, landingPathFor, canonicalRole } from "../config/roleMatrix";

export default function RoleGuard({ children }) {
  const { user } = useAuth();
  const loc = useLocation();
  const role = canonicalRole(user?.activeRole || user?.role);
  // canAccessPath returns true for unknown paths if role === 'admin',
  // and false for known paths not in the visible set. We only redirect
  // when the user has an explicit, known denial.
  const allowed = canAccessPath(loc.pathname, role);
  if (allowed) return children;

  const dest = landingPathFor(role);
  // Safety: never loop — if the landing page would itself be denied,
  // fall through to render anyway rather than bouncing forever.
  if (dest === loc.pathname) return children;
  return <Navigate to={dest} replace state={{ from: loc.pathname, deniedRole: role }} />;
}
