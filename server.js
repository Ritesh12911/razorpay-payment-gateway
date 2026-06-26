require('dotenv').config();
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ═══════════════════════════════════════════════════════════
//  SECURITY MIDDLEWARE
// ═══════════════════════════════════════════════════════════

// 1. Helmet — Sets secure HTTP headers (XSS, HSTS, CSP, etc.)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://checkout.razorpay.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: [
          "'self'",
          'https://lumberjack.razorpay.com',
          'https://api.razorpay.com',
          'https://*.razorpay.com',
        ],
        frameSrc: [
          "'self'",
          'https://api.razorpay.com',
          'https://*.razorpay.com',
        ],
        imgSrc: ["'self'", 'data:', 'https:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false, // Required for Razorpay iframe
  })
);

// 2. CORS — Lock to your domain only
const allowedOrigin = process.env.ALLOWED_ORIGIN || `http://localhost:${PORT}`;
app.use(
  cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
  })
);

// 3. Rate Limiting — Prevent abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Max 30 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please try again after 15 minutes.',
  },
});

const orderLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Max 5 order creation attempts per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many payment attempts. Please wait a minute.',
  },
});

// 4. Body Parsing with size limits
app.use(express.json({ limit: '10kb' })); // Prevent large payload attacks
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 5. Serve static files with cache headers
app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: IS_PRODUCTION ? '1d' : 0,
    etag: true,
  })
);

// 6. Disable X-Powered-By (already done by helmet, but belt & suspenders)
app.disable('x-powered-by');

// ═══════════════════════════════════════════════════════════
//  RAZORPAY INSTANCE
// ═══════════════════════════════════════════════════════════

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.error('❌ FATAL: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in .env');
  process.exit(1);
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ═══════════════════════════════════════════════════════════
//  IN-MEMORY PAYMENT STORE
//  Replace with a real database (MongoDB, PostgreSQL) in production
// ═══════════════════════════════════════════════════════════

const paymentStore = new Map();

function storePayment(orderId, data) {
  paymentStore.set(orderId, {
    ...data,
    createdAt: new Date().toISOString(),
  });

  // Auto-cleanup: remove entries older than 24 hours
  if (paymentStore.size > 1000) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [key, val] of paymentStore) {
      if (new Date(val.createdAt).getTime() < cutoff) {
        paymentStore.delete(key);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  INPUT VALIDATION
// ═══════════════════════════════════════════════════════════

function sanitizeString(str, maxLen = 200) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'`;()]/g, '').trim().substring(0, maxLen);
}

function validateAmount(amount) {
  const num = Number(amount);
  if (isNaN(num) || num <= 0 || num > 500000 || !isFinite(num)) {
    return null;
  }
  return Math.round(num * 100) / 100; // Round to 2 decimal places
}

function validateCurrency(currency) {
  const allowed = ['INR', 'USD', 'EUR', 'GBP', 'SGD'];
  return allowed.includes(currency) ? currency : null;
}

// ═══════════════════════════════════════════════════════════
//  SECURE LOGGING (no sensitive data)
// ═══════════════════════════════════════════════════════════

function secureLog(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const safeMeta = { ...meta };

  // Strip any secrets that might accidentally leak
  delete safeMeta.key_secret;
  delete safeMeta.signature;
  delete safeMeta.razorpay_signature;

  const prefix = {
    info: '✅',
    warn: '⚠️',
    error: '❌',
  }[level] || 'ℹ️';

  console.log(`[${timestamp}] ${prefix} ${message}`, Object.keys(safeMeta).length ? safeMeta : '');
}

// ═══════════════════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════════════════

// ─── GET: Razorpay Public Key ───────────────────────────
app.get('/api/get-key', apiLimiter, (req, res) => {
  res.json({ key: process.env.RAZORPAY_KEY_ID });
});

// ─── POST: Create Order ─────────────────────────────────
app.post('/api/create-order', orderLimiter, async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt, notes } = req.body;

    // Validate amount
    const validAmount = validateAmount(amount);
    if (validAmount === null) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount. Must be between ₹1 and ₹5,00,000.',
      });
    }

    // Validate currency
    const validCurrency = validateCurrency(currency);
    if (!validCurrency) {
      return res.status(400).json({
        success: false,
        error: 'Unsupported currency.',
      });
    }

    // Sanitize receipt and notes
    const safeReceipt = sanitizeString(receipt) || `rcpt_${Date.now()}`;
    const safeNotes = {};
    if (notes && typeof notes === 'object') {
      for (const [key, val] of Object.entries(notes)) {
        if (typeof val === 'string') {
          safeNotes[sanitizeString(key, 50)] = sanitizeString(val, 200);
        }
      }
    }

    const options = {
      amount: Math.round(validAmount * 100), // Convert to paise
      currency: validCurrency,
      receipt: safeReceipt,
      notes: safeNotes,
    };

    const order = await razorpay.orders.create(options);

    // Store order details
    storePayment(order.id, {
      amount: validAmount,
      currency: validCurrency,
      status: 'created',
    });

    secureLog('info', `Order created: ${order.id}`, {
      amount: validAmount,
      currency: validCurrency,
    });

    res.json({
      success: true,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        receipt: order.receipt,
      },
    });
  } catch (error) {
    secureLog('error', 'Order creation failed', { message: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to create order. Please try again.',
    });
  }
});

