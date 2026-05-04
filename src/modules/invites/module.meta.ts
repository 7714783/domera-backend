// INIT-013 — module category. Drives the role-builder UI grouping
// and lets the workspace_owner grant a custom role access to a category
// without listing every permission individually. Required by the
// module-category-coverage CI gate.

import { MODULE_CATEGORIES } from '../../common/module-categories';

// Invites belong to people / membership management — same category as
// the iam + team modules.
export const MODULE_CATEGORY = 'people' as (typeof MODULE_CATEGORIES)[number];
