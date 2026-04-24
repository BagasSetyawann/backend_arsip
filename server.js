const express = require("express");
const { Sequelize, DataTypes } = require("sequelize");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = "rahasia_arsip_super_aman_123";

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

app.use(express.json());

// ==========================================
// PENGATURAN FOLDER UPLOAD (Vercel Safe)
// ==========================================
// Vercel hanya mengizinkan kita menulis file di folder /tmp
const uploadDir = process.env.VERCEL ? "/tmp/uploads" : "./uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use("/uploads", express.static(uploadDir));

// ==========================================
// 1. KONEKSI DATABASE (SUPABASE POSTGRESQL)
// ==========================================
const DB_URL = "postgresql://postgres.cqbsuskfjqqqcqnpgnrx:0OdAHtLbApE7uB4S@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres";

// Tambahkan require('pg') secara eksplisit agar Vercel tidak membuangnya
const pg = require('pg'); 

const sequelize = new Sequelize(DB_URL, {
  dialect: "postgres",
  dialectModule: pg, // <--- INI KUNCI RAHASIANYA!
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false, // Wajib untuk Supabase
    },
  },
  logging: false,
});

sequelize
  .authenticate()
  .then(() => console.log("✅ Database PostgreSQL terhubung!"))
  .catch((err) => console.error("❌ Gagal terhubung ke database:", err));

// ==========================================
// 2. MEMBUAT MODEL (TABEL) DATABASE
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
  filePath: { type: DataTypes.STRING },
});

// ==========================================
// 3. KONFIGURASI MULTER (UPLOAD FILE PDF)
// ==========================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir), // Diarahkan ke folder yang aman
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
// 4. API ENDPOINTS (ROUTES)
// ==========================================

// --- API KHUSUS SETUP DATABASE (Dijalankan 1x lewat browser) ---
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
      }
    }
    res.status(200).json({ message: pesan });
  } catch (error) {
    res.status(500).json({ error: "Gagal setup DB: " + error.message });
  }
});

// --- API AUTHENTICATION ---
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

// --- API ARSIP ---
app.post("/api/arsip", upload.single("filePdf"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: "File PDF wajib diunggah!" });

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

app.delete("/api/arsip/:id", async (req, res) => {
  try {
    const arsip = await Arsip.findByPk(req.params.id);
    if (!arsip)
      return res.status(404).json({ message: "Arsip tidak ditemukan!" });

    if (arsip.filePath) {
      // Vercel membersihkan tmp secara otomatis, tapi ini aman untuk lokal
      const fullPath = path.join(
        process.env.VERCEL ? "/tmp" : __dirname,
        arsip.filePath,
      );
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }

    await arsip.destroy();
    res.status(200).json({ message: "Arsip berhasil dihapus!" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Terjadi kesalahan server", error: error.message });
  }
});

// --- API MENGAMBIL DAFTAR STAF UNTUK DISPOSISI ---
app.get("/api/users/staf", async (req, res) => {
  try {
    const staf = await User.findAll({
      where: { role: ["staf", "admin", "kasubbag"] },
      attributes: ["id", "username", "nomorWa"],
    });
    res.status(200).json(staf);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Terjadi kesalahan server", error: error.message });
  }
});

// ==========================================
// 5. JALANKAN SERVER
// ==========================================
// Matikan app.listen jika sedang berada di Vercel (Production)
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`🚀 Server backend berjalan di http://localhost:${PORT}`);
  });
}

// Ekspor app agar bisa dibaca oleh Vercel
module.exports = app;
