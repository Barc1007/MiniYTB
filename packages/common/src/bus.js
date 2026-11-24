// Event bus dùng RabbitMQ (topic exchange). Các service giao tiếp bất đồng bộ qua sự kiện,
// ví dụ: video.uploaded -> streaming-service chuyển mã -> video.transcoded -> video-service.
// Tin nhắn xử lý lỗi được đẩy sang dead-letter queue "myt.dead" để kiểm tra sau.
const amqp = require('amqplib');
const { optional } = require('./env');

const URL = optional('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672');
const EXCHANGE = 'myt.events';
const DLX = 'myt.dlx';

let connection = null;
let channel = null;
let connecting = null;
let closing = false;
const subscriptions = [];
const pendingPublishes = [];

async function setupChannel(conn) {
  const ch = await conn.createConfirmChannel();
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertExchange(DLX, 'fanout', { durable: true });
  await ch.assertQueue('myt.dead', { durable: true });
  await ch.bindQueue('myt.dead', DLX, '');
  return ch;
}

async function connect() {
  if (channel) return channel;
  if (connecting) return connecting;
  connecting = (async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        const conn = await amqp.connect(URL);
        conn.on('error', (err) => console.error('RabbitMQ lỗi kết nối:', err.message));
        conn.on('close', () => {
          connection = null; channel = null; connecting = null;
          if (closing) return;
          console.warn('⚠️  Mất kết nối RabbitMQ, đang thử kết nối lại...');
          setTimeout(() => connect().catch(() => {}), 2000);
        });
        const ch = await setupChannel(conn);
        connection = conn;
        channel = ch;
        for (const sub of subscriptions) await bindSubscription(sub);
        console.log('✅ RabbitMQ đã kết nối');
        connecting = null;
        while (pendingPublishes.length) {
          const { key, payload } = pendingPublishes.shift();
          await publish(key, payload);
        }
        return channel;
      } catch (err) {
        connection = null; channel = null;
        if (attempt % 5 === 1) console.warn(`⏳ Chưa kết nối được RabbitMQ (lần ${attempt}): ${err.message}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  })();
  return connecting;
}

/** Phát một sự kiện. Nếu đang mất kết nối, sự kiện được giữ lại và gửi khi kết nối lại. */
async function publish(key, payload) {
  if (!channel) {
    pendingPublishes.push({ key, payload });
    connect().catch(() => {});
    return;
  }
  const message = { type: key, data: payload, at: new Date().toISOString() };
  await new Promise((resolve, reject) => {
    channel.publish(EXCHANGE, key, Buffer.from(JSON.stringify(message)), {
      persistent: true, contentType: 'application/json',
    }, (err) => (err ? reject(err) : resolve()));
  });
}

async function bindSubscription(sub) {
  // Mỗi subscription có channel riêng để prefetch độc lập (worker chuyển mã chỉ nhận 1 việc/lần).
  const ch = await connection.createChannel();
  await ch.assertQueue(sub.queue, { durable: true, deadLetterExchange: DLX });
  for (const key of sub.keys) await ch.bindQueue(sub.queue, EXCHANGE, key);
  await ch.prefetch(sub.prefetch);
  await ch.consume(sub.queue, async (msg) => {
    if (!msg) return;
    let event;
    try {
      event = JSON.parse(msg.content.toString());
      await sub.handler(event.data, event.type, event);
      ch.ack(msg);
    } catch (err) {
      console.error(`❌ Xử lý sự kiện ${event?.type || '?'} ở queue ${sub.queue} thất bại:`, err.message);
      try { ch.nack(msg, false, false); } catch { /* channel đã đóng */ } // -> dead-letter queue
    }
  });
}

/**
 * Đăng ký nhận sự kiện. `queue` là tên queue bền vững của service: nhiều instance của
 * cùng service dùng chung queue => tải được chia đều giữa các instance (scale ngang).
 */
async function subscribe(queue, keys, handler, { prefetch = 10 } = {}) {
  const sub = { queue, keys, handler, prefetch };
  subscriptions.push(sub);
  if (connection && channel) await bindSubscription(sub);
  else connect().catch(() => {});
}

function isConnected() {
  return !!channel;
}

async function close() {
  closing = true;
  try { await connection?.close(); } catch { /* bỏ qua */ }
}

module.exports = { connect, publish, subscribe, isConnected, close, EXCHANGE };
