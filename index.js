require('dotenv').config();
const express = require('express');
const crypto  = require('crypto');
const { sendPurchaseEvent } = require('./capi-meta');
const app    = express();
const PORT   = process.env.PORT || 3000;
const SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

// Rota de saúde — para o Railway saber que o servidor está OK
app.get('/', (req, res) => res.send('Mōva Decor CAPI Server ✅ Online'));

// ============================================================
// NOVO — Endpoint /ip
// O snippet do theme.liquid chama este endpoint para descobrir
// o IP público do visitante e gravá-lo como cart attribute
// (_client_ip_address), que depois chega no webhook.
// ============================================================
const ALLOWED_ORIGINS = [
  'https://movadecor.com.br',
  'https://www.movadecor.com.br',
];

app.get('/ip', (req, res) => {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  }
  res.set('Cache-Control', 'no-store');

  // O Railway fica atrás de proxy: o IP real do visitante
  // vem no primeiro valor do header x-forwarded-for
  const ip =
    (req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim() ||
    req.socket.remoteAddress ||
    '';

  res.json({ ip });
});

// Webhook do Shopify — orders/paid
app.post('/webhook/orders-paid',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const rawBody = req.body.toString();
    const hmac    = req.headers['x-shopify-hmac-sha256'];
    // Valida autenticidade
    const hash = crypto.createHmac('sha256', SECRET)
      .update(rawBody, 'utf8').digest('base64');
    if (hash !== hmac) {
      console.warn('[Webhook] ❌ HMAC inválido');
      return res.status(401).send();
    }
    res.status(200).send();  // Responde imediatamente ao Shopify
    const order = JSON.parse(rawBody);
    console.log(`[Webhook] 📦 Pedido pago: #${order.order_number} | Gateway: ${order.gateway}`);
    await sendPurchaseEvent(order);
  }
);

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
