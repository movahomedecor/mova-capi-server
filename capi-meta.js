const crypto = require('crypto');

const PIXEL_ID     = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

// ============================================================
// Dedup de segurança em memória (sem dependência nova).
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

// [NOVO] helper: lê um note_attribute do pedido pelo nome
function getAttr(order, name) {
  const attrs = order.note_attributes || [];
  const found = attrs.find(a => a.name === name);
  return found && found.value ? String(found.value) : null;
}

async function sendPurchaseEvent(order) {
  const eventId = `shopify_purchase_${order.id}`;

  // dedup: se já enviamos este pedido, não reenvia
  if (alreadySent(eventId)) {
    console.log(`[dedup] já enviado, ignorando: ${eventId}`);
    return true;
  }

  const eventTime = Math.floor(new Date(order.created_at).getTime() / 1000);
  const customer  = order.customer || {};
  const address   = order.billing_address || order.shipping_address || {};

  // ============================================================
  // [ALTERADO] IP e UA: prioridade para os note_attributes
  // capturados no NAVEGADOR REAL do cliente pelo snippet do tema.
  // O browser_ip/client_details do pedido é só fallback, porque
  // em checkout externo (UnicoPag) pode refletir o servidor do
  // gateway em vez do cliente.
  // ============================================================
  const ipAttr = getAttr(order, '_client_ip_address');
  const uaAttr = getAttr(order, '_client_user_agent');

  const clientIp = ipAttr
    || order.browser_ip
    || order.client_details?.browser_ip
    || null;

  const clientUa = uaAttr
    || order.client_details?.user_agent
    || null;

  const userData = {
    em:  [hash(customer.email)],
    ph:  [hash(formatPhone(customer.phone || address.phone))],
    fn:  [hash(customer.first_name)],
    ln:  [hash(customer.last_name)],
    ct:  [hash(address.city)],
    st:  [hash(address.province_code)],
    zp:  [hash(address.zip)],
    country: [hash(address.country_code)],
    // external_id: identificador estável do cliente (hash do email, fallback id)
    external_id: [hash(customer.email || (customer.id ? String(customer.id) : null))],
    client_ip_address: clientIp,
    client_user_agent: clientUa,
  };

  // ============================================================
  // fbc: prioriza o cookie _fbc capturado pronto no navegador.
  // Se não houver, reconstrói a partir do fbclid (fallback).
  // ============================================================
  const fbcAttr = getAttr(order, '_fbc');
  if (fbcAttr) {
    userData.fbc = fbcAttr;
  } else {
    const fbclidAttr = getAttr(order, 'fbclid');
    if (fbclidAttr) {
      const ts = Math.floor(Date.now() / 1000);
      userData.fbc = `fb.1.${ts}.${fbclidAttr}`;
    }
  }

  const fbpAttr = getAttr(order, '_fbp');
  if (fbpAttr) {
    userData.fbp = fbpAttr;
  }

  // ============================================================
  // [NOVO] Log de diagnóstico: mostra pedido a pedido quais
  // sinais de navegador chegaram e de onde vieram. Acompanhe
  // nos Deploy Logs do Railway para ver a cobertura subindo.
  // ============================================================
  console.log(`[sinais] Pedido #${order.order_number}:`, {
    fbp: userData.fbp ? 'OK' : 'AUSENTE',
    fbc: userData.fbc ? (fbcAttr ? 'OK (cookie)' : 'OK (reconstruído)') : 'AUSENTE',
    ip:  clientIp ? (ipAttr ? 'OK (navegador)' : 'OK (fallback Shopify)') : 'AUSENTE',
    ua:  clientUa ? (uaAttr ? 'OK (navegador)' : 'OK (fallback Shopify)') : 'AUSENTE',
  });

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

    // marca como enviado só após sucesso (dedup definitivo)
    sentEvents.set(eventId, Date.now());

    console.log(`[CAPI] ✅ Purchase enviado! Pedido #${order.order_number} | Recebidos: ${result.events_received}`);
    return true;
  } catch (err) {
    console.error('[CAPI] Falha:', err.message);
    return false; // NÃO marca -> permite reprocessar
  }
}

module.exports = { sendPurchaseEvent };
