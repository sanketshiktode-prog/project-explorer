// The permission catalogue. Roles are rows in the DB that hold a subset of these keys,
// so new roles can be created in Admin → Users & Roles without code changes.
export const PERMISSIONS = [
  { key: 'explorer.view', label: 'Search & view published projects' },
  { key: 'project.view_all', label: 'View drafts, unpublished projects and internal notes' },
  { key: 'project.create', label: 'Create projects' },
  { key: 'project.edit', label: 'Edit projects' },
  { key: 'project.submit', label: 'Submit projects for review' },
  { key: 'project.verify', label: 'Verify projects / send back' },
  { key: 'project.publish', label: 'Publish / unpublish projects' },
  { key: 'project.archive', label: 'Deactivate, archive & restore projects' },
  { key: 'project.delete', label: 'Permanently delete draft projects (admin only)' },
  { key: 'master.manage', label: 'Manage master data' },
  { key: 'config.manage', label: 'Manage filters, bands, fields & settings' },
  { key: 'users.manage', label: 'Manage users & roles' },
  { key: 'import.run', label: 'Run bulk imports' },
  { key: 'audit.view', label: 'View audit history' },
  { key: 'quality.view', label: 'View data-quality dashboard' },
];
export const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));
