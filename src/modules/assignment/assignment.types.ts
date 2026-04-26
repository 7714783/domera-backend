// INIT-004 Phase 2 — AssignmentResolver public types.
//
// Pure types so the resolver can be unit-tested with mocked clients
// and reused from cleaning / reactive / public-qr request paths.

export type AssignmentSource =
  | 'floor.primary' // primary FloorAssignment matched
  | 'floor.any' // any FloorAssignment for floor+role matched
  | 'building.role' // fallback to anyone with the role in this building
  | 'manager_queue'; // nobody available — caller should route to manager

export interface AssignmentInput {
  tenantId: string;
  buildingId: string;
  /** Floor the request originates on. Optional — if absent, only step 3 runs. */
  floorId?: string | null;
  /** Role required to handle the request (e.g. cleaner, technician, security). */
  roleKey: string;
  /** Date used to evaluate UserAvailability. Defaults to now. */
  on?: Date;
}

export interface AssignmentOutput {
  /** null when nobody matched — caller routes to the manager queue. */
  userId: string | null;
  source: AssignmentSource;
  /** Human-readable explanation suitable for audit logs / UI. */
  reason: string;
}

/**
 * Minimal shape of the Prisma client surface the resolver depends on.
 * Lets unit tests pass mocks without spinning up a database.
 */
export interface ResolverPrisma {
  floorAssignment: {
    findMany: (args: any) => Promise<any[]>;
  };
  buildingRoleAssignment: {
    findMany: (args: any) => Promise<any[]>;
  };
  userAvailability: {
    findMany: (args: any) => Promise<any[]>;
  };
}
