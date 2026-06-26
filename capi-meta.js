const crypto = require('crypto');

const PIXEL_ID     = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

// ============================================================
// [NOVO] Dedup de segurança em memória (sem dependência nova).
// Protege contra reentrega do webhook orders/paid e contra a
// retentativa cartão UnicoPag -> Appmax gerar dois disparos.
// TTL de 6h cobre o cenário real (reentregas em segundos/minutos).
// ============================================================
const sentEvents = new Map(); // eventId -> timestamp
const DEDUP_TTL  = 1000 * 60 * 60 * 6; // 6 horas

function alreadySent(id) {
  const now = Date.now();
  for (const [k, t] of sentEvents) {
    if (now - t > DEDUP_TTL) sentEvents.delete(k); // limpeza preguiçosa
  }
  return sentEvents.has(id);
}

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

  // [NOVO] dedup: se já enviamos este pedido, não reenvia
  if (alreadySent(eventId)) {
    console.log(`[dedup] já enviado, ignorando: ${eventId}`);
    return true;
  }

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
    // [NOVO] external_id: identificador estável do cliente (hash do email, fallback id)
    external_id: [hash(customer.email || (customer.id ? String(customer.id) : null))],
    client_ip_address: order.browser_ip || null,
    client_user_agent: order.client_details?.user_agent || null,
  };

  const attrs = order.note_attributes || [];

  // ============================================================
  // fbc: prioriza o cookie _fbc capturado pronto no navegador.
  // Se não houver, reconstrói a partir do fbclid (fallback).
  // ============================================================
  const fbcAttr = attrs.find(a => a.name === '_fbc');
  if (fbcAttr?.value) {
    // [NOVO] usa o _fbc pronto do navegador (mais confiável)
    userData.fbc = fbcAttr.value;
  } else {
    const fbclidAttr = attrs.find(a => a.name === 'fbclid');
    if (fbclidAttr?.value) {
      const ts = Math.floor(Date.now() / 1000);
      userData.fbc = `fb.1.${ts}.${fbclidAttr.value}`;
    }
  }

  const fbpAttr = attrs.find(a => a.name === '_fbp');
  if (fbpAttr?.value) {
    userData.fbp = fbpAttr.value;
  }

  // [NOVO] fallback de user_agent: se a Shopify não trouxe, usa o capturado no checkout
  if (!userData.client_user_agent) {
    const uaAttr = attrs.find(a => a.name === '_client_user_agent');
    if (uaAttr?.value) userData.client_user_agent = uaAttr.value;
  }

  // remove campos vazios/nulos
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

  // [ALTERADO] API v19.0 -> v20.0
  const url = `https://graph.facebook.com/v20.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (result.error) {
      console.error('[CAPI] Erro:', result.error);
      return false; // NÃO marca como enviado -> permite reprocessar
    }

    // [NOVO] marca como enviado só após sucesso (dedup definitivo)
    sentEvents.set(eventId, Date.now());

    console.log(`[CAPI] ✅ Purchase enviado! Pedido #${order.order_number} | Recebidos: ${result.events_received}`);
    return true;
  } catch (err) {
    console.error('[CAPI] Falha:', err.message);
    return false; // NÃO marca -> permite reprocessar
  }
}

module.exports = { sendPurchaseEvent };
