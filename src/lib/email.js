async function sendEmail({ to, subject, text, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_FROM_EMAIL;
  if (!apiKey || !senderEmail) {
    throw new Error("Configure BREVO_API_KEY and BREVO_FROM_EMAIL to send email");
  }

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
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Brevo email request failed: ${response.status} ${details}`);
  }
}

module.exports = { sendEmail };
