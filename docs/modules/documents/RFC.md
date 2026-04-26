# Module RFC — `documents`

## 1. Why this module exists

Universal file/document store. Every module that needs a "thing to attach to a record" (PPM evidence, asset manuals, lease PDFs, compliance certs) uses Document + DocumentLink, not a per-module file table.

## 2. Scope / non-scope

**In:** Document CRUD, signed-URL generation for download, virus-scan flag, legal-hold flag, retention policy markers, DocumentTemplate (for generating standard letters/forms).
**Out:** asset-specific link rows — those live in `document-links` (separate small module that owns the join table).

## 3. Owned entities

| Model | Table |
|---|---|
| `Document` | `documents` |
| `DocumentTemplate` | `document_templates` |

(`DocumentLink` lives in `document-links` module; `AssetDocument` lives in `assets`.)

## 4. Reads
- `User` for uploader display.
- `Building` for scope.

## 5. Incoming events
- (Planned) `ppm.case.closed` → auto-link evidence document to the case + asset.
- (Planned) `completion.recorded` → same.

## 6. Outgoing events
- (Planned) `document.uploaded` → audit + dashboard counter.

## 7. Workflow states
None — Document is metadata + binary blob reference. Lifecycle is managed by `legalHoldUntil` and `retentionUntil` fields, not transitions.

## 8. Failure / rollback
- Upload that fails virus scan → row stays with `virusScanStatus='infected'`, `isAvailable=false`.
- Legal hold blocks delete (DELETE returns 423 Locked).
- Signed URL has 1h TTL.

## 9. Audit
- `audit.write({ entityType: 'document' })` on upload, delete, legal-hold-set/release.

## 10. RBAC

| Endpoint | Permission |
|---|---|
| `POST /v1/documents/upload` | `document.create` |
| `GET /v1/documents/:token` | signed URL — public (BYPASS_PATHS); token-bound |
| `DELETE /v1/documents/:id` | `document.create` + not on legal hold |
| `POST /v1/documents/:id/legal-hold` | `document.review` |

## 11. Tenant isolation
PrismaService + RLS. Signed URLs encode tenantId in the JWT payload.

## 12. DoR
- [x] Backend endpoints
- [x] Frontend renders documents-page (portfolio + per-building)
- [x] Tenant + RBAC enforced
- [x] audit.write on mutations
- [x] No cross-module writes

## 13. Open questions
- Document → Asset link UI (portfolio side) — backlog P2.
- Bulk upload progress streaming — backlog.
