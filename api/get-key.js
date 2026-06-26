const { setCorsHeaders, handlePreflight } = require('./_lib/razorpay');

module.exports = function handler(req, res) {
  if (handlePreflight(req, res)) return;
  setCorsHeaders(res);

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  res.json({ key: process.env.RAZORPAY_KEY_ID });
};
