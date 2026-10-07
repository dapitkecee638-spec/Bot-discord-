// ============================================================
// BOT DISCORD AUTO-MODERATOR (Anti Promosi & Anti Link)
// Library : discord.js v14
// ============================================================

// --- 1. IMPORT & LOAD ENVIRONMENT -------------------------------------------
require('dotenv').config(); // Membaca file .env agar process.env.TOKEN terbaca
const {
  Client,
  GatewayIntentBits,
  Events,
  PermissionFlagsBits,
} = require('discord.js');

// --- 2. KONFIGURASI (EDIT BAGIAN INI SESUAI KEBUTUHAN) -----------------------

// Daftar kata kunci promosi (huruf kecil semua). Tinggal tambah/hapus item-nya.
const PROMO_KEYWORDS = [
  'promosi',
  'open paid',
  'jual',
  'murah',
  'diskon',
  'cek bio',
  'ready stock',
  'gabung grup',
  'open member',
];

// Nama role yang kebal filter (tidak peka huruf besar/kecil).
const WHITELIST_ROLE_NAMES = ['Staff', 'Moderator', 'Admin'];

// (Opsional) ID role yang kebal filter. Lebih akurat daripada nama role.
const WHITELIST_ROLE_IDS = [
  // '123456789012345678',
];

// Permission yang otomatis membuat user kebal (Admin & Moderator).
const WHITELIST_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageMessages,
];

// Berapa detik pesan peringatan tampil sebelum dihapus otomatis (0 = tidak dihapus).
const WARNING_LIFETIME_SECONDS = 8;

// --- 3. REGEX DETEKSI LINK ---------------------------------------------------

// a) Link invite Discord (discord.gg, discord.com/invite, discordapp.com/invite)
const DISCORD_INVITE_REGEX =
  /(?:discord(?:app)?\s*\.\s*(?:gg|com\s*\/\s*invite)|dsc\s*\.\s*gg)\s*\/?\s*[\w-]+/i;

// b) Link umum: diawali http(s):// atau www., ATAU domain dengan TLD populer.
//    Tambahkan TLD lain di dalam daftar (com|net|id|...) jika perlu.
const URL_REGEX = new RegExp(
  [
    '(?:https?:\\/\\/|www\\.)\\S+', // http://..., https://..., www....
    '|',
    '\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.', // nama domain (contoh: toko.example)
    '(?:com|net|org|id|co\\.id|my\\.id|web\\.id|biz|info|xyz|site|online|shop|store|link|me|io|gg|tv|cc|app|dev|top|club)',
    '\\b(?:\\/\\S*)?', // path opsional setelah domain
  ].join(''),
  'i'
);

// --- 4. FUNGSI BANTUAN -------------------------------------------------------

// Membersihkan teks: hapus karakter tak terlihat (zero-width) yang sering dipakai untuk mengakali filter.
function normalizeText(text) {
  return text.replace(/[\u200B-\u200D\uFEFF]/g, '').toLowerCase();
}

// Cek apakah pesan mengandung kata kunci promosi. Mengembalikan kata yang cocok (atau null).
function findPromoKeyword(content) {
  return PROMO_KEYWORDS.find((keyword) => content.includes(keyword.toLowerCase())) || null;
}

// Cek apakah pesan mengandung link/URL apa pun (termasuk invite Discord).
function containsLink(content) {
  return DISCORD_INVITE_REGEX.test(content) || URL_REGEX.test(content);
}

// Cek apakah member masuk whitelist (Admin, Moderator, atau role tertentu).
function isWhitelisted(member) {
  if (!member) return false;

  // Punya permission Administrator / Manage Messages?
  if (WHITELIST_PERMISSIONS.some((perm) => member.permissions.has(perm))) return true;

  // Punya role dengan ID atau nama yang ada di whitelist?
  const whitelistedNames = WHITELIST_ROLE_NAMES.map((n) => n.toLowerCase());
  return member.roles.cache.some(
    (role) =>
      WHITELIST_ROLE_IDS.includes(role.id) ||
      whitelistedNames.includes(role.name.toLowerCase())
  );
}

// --- 5. SERVER HTTP KECIL (WAJIB UNTUK RENDER "WEB SERVICE") -----------------
// Render Web Service mengecek apakah ada proses yang "listen" di process.env.PORT.
// Tanpa ini, deploy akan dianggap gagal / terus restart.
// Kalau kamu pakai tipe layanan "Background Worker" di Render, bagian ini boleh dihapus.
const http = require('http');
const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running.');
  })
  .listen(PORT, () => {
    console.log(`🌐 Health check server berjalan di port ${PORT}`);
  });

// --- 6. INISIALISASI CLIENT --------------------------------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,         // Akses dasar server
    GatewayIntentBits.GuildMessages,  // Menerima event pesan di server
    GatewayIntentBits.MessageContent, // Membaca isi pesan (WAJIB diaktifkan di Developer Portal)
  ],
});

// Event: bot berhasil online
client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅ Bot aktif sebagai ${readyClient.user.tag}`);
});

// --- 7. LOGIKA UTAMA AUTO-MODERATOR -----------------------------------------

client.on(Events.MessageCreate, async (message) => {
  // Abaikan bot lain, DM, dan pesan webhook
  if (message.author.bot || !message.guild || message.webhookId) return;

  // Abaikan member yang masuk whitelist (Admin/Mod/Staff)
  if (isWhitelisted(message.member)) return;

  // Deteksi promosi & link pada teks yang sudah dinormalisasi
  const content = normalizeText(message.content);
  const promoKeyword = findPromoKeyword(content);
  const hasLink = containsLink(content);

  // Jika bersih, hentikan proses
  if (!promoKeyword && !hasLink) return;

  // Tentukan alasan pelanggaran untuk pesan peringatan
  const reason = hasLink ? 'mengirim link' : 'melakukan promosi';

  try {
    // Tindakan 1: hapus pesan pelanggar
    await message.delete();

    // Tindakan 2: kirim peringatan dengan mention user di channel yang sama
    const warning = await message.channel.send(
      `⚠️ ${message.author}, kamu dilarang ${reason} di server ini! ` +
        `Pesanmu telah dihapus otomatis.`
    );

    // Hapus pesan peringatan setelah beberapa detik agar channel tetap rapi
    if (WARNING_LIFETIME_SECONDS > 0) {
      setTimeout(() => warning.delete().catch(() => {}), WARNING_LIFETIME_SECONDS * 1000);
    }

    console.log(
      `🛡️ Pesan ${message.author.tag} dihapus (${reason}${promoKeyword ? `, kata: "${promoKeyword}"` : ''}).`
    );
  } catch (error) {
    // Biasanya terjadi jika bot tidak punya izin "Manage Messages" / "Send Messages"
    console.error('❌ Gagal memoderasi pesan:', error.message);
  }
});

// --- 8. LOGIN ----------------------------------------------------------------

if (!process.env.TOKEN) {
  console.error('❌ TOKEN tidak ditemukan. Isi file .env terlebih dahulu.');
  process.exit(1);
}

client.login(process.env.TOKEN);
