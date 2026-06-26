const {
  getRazorpay,
  setCorsHeaders,
  handlePreflight,
  sanitizeString,
  validateAmount,
  validateCurrency,
  secureLog,
} = require('./_lib/razorpay');

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  setCorsHeaders(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

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

    // Sanitize inputs
    const safeReceipt = sanitizeString(receipt) || `rcpt_${Date.now()}`;
    const safeNotes = {};
    if (notes && typeof notes === 'object') {
      for (const [key, val] of Object.entries(notes)) {
        if (typeof val === 'string') {
          safeNotes[sanitizeString(key, 50)] = sanitizeString(val, 200);
        }
      }
    }

    const razorpay = getRazorpay();
    const order = await razorpay.orders.create({
      amount: Math.round(validAmount * 100),
      currency: validCurrency,
      receipt: safeReceipt,
      notes: safeNotes,
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
};
