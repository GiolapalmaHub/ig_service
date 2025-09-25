import express from 'express';
import dotenv from 'dotenv';
import instagramRoutes from './routes/instagramRoutes'
dotenv.config();

const app = express();
const PORT = process.env.PORT;

app.use(express.json());

// Rotte principali per l'API di Instagram
app.use('/api/v1/instagram', instagramRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Servizio Instagram in ascolto sulla porta ${PORT}`);
});