// ─── POST: Verify Payment ───────────────────────────────
app.post('/api/verify-payment', apiLimiter, (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Validate required fields exist and are strings
    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature ||
      typeof razorpay_order_id !== 'string' ||
      typeof razorpay_payment_id !== 'string' ||
      typeof razorpay_signature !== 'string'
    ) {
      secureLog('warn', 'Verification attempt with missing/invalid parameters');
      return res.status(400).json({
        success: false,
        error: 'Missing payment verification parameters.',
      });
    }

    // Validate format (Razorpay IDs follow specific patterns)
    if (
      !razorpay_order_id.startsWith('order_') ||
      !razorpay_payment_id.startsWith('pay_')
    ) {
      secureLog('warn', 'Verification attempt with malformed IDs');
      return res.status(400).json({
        success: false,
        error: 'Invalid payment parameters.',
      });
    }

    // Generate expected HMAC SHA256 signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    const isAuthentic = crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(razorpay_signature, 'hex')
    );

    if (isAuthentic) {
      // Update stored payment
      storePayment(razorpay_order_id, {
        paymentId: razorpay_payment_id,
        status: 'verified',
        verifiedAt: new Date().toISOString(),
      });

      secureLog('info', `Payment verified: ${razorpay_payment_id}`, {
        orderId: razorpay_order_id,
      });

      res.json({
        success: true,
        message: 'Payment verified successfully!',
        payment: {
          orderId: razorpay_order_id,
          paymentId: razorpay_payment_id,
        },
      });
    } else {
      secureLog('error', 'SIGNATURE MISMATCH — possible tampering', {
        orderId: razorpay_order_id,
      });

      res.status(400).json({
        success: false,
        error: 'Payment verification failed.',
      });
    }
  } catch (error) {
    secureLog('error', 'Verification error', { message: error.message });
    res.status(500).json({
      success: false,
      error: 'Verification error. Contact support.',
    });
  }
});

