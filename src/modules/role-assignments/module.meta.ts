// INIT-013 — Role assignments module owns the TeamMemberRoleAssignment
// table and the auto-routing resolver helpers.

import { MODULE_CATEGORIES } from '../../common/module-categories';

export const MODULE_CATEGORY = 'people' as (typeof MODULE_CATEGORIES)[number];
