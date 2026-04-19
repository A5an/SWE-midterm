import type { DocumentPermissionEntry, DocumentVersionSummary, SharingRole } from "@swe-midterm/contracts";

export type EffectiveDocumentRole = "owner" | "editor" | "viewer" | "unknown";

const ROLE_PRIORITY: Record<SharingRole, number> = {
  owner: 0,
  editor: 1,
  viewer: 2
};

export const resolveEffectiveDocumentRole = (
  ownerControlsAvailable: boolean,
  editAccess: boolean | null
): EffectiveDocumentRole => {
  if (ownerControlsAvailable) {
    return "owner";
  }

  if (editAccess === true) {
    return "editor";
  }

  if (editAccess === false) {
    return "viewer";
  }

  return "unknown";
};

export const describeRoleCapabilities = (
  role: EffectiveDocumentRole,
  hasAuthenticatedUser: boolean,
  hasLoadedDocument: boolean
): string => {
  if (!hasLoadedDocument) {
    return "Load a document to discover document permissions and version history.";
  }

  if (!hasAuthenticatedUser) {
    return "Sign in with a demo user to load sharing controls, version history, and collaboration access.";
  }

  if (role === "owner") {
    return "Owner access confirmed. You can assign roles, restore versions, and join editing sessions.";
  }

  if (role === "editor") {
    return "Editor access confirmed. You can join editing sessions, but sharing and restore controls remain owner-only.";
  }

  if (role === "viewer") {
    return "Viewer access confirmed. This document stays read-only and collaboration/AI entry points remain disabled.";
  }

  return "Owner-only sharing checks have not passed yet. Join a session to confirm whether this user is an editor or viewer.";
};

export const sortPermissionEntries = (
  permissions: DocumentPermissionEntry[]
): DocumentPermissionEntry[] =>
  [...permissions].sort(
    (left, right) =>
      ROLE_PRIORITY[left.permissionLevel] - ROLE_PRIORITY[right.permissionLevel] ||
      left.displayName.localeCompare(right.displayName)
  );

export const upsertPermissionEntry = (
  permissions: DocumentPermissionEntry[],
  nextPermission: DocumentPermissionEntry
): DocumentPermissionEntry[] => {
  const filtered = permissions.filter((permission) => permission.userId !== nextPermission.userId);
  return sortPermissionEntries([...filtered, nextPermission]);
};

export const removePermissionEntry = (
  permissions: DocumentPermissionEntry[],
  shareId: string
): DocumentPermissionEntry[] =>
  permissions.filter((permission) => permission.shareId !== shareId);

export const sortVersionsDescending = (versions: DocumentVersionSummary[]): DocumentVersionSummary[] =>
  [...versions].sort((left, right) => right.versionNumber - left.versionNumber);
