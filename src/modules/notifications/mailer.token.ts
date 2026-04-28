// INIT-014 — Mailer DI token. Decouples consumers (DeliveryDispatcher)
// from the concrete provider chosen at module bootstrap time.

export const MAILER = Symbol('MAILER');
