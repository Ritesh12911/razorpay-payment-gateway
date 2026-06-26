const {
  setCorsHeaders,
  handlePreflight,
  secureLog,
  crypto,
} = require('./_lib/razorpay');

module.exports = function handler(req, res) {
  if (handlePreflight(req, res)) return;
  setCorsHeaders(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Validate required fields
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

    // Validate ID formats
    if (!razorpay_order_id.startsWith('order_') || !razorpay_payment_id.startsWith('pay_')) {
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
};
