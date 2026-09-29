const mongoose = require("mongoose");

const emailOtpSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    codeHash: { type: String, required: true },
    challengeId: { type: String, required: true, unique: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service", default: null },
    slotId: { type: mongoose.Schema.Types.ObjectId, ref: "Slot", default: null },
    holdToken: { type: String, default: null },
    coachWillAssignSlot: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    resendCount: { type: Number, default: 0 },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

emailOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("EmailOtp", emailOtpSchema);