// INIT-014 — Notifications is an infrastructure module (the platform's
// delivery channel). Lives under the platform category alongside events,
// metrics, webhooks.

import { MODULE_CATEGORIES } from '../../common/module-categories';

export const MODULE_CATEGORY = 'platform' as (typeof MODULE_CATEGORIES)[number];
