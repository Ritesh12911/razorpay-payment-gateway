# 💳 Razorpay Payment Gateway

A production-ready payment gateway with a premium dark-themed UI, built with Node.js/Express and Razorpay.

## Features

- 🎨 **Premium UI** — Dark glassmorphism design with animations
- 🔐 **Secure** — HMAC SHA256 payment verification
- 💳 **Multiple Payment Methods** — Cards, UPI, Wallets, Net Banking
- 📱 **Responsive** — Works on mobile, tablet, and desktop
- 🧾 **Receipt Download** — Text receipt for successful payments
- ⚡ **Fast** — Razorpay Checkout modal (no redirects)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Razorpay Keys

1. Sign up at [https://dashboard.razorpay.com](https://dashboard.razorpay.com)
2. Go to **Settings → API Keys → Generate Key**
3. Copy your **Key ID** and **Key Secret**
4. Edit `.env` and replace the placeholder values:

```env
RAZORPAY_KEY_ID=rzp_test_YOUR_KEY_ID
RAZORPAY_KEY_SECRET=YOUR_KEY_SECRET
PORT=3000
```

### 3. Start the Server

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Test Cards (Test Mode)

| Card Number | CVV | Expiry |
|---|---|---|
| `4111 1111 1111 1111` | Any 3 digits | Any future date |
| `5267 3181 8797 5449` | Any 3 digits | Any future date |

**UPI Test ID:** `success@razorpay`

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/get-key` | Returns the Razorpay public key |
| `POST` | `/api/create-order` | Creates a new Razorpay order |
| `POST` | `/api/verify-payment` | Verifies payment signature |
| `GET` | `/api/payment/:id` | Fetches payment details |

## Project Structure

```
razorpay-gateway/
├── server.js              # Express backend
├── package.json           # Dependencies
├── .env                   # API keys (gitignored)
├── public/
│   ├── index.html         # Main payment page
│   ├── success.html       # Payment success page
│   ├── failure.html       # Payment failure page
│   ├── css/styles.css     # Design system
│   └── js/app.js          # Frontend logic
└── README.md
```

## Deployment

### Deploy to any Node.js host:

1. Set environment variables (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `PORT`)
2. Run `npm install && npm start`
3. Point your domain to the server

### Popular hosts:
- **Railway** / **Render** / **Fly.io** — Free tier available
- **Heroku** — Add env vars in Settings
- **VPS (DigitalOcean, AWS)** — Use PM2 for process management

## Going Live

1. Get **Live API Keys** from Razorpay Dashboard (requires KYC)
2. Replace test keys in `.env` with live keys
3. Remove test cards and test with real small amounts (₹1)

## License

MIT