// ─── POST: Razorpay Webhook ─────────────────────────────
// This ensures you capture payments even if the user's browser closes
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret || webhookSecret === 'your_webhook_secret_here') {
      secureLog('warn', 'Webhook received but RAZORPAY_WEBHOOK_SECRET not configured');
      return res.status(200).json({ status: 'ok' }); // Acknowledge to prevent retries
    }

    const shasum = crypto.createHmac('sha256', webhookSecret);
    const receivedSignature = req.headers['x-razorpay-signature'];

    if (!receivedSignature) {
      secureLog('warn', 'Webhook missing signature header');
      return res.status(400).json({ error: 'Missing signature' });
    }

    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    shasum.update(body);
    const expectedSignature = shasum.digest('hex');

    // Constant-time comparison
    let isValid = false;
    try {
      isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(receivedSignature, 'hex')
      );
    } catch {
      isValid = false;
    }

    if (!isValid) {
      secureLog('error', 'Webhook signature verification FAILED');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const eventType = event.event;

    secureLog('info', `Webhook received: ${eventType}`);

    switch (eventType) {
      case 'payment.authorized':
        secureLog('info', 'Payment authorized via webhook', {
          paymentId: event.payload?.payment?.entity?.id,
          amount: event.payload?.payment?.entity?.amount / 100,
        });
        break;

      case 'payment.captured':
        secureLog('info', 'Payment captured via webhook', {
          paymentId: event.payload?.payment?.entity?.id,
          amount: event.payload?.payment?.entity?.amount / 100,
        });
        // TODO: Update your database — mark order as paid
        break;

      case 'payment.failed':
        secureLog('warn', 'Payment failed via webhook', {
          paymentId: event.payload?.payment?.entity?.id,
          reason: event.payload?.payment?.entity?.error_description,
        });
        break;

      case 'refund.created':
        secureLog('info', 'Refund created via webhook', {
          refundId: event.payload?.refund?.entity?.id,
        });
        break;

      default:
        secureLog('info', `Unhandled webhook event: ${eventType}`);
    }

    // Always respond 200 to acknowledge (prevents Razorpay retries)
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    secureLog('error', 'Webhook processing error', { message: error.message });
    res.status(200).json({ status: 'ok' }); // Still acknowledge
  }
});

// ─── GET: Payment Details ───────────────────────────────
app.get('/api/payment/:paymentId', apiLimiter, async (req, res) => {
  try {
    const { paymentId } = req.params;

    // Validate payment ID format
    if (!paymentId || !paymentId.startsWith('pay_')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment ID.',
      });
    }

    const payment = await razorpay.payments.fetch(paymentId);

    // Only return safe fields (not internal data)
    res.json({
      success: true,
      payment: {
        id: payment.id,
        amount: payment.amount / 100,
        currency: payment.currency,
        status: payment.status,
        method: payment.method,
        email: payment.email,
        contact: payment.contact,
        created_at: payment.created_at,
      },
    });
  } catch (error) {
    secureLog('error', 'Fetch payment error', { message: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment details.',
    });
  }
});

// ─── Health Check ───────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    mode: process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test') ? 'test' : 'live',
    uptime: Math.round(process.uptime()) + 's',
  });
});

// ─── Fallback: Serve SPA ────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Global Error Handler ───────────────────────────────
app.use((err, req, res, next) => {
  secureLog('error', 'Unhandled error', { message: err.message });
  res.status(500).json({
    success: false,
    error: 'An unexpected error occurred.',
  });
});

// ═══════════════════════════════════════════════════════════
//  START SERVER
// ═══════════════════════════════════════════════════════════

app.listen(PORT, () => {
  const mode = process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test') ? 'TEST' : '🔴 LIVE';
  console.log(`
╔══════════════════════════════════════════════╗
║   🚀  Razorpay Gateway — PRODUCTION         ║
╠══════════════════════════════════════════════╣
║  URL:     http://localhost:${PORT}              ║
║  Mode:    ${mode.padEnd(35)}║
║  Helmet:  ✅ Security headers active         ║
║  CORS:    ✅ Locked to allowed origin        ║
║  Rate:    ✅ 5 orders/min, 30 req/15min      ║
║  Webhook: ${(process.env.RAZORPAY_WEBHOOK_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET !== 'your_webhook_secret_here') ? '✅ Configured                       ' : '⚠️  Not configured (set in .env)     '}║
╚══════════════════════════════════════════════╝
  `);
});

// ─── Graceful Shutdown ──────────────────────────────────
process.on('SIGTERM', () => {
  secureLog('info', 'SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  secureLog('info', 'SIGINT received. Shutting down...');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  secureLog('error', 'Unhandled Promise Rejection', { reason: String(reason) });
});
