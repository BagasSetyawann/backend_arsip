const express = require("express");
const { Sequelize, DataTypes } = require("sequelize");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = 5000;
const JWT_SECRET = "rahasia_arsip_super_aman_123";

app.use(
  cors({
    // Izinkan frontend Vercel kamu dan localhost (jika dites di komputer)
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

// Tambahkan penanganan khusus untuk 'preflight' request (wajib untuk Vercel)
app.options("*", cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");

// ==========================================
// 1. KONEKSI DATABASE (POSTGRESQL via SEQUELIZE)
// ==========================================
// Format: new Sequelize('nama_database', 'username', 'password', { ... })

// ==========================================
// 1. KONEKSI DATABASE (SUPABASE POSTGRESQL)
// ==========================================
// Masukkan Connection String dari Supabase di sini
const DB_URL =
  'DATABASE_URL="postgresql://postgres.cqbsuskfjqqqcqnpgnrx:0OdAHtLbApE7uB4S@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres"';

const sequelize = new Sequelize(DB_URL, {
  dialect: "postgres",
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false, // Wajib untuk Supabase
    },
  },
  logging: false,
});

// const sequelize = new Sequelize("db_earsip", "postgres", "bagaz6645", {
//   host: "localhost",
//   dialect: "postgres",
//   logging: false, // Ubah ke console.log jika ingin melihat query SQL yang berjalan
// });

sequelize
  .authenticate()
  .then(() => console.log("✅ Database PostgreSQL terhubung!"))
  .catch((err) => console.error("❌ Gagal terhubung ke database:", err));

// ==========================================
// 2. MEMBUAT MODEL (TABEL) DATABASE
// ==========================================

// A. Tabel User (Untuk Login)
const User = sequelize.define("User", {
  username: { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.STRING, allowNull: false, defaultValue: "staf" },
  nomorWa: { type: DataTypes.STRING, allowNull: true }, // <-- Tambahan kolom nomor WA
});

// B. Tabel Arsip (Untuk Surat)
const Arsip = sequelize.define("Arsip", {
  jenisSurat: { type: DataTypes.STRING },
  nomorSurat: { type: DataTypes.STRING },
  nomorBerkas: { type: DataTypes.STRING },
  kodeSurat: { type: DataTypes.STRING },
  penerima: { type: DataTypes.STRING },
  tanggalSurat: { type: DataTypes.DATEONLY }, // DATEONLY hanya menyimpan tanggal, tanpa jam
  perihalSurat: { type: DataTypes.STRING },
  keterangan: { type: DataTypes.TEXT },
  fileName: { type: DataTypes.STRING },
  filePath: { type: DataTypes.STRING },
});

// ==========================================
// 3. SINKRONISASI & SEEDER ADMIN OTOMATIS
// ==========================================
// sync({ alter: true }) akan otomatis membuat/mengupdate tabel di Postgres tanpa menghapus data
sequelize.sync({ alter: true }).then(async () => {
  console.log("✅ Tabel database berhasil disinkronisasi.");

  try {
    // Menambahkan contoh staf dari berbagai tim divisi
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
        console.log(`✅ Akun dibuat: ${u.user}`);
      }
    }
  } catch (error) {
    console.error("❌ Gagal mendeklarasikan akun awal:", error);
  }
});

// ==========================================
// 4. KONFIGURASI MULTER (UPLOAD FILE PDF)
// ==========================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Bukan file PDF!"), false);
  },
});

// ==========================================
// 5. API ENDPOINTS (ROUTES)
// ==========================================

// --- API AUTHENTICATION ---
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // Pencarian di Postgres menggunakan objek 'where'
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

    // Kirimkan juga role-nya ke frontend
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

// --- API ARSIP ---
app.post("/api/arsip", upload.single("filePdf"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: "File PDF wajib diunggah!" });

    // Insert data ke Postgres menggunakan method .create()
    const arsipBaru = await Arsip.create({
      ...req.body,
      fileName: req.file.originalname,
      filePath: `/uploads/${req.file.filename}`,
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

// --- API MENGAMBIL DAFTAR STAF UNTUK DISPOSISI ---
app.get("/api/users/staf", async (req, res) => {
  try {
    // Hanya ambil user dengan role 'staf'
    const staf = await User.findAll({
      where: { role: "staf" },
      attributes: ["id", "username", "nomorWa"], // Hanya ambil data yang diperlukan
    });
    res.status(200).json(staf);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Terjadi kesalahan server", error: error.message });
  }
});

app.get("/api/arsip", async (req, res) => {
  try {
    // Mengambil semua data, diurutkan dari yang terbaru (DESC)
    const arsip = await Arsip.findAll({ order: [["createdAt", "DESC"]] });
    res.status(200).json(arsip);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Terjadi kesalahan server", error: error.message });
  }
});

app.delete("/api/arsip/:id", async (req, res) => {
  try {
    // Cari data berdasarkan Primary Key (id)
    const arsip = await Arsip.findByPk(req.params.id);
    if (!arsip)
      return res.status(404).json({ message: "Arsip tidak ditemukan!" });

    if (arsip.filePath) {
      const fullPath = path.join(__dirname, arsip.filePath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }

    // Hapus baris data dari database
    await arsip.destroy();
    res.status(200).json({ message: "Arsip berhasil dihapus!" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Terjadi kesalahan server", error: error.message });
  }
});

// ==========================================
// 6. JALANKAN SERVER
// ==========================================
app.listen(PORT, () => {
  console.log(`🚀 Server backend berjalan di http://localhost:${PORT}`);
});

app.listen(PORT, () => {
  console.log(`🚀 Server berjalan di port ${PORT}`);
});

// Wajib ditambahkan untuk Vercel Serverless
module.exports = app;
