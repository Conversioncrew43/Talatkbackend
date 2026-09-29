require("dotenv").config();
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
dns.setDefaultResultOrder("ipv4first");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");
const Service = require("./models/Service");
const Slot = require("./models/Slot");

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);

  const email = (process.env.COACH_EMAIL || "coach@talatk.local").toLowerCase();
  const password = process.env.COACH_PASSWORD || "Coach123!";
  let coach = await User.findOne({ email });
  if (!coach) {
    coach = await User.create({
      name: "Talat K",
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role: "coach",
    });
    console.log("Created coach:", email);
  } else if (coach.role !== "coach") {
    coach.role = "coach";
    await coach.save();
    console.log("Promoted existing user to coach:", email);
  } else {
    console.log("Coach already exists:", email);
  }

  const existingServices = await Service.countDocuments();
  if (existingServices === 0) {
    const services = await Service.insertMany([
      {
        title: "Discovery Session",
        description:
          "A focused first conversation to map your patterns, language, and the change you want to make.",
        durationMinutes: 45,
        price: 2500,
        active: true,
      },
      {
        title: "Deep Pattern Work",
        description:
          "A full NLP session working with limiting beliefs, anchoring, and reframing in a quiet, structured space.",
        durationMinutes: 75,
        price: 4800,
        active: true,
      },
      {
        title: "Integration Follow-up",
        description:
          "Shorter session to lock in new language, review practices, and set the next stretch of work.",
        durationMinutes: 40,
        price: 3200,
        active: true,
      },
    ]);

    const now = new Date();
    const daysAhead = [1, 2, 3, 5, 7, 8];
    const hours = [10, 14, 16];
    const slots = [];
    for (const service of services) {
      for (const day of daysAhead) {
        for (const hour of hours) {
          if (service.title === "Integration Follow-up" && hour === 16) continue;
          const startAt = new Date(now);
          startAt.setDate(now.getDate() + day);
          startAt.setHours(hour, 0, 0, 0);
          const endAt = new Date(startAt.getTime() + service.durationMinutes * 60 * 1000);
          slots.push({
            serviceId: service._id,
            startAt,
            endAt,
            status: "open",
          });
        }
      }
    }
    await Slot.insertMany(slots);
    console.log(`Seeded ${services.length} services and ${slots.length} slots`);
  } else {
    console.log("Services already present; skipped sample data");
  }

  await mongoose.disconnect();
  console.log("Seed complete");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
