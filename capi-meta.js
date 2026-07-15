// capi-meta.js
const axios = require('axios');
const crypto = require('crypto');

// ====== FUNÇÕES DE HASH ======

function normalizeAndHash(data) {
  if (!data) return null;
  
  const normalized = String(data)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  
  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex');
}

function hashPhone(phone) {
  if (!phone) return null;
  
  const cleaned = String(phone)
    .replace(/\D/g, '')
    .trim();
  
  if (cleaned.length < 10) return null;
  
  return crypto
    .createHash('sha256')
    .update(cleaned)
    .digest('hex');
}

function hashEmail(email) {
  if (!email) return null;
  
  const normalized = String(email)
    .toLowerCase()
    .trim();
  
  if (!normalized.includes('@')) return null;
  
  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex');
}

// ====== FUNÇÃO PRINCIPAL ======

async function sendPurchaseEvent(order, request) {
  try {
    console.log('\n🔄 Processando pedido para Meta CAPI...');
    
    const PIXEL_ID = process.env.PIXEL_ID;
    const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

    if (!PIXEL_ID || !ACCESS_TOKEN) {
      throw new Error('❌ PIXEL_ID ou ACCESS_TOKEN não configurados');
    }

    const customer = order.customer || {};
    const billingAddress = customer.default_address || {};
    
    console.log('👤 Cliente:', customer.email);
    console.log('💰 Total:', order.total_price, 'BRL');

    const userData = {};
    
    if (customer.email) {
      userData.em = hashEmail(customer.email);
      console.log('✓ Email hashed');
    }
    
    if (customer.phone) {
      userData.ph = hashPhone(customer.phone);
      console.log('✓ Telefone hashed');
    }
    
    if (customer.first_name) {
      userData.fn = normalizeAndHash(customer.first_name);
      console.log('✓ Nome hashed');
    }
    
    if (customer.last_name) {
      userData.ln = normalizeAndHash(customer.last_name);
      console.log('✓ Sobrenome hashed');
    }
    
    if (billingAddress.city) {
      userData.ct = normalizeAndHash(billingAddress.city);
      console.log('✓ Cidade hashed');
    }
    
    if (billingAddress.province) {
      userData.st = normalizeAndHash(billingAddress.province);
      console.log('✓ Estado hashed');
    }
    
    if (billingAddress.zip) {
      userData.zp = normalizeAndHash(billingAddress.zip);
      console.log('✓ CEP hashed');
    }
    
    userData.country = normalizeAndHash('BR');
    console.log('✓ País: BR');

    const userAgent = request.get('user-agent') || 'unknown';
    const clientIp = 
      request.get('x-forwarded-for')?.split(',')[0] || 
      request.ip || 
      request.connection.remoteAddress ||
      'unknown';

    console.log('📱 User Agent:', userAgent.substring(0, 50) + '...');
    console.log('🌐 IP:', clientIp);

    const fbp = request.get('x-fbp') || order.fbp || null;
    const fbc = request.get('x-fbc') || order.fbc || null;

    if (fbp) console.log('✓ fbp:', fbp.substring(0, 20) + '...');
    if (fbc) console.log('✓ fbc:', fbc.substring(0, 20) + '...');

    const capiPayload = {
      data: [
        {
          event_name: 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          event_id: `${order.id}_${Date.now()}`,
          action_source: 'website',
          event_source_url: order.checkout_url || 'https://movadecor.com.br',

          user_data: {
            ...userData,
            client_user_agent: userAgent,
            client_ip_address: clientIp,
            ...(fbc && { fbc }),
            ...(fbp && { fbp }),
          },

          custom_data: {
            value: parseFloat(order.total_price || 0),
            currency: 'BRL',
            content_name: 'Compra Mōva Decor',
            content_type: 'product',
            content_ids: [String(order.id)],
            num_items: order.line_items?.length || 1,
          },

          opt_out: false,
        }
      ],
      access_token: ACCESS_TOKEN
    };

    console.log('\n📤 Enviando para Meta...');

    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${PIXEL_ID}/events`,
      capiPayload,
      {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Resposta Meta:', response.data);
    
    return response.data;

  } catch (error) {
    console.error('\n❌ Erro ao enviar CAPI:');
    console.error('Status:', error.response?.status);
    console.error('Dados:', error.response?.data);
    console.error('Mensagem:', error.message);
    
    throw error;
  }
}

module.exports = {
  sendPurchaseEvent,
  normalizeAndHash,
  hashPhone,
  hashEmail
};
