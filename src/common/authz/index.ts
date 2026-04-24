// Public barrel for INIT-007 Phase 3 policy engine.
export { Actor, AuthorizationError, AuthorizeOptions, ResourceRef, Scope } from './types';
export { authorize, requirePermission, requireScope, scopeWhere } from './policy';
export { ActorResolver } from './actor-resolver';
