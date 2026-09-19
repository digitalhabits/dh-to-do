"use client";

import {
  Broom,
  Bug,
  Code,
  CreativeCommons,
  Database,
  GraduationCap,
  HandCoins,
  Landmark,
  Megaphone,
  Microscope,
  NotebookPen,
  Palette,
  Scale,
  School,
  Shield,
  Smartphone,
  Users,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";

/** Default swatches in the list appearance picker. */
export const LIST_ICON_PRESETS = [
  "megaphone",
  "school",
  "landmark",
  "microscope",
  "hand-coins",
  "users",
  "database",
  "shield",
  "scale",
  "creative-commons",
  "code",
  "bug",
  "notebook-pen",
  "graduation-cap",
  "broom",
  "palette",
  "smartphone",
] as const;

export type ListIconPresetId = (typeof LIST_ICON_PRESETS)[number];

/** Any Lucide kebab-case name we can store / render. */
export type ListIconId = IconName | ListIconPresetId;

const PRESET_ICONS: Record<ListIconPresetId, LucideIcon> = {
  megaphone: Megaphone,
  school: School,
  landmark: Landmark,
  microscope: Microscope,
  "hand-coins": HandCoins,
  users: Users,
  database: Database,
  shield: Shield,
  scale: Scale,
  "creative-commons": CreativeCommons,
  code: Code,
  bug: Bug,
  "notebook-pen": NotebookPen,
  "graduation-cap": GraduationCap,
  broom: Broom,
  palette: Palette,
  smartphone: Smartphone,
};

/** Map previously stored unicode presets → Lucide ids. */
const LEGACY_EMOJI_TO_ICON: Record<string, ListIconId> = {
  "🎯": "target",
  "💪": "dumbbell",
  "📚": "book-open",
  "📱": "smartphone",
  "🌳": "tree-deciduous",
  "🎉": "party-popper",
  "🛏️": "bed",
  "🎹": "piano",
};

const ICON_NAME_SET = new Set<string>(iconNames);

/** The two letters a list with no icon is drawn as: "PR" for "Product". */
export function listInitials(name: string): string {
  const letters = name.replace(/[^\p{L}\p{N}]+/gu, "");
  return (letters.slice(0, 2) || name.slice(0, 2) || "?").toUpperCase();
}

export function isListIconId(value: string): value is ListIconId {
  return ICON_NAME_SET.has(value);
}

export function isListIconPresetId(value: string): value is ListIconPresetId {
  return (LIST_ICON_PRESETS as readonly string[]).includes(value);
}

/** Resolve a stored list appearance value to a Lucide icon id, if any. */
export function resolveListIconId(
  stored: string | null | undefined
): ListIconId | null {
  if (!stored) return null;
  const trimmed = stored.trim();
  if (!trimmed) return null;
  if (isListIconId(trimmed)) return trimmed;
  const fromEmoji = LEGACY_EMOJI_TO_ICON[trimmed];
  if (fromEmoji) return fromEmoji;
  // Accept accidental PascalCase from older tooling.
  const kebab = trimmed
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
  if (isListIconId(kebab)) return kebab;
  return null;
}

export function getAllListIconIds(): readonly ListIconId[] {
  return iconNames;
}

export function ListIcon({
  id,
  className,
  size = 14,
  strokeWidth = 2,
  ...props
}: {
  id: ListIconId;
  className?: string;
  size?: number;
  strokeWidth?: number;
} & Omit<LucideProps, "ref" | "name">) {
  const Preset = isListIconPresetId(id) ? PRESET_ICONS[id] : null;
  if (Preset) {
    return (
      <Preset
        {...props}
        className={className}
        size={size}
        strokeWidth={strokeWidth}
        aria-hidden="true"
      />
    );
  }
  return (
    <DynamicIcon
      {...props}
      name={id as IconName}
      className={className}
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden="true"
    />
  );
}
