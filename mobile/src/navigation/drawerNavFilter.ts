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
 *   - Empty groups are dropped entirely so the drawer doesn't show a
 *     collapsible header that opens onto nothing.
 */

import { DrawerNavGroup, DrawerNavItem } from './drawerNavConfig';
import { canSeeNav } from '../config/roleMatrix';

export function filterDrawerGroups(
  groups: DrawerNavGroup[],
  role: string | null | undefined,
): DrawerNavGroup[] {
  return groups
    .map((g) => ({
      ...g,
      children: g.children.filter((c: DrawerNavItem) => canSeeNav(c.label, role)),
    }))
    .filter((g) => g.children.length > 0);
}
