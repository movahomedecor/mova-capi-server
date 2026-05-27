const crypto = require('crypto');

const PIXEL_ID     = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

function hash(value) {
  if (!value) return null;
  return crypto.createHash('sha256')
    .update(value.toLowerCase().trim()).digest('hex');
}

function formatPhone(phone) {
  if (!phone) return null;
  return phone.replace(/\D/g, '');
}

async function sendPurchaseEvent(order) {
  const eventId = `shopify_purchase_${order.id}`;
  const eventTime = Math.floor(new Date(order.created_at).getTime() / 1000);
  const customer  = order.customer || {};
  const address   = order.billing_address || order.shipping_address || {};

  const userData = {
    em:  [hash(customer.email)],
    ph:  [hash(formatPhone(customer.phone || address.phone))],
    fn:  [hash(customer.first_name)],
    ln:  [hash(customer.last_name)],
    ct:  [hash(address.city)],
    st:  [hash(address.province_code)],
    zp:  [hash(address.zip)],
    country: [hash(address.country_code)],
    client_ip_address: order.browser_ip || null,
    client_user_agent: order.client_details?.user_agent || null,
  };

  const attrs = order.note_attributes || [];
  
  const fbclidAttr = attrs.find(a => a.name === 'fbclid');
  if (fbclidAttr?.value) {
    const ts = Math.floor(Date.now() / 1000);
    userData.fbc = `fb.1.${ts}.${fbclidAttr.value}`;
  }

  const fbpAttr = attrs.find(a => a.name === '_fbp');
  if (fbpAttr?.value) {
    userData.fbp = fbpAttr.value;
  }

  Object.keys(userData).forEach(k => {
    if (!userData[k] || userData[k][0] === null) delete userData[k];
  });

  const payload = {
    data: [{
      event_name: 'Purchase',
      event_time: eventTime,
      event_id:   eventId,
      event_source_url: 'https://www.movadecor.com.br/',
      action_source: 'website',
      user_data:   userData,
      custom_data: {
  currency:      order.currency,
  value:         parseFloat(order.total_price),
  predicted_ltv: Math.round(parseFloat(order.total_price) * 3 * 100) / 100,
  order_id:      String(order.id),
  content_type:  'product',
        contents: (order.line_items || []).map(item => ({
          id: String(item.product_id),
          quantity: item.quantity,
          item_price: parseFloat(item.price)
        }))
      }
    }]
  };

  const url = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (result.error) {
      console.error('[CAPI] Erro:', result.error);
      return false;
    }
    console.log(`[CAPI] ✅ Purchase enviado! Pedido #${order.order_number} | Recebidos: ${result.events_received}`);
    return true;
  } catch (err) {
    console.error('[CAPI] Falha:', err.message);
    return false;
  }
}

module.exports = { sendPurchaseEvent };
