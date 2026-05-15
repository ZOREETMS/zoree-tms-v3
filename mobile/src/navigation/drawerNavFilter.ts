/**
 * drawerNavFilter — apply role-based visibility to the drawer config.
 *
 * Why a separate module:
 *   - Keeps DrawerSidebar.tsx free of role logic (Rule 6 — services).
 *   - Lets a future test isolate the filter without rendering the
 *     drawer.
 *
 * Behaviour:
 *   - Each child is checked against config/roleMatrix.canSeeNav.
 *   - Groups marked restrictedToRoles are dropped wholesale when the
 *     active canonical role isn't in the whitelist — even if a child
 *     would otherwise pass canSeeNav (QA #331/#332/#338, where System
 *     stays admin-only and Settings remains reachable via its own
 *     dedicated group).
 *   - Empty groups are dropped entirely so the drawer doesn't show a
 *     collapsible header that opens onto nothing.
 */

import { DrawerNavGroup, DrawerNavItem } from './drawerNavConfig';
import { canSeeNav, canonicalRole } from '../config/roleMatrix';

export function filterDrawerGroups(
  groups: DrawerNavGroup[],
  role: string | null | undefined,
): DrawerNavGroup[] {
  const activeRole = canonicalRole(role);
  return groups
    .filter((g) => !g.restrictedToRoles || g.restrictedToRoles.includes(activeRole))
    .map((g) => ({
      ...g,
      children: g.children.filter((c: DrawerNavItem) => canSeeNav(c.label, role)),
    }))
    .filter((g) => g.children.length > 0);
}
