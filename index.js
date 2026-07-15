// index.js
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const { sendPurchaseEvent } = require('./capi-meta');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Health check
app.get('/health', (req, res) => {
  console.log('✅ Health check OK');
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    pixelId: process.env.PIXEL_ID,
    hasToken: !!process.env.META_ACCESS_TOKEN
  });
});

// Webhook Shopify - Pedido pago (ROTA CORRIGIDA)
app.post('/webhook/orders-paid', async (req, res) => {
  try {
    console.log('\n📨 WEBHOOK RECEBIDO DE SHOPIFY');
    console.log('Order ID:', req.body.id);
    
    // Enviar para Meta CAPI
    const result = await sendPurchaseEvent(req.body, req);
    
    console.log('✅ Evento enviado para Meta com sucesso\n');
    res.status(200).json({ 
      success: true, 
      message: 'Event sent to Meta CAPI',
      facebookEventId: result.events_received
    });

  } catch (error) {
    console.error('❌ Erro no webhook:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Webhook Shopify - Pedido pago (ALIAS COMPATIBILIDADE)
app.post('/webhook/purchase', async (req, res) => {
  try {
    console.log('\n📨 WEBHOOK RECEBIDO DE SHOPIFY (via /purchase)');
    console.log('Order ID:', req.body.id);
    
    // Enviar para Meta CAPI
    const result = await sendPurchaseEvent(req.body, req);
    
    console.log('✅ Evento enviado para Meta com sucesso\n');
    res.status(200).json({ 
      success: true, 
      message: 'Event sent to Meta CAPI',
      facebookEventId: result.events_received
    });

  } catch (error) {
    console.error('❌ Erro no webhook:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Webhook Shopify - Carrinho
app.post('/webhook/cart', async (req, res) => {
  try {
    console.log('📨 Cart webhook recebido');
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Erro:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`\n🚀 CAPI Server rodando em porta ${PORT}`);
  console.log(`📊 Pixel ID: ${process.env.PIXEL_ID}`);
  console.log(`🔑 Token: ${process.env.META_ACCESS_TOKEN ? '✅ Configurado' : '❌ FALTANDO'}`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
