import express, { Application } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import healthRoutes from './routes/health.routes';
import authRoutes from './routes/auth.routes';

// Load environment variables from .env
dotenv.config();

// Refuse to operate when critical auth secrets are missing
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
  console.error('[FATAL] JWT_SECRET is not configured in environment variables. Refusing to start server.');
  process.exit(1);
}

const app: Application = express();
const PORT = process.env.PORT || 5001;

// Global Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);

// Start Server
app.listen(PORT, () => {
  console.log(`[cineVault Server] Running at http://localhost:${PORT}`);
  console.log(`[cineVault Server] Health check available at http://localhost:${PORT}/api/health`);
  console.log(`[cineVault Server] Auth routes mounted at http://localhost:${PORT}/api/auth`);
});

export default app;
