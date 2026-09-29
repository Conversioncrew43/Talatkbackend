const Slot = require("../models/Slot");
const Service = require("../models/Service");
const { authRequired, requireRole } = require("../middleware/auth");

const router = require("express").Router();

router.get("/", async (req, res) => {
  const { serviceId } = req.query;
  const filter = { status: "open", startAt: { $gte: new Date() } };
  if (serviceId) filter.serviceId = serviceId;
  const slots = await Slot.find(filter).sort({ startAt: 1 }).populate("serviceId");
  res.json({ slots });
});

router.get("/all", authRequired, requireRole("coach", "admin"), async (req, res) => {
  const { serviceId } = req.query;
  const filter = {};
  if (serviceId) filter.serviceId = serviceId;
  const slots = await Slot.find(filter).sort({ startAt: 1 }).populate("serviceId");
  res.json({ slots });
});

router.post("/", authRequired, requireRole("coach", "admin"), async (req, res) => {
  try {
    const { serviceId, startAt, endAt } = req.body;
    if (!serviceId || !startAt || !endAt) {
      return res.status(400).json({ error: "serviceId, startAt, and endAt are required" });
    }
    const service = await Service.findById(serviceId);
    if (!service) return res.status(404).json({ error: "Service not found" });
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (end <= start) {
      return res.status(400).json({ error: "End time must be after start time" });
    }
    const slot = await Slot.create({ serviceId, startAt: start, endAt: end, status: "open" });
    res.status(201).json({ slot });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create slot" });
  }
});

router.patch("/:id", authRequired, requireRole("coach", "admin"), async (req, res) => {
  try {
    const allowed = ["startAt", "endAt", "status", "serviceId"];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const slot = await Slot.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!slot) return res.status(404).json({ error: "Slot not found" });
    res.json({ slot });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update slot" });
  }
});

module.exports = router;
