import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import connectDB from "./config/db.js";
import mongoose from "mongoose";
import authRoutes from "./routes/auth.js";
import bookRoutes from "./routes/books.js";
import borrowRoutes from "./routes/borrow.js";

// Load environment variables from server/.env
dotenv.config({ path: new URL("./.env", import.meta.url).pathname });

if (!process.env.JWT_SECRET) {
  console.error(
    "JWT_SECRET is not configured. Copy server/.env.example to server/.env and set JWT_SECRET.",
  );
  process.exit(1);
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://localhost:4173",
      "https://e-librarycentre.netlify.app",
      "https://e-lib-k9tp.onrender.com",
    ],
    methods: ["GET", "POST"],
  },
});

app.set("io", io);

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("join", ({ userId, role }) => {
    if (role === "admin") {
      socket.join("admins");
    }
    if (userId) {
      socket.join(`user-${userId}`);
    }
  });
});

// Middleware

const clientOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:5173",
  "http://localhost:3000",

  "https://e-librarycentre.netlify.app",
  "https://e-lib-k9tp.onrender.com",

  "http://localhost:4173",
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      if (clientOrigins.length === 0 || clientOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS origin denied: ${origin}`), false);
    },

    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/books", bookRoutes);
app.use("/api/borrow", borrowRoutes);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "E-Library API is running" });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  const dbConnected = await connectDB();

  if (!dbConnected) {
    console.warn(
      "Database connection is unavailable. Configure MONGODB_URI and Atlas IP access to enable data features.",
    );
  }

  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

// Ensure indexes for books collection are correct to avoid duplicate-null unique index errors
async function ensureBookIndexes() {
  try {
    if (!mongoose.connection || !mongoose.connection.db) return;
    const coll = mongoose.connection.db.collection("books");
    const existingIndexes = await coll.indexes();

    // Drop old isbnNormalized index if present (legacy)
    if (existingIndexes.some((i) => i.name === "isbnNormalized_1")) {
      try {
        await coll.dropIndex("isbnNormalized_1");
        console.log("Dropped legacy index: isbnNormalized_1");
      } catch (e) {
        console.warn("Failed to drop isbnNormalized_1 index:", e.message || e);
      }
    }

    // Create safe unique partial index on accNoNormalized
    const hasAccNoIndex = existingIndexes.some(
      (i) => i.name === "accNoNormalized_unique",
    );
    if (!hasAccNoIndex) {
      try {
        await coll.createIndex(
          { accNoNormalized: 1 },
          {
            name: "accNoNormalized_unique",
            unique: true,
            partialFilterExpression: {
              accNoNormalized: { $exists: true, $ne: null },
            },
          },
        );
        console.log("Created unique partial index: accNoNormalized_unique");
      } catch (e) {
        console.warn(
          "Failed to create accNoNormalized_unique index:",
          e.message || e,
        );
      }
    }
  } catch (err) {
    console.error("ensureBookIndexes error:", err);
  }
}

// Run index fix after DB connection established
startServer().then(() => ensureBookIndexes());
