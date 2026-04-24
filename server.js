const express = require("express");
const { Sequelize, DataTypes, Op } = require("sequelize");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = "rahasia_arsip_super_aman_123";

// ==========================================
// PENGATURAN SUPABASE
// ⚠️ Ganti dengan Service Role Key BARU hasil rotate!
// Ambil dari: Supabase Dashboard → Settings → API → service_role
// ==========================================
const SUPABASE_URL = "https://cqbsuskfjqqqcqnpgnrx.supabase.co";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxYnN1c2tmanFxcWNxbnBnbnJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5MDI1OTQsImV4cCI6MjA5MjQ3ODU5NH0.EOGA0sYpgOrrOR9YvadDlHYYG2m1lklENzegvA-IXUw"; // ← Ganti ini!
const BUCKET_NAME = "arsip-dokumen";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ==========================================
// PENGATURAN CORS
// ==========================================
app.use(
  cors({
    origin: [
      "https://frontend-arsip.vercel.app",
      "http://localhost:5173",
      "http://localhost:3000",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// Handle preflight OPTIONS request secara eksplisit
app.options("*", cors());

app.use(express.json());

// ==========================================
// KONEKSI DATABASE (SUPABASE POSTGRESQL)
// ==========================================
const DB_URL =
  "postgresql://postgres.cqbsuskfjqqqcqnpgnrx:0OdAHtLbApE7uB4S@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres";

const pg = require("pg");

const sequelize = new Sequelize(DB_URL, {
  dialect: "postgres",
  dialectModule: pg,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  },
  logging: false,
});

sequelize
  .authenticate()
  .then(() => console.log("✅ Database PostgreSQL terhubung!"))
  .catch((err) => console.error("❌ Gagal terhubung ke database:", err));

// ==========================================
// MODEL (TABEL) DATABASE
// ==========================================
const User = sequelize.define("User", {
  username: { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.STRING, allowNull: false, defaultValue: "staf" },
  nomorWa: { type: DataTypes.STRING, allowNull: true },
});

const Arsip = sequelize.define("Arsip", {
  jenisSurat: { type: DataTypes.STRING },
  nomorSurat: { type: DataTypes.STRING },
  nomorBerkas: { type: DataTypes.STRING },
  kodeSurat: { type: DataTypes.STRING },
  penerima: { type: DataTypes.STRING },
  tanggalSurat: { type: DataTypes.DATEONLY },
  perihalSurat: { type: DataTypes.STRING },
  keterangan: { type: DataTypes.TEXT },
  fileName: { type: DataTypes.STRING },
  filePath: { type: DataTypes.STRING }, // URL publik Supabase Storage
});

// ==========================================
// MIDDLEWARE: VERIFIKASI TOKEN JWT
// ==========================================
const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token)
    return res.status(401).json({ message: "Akses ditolak! Token tidak ada." });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res
      .status(403)
      .json({ message: "Token tidak valid atau kadaluarsa!" });
  }
};

// ==========================================
// API ENDPOINTS
// ==========================================

// --- SETUP DATABASE (Jalankan 1x saja lewat browser) ---
app.get("/api/setup-db", async (req, res) => {
  try {
    await sequelize.sync({ alter: true });

    const users = [
      { user: "admin", pass: "admin123", role: "admin", wa: "089512636966" },
      { user: "kepala", pass: "kepala123", role: "kepala", wa: "08222222222" },
      {
        user: "kasubbag",
        pass: "kasubbag123",
        role: "kasubbag",
        wa: "08333333333",
      },
      {
        user: "staf_produksi",
        pass: "staf123",
        role: "staf",
        wa: "081234567890",
      },
      {
        user: "staf_evaluasi",
        pass: "staf123",
        role: "staf",
        wa: "089876543210",
      },
    ];

    let pesan = "Tabel berhasil disinkronisasi. ";
    for (let u of users) {
      const isExist = await User.findOne({ where: { username: u.user } });
      if (!isExist) {
        const hashedPassword = await bcrypt.hash(u.pass, 10);
        await User.create({
          username: u.user,
          password: hashedPassword,
          role: u.role,
          nomorWa: u.wa,
        });
        pesan += `Akun ${u.user} dibuat. `;
      } else {
        pesan += `Akun ${u.user} sudah ada. `;
      }
    }
    res.status(200).json({ message: pesan });
  } catch (error) {
    res.status(500).json({ error: "Gagal setup DB: " + error.message });
  }
});

