import { Schema, model } from 'mongoose';
import Joi from 'joi';

const eventSchema = new Schema({
  event_id:        { type: String, required: true, unique: true }, // unique index = duplicates blocked at DB level
  customer_id:     { type: String, required: true },
  dealer_id:       { type: String, required: true },
  event_type:      { type: String, required: true },
  event_timestamp: { type: Date, required: true },
  received_at:     { type: Date, required: true },
  lead_created_at: { type: Date, required: true },
  campaign_id:     { type: String },   // these 4 are only saved, not validated
  segment:         { type: String },
  email_provider:  { type: String },
  lead_status:     { type: String },
});

// indexes for the README filters: dealer, event date range
eventSchema.index({ dealer_id: 1, event_timestamp: 1 });  // dealer + date range, or dealer only
eventSchema.index({ event_timestamp: 1 });                // date range for all dealers

export default model('Event', eventSchema);

// ---------- validation (Joi) ----------
export const EVENT_TYPES = ['EMAIL_SENT', 'EMAIL_DELIVERED', 'EMAIL_OPENED', 'EMAIL_CLICKED', 'EMAIL_BOUNCED', 'EMAIL_UNSUBSCRIBED'];

// one rule per field, and the reason code to return if that rule fails
const eventJoi = Joi.object({
  event_id:        Joi.string().pattern(/\S/).required().error(new Error('MISSING_EVENT_ID')),
  customer_id:     Joi.string().pattern(/\S/).required().error(new Error('MISSING_CUSTOMER_ID')),
  dealer_id:       Joi.string().pattern(/\S/).required().error(new Error('MISSING_DEALER_ID')),
  event_type:      Joi.string().valid(...EVENT_TYPES).required().error(new Error('UNKNOWN_EVENT_TYPE')),
  event_timestamp: Joi.date().iso().required().error(new Error('INVALID_EVENT_TIMESTAMP')),
  received_at:     Joi.date().iso().required().error(new Error('INVALID_RECEIVED_AT')),
  lead_created_at: Joi.date().iso().required().error(new Error('INVALID_LEAD_CREATED_AT')),
  // these 4 are only saved: text, "" or null is fine, and the key may be missing
  campaign_id:     Joi.string().allow('', null).error(new Error('INVALID_CAMPAIGN_ID')),
  segment:         Joi.string().allow('', null).error(new Error('INVALID_SEGMENT')),
  email_provider:  Joi.string().allow('', null).error(new Error('INVALID_EMAIL_PROVIDER')),
  lead_status:     Joi.string().allow('', null).error(new Error('INVALID_LEAD_STATUS')),
}).unknown(true);   // any other key is allowed and ignored (Mongoose does not save it)

export function validateEvent(data: unknown) {
  // the row itself must be an object (not null, text or a list)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { reason: 'INVALID_RECORD' };

  const { error, value } = eventJoi.validate(data, { abortEarly: true });   // stop at the first problem
  if (error) return { reason: error.message };

  // rule between two fields, so it is checked after all fields are valid
  if (value.lead_created_at > value.event_timestamp) return { reason: 'INVALID_LEAD_CHRONOLOGY' };

  return { value };
}
