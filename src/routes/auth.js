const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const Service = require("../models/Service");
const Slot = require("../models/Slot");
const Booking = require("../models/Booking");
const EmailOtp = require("../models/EmailOtp");
const { signToken, authRequired } = require("../middleware/auth");

const router = require("express").Router();

const OTP_TTL_MS = 10 * 60 * 1000;
const HOLD_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isAdminEmail(email) {
  return Boolean(process.env.ADMIN_EMAIL) && normalizeEmail(process.env.ADMIN_EMAIL) === email;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function sendOtp(email, code) {
  const subject = "Your Talat K verification code";
  const text = `Your Talat K verification code is ${code}. It expires in 10 minutes.`;
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_FROM_EMAIL;

  if (process.env.NODE_ENV !== "production") {
    console.log(`[DEV OTP] ${email}: ${code}`);
  }

  if (apiKey && senderEmail) {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: {
          email: senderEmail,
          ...(process.env.BREVO_FROM_NAME ? { name: process.env.BREVO_FROM_NAME } : {}),
        },
        to: [{ email }],
        subject,
        textContent: text,
        htmlContent: `<p>Your Talat K verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
      }),
    });
    if (!response.ok) {
      const details = await response.text();
      console.error("Brevo email request failed:", response.status, details);
      throw new Error("Brevo could not send the verification email");
    }
    return;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Configure BREVO_API_KEY and BREVO_FROM_EMAIL to send verification emails");
  }
}

async function createBooking({ userId, serviceId, slotId, holdToken, coachWillAssignSlot }) {
  const service = await Service.findOne({ _id: serviceId, active: true });
  if (!service) throw Object.assign(new Error("Service not found"), { status: 404 });

  let selectedSlot = null;
  if (slotId) {
    selectedSlot = await Slot.findOneAndUpdate(
      {
        _id: slotId,
        serviceId,
        status: "open",
        startAt: { $gte: new Date() },
        $or: [{ holdToken }, { holdToken: null }, { holdUntil: { $lt: new Date() } }],
      },
      { status: "booked", holdToken: null, holdUntil: null },
      { new: true }
    );
    if (!selectedSlot) throw Object.assign(new Error("Sorry, this time slot was just booked by someone else."), { status: 409 });
  } else if (!coachWillAssignSlot) {
    throw Object.assign(new Error("Choose a slot"), { status: 400 });
  }

  return Booking.create({
    clientId: userId,
    serviceId,
    slotId: selectedSlot?._id || null,
    status: "pending_payment",
    coachWillAssignSlot: Boolean(coachWillAssignSlot),
    amount: service.price,
  });
}

router.post("/request-otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { serviceId, slotId, coachWillAssignSlot } = req.body;
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address" });
    const service = serviceId ? await Service.findOne({ _id: serviceId, active: true }) : null;
    if (serviceId && !service) return res.status(404).json({ error: "Consultation not found" });

    const challengeId = crypto.randomBytes(24).toString("hex");
    const code = String(crypto.randomInt(100000, 1000000));
    let holdToken = null;
    if (slotId && serviceId) {
      holdToken = crypto.randomBytes(24).toString("hex");
      const held = await Slot.findOneAndUpdate(
        {
          _id: slotId,
          serviceId,
          status: "open",
          startAt: { $gte: new Date() },
          $or: [{ holdUntil: null }, { holdUntil: { $lt: new Date() } }],
        },
        { holdToken, holdUntil: new Date(Date.now() + HOLD_TTL_MS) },
        { new: true }
      );
      if (!held) return res.status(409).json({ error: "Sorry, this time slot was just booked by someone else." });
    }
    await EmailOtp.create({
      email,
      codeHash: hash(code),
      challengeId,
      serviceId,
      slotId: slotId || null,
      holdToken,
      coachWillAssignSlot: Boolean(coachWillAssignSlot),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });
    await sendOtp(email, code);
    return res.json({ challengeId, expiresInSeconds: OTP_TTL_MS / 1000 });
  } catch (err) {
    console.error(err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : "Could not send verification code" });
  }
});

router.post("/resend-otp", async (req, res) => {
  try {
    const otp = await EmailOtp.findOne({ challengeId: req.body.challengeId });
    if (!otp || otp.resendCount >= 3) return res.status(429).json({ error: "Too many code requests. Please start again." });
    const code = String(crypto.randomInt(100000, 1000000));
    otp.codeHash = hash(code);
    otp.expiresAt = new Date(Date.now() + OTP_TTL_MS);
    otp.resendCount += 1;
    otp.attempts = 0;
    await otp.save();
    await sendOtp(otp.email, code);
    return res.json({ expiresInSeconds: OTP_TTL_MS / 1000 });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not resend verification code" });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const otp = await EmailOtp.findOne({ challengeId: req.body.challengeId });
    if (!otp) return res.status(400).json({ error: "This verification session has expired. Start again." });
    if (otp.expiresAt < new Date()) return res.status(410).json({ error: "This code has expired. Request a new one." });
    if (otp.attempts >= MAX_ATTEMPTS) return res.status(429).json({ error: "Too many attempts. Request a new code." });
    if (hash(String(req.body.code || "")) !== otp.codeHash) {
      otp.attempts += 1;
      await otp.save();
      return res.status(400).json({ error: "That code is incorrect." });
    }
    otp.verifiedAt = new Date();
    await otp.save();
    const existing = await User.findOne({ email: otp.email });
    if (!existing) return res.json({ needsProfile: true, email: otp.email, challengeId: otp.challengeId });
    if (isAdminEmail(otp.email) && existing.role !== "admin") existing.role = "admin";
    existing.emailVerified = true;
    await existing.save();
    if (!otp.serviceId) {
      return res.json({ token: signToken(existing), user: existing.toSafeJSON() });
    }
    const booking = await createBooking({
      userId: existing._id,
      serviceId: otp.serviceId,
      slotId: otp.slotId,
      holdToken: otp.holdToken,
      coachWillAssignSlot: otp.coachWillAssignSlot,
    });
    const token = signToken(existing);
    return res.json({ token, user: existing.toSafeJSON(), booking: await Booking.findById(booking._id).populate("serviceId slotId") });
  } catch (err) {
    console.error(err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : "Could not verify email" });
  }
});

router.post("/complete-profile", async (req, res) => {
  try {
    const otp = await EmailOtp.findOne({ challengeId: req.body.challengeId, verifiedAt: { $ne: null } });
    if (!otp) return res.status(400).json({ error: "Verify your email first" });
    const name = String(req.body.name || "").trim();
    const phone = String(req.body.phone || "").trim();
    if (!name) return res.status(400).json({ error: "Full name is required" });
    if (!phone) return res.status(400).json({ error: "Mobile number is required" });
    const user = await User.create({ name, email: otp.email, phone, emailVerified: true, role: isAdminEmail(otp.email) ? "admin" : "client" });
    if (!otp.serviceId) return res.status(201).json({ token: signToken(user), user: user.toSafeJSON() });
    const booking = await createBooking({ userId: user._id, serviceId: otp.serviceId, slotId: otp.slotId, holdToken: otp.holdToken, coachWillAssignSlot: otp.coachWillAssignSlot });
    const token = signToken(user);
    return res.status(201).json({ token, user: user.toSafeJSON(), booking: await Booking.findById(booking._id).populate("serviceId slotId") });
  } catch (err) {
    console.error(err);
    return res.status(err.status || 500).json({ error: err.code === 11000 ? "An account with this email already exists. Verify again to continue." : err.status ? err.message : "Could not complete your details" });
  }
});

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      role: "client",
    });
    const token = signToken(user);
    return res.status(201).json({ token, user: user.toSafeJSON() });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not create account" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const user = await User.findOne({ email: email.toLowerCase() }).select("+passwordHash");
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = signToken(user);
    return res.json({ token, user: user.toSafeJSON() });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not sign in" });
  }
});

router.get("/me", authRequired, async (req, res) => {
  const user = await User.findById(req.user.sub);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  return res.json({ user: user.toSafeJSON() });
});

module.exports = router;
