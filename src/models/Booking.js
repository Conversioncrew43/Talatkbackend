const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: true },
    slotId: { type: mongoose.Schema.Types.ObjectId, ref: "Slot", default: null },
    status: {
      type: String,
      enum: ["pending_payment", "confirmed", "awaiting_coach_slot", "cancelled"],
      default: "pending_payment",
    },
    coachWillAssignSlot: { type: Boolean, default: false },
    amount: { type: Number, required: true },
    paymentOrderId: { type: String, default: "" },
    paymentId: { type: String, default: "" },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "created", "failed", "paid"],
      default: "unpaid",
    },
    googleMeetUrl: { type: String, default: "" },
    googleEventId: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Booking", bookingSchema);
