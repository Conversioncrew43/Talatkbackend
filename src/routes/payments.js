const Booking = require("../models/Booking");
const User = require("../models/User");
const { authRequired, requireRole } = require("../middleware/auth");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const router = require("express").Router();

function getRazorpay() {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    throw Object.assign(new Error("Razorpay is not configured"), { status: 503 });
  }
  return new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
}

function validSignature(expected, received) {
  if (!received || expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

async function markBookingPaid({ orderId, paymentId, amount, currency }) {
  const booking = await Booking.findOne({ paymentOrderId: orderId });
  if (!booking) return null;
  if (amount !== Math.round(booking.amount * 100) || currency !== "INR") return null;
  if (booking.paymentStatus === "paid") {
    return Booking.findById(booking._id)
      .populate("serviceId")
      .populate("slotId")
      .populate("clientId", "name email role");
  }

  const status = booking.coachWillAssignSlot && !booking.slotId
    ? "awaiting_coach_slot"
    : "confirmed";
  await Booking.updateOne(
    { _id: booking._id, paymentOrderId: orderId, paymentStatus: { $ne: "paid" }, status: "pending_payment" },
    { $set: { paymentId, paymentStatus: "paid", status } }
  );
  const updatedBooking = await Booking.findById(booking._id)
    .populate("serviceId")
    .populate("slotId")
    .populate("clientId", "name email role");
  return updatedBooking?.paymentStatus === "paid" ? updatedBooking : null;
}

router.post("/orders", authRequired, requireRole("client"), async (req, res) => {
  try {
    const { bookingId } = req.body;
    if (!bookingId) {
      return res.status(400).json({ error: "bookingId is required" });
    }
    const booking = await Booking.findOne({
      _id: bookingId,
      clientId: req.user.sub,
      status: "pending_payment",
      paymentStatus: { $ne: "paid" },
    });
    if (!booking) {
      return res.status(404).json({ error: "Pending booking not found" });
    }

    const razorpay = getRazorpay();
    const customer = await User.findById(req.user.sub);
    let order;
    if (booking.paymentOrderId && booking.paymentStatus === "created") {
      order = await razorpay.orders.fetch(booking.paymentOrderId);
    } else {
      order = await razorpay.orders.create({
        amount: Math.round(booking.amount * 100),
        currency: "INR",
        receipt: booking._id.toString(),
        notes: { bookingId: booking._id.toString() },
      });
      booking.paymentOrderId = order.id;
      booking.paymentStatus = "created";
      await booking.save();
    }
    return res.json({
      keyId: process.env.RAZORPAY_KEY_ID,
      order: { id: order.id, amount: order.amount, currency: order.currency },
      customer: { name: customer?.name || "", email: customer?.email || "" },
    });
  } catch (err) {
    console.error(err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : "Could not create payment order" });
  }
});

router.post("/verify", authRequired, requireRole("client"), async (req, res) => {
  try {
    const { bookingId, razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body;
    const booking = await Booking.findOne({ _id: bookingId, clientId: req.user.sub, paymentOrderId: orderId });
    if (!booking) return res.status(404).json({ error: "Payment order not found" });
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    if (!validSignature(expected, signature)) {
      return res.status(400).json({ error: "Payment signature verification failed" });
    }

    const payment = await getRazorpay().payments.fetch(paymentId);
    if (payment.order_id !== orderId || payment.amount !== Math.round(booking.amount * 100) || payment.currency !== "INR") {
      return res.status(400).json({ error: "Payment details do not match this booking" });
    }
    if (payment.status !== "captured") {
      return res.json({ paid: false, message: "Payment is processing. Check again shortly." });
    }

    const updated = await markBookingPaid({
      orderId,
      paymentId,
      amount: payment.amount,
      currency: payment.currency,
    });
    return res.json({
      paid: Boolean(updated),
      booking: updated,
      ...(!updated ? { message: "Payment is processing. Check again shortly." } : {}),
    });
  } catch (err) {
    console.error(err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : "Could not verify payment" });
  }
});

router.get("/status/:bookingId", authRequired, requireRole("client"), async (req, res) => {
  const booking = await Booking.findOne({ _id: req.params.bookingId, clientId: req.user.sub })
    .populate("serviceId")
    .populate("slotId")
    .populate("clientId", "name email role");
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  return res.json({ paid: booking.paymentStatus === "paid", booking });
});

router.post("/webhook", async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !req.rawBody) return res.status(503).json({ error: "Webhook is not configured" });
  const signature = req.get("x-razorpay-signature");
  const expected = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
  if (!validSignature(expected, signature)) return res.status(400).json({ error: "Invalid webhook signature" });

  try {
    const event = req.body;
    if (event.event === "payment.captured" || event.event === "order.paid") {
      const payment = event.payload?.payment?.entity;
      if (payment) {
        await markBookingPaid({
          orderId: payment.order_id,
          paymentId: payment.id,
          amount: payment.amount,
          currency: payment.currency,
        });
      }
    } else if (event.event === "payment.failed") {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id) {
        await Booking.updateOne(
          { paymentOrderId: payment.order_id, paymentStatus: { $ne: "paid" } },
          { $set: { paymentStatus: "failed" } }
        );
      }
    }
    return res.json({ received: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});

module.exports = router;
