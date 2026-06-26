/* ═══════════════════════════════════════════════════════════
   RAZORPAY PAYMENT GATEWAY — Frontend Logic (Production)
   Secure payment flow with validation and error handling
   ═══════════════════════════════════════════════════════════ */

const API_BASE = window.location.origin;

// Prevent multiple simultaneous payment attempts
let isProcessing = false;

// ─── Utility: Show Toast Notification ───────────────────
function showToast(message, type = 'info') {
  document.querySelectorAll('.toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ─── Utility: Toggle Loading Overlay ────────────────────
function setLoading(active, message = 'Creating your order...') {
  const overlay = document.getElementById('loading-overlay');
  const text = overlay.querySelector('.loading-overlay__text');
  text.textContent = message;

  if (active) {
    overlay.classList.add('active');
  } else {
    overlay.classList.remove('active');
  }
}

// ─── Utility: Format Currency ───────────────────────────
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Fetch Razorpay Key ─────────────────────────────────
async function fetchRazorpayKey() {
  try {
    const res = await fetch(`${API_BASE}/api/get-key`, {
      method: 'GET',
      credentials: 'same-origin',
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.key || typeof data.key !== 'string') {
      throw new Error('Invalid key response');
    }

    return data.key;
  } catch (error) {
    console.error('Failed to fetch Razorpay key:', error);
    showToast('Configuration error. Please try again later.', 'error');
    return null;
  }
}

// ─── Create Order on Backend ────────────────────────────
async function createOrder(amount, planName) {
  const res = await fetch(`${API_BASE}/api/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      amount: amount,
      currency: 'INR',
      receipt: `rcpt_${Date.now()}`,
      notes: {
        plan: planName,
      },
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Server error (${res.status})`);
  }

  const data = await res.json();

  if (!data.success || !data.order?.id) {
    throw new Error(data.error || 'Invalid order response');
  }

  return data.order;
}

// ─── Verify Payment on Backend ──────────────────────────
async function verifyPayment(paymentData) {
  const res = await fetch(`${API_BASE}/api/verify-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(paymentData),
  });

  const data = await res.json();
  return data;
}

// ─── Open Razorpay Checkout ─────────────────────────────
function openRazorpayCheckout(order, key, planName) {
  return new Promise((resolve, reject) => {
    if (typeof Razorpay === 'undefined') {
      reject(new Error('Razorpay SDK not loaded. Please refresh and try again.'));
      return;
    }

    const options = {
      key: key,
      amount: order.amount,
      currency: order.currency,
      name: 'PaySecure',
      description: planName,
      order_id: order.id,

      theme: {
        color: '#6366f1',
        backdrop_color: 'rgba(10, 10, 26, 0.85)',
      },

      modal: {
        ondismiss: function () {
          showToast('Payment cancelled. You can try again anytime.', 'info');
          resolve({ cancelled: true });
        },
        escape: true,
        animation: true,
        confirm_close: true, // Ask "Are you sure?" before closing
      },

      handler: function (response) {
        // Validate response has required fields
        if (!response.razorpay_payment_id || !response.razorpay_order_id || !response.razorpay_signature) {
          reject(new Error('Incomplete payment response from Razorpay'));
          return;
        }

        resolve({
          cancelled: false,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id: response.razorpay_order_id,
          razorpay_signature: response.razorpay_signature,
        });
      },

      retry: {
        enabled: true,
        max_count: 3, // Allow up to 3 retry attempts in the modal
      },
    };

    try {
      const razorpayInstance = new Razorpay(options);

      razorpayInstance.on('payment.failed', function (response) {
        console.error('Payment failed:', response.error);
        reject({
          description: response.error?.description || 'Payment failed',
          code: response.error?.code,
          reason: response.error?.reason,
        });
      });

      razorpayInstance.open();
    } catch (error) {
      reject(error);
    }
  });
}

// ─── Main Payment Flow ──────────────────────────────────
async function initiatePayment(amount, planName) {
  // Prevent double-clicks / concurrent payments
  if (isProcessing) {
    showToast('Payment already in progress...', 'info');
    return;
  }

  // Validate amount client-side
  const numAmount = Number(amount);
  if (!numAmount || numAmount < 1 || numAmount > 500000 || !isFinite(numAmount)) {
    showToast('Please enter a valid amount (₹1 – ₹5,00,000).', 'error');
    return;
  }

  isProcessing = true;

  try {
    // Step 1: Show loading
    setLoading(true, `Creating order for ${formatCurrency(numAmount)}...`);

    // Step 2: Fetch Razorpay key
    const key = await fetchRazorpayKey();
    if (!key) {
      setLoading(false);
      isProcessing = false;
      return;
    }

    // Step 3: Create order on backend
    const order = await createOrder(numAmount, planName);
    setLoading(false);

    // Step 4: Open Razorpay Checkout
    const result = await openRazorpayCheckout(order, key, planName);

    if (result.cancelled) {
      isProcessing = false;
      return;
    }

    // Step 5: Verify payment
    setLoading(true, 'Verifying your payment...');
    const verification = await verifyPayment({
      razorpay_order_id: result.razorpay_order_id,
      razorpay_payment_id: result.razorpay_payment_id,
      razorpay_signature: result.razorpay_signature,
    });

    setLoading(false);

    if (verification.success) {
      const params = new URLSearchParams({
        payment_id: result.razorpay_payment_id,
        order_id: result.razorpay_order_id,
        amount: numAmount,
        plan: planName,
      });
      window.location.href = `/success.html?${params.toString()}`;
    } else {
      window.location.href = `/failure.html?reason=${encodeURIComponent(verification.error || 'Verification failed')}`;
    }
  } catch (error) {
    setLoading(false);
    console.error('Payment flow error:', error);

    if (error.description) {
      window.location.href = `/failure.html?reason=${encodeURIComponent(error.description)}`;
    } else {
      showToast(error.message || 'Something went wrong. Please try again.', 'error');
    }
  } finally {
    isProcessing = false;
  }
}

// ─── Custom Amount Handler ──────────────────────────────
function handleCustomPayment() {
  const input = document.getElementById('custom-amount');
  const amount = parseFloat(input.value);

  if (!amount || amount < 1) {
    showToast('Please enter an amount of at least ₹1.', 'error');
    const group = document.getElementById('custom-amount-group');
    group.classList.add('shake');
    setTimeout(() => group.classList.remove('shake'), 500);
    input.focus();
    return;
  }

  if (amount > 500000) {
    showToast('Maximum amount is ₹5,00,000 per transaction.', 'error');
    return;
  }

  initiatePayment(amount, 'Custom Payment');
}

// ─── Enter Key Support for Custom Amount ────────────────
document.addEventListener('DOMContentLoaded', () => {
  const customInput = document.getElementById('custom-amount');
  if (customInput) {
    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCustomPayment();
      }
    });
  }
});
