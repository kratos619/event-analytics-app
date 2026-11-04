import { Schema, model } from 'mongoose';

const rejectedSchema = new Schema(
  {
    file_id:    { type: String, required: true },  // the upload (ImportRun.file_id) this row was rejected in
    row_number: { type: Number, required: true },  // position of the row in the file
    reason:     { type: String, required: true },  // why we rejected it
    raw:        Schema.Types.Mixed,                // the original row, untouched
  },
  { timestamps: true }                             // Mongoose adds createdAt and updatedAt
);

rejectedSchema.index({ file_id: 1, row_number: 1 });  // the rejected rows of one upload, in file order

export default model('rejectedrecords', rejectedSchema);
