import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import router from './routes/instagramRoutes.js';



const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.STATE_SECRET_KEY));

// Routes - CAMBIA QUI
app.use('/api/v1/instagram/auth', router);

app.use(cors({
  origin: [
    'http://localhost:5173',  // Il tuo frontend React locale
    'https://angelina-soigna-euphoniously.ngrok-free.dev'  // Se host frontend su ngrok
  ],
  credentials: true  // Permetti cookies (per OAuth state)
}));

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
  });
});

app.listen(PORT, () => {
  console.log('🚀 Instagram OAuth Microservice');
  console.log(`   Port: ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('   Ready to handle OAuth requests');
});