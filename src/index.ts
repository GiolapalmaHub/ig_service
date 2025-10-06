import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import router from './routes/instagramRoutes.js';

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// MIDDLEWARE CONFIGURATION
// ============================================

// CORS - Permetti richieste dal frontend
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://angelina-soigna-euphoniously.ngrok-free.dev',
  process.env.IVOT_FRONTEND_URL
].filter((origin): origin is string => Boolean(origin));

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Hub-Signature-256'],
}));

// Body parsers
app.use(express.json({ 
  limit: '10mb',
  verify: (req: any, res, buf) => {
    // Salva raw body per verifica signature webhook
    req.rawBody = buf.toString('utf8');
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser con secret key per signed cookies
app.use(cookieParser(process.env.STATE_SECRET_KEY));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// ============================================
// ROUTES
// ============================================

// Health check globale
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'ivot-instagram-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Instagram API routes
app.use('/api/v1/instagram/auth', router);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'IVOT Instagram OAuth Microservice',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      oauth_start: '/api/v1/instagram/auth/url',
      oauth_callback: '/api/v1/instagram/auth/callback',
      webhooks_verify: '/api/v1/instagram/auth/webhooks (GET)',
      webhooks_receive: '/api/v1/instagram/auth/webhooks (POST)',
      publish_image: '/api/v1/instagram/auth/publish/image (POST)',
      publish_video: '/api/v1/instagram/auth/publish/video (POST)',
      publish_carousel: '/api/v1/instagram/auth/publish/carousel (POST)',
      refresh_token: '/api/v1/instagram/auth/refresh-token (POST)',
      rate_limit: '/api/v1/instagram/auth/rate-limit (GET)'
    },
    documentation: 'https://github.com/your-repo/ivot-instagram-service'
  });
});

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler - deve essere DOPO tutte le routes
app.use((req, res) => {
  console.warn(`404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} does not exist`,
    path: req.path,
    availableEndpoints: [
      '/health',
      '/api/v1/instagram/auth/url',
      '/api/v1/instagram/auth/callback',
      '/api/v1/instagram/auth/webhooks',
      '/api/v1/instagram/auth/publish/image',
      '/api/v1/instagram/auth/publish/video',
      '/api/v1/instagram/auth/publish/carousel'
    ]
  });
});

// Global error handler - deve essere ULTIMO
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Unhandled error:', {
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
  
  // Non esporre dettagli interni in production
  const message = process.env.NODE_ENV === 'development' 
    ? err.message 
    : 'Internal server error';
  
  res.status(500).json({
    error: 'Internal Server Error',
    message,
    timestamp: new Date().toISOString()
  });
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, closing server gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, closing server gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Gestisci errori non catturati
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// ============================================
// START SERVER
// ============================================

const server = app.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                                                           ║');
  console.log('║   🚀 IVOT Instagram OAuth Microservice                   ║');
  console.log('║                                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`📍 Server:        http://localhost:${PORT}`);
  console.log(`🌍 Environment:   ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 ngrok URL:     ${process.env.INSTAGRAM_REDIRECT_URI?.split('/api')[0] || 'Not configured'}`);
  console.log(`📱 Frontend:      ${process.env.IVOT_FRONTEND_URL || 'Not configured'}`);
  console.log('');
  console.log('📋 Available Endpoints:');
  console.log('   GET  /health');
  console.log('   GET  /api/v1/instagram/auth/url');
  console.log('   GET  /api/v1/instagram/auth/callback');
  console.log('   GET  /api/v1/instagram/auth/webhooks');
  console.log('   POST /api/v1/instagram/auth/webhooks');
  console.log('   POST /api/v1/instagram/auth/publish/image');
  console.log('   POST /api/v1/instagram/auth/publish/video');
  console.log('   POST /api/v1/instagram/auth/publish/carousel');
  console.log('   POST /api/v1/instagram/auth/refresh-token');
  console.log('   GET  /api/v1/instagram/auth/rate-limit');
  console.log('');
  console.log('✅ Ready to handle requests');
  console.log('');
  
  // Valida configurazione
  const requiredEnvVars = [
    'INSTAGRAM_APP_ID',
    'INSTAGRAM_APP_SECRET',
    'INSTAGRAM_REDIRECT_URI',
    'STATE_SECRET_KEY',
    'VERIFY_TOKEN'
  ];
  
  const missing = requiredEnvVars.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.warn('⚠️  Missing environment variables:', missing.join(', '));
    console.warn('   Some features may not work correctly');
    console.log('');
  }
});

export default app;