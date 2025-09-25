import type { Request, Response, NextFunction } from 'express';

export const verifyInternalApiKey = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Accesso non autorizzato.' });
  }

  next();
};
