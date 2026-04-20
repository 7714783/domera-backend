# Domera domain events (CloudEvents 1.0 + AsyncAPI 2.6)

## Envelope

Every event written to `outbox_events` and delivered via outbound webhook
follows the [CloudEvents 1.0](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md)
structured JSON mode:

```json
{
  "specversion": "1.0",
  "id": "<uuid>",
  "type": "domera.<module>.<entity>.<action>",
  "source": "/domera/api/<module>",
  "subject": "<entity-id>",
  "time": "2026-04-19T06:45:00.000Z",
  "datacontenttype": "application/json",
  "data": { /* payload, schema keyed by `type` */ },
  "tenantid": "<uuid>",
  "buildingid": "<uuid>"
}
```

`tenantid` / `buildingid` are CloudEvents extensions (lowercase, no dashes per
the spec).

## Canonical event types (v1)

| type | source | data.shape |
|---|---|---|
| `domera.ppm.task.scheduled` | `/domera/api/ppm` | `{ taskId, planItemId, dueAt }` |
| `domera.ppm.task.completed` | `/domera/api/ppm` | `{ taskId, completedAt, evidenceDocumentIds }` |
| `domera.reactive.incident.raised` | `/domera/api/reactive` | `{ incidentId, severity, origin }` |
| `domera.reactive.service_request.submitted` | `/domera/api/reactive` | `{ serviceRequestId, category, priority }` |
| `domera.reactive.work_order.completed` | `/domera/api/reactive` | `{ workOrderId, costs }` |
| `domera.approval.request.created` | `/domera/api/approvals` | `{ approvalRequestId, amount, currency }` |
| `domera.approval.request.decided` | `/domera/api/approvals` | `{ approvalRequestId, decision }` |
| `domera.import.committed` | `/domera/api/imports` | `{ importJobId, kind, createdEntities }` |
| `domera.import.rolled_back` | `/domera/api/imports` | `{ importJobId, reason }` |
| `domera.project.stage.advanced` | `/domera/api/projects` | `{ projectId, from, to }` |
| `domera.project.change_order.decided` | `/domera/api/projects` | `{ changeOrderId, decision }` |
| `domera.project.acceptance.submitted` | `/domera/api/projects` | `{ acceptancePackId }` |
| `domera.project.acceptance.accepted` | `/domera/api/projects` | `{ acceptancePackId }` |
| `domera.document.legal_hold.set` | `/domera/api/documents` | `{ documentId, reason }` |
| `domera.privacy.dsar.completed` | `/domera/api/privacy` | `{ dsarId, kind }` |

## Delivery contract

1. Writer **MUST** call `EventsService.emit(tenantId, evt, tx)` inside the same
   Prisma `$transaction` as the state change.
2. Worker picks up `outbox_events` rows with `status='pending'`, flips to
   `delivering`, POSTs to every matching `WebhookSubscription`, then sets
   `delivered` or `failed` (incrementing `attempts`).
3. Outbound POST headers:
   - `Content-Type: application/cloudevents+json`
   - `X-Domera-Signature: sha256=<hex>` (HMAC of the raw body using
     `WebhookSubscription.sharedSecret`)
   - `X-Domera-Event-Type: <type>`
   - `X-Domera-Delivery-Id: <outbox_event.id>`
4. Retries: exponential backoff (5s, 30s, 2m, 10m, 1h, 6h). After 7 attempts
   an event flips to `dead` and requires manual replay.

## AsyncAPI (minimal skeleton)

```yaml
asyncapi: 2.6.0
info:
  title: Domera Events
  version: 1.0.0
channels:
  outbox/cloudevents:
    subscribe:
      summary: Domain events emitted by Domera
      message:
        contentType: application/cloudevents+json
        payload:
          $ref: "#/components/schemas/CloudEvent"
components:
  schemas:
    CloudEvent:
      type: object
      required: [specversion, id, type, source, time, data]
      properties:
        specversion: { type: string, const: "1.0" }
        id: { type: string, format: uuid }
        type: { type: string }
        source: { type: string }
        subject: { type: string }
        time: { type: string, format: date-time }
        datacontenttype: { type: string }
        tenantid: { type: string }
        buildingid: { type: string }
        data: { type: object }
```

## Consumer requirements

- **Idempotency**: consumers MUST de-dup by `id`. The same event MAY arrive
  more than once (at-least-once delivery).
- **Signature verification**: consumers MUST reject deliveries whose
  `X-Domera-Signature` does not match `HMAC_SHA256(sharedSecret, body)`.
- **Ordering**: within a single `subject` (entity id), events are delivered in
  approximately causal order, but the protocol is NOT strictly ordered.
  Consumers that need total order MUST use the database as the source of truth.
