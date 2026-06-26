const { secureLog, crypto } = require('./_lib/razorpay');

// Vercel config: disable body parsing so we get raw body for signature verification
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret || webhookSecret === 'your_webhook_secret_here') {
      secureLog('warn', 'Webhook received but RAZORPAY_WEBHOOK_SECRET not configured');
      return res.status(200).json({ status: 'ok' });
    }

    // Get raw body for signature verification
    const rawBody = await getRawBody(req);
    const receivedSignature = req.headers['x-razorpay-signature'];

    if (!receivedSignature) {
      secureLog('warn', 'Webhook missing signature header');
      return res.status(400).json({ error: 'Missing signature' });
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

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

    const event = JSON.parse(rawBody);
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

    res.status(200).json({ status: 'ok' });
  } catch (error) {
    secureLog('error', 'Webhook processing error', { message: error.message });
    res.status(200).json({ status: 'ok' }); // Always acknowledge
  }
};
