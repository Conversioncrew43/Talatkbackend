const mongoose = require("mongoose");

const slotSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    status: { type: String, enum: ["open", "booked", "cancelled"], default: "open" },
    holdToken: { type: String, default: null },
    holdUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Slot", slotSchema);
