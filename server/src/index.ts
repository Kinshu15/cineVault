import express, { Application } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import healthRoutes from './routes/health.routes';

// Load environment variables from .env
dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5001;

// Global Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api', healthRoutes);

// Start Server
app.listen(PORT, () => {
  console.log(`[cineVault Server] Running at http://localhost:${PORT}`);
  console.log(`[cineVault Server] Health check available at http://localhost:${PORT}/api/health`);
});

export default app;
