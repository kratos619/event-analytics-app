import { Schema, model } from 'mongoose';

const rejectedSchema = new Schema(
  {
    row_number: { type: Number, required: true },  // position of the row in the file
    reason:     { type: String, required: true },  // why we rejected it
    raw:        Schema.Types.Mixed,                // the original row, untouched
  },
  { timestamps: true }                             // Mongoose adds createdAt and updatedAt
);

export default model('rejectedrecords', rejectedSchema);
