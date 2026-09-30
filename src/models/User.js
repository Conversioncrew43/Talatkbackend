const mongoose = require("mongoose");

const DEFAULT_PHONE = process.env.DEFAULT_PHONE || "9833353646";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: null, select: false },
    emailVerified: { type: Boolean, default: false },
    phone: { type: String, default: DEFAULT_PHONE, trim: true },
    role: { type: String, enum: ["admin", "coach", "client"], default: "client" },
  },
  { timestamps: true }
);

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    phone: this.phone,
    role: this.role,
  };
};

module.exports = mongoose.model("User", userSchema);
