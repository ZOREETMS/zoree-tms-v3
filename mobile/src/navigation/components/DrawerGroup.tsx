/**
 * DrawerGroup — collapsible section row inside the mobile drawer.
 *
 * Renders a header (icon + uppercase label + chevron) and, when
 * expanded, a list of children. Visual style intentionally matches the
 * 2026-05-13 mockups — pill background for the active row, indented
 * panel for children, soft accent for highlighted items.
 *
 * This component is presentation-only; the actual navigate() call is
 * handled by the parent (DrawerSidebar). Keeping it stateless lets
 * higher-level routing logic stay testable and avoids the component
 * holding stale navigation objects.
 */
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { colors, fontSize, fontWeight, spacing } from '../../theme';
import type { DrawerNavGroup, DrawerNavItem } from '../drawerNavConfig';

// LayoutAnimation needs an explicit opt-in on Android, otherwise the
// expand/collapse falls back to an instant snap and feels off.
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface DrawerGroupProps {
  group: DrawerNavGroup;
  /** Currently focused drawer tab — drives header highlight. */
  activeTab: string | undefined;
  /** Currently focused nested screen — drives child highlight. */
  activeScreen: string | undefined;
  /** True if this group is currently expanded. */
  expanded: boolean;
  /** Toggle expansion. Parent owns the state to allow single-open mode. */
  onToggle: () => void;
  /** Tapping a child row routes through here. */
  onSelectItem: (item: DrawerNavItem) => void;
}

export default function DrawerGroup({
  group,
  activeTab,
  activeScreen,
  expanded,
  onToggle,
  onSelectItem,
}: DrawerGroupProps) {
  const isActiveGroup = activeTab === group.tab;

  const handleToggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle();
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={handleToggle}
        style={[styles.header, (expanded || isActiveGroup) && styles.headerActive]}>
        <Text style={styles.icon}>{group.icon}</Text>
        <Text
          style={[
            styles.label,
            (expanded || isActiveGroup) && styles.labelActive,
          ]}
          numberOfLines={1}>
          {group.label}
        </Text>
        <Text
          style={[
            styles.chevron,
            (expanded || isActiveGroup) && styles.chevronActive,
          ]}>
          {expanded ? '⌄' : '›'}
        </Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.childPanel}>
          {group.children.map((child) => {
            const isActive =
              isActiveGroup && activeScreen === child.screen;
            return (
              <TouchableOpacity
                key={`${child.tab}:${child.screen}`}
                activeOpacity={0.7}
                onPress={() => onSelectItem(child)}
                style={[styles.childRow, isActive && styles.childRowActive]}>
                {!!child.icon && (
                  <Text style={styles.childIcon}>{child.icon}</Text>
                )}
                <Text
                  style={[styles.childLabel, isActive && styles.childLabelActive]}
                  numberOfLines={1}>
                  {child.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
  },
  headerActive: {
    backgroundColor: 'rgba(37,99,235,0.18)',
  },
  icon: {
    fontSize: fontSize.lg,
    marginRight: spacing.md,
  },
  label: {
    flex: 1,
    color: 'rgba(255,255,255,0.78)',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  labelActive: {
    color: colors.accent,
  },
  chevron: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    marginLeft: spacing.sm,
  },
  chevronActive: {
    color: colors.accent,
  },
  childPanel: {
    marginTop: spacing.xs,
    marginLeft: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    paddingVertical: spacing.xs,
  },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  childRowActive: {
    backgroundColor: 'rgba(37,99,235,0.14)',
    borderRadius: 10,
    marginHorizontal: spacing.xs,
  },
  childIcon: {
    width: 22,
    fontSize: fontSize.md,
    marginRight: spacing.sm,
    color: 'rgba(255,255,255,0.7)',
  },
  childLabel: {
    flex: 1,
    color: 'rgba(255,255,255,0.85)',
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  childLabelActive: {
    color: colors.white,
    fontWeight: fontWeight.semibold,
  },
});
