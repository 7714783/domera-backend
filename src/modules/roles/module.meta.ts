// INIT-013 — Roles is a people-domain module: it owns the role catalogue
// (system + tenant-custom) and the permission/category metadata.

import { MODULE_CATEGORIES } from '../../common/module-categories';

export const MODULE_CATEGORY = 'people' as (typeof MODULE_CATEGORIES)[number];
