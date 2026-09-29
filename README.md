# Backend

Express API for the Talat K booking app.

## Deploy on Render

Create a Render Web Service from this repository. Render will use `render.yaml` automatically, or configure these values manually:

- Build command: `npm ci`
- Start command: `npm start`
- Health check path: `/health`

Set these environment variables in Render:

- `MONGODB_URI`: MongoDB Atlas connection string
- `JWT_SECRET`: long random signing secret
- `FRONTEND_URL`: allowed frontend origins, such as `https://your-app.vercel.app`; separate multiple origins with commas
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`: SMTP server settings (Gmail defaults are in `render.yaml`)
- `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`: sender account, app password, and from address; configure these in Render
- `RAZORPAY_KEY_ID`: Razorpay API key ID
- `RAZORPAY_KEY_SECRET`: Razorpay API key secret
- `RAZORPAY_WEBHOOK_SECRET`: webhook secret configured in the Razorpay dashboard

In Razorpay, configure a webhook pointing to `https://<your-api-domain>/payments/webhook` and subscribe to `payment.captured` and `payment.failed`. Use the same webhook secret in `RAZORPAY_WEBHOOK_SECRET`. Keep all three Razorpay values server-side; only the key ID is returned to the frontend at checkout.

Set the SMTP and Google Calendar variables from `.env.example` when those features are enabled. Do not commit `.env` or production secrets.

## Run locally

```bash
npm install
npm run seed
npm run dev
```