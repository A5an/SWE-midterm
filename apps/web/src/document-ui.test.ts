import assert from "node:assert/strict";
import type { DocumentPermissionEntry } from "@swe-midterm/contracts";
import { describe, it } from "vitest";
import {
  describeRoleCapabilities,
  removePermissionEntry,
  resolveEffectiveDocumentRole,
  sortVersionsDescending,
  upsertPermissionEntry
} from "./document-ui.ts";

const ownerPermission: DocumentPermissionEntry = {
  shareId: null,
  source: "owner",
  userId: "usr_owner",
  email: "owner@example.com",
  displayName: "Owner User",
  permissionLevel: "owner"
};

const editorPermission: DocumentPermissionEntry = {
  shareId: "shr_editor",
  source: "share",
  userId: "usr_editor",
  email: "editor@example.com",
  displayName: "Editor User",
  permissionLevel: "editor"
};

const viewerPermission: DocumentPermissionEntry = {
  shareId: "shr_viewer",
  source: "share",
  userId: "usr_viewer",
  email: "viewer@example.com",
  displayName: "Viewer User",
  permissionLevel: "viewer"
};

describe("document admin helpers", () => {
  it("infers effective roles and capability text", () => {
    assert.equal(resolveEffectiveDocumentRole(true, null), "owner");
    assert.equal(resolveEffectiveDocumentRole(false, true), "editor");
    assert.equal(resolveEffectiveDocumentRole(false, false), "viewer");
    assert.equal(resolveEffectiveDocumentRole(false, null), "unknown");

    assert.match(describeRoleCapabilities("owner", true, true), /assign roles, restore versions/u);
    assert.match(describeRoleCapabilities("viewer", true, true), /read-only/u);
    assert.match(
      describeRoleCapabilities("unknown", true, true),
      /confirm whether this user is an editor or viewer/u
    );
  });

  it("updates permission lists predictably", () => {
    assert.deepEqual(upsertPermissionEntry([ownerPermission, viewerPermission], editorPermission), [
      ownerPermission,
      editorPermission,
      viewerPermission
    ]);

    assert.deepEqual(
      upsertPermissionEntry([ownerPermission, editorPermission], {
        ...editorPermission,
        permissionLevel: "viewer"
      }),
      [
        ownerPermission,
        {
          ...editorPermission,
          permissionLevel: "viewer"
        }
      ]
    );

    assert.deepEqual(removePermissionEntry([ownerPermission, editorPermission, viewerPermission], "shr_editor"), [
      ownerPermission,
      viewerPermission
    ]);
  });

  it("sorts versions newest-first", () => {
    assert.deepEqual(
      sortVersionsDescending([
        {
          versionId: "ver_001",
          versionNumber: 1,
          createdAt: "2026-04-19T10:00:00.000Z",
          createdByUserId: "usr_owner",
          basedOnVersionId: null,
          isRevert: false,
          changeSummary: "Initial version",
          title: "Doc"
        },
        {
          versionId: "ver_003",
          versionNumber: 3,
          createdAt: "2026-04-19T12:00:00.000Z",
          createdByUserId: "usr_owner",
          basedOnVersionId: "ver_001",
          isRevert: true,
          changeSummary: "Restored from version ver_001",
          title: "Doc"
        },
        {
          versionId: "ver_002",
          versionNumber: 2,
          createdAt: "2026-04-19T11:00:00.000Z",
          createdByUserId: "usr_editor",
          basedOnVersionId: null,
          isRevert: false,
          changeSummary: "Updated content",
          title: "Doc"
        }
      ]).map((version) => version.versionId),
      ["ver_003", "ver_002", "ver_001"]
    );
  });
});
