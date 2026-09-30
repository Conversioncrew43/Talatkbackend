const Service = require("../models/Service");
const { authRequired, requireRole } = require("../middleware/auth");

const router = require("express").Router();

router.get("/", async (_req, res) => {
  const services = await Service.find({ active: true }).sort({ price: 1 });
  res.json({ services });
});

router.get("/all", authRequired, requireRole("coach", "admin"), async (_req, res) => {
  const services = await Service.find().sort({ createdAt: -1 });
  res.json({ services });
});

router.post("/", authRequired, requireRole("coach", "admin"), async (req, res) => {
  try {
    const { title, description, durationMinutes, price, active } = req.body;
    if (!title || !description || !durationMinutes || price == null) {
      return res.status(400).json({ error: "Missing service fields" });
    }
    const service = await Service.create({
      title,
      description,
      durationMinutes,
      price,
      active: active !== false,
    });
    res.status(201).json({ service });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create service" });
  }
});

router.patch("/:id", authRequired, requireRole("coach", "admin"), async (req, res) => {
  try {
    const allowed = ["title", "description", "durationMinutes", "price", "active"];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const service = await Service.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!service) return res.status(404).json({ error: "Service not found" });
    res.json({ service });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update service" });
  }
});

router.delete("/:id", authRequired, requireRole("coach", "admin"), async (req, res) => {
  try {
    const service = await Service.findByIdAndDelete(req.params.id);
    if (!service) return res.status(404).json({ error: "Service not found" });
    res.json({ success: true, serviceId: req.params.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete service" });
  }
});

module.exports = router;