// --- AUTHENTICATION ---
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ where: { username } });
    if (!user)
      return res.status(404).json({ message: "Username tidak ditemukan!" });

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid)
      return res.status(400).json({ message: "Password salah!" });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "1d" },
    );

    res.status(200).json({
      message: "Login berhasil!",
      token,
      username: user.username,
      role: user.role,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Terjadi kesalahan server", error: error.message });
  }
});

// --- SIMPAN DATA ARSIP ---
// File sudah diupload langsung ke Supabase Storage dari frontend
// Backend hanya menerima URL file (filePath) dan data teks
app.post("/api/arsip", async (req, res) => {
  try {
    const {
      jenisSurat,
      nomorSurat,
      nomorBerkas,
      kodeSurat,
      penerima,
      tanggalSurat,
      perihalSurat,
      keterangan,
      fileName,
      filePath,
    } = req.body;

    if (!filePath) {
      return res.status(400).json({ message: "File PDF wajib diunggah!" });
    }

    const arsipBaru = await Arsip.create({
      jenisSurat,
      nomorSurat,
      nomorBerkas,
      kodeSurat,
      penerima,
      tanggalSurat,
      perihalSurat,
      keterangan,
      fileName,
      filePath,
    });

    res
      .status(201)
      .json({ message: "Arsip berhasil disimpan!", data: arsipBaru });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Terjadi kesalahan server", error: error.message });
  }
});

// --- AMBIL SEMUA ARSIP ---
app.get("/api/arsip", async (req, res) => {
  try {
    const arsip = await Arsip.findAll({ order: [["createdAt", "DESC"]] });
    res.status(200).json(arsip);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Terjadi kesalahan server", error: error.message });
  }
});

// --- HAPUS ARSIP (termasuk file di Supabase Storage) ---
app.delete("/api/arsip/:id", async (req, res) => {
  try {
    const arsip = await Arsip.findByPk(req.params.id);
    if (!arsip)
      return res.status(404).json({ message: "Arsip tidak ditemukan!" });

    // Hapus file dari Supabase Storage jika ada
    if (arsip.filePath) {
      const urlParts = arsip.filePath.split("/");
      const fileNameInStorage = urlParts[urlParts.length - 1];

      const { error: deleteError } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([fileNameInStorage]);

      if (deleteError) {
        console.error("Gagal hapus file dari storage:", deleteError.message);
        // Tetap lanjut hapus dari database meskipun file gagal dihapus
      }
    }

    await arsip.destroy();
    res.status(200).json({ message: "Arsip berhasil dihapus!" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Terjadi kesalahan server", error: error.message });
  }
});

// --- DAFTAR USER UNTUK DISPOSISI ---
app.get("/api/users/staf", async (req, res) => {
  try {
    const staf = await User.findAll({
      where: {
        role: { [Op.in]: ["staf", "admin", "kasubbag"] },
      },
      attributes: ["id", "username", "nomorWa"],
    });
    res.status(200).json(staf);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Terjadi kesalahan server", error: error.message });
  }
});

// --- KIRIM DISPOSISI VIA WHATSAPP ---
app.post("/api/disposisi/whatsapp", async (req, res) => {
  try {
    const { arsipId, userId, pesan } = req.body;

    const arsip = await Arsip.findByPk(arsipId);
    if (!arsip)
      return res.status(404).json({ message: "Arsip tidak ditemukan!" });

    const user = await User.findByPk(userId);
    if (!user)
      return res.status(404).json({ message: "User tidak ditemukan!" });

    if (!user.nomorWa)
      return res
        .status(400)
        .json({ message: "User tidak memiliki nomor WhatsApp!" });

    // Format nomor WA (pastikan diawali 62, bukan 0)
    let nomorWa = user.nomorWa.replace(/\D/g, "");
    if (nomorWa.startsWith("0")) {
      nomorWa = "62" + nomorWa.slice(1);
    }

    const pesanWa =
      pesan ||
      `Yth. ${user.username},\n\nAnda mendapat disposisi surat:\n📋 Perihal: ${arsip.perihalSurat}\n📅 Tanggal: ${arsip.tanggalSurat}\n\n📄 Dokumen dapat dibuka di:\n${arsip.filePath}\n\nTerima kasih.`;

    const waLink = `https://wa.me/${nomorWa}?text=${encodeURIComponent(pesanWa)}`;

    res.status(200).json({
      message: "Link WhatsApp berhasil dibuat!",
      waLink,
      nomorWa,
      dokumenUrl: arsip.filePath,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Terjadi kesalahan server", error: error.message });
  }
});

// ==========================================
// JALANKAN SERVER
// ==========================================
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`🚀 Server backend berjalan di http://localhost:${PORT}`);
  });
}

module.exports = app;
