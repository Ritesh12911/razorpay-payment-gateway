/* ═══════════════════════════════════════════════════════════
   Shared Razorpay instance & utilities for Vercel Serverless
   Files prefixed with _ in /api are NOT exposed as endpoints
   ═══════════════════════════════════════════════════════════ */

const Razorpay = require('razorpay');
const crypto = require('crypto');

// ─── Singleton Razorpay Instance ────────────────────────
let razorpayInstance = null;

function getRazorpay() {
  if (!razorpayInstance) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set');
    }
    razorpayInstance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayInstance;
}

// ─── CORS Headers ───────────────────────────────────────
function setCorsHeaders(res) {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

// ─── Handle CORS Preflight ─────────────────────────────
function handlePreflight(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.status(204).end();
    return true;
  }
  return false;
}

// ─── Input Validation ───────────────────────────────────
function sanitizeString(str, maxLen = 200) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'`;()]/g, '').trim().substring(0, maxLen);
}

function validateAmount(amount) {
  const num = Number(amount);
  if (isNaN(num) || num <= 0 || num > 500000 || !isFinite(num)) {
    return null;
  }
  return Math.round(num * 100) / 100;
}

function validateCurrency(currency) {
  const allowed = ['INR', 'USD', 'EUR', 'GBP', 'SGD'];
  return allowed.includes(currency) ? currency : null;
}

// ─── Secure Logging ─────────────────────────────────────
function secureLog(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const safeMeta = { ...meta };
  delete safeMeta.key_secret;
  delete safeMeta.signature;
  delete safeMeta.razorpay_signature;

  const prefix = { info: '✅', warn: '⚠️', error: '❌' }[level] || 'ℹ️';
  console.log(`[${timestamp}] ${prefix} ${message}`, Object.keys(safeMeta).length ? safeMeta : '');
}

module.exports = {
  getRazorpay,
  setCorsHeaders,
  handlePreflight,
  sanitizeString,
  validateAmount,
  validateCurrency,
  secureLog,
  crypto,
};
