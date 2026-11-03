import { Schema, model } from 'mongoose';

const importRunSchema = new Schema(
  {
    status:                 { type: String, enum: ['running', 'completed', 'failed'], default: 'running' },
    total_rows:             { type: Number, default: 0 },  // rows read from the file
    accepted:               { type: Number, default: 0 },  // new events saved in this run
    exact_duplicates:       { type: Number, default: 0 },
    conflicting_duplicates: { type: Number, default: 0 },
    invalid:                { type: Number, default: 0 },
    duration_ms:            { type: Number },              // set when the run ends
    error:                  { type: String },              // set when the run fails
  },
  { timestamps: true }                                     // createdAt = when the import started
);

export default model('ImportRun', importRunSchema);
