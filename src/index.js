require("dotenv").config();
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
dns.setDefaultResultOrder("ipv4first");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const authRoutes = require("./routes/auth");
const serviceRoutes = require("./routes/services");
const slotRoutes = require("./routes/slots");
const bookingRoutes = require("./routes/bookings");
const paymentRoutes = require("./routes/payments");

const app = express();
const port = Number(process.env.PORT) || 4000;
const frontendUrls = [
  ...(process.env.FRONTEND_URL || "https://talatk.in")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean),
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

app.use(
  cors({
    origin: frontendUrls,
    credentials: true,
  })
);
app.use(express.json({
  verify: (req, _res, buffer) => {
    if (req.originalUrl === "/payments/webhook") req.rawBody = Buffer.from(buffer);
  },
}));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", authRoutes);
app.use("/services", serviceRoutes);
app.use("/slots", slotRoutes);
app.use("/bookings", bookingRoutes);
app.use("/payments", paymentRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Unexpected server error" });
});

async function start() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is missing");
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET is missing");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  app.listen(port, "0.0.0.0", () => {
    console.log(`API listening on http://localhost:${port}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
