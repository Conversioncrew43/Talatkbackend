const Booking = require("../models/Booking");
const Service = require("../models/Service");
const Slot = require("../models/Slot");
const { authRequired, requireRole } = require("../middleware/auth");

const router = require("express").Router();

async function createGoogleMeet(booking) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
    throw Object.assign(new Error("Google Calendar OAuth is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN."), { status: 503 });
  }
  const { google } = require("googleapis");
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:4000/auth/google/callback"
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const calendar = google.calendar({ version: "v3", auth });
  const event = await calendar.events.insert({
    calendarId: "primary",
    conferenceDataVersion: 1,
    sendUpdates: "all",
    requestBody: {
      summary: `${booking.serviceId.title} with Talat K`,
      description: `Consultation for ${booking.clientId.name} (${booking.clientId.email}).`,
      start: { dateTime: booking.slotId.startAt.toISOString() },
      end: { dateTime: booking.slotId.endAt.toISOString() },
      attendees: [{ email: booking.clientId.email }],
      conferenceData: {
        createRequest: {
          requestId: `talatk-${booking._id}-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
  });
  return {
    eventId: event.data.id,
    meetUrl: event.data.hangoutLink || event.data.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri,
  };
}

function populateBooking(query) {
  return query
    .populate("serviceId")
    .populate("slotId")
    .populate("clientId", "name email role");
}

router.post("/", authRequired, requireRole("client"), async (req, res) => {
  try {
    const { serviceId, slotId, coachWillAssignSlot } = req.body;
    const service = await Service.findOne({ _id: serviceId, active: true });
    if (!service) {
      return res.status(404).json({ error: "Service not found" });
    }

    if (slotId) {
      const slot = await Slot.findOneAndUpdate(
        {
          _id: slotId,
          serviceId,
          status: "open",
          startAt: { $gte: new Date() },
        },
        { status: "booked" },
        { new: true }
      );
      if (!slot) {
        return res.status(409).json({ error: "That slot is no longer available" });
      }
      const booking = await Booking.create({
        clientId: req.user.sub,
        serviceId,
        slotId: slot._id,
        status: "pending_payment",
        coachWillAssignSlot: false,
        amount: service.price,
      });
      const populated = await populateBooking(Booking.findById(booking._id));
      return res.status(201).json({ booking: populated });
    }

    if (!coachWillAssignSlot) {
      return res.status(400).json({
        error: "Choose a slot, or allow the coach to pick a time",
      });
    }

    const booking = await Booking.create({
      clientId: req.user.sub,
      serviceId,
      slotId: null,
      status: "pending_payment",
      coachWillAssignSlot: true,
      amount: service.price,
    });
    const populated = await populateBooking(Booking.findById(booking._id));
    return res.status(201).json({ booking: populated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not create booking" });
  }
});

router.get("/me", authRequired, requireRole("client"), async (req, res) => {
  const bookings = await populateBooking(
    Booking.find({ clientId: req.user.sub }).sort({ createdAt: -1 })
  );
  res.json({ bookings });
});

router.post("/:id/google-meet", authRequired, requireRole("coach", "admin"), async (req, res) => {
  try {
    const booking = await populateBooking(
      Booking.findOne({ _id: req.params.id, status: "confirmed" })
    );
    if (!booking) return res.status(404).json({ error: "Confirmed appointment not found" });
    if (!booking.slotId) return res.status(400).json({ error: "Assign a time before creating a Google Meet" });
    if (booking.googleMeetUrl) return res.json({ booking });

    const meeting = await createGoogleMeet(booking);
    if (!meeting.meetUrl) return res.status(502).json({ error: "Google did not return a Meet link" });
    booking.googleMeetUrl = meeting.meetUrl;
    booking.googleEventId = meeting.eventId;
    await booking.save();
    return res.json({ booking });
  } catch (err) {
    console.error(err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : "Could not create Google Meet" });
  }
});

router.get("/", authRequired, requireRole("coach", "admin"), async (_req, res) => {
  const bookings = await populateBooking(Booking.find().sort({ createdAt: -1 }));
  res.json({ bookings });
});

router.patch("/:id/assign-slot", authRequired, requireRole("coach", "admin"), async (req, res) => {
  try {
    const { slotId } = req.body;
    if (!slotId) {
      return res.status(400).json({ error: "slotId is required" });
    }
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }
    if (!booking.coachWillAssignSlot || booking.status !== "awaiting_coach_slot") {
      return res.status(400).json({ error: "This booking is not waiting for a coach slot" });
    }
    const slot = await Slot.findOneAndUpdate(
      {
        _id: slotId,
        serviceId: booking.serviceId,
        status: "open",
      },
      { status: "booked" },
      { new: true }
    );
    if (!slot) {
      return res.status(409).json({ error: "Slot is not available" });
    }
    booking.slotId = slot._id;
    booking.status = "confirmed";
    await booking.save();
    const populated = await populateBooking(Booking.findById(booking._id));
    return res.json({ booking: populated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not assign slot" });
  }
});

module.exports = router;
