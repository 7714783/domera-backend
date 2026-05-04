// INIT-013 — module category.

import { MODULE_CATEGORIES } from '../../common/module-categories';

// Scanner is the cross-domain "what does this token mean" router —
// belongs to operations (the inspector / technician / cleaner uses
// it on-site to navigate to the correct module).
export const MODULE_CATEGORY = 'operations' as (typeof MODULE_CATEGORIES)[number];
