module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.json({
    status: 'healthy',
    mode: process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test') ? 'test' : 'live',
    timestamp: new Date().toISOString(),
  });
};
